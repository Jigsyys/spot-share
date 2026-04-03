# Performance, Realtime & Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Éliminer les lags de chargement (viewport-based loading), corriger les notifications temps réel (tables manquantes dans la publication Supabase), et supprimer les positions d'amis + ghost mode.

**Architecture:**
- Le chargement des spots passe de "tout charger" à "charger uniquement les spots dans le viewport courant", fusionnant les résultats dans un Map par ID pour éviter les doublons.
- Les notifications temps réel sont cassées parce que `friend_requests`, `followers` et `spots` ne sont pas dans la publication `supabase_realtime` — une migration SQL corrige ça.
- Ghost mode et positions d'amis sont supprimés proprement du code et de la DB.

**Tech Stack:** Next.js 16 App Router, Supabase Realtime, React 19, TypeScript, Mapbox GL JS

---

## Fichiers modifiés

| Fichier | Changement |
|---------|-----------|
| `supabase/migrations/20260403_realtime_indexes.sql` | Créer — publication Realtime + index |
| `components/map/MapView.tsx` | Modifier — viewport loading, suppression ghost mode/positions |
| `components/map/ProfileModal.tsx` | Modifier — suppression toggle ghost mode |
| `components/map/FriendsModal.tsx` | Modifier — suppression is_ghost_mode des selects + isOnline |

---

## Task 1 : Supabase — Realtime publication + index DB

**Cause du bug notifs :** `friend_requests`, `followers`, `spots` ne sont pas dans la publication `supabase_realtime`. Les callbacks Realtime ne se déclenchent jamais.

**Files:**
- Create: `supabase/migrations/20260403_realtime_indexes.sql`

- [ ] **Step 1 : Créer la migration SQL**

Créer le fichier `supabase/migrations/20260403_realtime_indexes.sql` avec ce contenu exact :

```sql
-- ── 1. Ajouter les tables manquantes à la publication Supabase Realtime ──────
-- friend_requests, followers, spots ne reçoivent pas les events Realtime
-- car ils n'étaient pas dans la publication.
ALTER PUBLICATION supabase_realtime ADD TABLE public.friend_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.followers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.spots;
ALTER PUBLICATION supabase_realtime ADD TABLE public.spot_reactions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.spot_visits;

-- ── 2. REPLICA IDENTITY FULL sur ces tables ───────────────────────────────────
-- Nécessaire pour que les filtres Realtime (filter: `to_id=eq.xxx`) fonctionnent
-- correctement sur les events UPDATE et DELETE.
ALTER TABLE public.friend_requests REPLICA IDENTITY FULL;
ALTER TABLE public.followers REPLICA IDENTITY FULL;
ALTER TABLE public.spots REPLICA IDENTITY FULL;
ALTER TABLE public.spot_reactions REPLICA IDENTITY FULL;
ALTER TABLE public.spot_visits REPLICA IDENTITY FULL;

-- ── 3. Index spatial pour le chargement par viewport ─────────────────────────
-- Permet à la requête WHERE lat BETWEEN x AND y AND lng BETWEEN a AND b
-- d'être exécutée en O(log n) au lieu de O(n).
CREATE INDEX IF NOT EXISTS idx_spots_lat_lng ON public.spots (lat, lng);

-- Index created_at pour le ORDER BY lors de la pagination
CREATE INDEX IF NOT EXISTS idx_spots_created_at ON public.spots (created_at DESC);
```

- [ ] **Step 2 : Appliquer la migration via Supabase MCP**

Utiliser `mcp__supabase__apply_migration` avec le contenu du fichier ci-dessus et le `project_id` `knfprbelfybkmlojltpr`.

- [ ] **Step 3 : Vérifier la publication**

```sql
SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY tablename;
```

Résultat attendu — doit inclure : `activities`, `followers`, `friend_requests`, `outing_invitations`, `outings`, `spot_group_invitations`, `spot_group_spots`, `spot_reactions`, `spot_visits`, `spots`.

