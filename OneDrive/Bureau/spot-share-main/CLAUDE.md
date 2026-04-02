# CLAUDE.md — FriendSpot

Référence rapide pour réduire la lecture de fichiers dans chaque session.

---

## Stack

- **Next.js 16.1.7** (App Router, Turbopack), **React 19**, **TypeScript**
- **Supabase** (Postgres + Realtime + Auth via SSR)
- **Mapbox GL JS** (`react-map-gl`) — token `NEXT_PUBLIC_MAPBOX_TOKEN`
- **Framer Motion** — animations + drag-to-close panels
- **Tailwind CSS** — dark mode via `dark:` prefix
- **Sonner** — toasts (`toast.success`, `toast.error`)
- **useSupercluster** — clustering de markers, `radius: 25`
- **Deploy** : `echo "y" | npx vercel deploy --prod`

---

## Structure des fichiers clés

```
app/
  page.tsx                    — root, monte <MapView>
  spot/[id]/page.tsx          — page de partage publique (SSR)
  api/instagram/route.ts      — scraping IG + Google Places AI
  api/search-place/route.ts   — geocoding Mapbox
  auth/callback/route.ts      — OAuth callback

components/map/
  MapView.tsx       (~2425 l) — composant principal, toute la logique carte
  FriendsModal.tsx  (~2900 l) — onglets Amis / Classement / Invitations
  ExploreModal.tsx   (~927 l) — recherche spots + classement mensuel
  ProfileModal.tsx   (~975 l) — profil utilisateur + historique likes
  AddSpotModal.tsx   (~731 l) — ajout spot (IG ou manuel)
  EditSpotModal.tsx  (~279 l) — édition spot existant
  PublicProfileModal.tsx      — profil public d'un autre user
  UserMenu.tsx                — menu compte utilisateur

lib/
  types.ts          — interfaces globales (Spot, Profile, FilterMode)
  categories.ts     — CATEGORIES, CATEGORY_EMOJIS, CATEGORY_LABELS (source unique)
  identify-place.ts — logique IA Google Places → données spot
  supabase/client.ts|server.ts|middleware.ts

hooks/
  useAuth.ts        — session Supabase
  useSwipeToClose.ts — swipe bas pour fermer un panel (scrollTop=0 + dy>80)
```

---

## Base de données Supabase

### Tables

| Table | Colonnes clés |
|---|---|
| `spots` | id, user_id, title, description, lat, lng, category, image_url, address, opening_hours, weekday_descriptions, maps_url, price_range, instagram_url, created_at, expires_at |
| `profiles` | id, username, avatar_url, last_active_at, is_ghost_mode, last_lat, last_lng |
| `followers` | follower_id, following_id |
| `friend_requests` | id, from_id, to_id, status (pending/accepted/declined) |
| `outings` | id, creator_id, title, description, location_name, lat, lng, spot_id, scheduled_at, status (active/cancelled/completed) |
| `outing_invitations` | id, outing_id, invitee_id, status (pending/accepted/declined), reply, responded_at |
| `spot_reactions` | spot_id, user_id, type (love) — PK composite, pas de colonne id |
| `spot_visits` | spot_id, user_id |
| `avatars` | bucket storage Supabase |

### Migrations SQL à appliquer si pas encore fait

```sql
-- Colonne reply sur invitations (chat dans les sorties)
ALTER TABLE public.outing_invitations ADD COLUMN IF NOT EXISTS reply text;

-- Prix sur les spots
ALTER TABLE public.spots ADD COLUMN IF NOT EXISTS price_range text;

-- Lat/lng sur les sorties
ALTER TABLE public.outings ADD COLUMN IF NOT EXISTS lat numeric;
ALTER TABLE public.outings ADD COLUMN IF NOT EXISTS lng numeric;

-- Realtime sur les sorties (pour annulation instantanée)
ALTER TABLE public.outings REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE outings;
```

### RPC
- `accept_friend_request(request_id)` — accepte une demande d'ami (crée les deux entrées followers)

---

## Patterns récurrents

### Jointures profils (FK → auth.users ne fonctionne pas directement)
Toujours faire : fetch IDs → fetch `profiles` séparément avec `.in("id", ids)`.

### Realtime
```ts
supabase.channel(`nom-stable-${userId}`)
  .on("postgres_changes", { event: "*", schema: "public", table: "xxx", filter: `col=eq.${id}` }, cb)
  .subscribe()
```
Nettoyer avec `supabase.removeChannel(channel)` dans le return du useEffect.

