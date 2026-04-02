# Performance — ProfileModal & FriendsModal Design

## Goal

Rendre ProfileModal et FriendsModal visuellement instantanés à l'ouverture en éliminant les requêtes réseau séquentielles, en ajoutant un cache localStorage et des skeletons UI.

## Contexte

### ProfileModal — état actuel (4 allers-retours séquentiels)
```
open → profiles query → followers/following counts → spot IDs → reactions count
```
Chaque bloc attend la réponse du précédent avant de démarrer. L'utilisateur voit un écran vide pendant toute la durée.

### FriendsModal — état actuel
- `loadFollowing` : cache localStorage déjà en place → rapide ✓
- `loadSentRequests` : 2 requêtes séquentielles (friend_requests → puis profiles)
- Le JOIN FK direct échoue car `to_id` référence `auth.users` (pas `public.profiles`)
- Aucun skeleton : la liste d'amis est vide jusqu'à la fin du chargement

---

## Solution

### 1. RPC Supabase `get_profile_stats`

Remplace les 4 requêtes séquentielles de ProfileModal par **un seul appel réseau**.

```sql
create or replace function public.get_profile_stats(p_user_id uuid)
returns json language sql security invoker stable set search_path = public
as $$
  select json_build_object(
    'username',        p.username,
    'avatar_url',      p.avatar_url,
    'is_ghost_mode',   p.is_ghost_mode,
    'followers_count', (
      select count(*) from followers where following_id = p_user_id
    ),
    'following_count', (
      select count(*) from followers where follower_id = p_user_id
    ),
    'total_likes', (
      select count(*)
      from spot_reactions sr
      join spots s on s.id = sr.spot_id
      where s.user_id = p_user_id
        and sr.type = 'love'
        and sr.user_id != p_user_id
    )
  )
  from profiles p
  where p.id = p_user_id
$$;
```

**Sécurité** : `SECURITY INVOKER` — la fonction s'exécute avec les droits de l'utilisateur appelant, donc RLS s'applique. `followers` et `spot_reactions` sont des données publiques (counts), pas de fuite.

### 2. Cache localStorage ProfileModal

Pattern stale-while-revalidate :
- Clé : `profile_stats_${userId}`
- TTL : 5 minutes
- À l'ouverture : afficher le cache immédiatement (sync), lancer le RPC en arrière-plan
- Invalidation immédiate : après `updateUsername`, `updateAvatar`, `follow/unfollow` → `localStorage.setItem` avec les nouvelles valeurs

```ts
const CACHE_TTL = 5 * 60 * 1000 // 5 min

const loadProfileStats = async () => {
  // 1. Afficher le cache instantanément
  try {
    const raw = localStorage.getItem(`profile_stats_${user.id}`)
    if (raw) {
      const { data, ts } = JSON.parse(raw)
      if (Date.now() - ts < CACHE_TTL) {
        applyStats(data)
        return // cache frais → pas de refetch
      }
      applyStats(data) // cache périmé → afficher quand même, puis rafraîchir
    }
  } catch { /* ignore */ }

  // 2. RPC en arrière-plan
  const { data } = await supabase.rpc('get_profile_stats', { p_user_id: user.id })
  if (data) {
    applyStats(data)
    try { localStorage.setItem(`profile_stats_${user.id}`, JSON.stringify({ data, ts: Date.now() })) } catch { /* ignore */ }
  }
}
```

### 3. Skeleton ProfileModal

Afficher le skeleton uniquement si le cache est absent (première ouverture).
Si le cache existe → données affichées instantanément, pas de skeleton.

```tsx
// Délai 150ms pour éviter le flash si RPC répond très vite
const timerRef = useRef<ReturnType<typeof setTimeout>>()
timerRef.current = setTimeout(() => setShowSkeleton(true), 150)
// Annuler si données arrivées avant
clearTimeout(timerRef.current)
```

Skeleton : cercle 72px (avatar) + 2 lignes de texte + 3 compteurs.

### 4. FriendsModal — fix `loadSentRequests`

Le problème : FK join `profiles!friend_requests_to_id_fkey` échoue car `to_id` → `auth.users`, pas `public.profiles`.

Fix : RPC `get_sent_requests` qui retourne directement les profils en SQL via `SECURITY DEFINER` (accès cross-schema).

```sql
create or replace function public.get_sent_requests(p_user_id uuid)
returns table(id uuid, username text, avatar_url text)
language sql security definer stable set search_path = public
as $$
  select p.id, p.username, p.avatar_url
  from friend_requests fr
  join profiles p on p.id = fr.to_id
  where fr.from_id = p_user_id and fr.status = 'pending'
$$;
```

Un seul appel remplace les 2 requêtes séquentielles.

**Sécurité** : `SECURITY DEFINER` justifié ici car on a besoin du cross-schema join. La fonction est restreinte à `from_id = p_user_id` (l'appelant ne peut voir que ses propres demandes envoyées).

### 5. Skeleton FriendsModal (liste d'amis)

Afficher 5 lignes squelette pendant `loadFollowing` si le cache localStorage est absent.
Si le cache existe → amis affichés instantanément, pas de skeleton.

Structure d'une ligne squelette :
```tsx
<div className="flex items-center gap-3 px-4 py-2 animate-pulse">
  <div className="w-10 h-10 rounded-full bg-zinc-800" />
  <div className="flex-1 space-y-1.5">
    <div className="h-3 w-28 rounded bg-zinc-800" />
    <div className="h-2.5 w-20 rounded bg-zinc-700" />
  </div>
</div>
```

---

## Problèmes anticipés et fixes

| Problème | Fix |
|---|---|
| Cache stale après changement username/avatar | `localStorage.setItem` immédiatement après succès de la mutation |
| Skeleton flash si données arrivent vite | Délai 150ms avant `setShowSkeleton(true)`, annuler si cache présent |
| `loadSentRequests` requêtes dépendantes | RPC `get_sent_requests` — 1 appel SQL au lieu de 2 |
| Sécurité RPC profile stats | `SECURITY INVOKER` — RLS appliqué, pas d'accès cross-user |
| Sécurité RPC sent requests | `SECURITY DEFINER` + filtre `from_id = p_user_id` — restreint à l'appelant |

---

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `supabase/migrations/20260402_perf_rpcs.sql` | Créer `get_profile_stats` et `get_sent_requests` |
| `components/map/ProfileModal.tsx` | Remplacer 4 queries par RPC + cache + skeleton |
| `components/map/FriendsModal.tsx` | Remplacer `loadSentRequests` par RPC + skeleton amis |

## Hors scope

- Optimisation du tab Classement (requêtes séparées)
- Optimisation de `loadOutings` (cache, outings changent fréquemment)
- Split de MapView.tsx / FriendsModal.tsx en sous-composants