- [ ] **Step 4 : Vérifier les index**

```sql
SELECT indexname FROM pg_indexes WHERE tablename = 'spots' ORDER BY indexname;
```

Résultat attendu — doit inclure : `idx_spots_created_at`, `idx_spots_lat_lng`.

- [ ] **Step 5 : Commit**

```bash
git add supabase/migrations/20260403_realtime_indexes.sql
git commit -m "fix: add missing tables to supabase_realtime publication + spatial indexes"
```

---

## Task 2 : Viewport-based spot loading dans MapView.tsx

Remplacer `fetchSpots()` (charge tout) par `fetchSpotsByBounds(bbox)` (charge uniquement le viewport). Les spots sont fusionnés dans un `Map<id, Spot>` pour éviter les doublons lors des pan/zoom. Les profils des auteurs sont chargés séparément en arrière-plan uniquement pour les spots visibles.

**Files:**
- Modify: `components/map/MapView.tsx`

### 2a : Modifier les constantes de cache en haut du fichier

- [ ] **Step 1 : Mettre à jour les TTL et supprimer SPOTS_CACHE_KEY**

Dans `MapView.tsx`, lignes 54-58, remplacer :

```ts
const SPOTS_CACHE_KEY = "friendspot_spots_v2"
const SPOTS_CACHE_TTL = 10 * 60 * 1000 // 10 min
const PROFILE_CACHE_TTL = 30 * 60 * 1000 // 30 min
const FOLLOWING_CACHE_TTL = 15 * 60 * 1000 // 15 min
const LIKES_CACHE_TTL = 5 * 60 * 1000 // 5 min
```

Par :

```ts
const SPOTS_CACHE_KEY = "friendspot_spots_v3"
const SPOTS_CACHE_TTL = 2 * 60 * 60 * 1000 // 2h — Realtime maintient la fraîcheur
const PROFILE_CACHE_TTL = 2 * 60 * 60 * 1000 // 2h
const FOLLOWING_CACHE_TTL = 60 * 60 * 1000 // 1h
const LIKES_CACHE_TTL = 5 * 60 * 1000 // 5 min
```

### 2b : Ajouter le ref profilesCache et spotsMap en haut des states

- [ ] **Step 2 : Ajouter deux refs après `spotDataCacheRef`**

Après la ligne `const spotDataCacheRef = useRef<SpotDataCache>(new globalThis.Map())` (ligne ~395), ajouter :

```ts
// Map id→Spot pour fusion sans doublons lors des viewport fetches
const spotsMapRef = useRef<globalThis.Map<string, Spot>>(new globalThis.Map())
// Cache profils auteurs des spots (id→Profile)
const spotProfilesCacheRef = useRef<globalThis.Map<string, { username: string | null; avatar_url: string | null; created_at: string }>>(new globalThis.Map())
```

### 2c : Remplacer fetchSpots par fetchSpotsByBounds

- [ ] **Step 3 : Remplacer la fonction fetchSpots (lignes 522-595)**

Remplacer la fonction entière `fetchSpots` par :