### Swipe-to-close
```ts
const swipe = useSwipeToClose(onClose, disabled)
<div ref={swipe.ref} onTouchStart={swipe.onTouchStart} onTouchEnd={swipe.onTouchEnd}>
```
Passer `disabled={true}` quand un overlay (form, sheet) est ouvert dessus.

### Drag Framer Motion sur un panel scrollable
Utiliser `dragControls` + pointer events forwarding depuis le handle uniquement :
```tsx
drag="y" dragControls={dragControls} dragListener={false}
// Sur le handle :
onPointerDown={e => dragControls.start(e)}
```

### Image URL multi-photos
`image_url` peut contenir plusieurs URLs séparées par des virgules.
Toujours splitter : `image_url.split(",").map(s => s.trim())`.

### Deep link spot partagé
URL : `/?spot=<id>` → MapView intercepte, cherche dans `spots[]`, flyTo + sélectionne.
Page de partage publique : `/spot/<id>` avec bouton "Ouvrir dans FriendSpot" → `/?spot=<id>`.

---

## Architecture MapView (composant principal)

### State clés
- `spots` — tous les spots chargés (paginés, cachés localStorage)
- `selectedSpot` — spot ouvert dans le panel latéral
- `filterMode` — `"all" | "friends" | "mine"`
- `followingIds` — IDs des amis suivis (chargés au boot)
- `visibleFriendIds` — subset de followingIds pour la map
- `friendFilterIds` — Set<string> pour filtre par personne
- `friendCategoryFilter` — Set<string> pour filtre par catégorie
- `visibleSpots` useMemo — applique tous les filtres

### Modals
Tous en dynamic import (`next/dynamic`) pour perf. Ouverts via `showXModal` booleans.
Ordre d'empilement z-index : Map < Panel spot < Modals (z-50).

---

## FriendsModal — onglets

| Onglet | Contenu |
|---|---|
| **Amis** | Liste amis en ligne/hors ligne + bouton "Proposer sortie" + sorties à venir |
| **Classement** | Podium top 3 (spots ajoutés ce mois) + classement liste + top spots les plus aimés |
| **Invitations** | Feed notifications : demandes amis → sorties proposées (expandables) → mes sorties (expandables) → demandes envoyées |

### Notifications (Invitations tab)
Format compact style Instagram : 1 ligne par notif, chevron pour expand.
- Sorties proposées : expand → `OutingInvitationCard` (photo, chat, Participer/Décliner)
- Mes sorties : expand → `FeaturedOutingCard` (photo, participants, chat, modifier/annuler)
- Participants affichés : acceptés (couleur) + en attente (opacity 50%) + déclinés (barré rouge)

### Chat dans les sorties
Colonne `reply` sur `outing_invitations`. Chaque participant a sa propre ligne → son message est son `reply`.
`FeaturedOutingCard` et `OutingInvitationCard` partagent le même fil (même données).

---

## Catégories (source unique : `lib/categories.ts`)
café, restaurant, bar, outdoor, vue, culture, shopping, other
Ne jamais redéfinir localement — toujours importer `CATEGORIES`, `CATEGORY_EMOJIS`, `CATEGORY_LABELS`.

---

## Déploiement
```bash
echo "y" | npx vercel deploy --prod
```
URL prod : https://spot-share-kappa.vercel.app

Build local (vérif TS) : `npx next build` — ignorer l'erreur prerender /login (env vars manquantes en local).

---

## Workflow sessions (optimisation tokens)

### Fin de session
Toujours lancer `/revise-claude-md` après une session de travail importante
pour capturer les numéros de ligne et les nouveaux composants.

### Vérification TypeScript
Utiliser `getDiagnostics` sur le fichier modifié au lieu de `npx next build`.
`npx next build` uniquement pour la vérification finale avant déploiement Vercel.

### Navigation dans les gros fichiers
`MapView.tsx` (~2600 l) et `FriendsModal.tsx` (~2900 l) sont les deux plus gros fichiers.
Toujours utiliser Read avec `offset` + `limit`, ou Grep ciblé.
Ne jamais lire ces fichiers en entier.

### Fonctions clés — numéros de ligne (MapView.tsx)
- `handleAddSpot` : ~1088
- `handleUpdateSpot` : ~1227
- `visibleSpots` useMemo : ~956
- `loadGroups` : ~655
- `groupSpotIds` useEffect : ~788
- Filter buttons UI : ~1649
- Groups dropdown UI : ~1710