```ts
const fetchSpotsByBounds = useCallback(async (bbox: [number, number, number, number]) => {
  const [west, south, east, north] = bbox
  const filterExpired = (list: Spot[]) =>
    list.filter(s => !s.expires_at || new Date(s.expires_at).getTime() > Date.now())

  // 1. Afficher le cache localStorage instantanément au premier appel
  try {
    const raw = localStorage.getItem(SPOTS_CACHE_KEY)
    if (raw) {
      const { data: cached, ts } = JSON.parse(raw)
      if (Date.now() - ts < SPOTS_CACHE_TTL && Array.isArray(cached)) {
        const valid = filterExpired(cached as Spot[])
        valid.forEach(s => spotsMapRef.current.set(s.id, s))
        setSpots(Array.from(spotsMapRef.current.values()))
      }
    }
  } catch { /* localStorage unavailable */ }

  // 2. Fetch spots dans le viewport uniquement (sans JOIN profiles)
  try {
    const { data, error } = await supabaseRef.current
      .from("spots")
      .select("id, user_id, title, description, lat, lng, category, image_url, address, opening_hours, weekday_descriptions, maps_url, price_range, instagram_url, created_at, expires_at, visibility, group_id")
      .gte("lat", south).lte("lat", north)
      .gte("lng", west).lte("lng", east)
      .order("created_at", { ascending: false })
      .limit(200)

    if (error) throw error

    if (data && data.length > 0) {
      const fresh = filterExpired(data as Spot[])
      // Fusionner avec les profiles déjà en cache
      const withProfiles = fresh.map(s => ({
        ...s,
        profiles: spotProfilesCacheRef.current.has(s.user_id)
          ? spotProfilesCacheRef.current.get(s.user_id)!
          : s.profiles,
      }))
      withProfiles.forEach(s => spotsMapRef.current.set(s.id, s))
      setSpots(Array.from(spotsMapRef.current.values()))

      // 3. Enrichir en arrière-plan avec les profils manquants
      const missingUserIds = [...new Set(fresh.map(s => s.user_id))]
        .filter(id => !spotProfilesCacheRef.current.has(id))
      if (missingUserIds.length > 0) {
        supabaseRef.current
          .from("profiles")
          .select("id, username, avatar_url, created_at")
          .in("id", missingUserIds)
          .then(({ data: profiles }) => {
            if (!profiles) return
            profiles.forEach((p: { id: string; username: string | null; avatar_url: string | null; created_at: string }) => {
              spotProfilesCacheRef.current.set(p.id, { username: p.username, avatar_url: p.avatar_url, created_at: p.created_at })
            })
            // Re-attacher les profils sur les spots concernés
            setSpots(prev => prev.map(s => {
              const prof = spotProfilesCacheRef.current.get(s.user_id)
              if (!prof) return s
              const updated = { ...s, profiles: { id: s.user_id, ...prof } }
              spotsMapRef.current.set(s.id, updated)
              return updated
            }))
          })
      }

      // 4. Persister le cache (tous les spots fusionnés)
      try {
        const allSpots = Array.from(spotsMapRef.current.values())
        localStorage.setItem(SPOTS_CACHE_KEY, JSON.stringify({ data: allSpots, ts: Date.now() }))
      } catch { /* quota exceeded */ }
    }
  } catch (_e) {
    console.error("fetchSpotsByBounds error:", _e)
    if (spotsMapRef.current.size === 0) setSpots(DEMO_SPOTS)
    toast.error("Impossible de charger les spots", {
      action: { label: "Réessayer", onClick: () => fetchSpotsByBounds(bbox) },
      duration: 8000,
    })
  } finally {
    setSpotsLoaded(true)
  }
}, [])
```

### 2d : Remplacer le useEffect de mount et ajouter onMoveEnd

- [ ] **Step 4 : Remplacer le useEffect fetchSpots au mount (ligne ~897-900)**

Remplacer :
```ts
useEffect(() => {
  Promise.all([fetchSpots(), fetchLikeCounts()])
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [])
```

Par :
```ts
useEffect(() => {
  Promise.all([fetchSpotsByBounds(bounds), fetchLikeCounts()])
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [])
```

- [ ] **Step 5 : Ajouter le handler debounced onMoveEnd sur la carte**

Après les useEffects de mount (ligne ~912), ajouter :

```ts
// Ref pour debounce du fetch viewport
const fetchBoundsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

const handleMapMoveEnd = useCallback(() => {
  const map = mapRef.current?.getMap()
  if (!map) return
  const b = map.getBounds()
  if (!b) return
  const newBounds: [number, number, number, number] = [
    b.getWest(), b.getSouth(), b.getEast(), b.getNorth()
  ]
  setBounds(newBounds)
  if (fetchBoundsTimerRef.current) clearTimeout(fetchBoundsTimerRef.current)
  fetchBoundsTimerRef.current = setTimeout(() => {
    fetchSpotsByBounds(newBounds)
  }, 400)
}, [fetchSpotsByBounds])
```

- [ ] **Step 6 : Brancher onMoveEnd sur la Map JSX**

Chercher la prop `onMove` ou `onZoom` sur le composant `<Map` dans le JSX (vers ligne 1700+) et ajouter :

```tsx
onMoveEnd={handleMapMoveEnd}
```

Si la prop `onMove` existe déjà pour setBounds, la remplacer par `onMoveEnd` (plus efficace — ne se déclenche qu'une fois le mouvement terminé, pas à chaque frame).

### 2e : Mettre à jour le Realtime INSERT spots

- [ ] **Step 7 : Mettre à jour le handler Realtime INSERT spots (ligne ~1053)**

Le handler actuel récupère le spot via une 2e requête SELECT. Mettre à jour pour aussi enrichir avec le profil depuis le cache :

Trouver ce bloc :
```ts
.on(
  "postgres_changes",
  { event: "INSERT", schema: "public", table: "spots" },
  async (payload) => {
    const raw = payload.new as Spot
    if (raw.user_id === user.id) return
    if (!visibleFriendIdsRef.current.has(raw.user_id)) return
    const { data } = await supabaseRef.current
      .from("spots")
      .select("*, profiles(id, username, avatar_url, created_at)")
      .eq("id", raw.id)
      .single()
    if (data) setSpots((prev) => prev.some((s) => s.id === data.id) ? prev : [data, ...prev])
  }
)
```

Remplacer par :
```ts
.on(
  "postgres_changes",
  { event: "INSERT", schema: "public", table: "spots" },
  async (payload) => {
    const raw = payload.new as Spot
    if (raw.user_id === user.id) return
    if (!visibleFriendIdsRef.current.has(raw.user_id)) return
    // Enrichir avec profil depuis cache ou fetch
    const cachedProfile = spotProfilesCacheRef.current.get(raw.user_id)
    if (cachedProfile) {
      const spot = { ...raw, profiles: { id: raw.user_id, ...cachedProfile } }
      spotsMapRef.current.set(spot.id, spot)
      setSpots(prev => prev.some(s => s.id === spot.id) ? prev : [spot, ...prev])
    } else {
      const { data } = await supabaseRef.current
        .from("spots")
        .select("id, user_id, title, description, lat, lng, category, image_url, address, opening_hours, weekday_descriptions, maps_url, price_range, instagram_url, created_at, expires_at, visibility, group_id, profiles(id, username, avatar_url, created_at)")
        .eq("id", raw.id)
        .single()
      if (data) {
        spotsMapRef.current.set(data.id, data as Spot)
        setSpots(prev => prev.some(s => s.id === data.id) ? prev : [data as Spot, ...prev])
      }
    }
  }
)
```

- [ ] **Step 8 : Commit**

```bash
git add components/map/MapView.tsx
git commit -m "feat: viewport-based spot loading with profile enrichment + 2h cache TTL"
```

---

## Task 3 : Supprimer les positions d'amis et le ghost mode

### 3a : MapView.tsx — suppression des states et fonctions

**Files:**
- Modify: `components/map/MapView.tsx`

- [ ] **Step 1 : Supprimer le state friendLocations (lignes ~415-424)**

Supprimer :
```ts
const [friendLocations, setFriendLocations] = useState<
  {
    id: string
    username: string | null
    avatar_url: string | null
    lat: number
    lng: number
    last_active_at: string
  }[]
>([])
```

- [ ] **Step 2 : Supprimer is_ghost_mode du type userProfile (ligne ~408)**

Remplacer :
```ts
const [userProfile, setUserProfile] = useState<{
  username: string
  avatar_url: string | null
  is_ghost_mode?: boolean
  is_admin?: boolean
} | null>(null)
```

Par :
```ts
const [userProfile, setUserProfile] = useState<{
  username: string
  avatar_url: string | null
  is_admin?: boolean
} | null>(null)
```

- [ ] **Step 3 : Supprimer is_ghost_mode du select fetchUserProfile (ligne ~496)**

Remplacer :
```ts
.select("username, avatar_url, is_ghost_mode, is_admin")
```

Par :
```ts
.select("username, avatar_url, is_admin")
```

- [ ] **Step 4 : Supprimer la fonction fetchFriendLocations (lignes 662-707)**

Supprimer la fonction entière `fetchFriendLocations`.

- [ ] **Step 5 : Supprimer la fonction publishLocation (lignes 710-727)**

Supprimer la fonction entière `publishLocation`.

- [ ] **Step 6 : Supprimer le useEffect fetchFriendLocations (ligne ~909-911)**

Supprimer :
```ts
useEffect(() => {
  fetchFriendLocations()
}, [fetchFriendLocations])
```

- [ ] **Step 7 : Supprimer le useEffect publishLocation (lignes ~1142-1162)**

Supprimer l'useEffect qui contient `publishLocation(lat, lng)` et `setInterval` de 5 minutes.

- [ ] **Step 8 : Supprimer la ligne setVisibleFriendIds dans le Realtime followers**

Dans le handler Realtime `followers INSERT` (ligne ~1048), supprimer la ligne :
```ts
setVisibleFriendIds((prev) => prev.includes(newId) ? prev : [...prev, newId])
```
(garder seulement `setFollowingIds`)

- [ ] **Step 9 : Supprimer les marqueurs friendLocations du JSX (lignes ~1776-1820)**

Supprimer le bloc JSX entier :
```tsx
{/* Friend Location Markers */}
{friendLocations.map((friend) => {
  ...
})}
```

- [ ] **Step 10 : Supprimer setFriendLocations dans le unfollow handler (ligne ~3066-3067)**

Trouver et supprimer la ligne :
```ts
setFriendLocations((prev) => prev.filter((x) => x.id !== id))
```

### 3b : ProfileModal.tsx — suppression du toggle ghost mode

**Files:**
- Modify: `components/map/ProfileModal.tsx`

- [ ] **Step 11 : Supprimer isGhostMode state et toggleGhostMode**

Dans `ProfileModal.tsx` :

1. Supprimer `const [isGhostMode, setIsGhostMode] = useState(false)` (ligne ~120)
2. Supprimer `setIsGhostMode(!!d.is_ghost_mode)` dans le fetch profil (ligne ~161)
3. Supprimer la fonction `toggleGhostMode` entière (lignes ~354-367)
4. Dans le select du fetch profil, supprimer `is_ghost_mode` du champ select (ligne ~154 dans le type et la requête)

- [ ] **Step 12 : Supprimer le toggle ghost mode du JSX (ProfileModal.tsx ligne ~1076)**

Supprimer le bouton toggle entier qui contient `onClick={toggleGhostMode}` et les classes `isGhostMode ? ...`. Chercher le bloc qui ressemble à :

```tsx
<button
  onClick={toggleGhostMode}
  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isGhostMode ? "bg-blue-600 dark:bg-indigo-500" : "bg-gray-300 dark:bg-zinc-700"}`}
>
  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isGhostMode ? "translate-x-6" : "translate-x-1"}`} />
</button>
```

Et supprimer tout le conteneur parent de ce toggle (label + toggle + description).

### 3c : FriendsModal.tsx — nettoyage is_ghost_mode

**Files:**
- Modify: `components/map/FriendsModal.tsx`

- [ ] **Step 13 : Supprimer is_ghost_mode de l'interface Profile locale**

Dans `FriendsModal.tsx`, ligne ~105, supprimer :
```ts
is_ghost_mode?: boolean
```

- [ ] **Step 14 : Simplifier la fonction isOnline**

Chercher la fonction `isOnline` dans FriendsModal.tsx. Elle prend `(last_active_at, is_ghost_mode)`. La simplifier pour ignorer ghost mode :

Remplacer toutes les occurrences de `isOnline(f.last_active_at, f.is_ghost_mode)` par `isOnline(f.last_active_at)`.

Modifier la signature de `isOnline` pour ne prendre qu'un paramètre :
```ts
function isOnline(last_active_at: string | null | undefined): boolean {
  if (!last_active_at) return false
  return Date.now() - new Date(last_active_at).getTime() < 10 * 60 * 1000
}
```

- [ ] **Step 15 : Supprimer is_ghost_mode des selects Supabase dans FriendsModal**

Chercher et supprimer `is_ghost_mode` dans tous les `.select(...)` de FriendsModal.tsx (lignes ~386, ~441, ~757, ~1091).

- [ ] **Step 16 : Commit**

```bash
git add components/map/MapView.tsx components/map/ProfileModal.tsx components/map/FriendsModal.tsx
git commit -m "feat: remove friend locations + ghost mode, clean up related DB queries"
```

---

## Task 4 : Supprimer la colonne is_ghost_mode de la DB

**Files:**
- Create: `supabase/migrations/20260403_remove_ghost_mode.sql`

- [ ] **Step 1 : Créer la migration**

```sql
-- Supprime la colonne ghost mode devenue inutile
-- Les données last_lat, last_lng, last_active_at restent (utilisées pour "en ligne")
ALTER TABLE public.profiles DROP COLUMN IF EXISTS is_ghost_mode;
```

- [ ] **Step 2 : Appliquer via Supabase MCP**

Utiliser `mcp__supabase__apply_migration` avec le projet `knfprbelfybkmlojltpr`.

- [ ] **Step 3 : Vérifier**

```sql
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'profiles' AND table_schema = 'public'
ORDER BY column_name;
```

Vérifier que `is_ghost_mode` n'apparaît plus.

- [ ] **Step 4 : Commit**

```bash
git add supabase/migrations/20260403_remove_ghost_mode.sql
git commit -m "fix: drop is_ghost_mode column from profiles"
```

---

## Task 5 : Vérification finale et déploiement

- [ ] **Step 1 : Vérifier TypeScript**

```bash
npx tsc --noEmit
```

Corriger toutes les erreurs liées à `is_ghost_mode`, `friendLocations`, `fetchFriendLocations`, `publishLocation`.

- [ ] **Step 2 : Test manuel**

1. Ouvrir l'app — vérifier que les spots du viewport se chargent en < 1 seconde
2. Pan sur la carte — vérifier que de nouveaux spots apparaissent
3. Demander à un ami d'envoyer une demande — vérifier que le badge s'incrémente sans recharger
4. Vérifier qu'il n'y a plus de marqueurs d'amis sur la carte
5. Vérifier que le toggle ghost mode n'apparaît plus dans ProfileModal

- [ ] **Step 3 : Déployer**

```bash
echo "y" | npx vercel deploy --prod
```

---

## Notes d'implémentation

### Gestion du cas west > east (anti-méridien)
Si `west > east` (l'utilisateur est proche de la ligne de date), la requête bbox standard échoue. Ajouter une guard avant la requête :
```ts
// Cas anti-méridien : étendre les bornes pour simplifier
const safeWest = Math.max(west, -180)
const safeEast = Math.min(east, 180)
```

### visibleFriendIds vs followingIds
Après suppression de ghost mode, `visibleFriendIds` et `followingIds` deviennent identiques. Les garder séparés est nécessaire pour le filtre "par ami" dans la carte (l'utilisateur peut désactiver un ami spécifique via le filtre). Ne pas fusionner ces deux states.

### Cache localStorage v3
Le changement de clé `friendspot_spots_v2` → `friendspot_spots_v3` invalide automatiquement l'ancien cache. Les utilisateurs verront un premier chargement normal puis le nouveau cache viewport.
