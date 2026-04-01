# Groupes & Visibilité des spots — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un système de groupes permettant de partager des spots avec une audience précise (amis, groupe, privé) et filtrer par groupe sur la carte.

**Architecture:** Les spots reçoivent deux nouvelles colonnes (`visibility`, `group_id`). Les RLS Supabase filtrent côté serveur. Le filtre "Groupes" côté client est un `.filter()` sur les spots déjà chargés. Un nouveau composant `GroupSettingsModal` gère la création/gestion des groupes.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + Realtime), TypeScript, Tailwind CSS, Framer Motion, Lucide React

---

## Fichiers touchés

| Fichier | Action |
|---|---|
| `lib/types.ts` | Modifier — ajouter `SpotGroup`, `SpotGroupInvitation`, étendre `Spot` et `FilterMode` |
| `supabase/migrations/20260401_groups.sql` | Créer — RLS sur les nouvelles tables |
| `components/map/MapView.tsx` | Modifier — state groupes, visibleSpots, filter bar, handleAddSpot |
| `components/map/AddSpotModal.tsx` | Modifier — sélecteur visibilité dans le formulaire |
| `components/map/GroupSettingsModal.tsx` | Créer — gestion membres, invitations |
| `components/map/FriendsModal.tsx` | Modifier — invitations de groupe dans l'onglet Invitations |

---

## Task 1 : Types TypeScript

**Files:**
- Modify: `lib/types.ts`

- [ ] **Ouvrir `lib/types.ts` et remplacer son contenu par :**

```ts
export interface Profile {
  id: string
  username: string | null
  avatar_url: string | null
  created_at: string
}

export interface SpotGroup {
  id: string
  creator_id: string
  name: string
  emoji: string
  created_at: string
}

export interface SpotGroupInvitation {
  id: string
  group_id: string
  invitee_id: string
  inviter_id: string
  status: 'pending' | 'accepted' | 'declined'
  created_at: string
  spot_groups?: SpotGroup & {
    profiles?: { username: string | null; avatar_url: string | null }
  }
}

export interface Spot {
  id: string
  user_id: string
  title: string
  description: string | null
  lat: number
  lng: number
  category: string
  instagram_url: string | null
  image_url: string | null
  address: string | null
  opening_hours: Record<string, string> | null
  weekday_descriptions: string[] | null
  maps_url: string | null
  price_range: string | null
  created_at: string
  expires_at?: string | null
  visibility?: 'friends' | 'group' | 'private'
  group_id?: string | null
  profiles?: Profile
}

export type FilterMode = "all" | "friends" | "mine" | "groups"

export interface GeocodingResult {
  id: string
  place_name: string
  center: [number, number]
}
```

- [ ] **Vérifier la compilation :**
```bash
npx tsc --noEmit
```
Expected : aucune erreur liée à `FilterMode`, `SpotGroup`, `SpotGroupInvitation`.

- [ ] **Commit :**
```bash
git add lib/types.ts
git commit -m "feat(groups): add SpotGroup, SpotGroupInvitation types and extend Spot/FilterMode"
```

---

## Task 2 : Migration RLS Supabase

**Files:**
- Create: `supabase/migrations/20260401_groups.sql`

> Les 3 tables (`spot_groups`, `spot_group_members`, `spot_group_invitations`) et les colonnes `visibility`/`group_id` sur `spots` ont déjà été créées manuellement. Cette migration ajoute uniquement les RLS et active le realtime.

- [ ] **Créer `supabase/migrations/20260401_groups.sql` :**

```sql
-- ─── RLS spots (nouvelle policy) ─────────────────────────────────────────────
-- Supprimer les policies existantes sur spots si elles existent
drop policy if exists "spots_select" on public.spots;

alter table public.spots enable row level security;

create policy "spots_select" on public.spots for select using (
  -- Toujours visible par le créateur
  user_id = auth.uid()
  or (
    -- Spots "friends" : visible si l'utilisateur suit le créateur
    (visibility = 'friends' or visibility is null)
    and user_id in (
      select following_id from public.followers where follower_id = auth.uid()
    )
  )
  or (
    -- Spots "group" : visible si membre du groupe
    visibility = 'group'
    and group_id in (
      select group_id from public.spot_group_members where user_id = auth.uid()
    )
  )
);

-- Insert / update / delete : uniquement par le propriétaire (inchangé)
create policy "spots_insert" on public.spots for insert with check (user_id = auth.uid());
create policy "spots_update" on public.spots for update using (user_id = auth.uid());
create policy "spots_delete" on public.spots for delete using (user_id = auth.uid());

-- ─── RLS spot_groups ─────────────────────────────────────────────────────────
alter table public.spot_groups enable row level security;

create policy "spot_groups_select" on public.spot_groups for select using (
  id in (select group_id from public.spot_group_members where user_id = auth.uid())
);
create policy "spot_groups_insert" on public.spot_groups for insert with check (creator_id = auth.uid());
create policy "spot_groups_update" on public.spot_groups for update using (creator_id = auth.uid());
create policy "spot_groups_delete" on public.spot_groups for delete using (creator_id = auth.uid());

-- ─── RLS spot_group_members ──────────────────────────────────────────────────
alter table public.spot_group_members enable row level security;

create policy "spot_group_members_select" on public.spot_group_members for select using (
  group_id in (select group_id from public.spot_group_members where user_id = auth.uid())
);
create policy "spot_group_members_insert" on public.spot_group_members for insert with check (
  group_id in (select id from public.spot_groups where creator_id = auth.uid())
  or user_id = auth.uid() -- pour s'ajouter soi-même en acceptant une invitation
);
create policy "spot_group_members_delete" on public.spot_group_members for delete using (
  user_id = auth.uid()
  or group_id in (select id from public.spot_groups where creator_id = auth.uid())
);

-- ─── RLS spot_group_invitations ──────────────────────────────────────────────
alter table public.spot_group_invitations enable row level security;

create policy "spot_group_invitations_select" on public.spot_group_invitations for select using (
  invitee_id = auth.uid()
  or group_id in (select id from public.spot_groups where creator_id = auth.uid())
);
create policy "spot_group_invitations_insert" on public.spot_group_invitations for insert with check (
  group_id in (select id from public.spot_groups where creator_id = auth.uid())
);
create policy "spot_group_invitations_update" on public.spot_group_invitations for update using (
  invitee_id = auth.uid()
  or group_id in (select id from public.spot_groups where creator_id = auth.uid())
);

-- ─── Realtime ─────────────────────────────────────────────────────────────────
alter table public.spot_group_invitations replica identity full;
alter publication supabase_realtime add table public.spot_group_invitations;
```

- [ ] **Coller ce SQL dans le Supabase SQL Editor et exécuter.**

- [ ] **Vérifier dans Supabase Dashboard → Authentication → Policies que les policies apparaissent sur `spots`, `spot_groups`, `spot_group_members`, `spot_group_invitations`.**

- [ ] **Commit :**
```bash
git add supabase/migrations/20260401_groups.sql
git commit -m "feat(groups): add RLS policies and realtime for groups tables"
```

---

## Task 3 : MapView — chargement des groupes

**Files:**
- Modify: `components/map/MapView.tsx`

- [ ] **En haut de MapView.tsx, ajouter l'import du type `SpotGroup` :**

Trouver la ligne :
```ts
import type { Spot, FilterMode } from "@/lib/types"
```
La remplacer par :
```ts
import type { Spot, FilterMode, SpotGroup } from "@/lib/types"
```

- [ ] **Dans la section des states (chercher `useState<FilterMode>`), ajouter après :**

```ts
const [groups, setGroups] = useState<SpotGroup[]>([])
const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
```

- [ ] **Ajouter le callback `loadGroups` après `loadOutings` (ou tout autre `useCallback` existant) :**

```ts
const loadGroups = useCallback(async () => {
  if (!user) return
  try {
    const { data } = await supabaseRef.current
      .from("spot_group_members")
      .select("group_id, spot_groups(id, creator_id, name, emoji, created_at)")
      .eq("user_id", user.id)
    if (data) {
      setGroups(
        data
          .map((d: any) => d.spot_groups)
          .filter(Boolean) as SpotGroup[]
      )
    }
  } catch (e) {
    console.error("loadGroups:", e)
  }
}, [user])
```

- [ ] **Dans le `useEffect` principal (celui qui charge les spots au boot), ajouter `loadGroups()` après les autres chargements :**

Chercher le bloc où `loadSpots()` est appelé au boot et ajouter :
```ts
loadGroups()
```

- [ ] **Mettre à jour le `useMemo` de `visibleSpots` :**

Trouver :
```ts
const visibleSpots = useMemo(() => {
    if (filter === "mine") return spots.filter((s) => s.user_id === user?.id)
    const friendSet = new Set(visibleFriendIds)
    let base = spots.filter((s) => friendSet.has(s.user_id))
    if (friendFilterIds.size > 0) base = base.filter((s) => friendFilterIds.has(s.user_id))
    if (friendCategoryFilter.size > 0) base = base.filter((s) => friendCategoryFilter.has(s.category ?? "other"))
    return base
  }, [spots, filter, user?.id, visibleFriendIds, friendFilterIds, friendCategoryFilter])
```

Remplacer par :
```ts
const visibleSpots = useMemo(() => {
    if (filter === "mine") return spots.filter((s) => s.user_id === user?.id)
    if (filter === "groups" && activeGroupId) {
      return spots.filter((s) => s.visibility === "group" && s.group_id === activeGroupId)
    }
    const friendSet = new Set(visibleFriendIds)
    let base = spots.filter((s) => friendSet.has(s.user_id) && (s.visibility === "friends" || !s.visibility))
    if (friendFilterIds.size > 0) base = base.filter((s) => friendFilterIds.has(s.user_id))
    if (friendCategoryFilter.size > 0) base = base.filter((s) => friendCategoryFilter.has(s.category ?? "other"))
    return base
  }, [spots, filter, user?.id, visibleFriendIds, friendFilterIds, friendCategoryFilter, activeGroupId])
```

- [ ] **Mettre à jour `filterButtons` pour ajouter "Groupes" :**

Trouver :
```ts
const filterButtons: {
    key: FilterMode
    label: string
    icon: React.ReactNode
  }[] = [
    { key: "mine", label: "Moi", icon: <User size={13} /> },
    { key: "friends", label: "Amis", icon: <Users size={13} /> },
  ]
```

Remplacer par :
```ts
const filterButtons: {
    key: FilterMode
    label: string
    icon: React.ReactNode
  }[] = [
    { key: "mine", label: "Moi", icon: <User size={13} /> },
    { key: "friends", label: "Amis", icon: <Users size={13} /> },
    { key: "groups", label: "Groupes", icon: <Layers size={13} /> },
  ]
```

- [ ] **Ajouter `Layers` aux imports Lucide en haut du fichier (chercher la ligne `import {` avec les icônes Lucide) :**

Ajouter `Layers` à la liste des imports existants.

- [ ] **Vérifier la compilation :**
```bash
npx tsc --noEmit
```

- [ ] **Commit :**
```bash
git add components/map/MapView.tsx
git commit -m "feat(groups): load groups state and update visibleSpots filter logic"
```

---

## Task 4 : MapView — barre de filtres Groupes + dropdown

**Files:**
- Modify: `components/map/MapView.tsx`

- [ ] **Ajouter le state du dropdown dans MapView (après `activeGroupId`) :**

```ts
const [showGroupsDropdown, setShowGroupsDropdown] = useState(false)
const [showCreateGroup, setShowCreateGroup] = useState(false)
const [newGroupName, setNewGroupName] = useState("")
const [newGroupEmoji, setNewGroupEmoji] = useState("🗂️")
const [creatingGroup, setCreatingGroup] = useState(false)
```

- [ ] **Ajouter la fonction `handleCreateGroup` dans MapView (après `loadGroups`) :**

```ts
const handleCreateGroup = async () => {
  if (!user || !newGroupName.trim()) return
  setCreatingGroup(true)
  try {
    const { data: group, error } = await supabaseRef.current
      .from("spot_groups")
      .insert({ creator_id: user.id, name: newGroupName.trim(), emoji: newGroupEmoji })
      .select()
      .single()
    if (error) throw error
    // Ajouter le créateur comme membre
    await supabaseRef.current
      .from("spot_group_members")
      .insert({ group_id: group.id, user_id: user.id })
    setGroups(prev => [...prev, group as SpotGroup])
    setNewGroupName("")
    setNewGroupEmoji("🗂️")
    setShowCreateGroup(false)
    toast.success(`Groupe "${group.name}" créé !`)
  } catch (e) {
    toast.error("Erreur lors de la création du groupe")
  }
  setCreatingGroup(false)
}
```

- [ ] **Dans le JSX de la barre de filtres, localiser le rendu du bouton "Groupes" et le remplacer par un bouton avec dropdown.**

Chercher le bloc `{filterButtons.map(({ key, label, icon }) => (` et ajouter après ce bloc (ou modifier pour traiter "groups" différemment) le code suivant **juste après la fermeture du `filterButtons.map`** :

```tsx
{/* Dropdown groupes */}
{showGroupsDropdown && (
  <div
    className="absolute top-full mt-2 left-0 z-50 w-64 rounded-2xl border border-white/[0.08] bg-zinc-900 shadow-xl overflow-hidden"
    onPointerDown={e => e.stopPropagation()}
  >
    {groups.map(group => (
      <div
        key={group.id}
        className="flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.04] cursor-pointer border-b border-white/[0.05]"
        onClick={() => {
          setActiveGroupId(activeGroupId === group.id ? null : group.id)
          setFilter("groups")
          setShowGroupsDropdown(false)
        }}
      >
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-base flex-shrink-0">
          {group.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-bold text-white truncate">{group.name}</p>
        </div>
        {activeGroupId === group.id && (
          <div className="w-4 h-4 rounded-full bg-indigo-500 flex items-center justify-center">
            <span className="text-white text-[9px] font-bold">✓</span>
          </div>
        )}
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={e => {
            e.stopPropagation()
            setSelectedGroupForSettings(group)
            setShowGroupsDropdown(false)
          }}
          className="w-7 h-7 rounded-lg bg-white/[0.05] flex items-center justify-center text-zinc-400 hover:text-white transition-colors flex-shrink-0"
        >
          <Settings size={12} />
        </button>
      </div>
    ))}

    {/* Créer un groupe */}
    {!showCreateGroup ? (
      <button
        onClick={() => setShowCreateGroup(true)}
        className="flex items-center gap-3 px-3 py-2.5 w-full hover:bg-white/[0.04] transition-colors"
      >
        <div className="w-8 h-8 rounded-xl border-2 border-dashed border-indigo-500/40 flex items-center justify-center text-indigo-400 text-lg flex-shrink-0">
          +
        </div>
        <div>
          <p className="text-[12px] font-semibold text-indigo-400">Créer un groupe</p>
          <p className="text-[10px] text-zinc-600">Inviter des amis, partager des spots</p>
        </div>
      </button>
    ) : (
      <div className="px-3 py-2.5 space-y-2">
        <div className="flex gap-2">
          <input
            value={newGroupEmoji}
            onChange={e => setNewGroupEmoji(e.target.value)}
            className="w-10 text-center rounded-lg bg-white/[0.06] border border-white/[0.08] text-white text-sm py-1.5"
            maxLength={2}
          />
          <input
            autoFocus
            value={newGroupName}
            onChange={e => setNewGroupName(e.target.value)}
            placeholder="Nom du groupe..."
            className="flex-1 rounded-lg bg-white/[0.06] border border-white/[0.08] text-white text-[12px] px-2.5 py-1.5 placeholder:text-zinc-600"
            onKeyDown={e => e.key === "Enter" && handleCreateGroup()}
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCreateGroup(false)}
            className="flex-1 rounded-lg bg-white/[0.05] py-1.5 text-[11px] font-semibold text-zinc-500"
          >
            Annuler
          </button>
          <button
            onClick={handleCreateGroup}
            disabled={!newGroupName.trim() || creatingGroup}
            className="flex-1 rounded-lg bg-indigo-500 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
          >
            {creatingGroup ? "..." : "Créer"}
          </button>
        </div>
      </div>
    )}
  </div>
)}
```

- [ ] **Ajouter `Settings` aux imports Lucide.**

- [ ] **Ajouter le state `selectedGroupForSettings` :**

```ts
const [selectedGroupForSettings, setSelectedGroupForSettings] = useState<SpotGroup | null>(null)
```

- [ ] **Modifier le bouton "Groupes" dans `filterButtons.map` pour ouvrir le dropdown au lieu de changer le filtre directement.**

Chercher dans le JSX le rendu des `filterButtons`. Le bouton "groups" doit appeler `setShowGroupsDropdown(v => !v)` et afficher un badge si `activeGroupId` est défini. Trouver le `onClick` du bouton filtre et le conditionner :

```tsx
onClick={() => {
  if (key === "groups") {
    setShowGroupsDropdown(v => !v)
  } else {
    setFilter(key)
    setActiveGroupId(null)
    setShowGroupsDropdown(false)
  }
}}
```

- [ ] **Fermer le dropdown au clic en dehors — ajouter dans le `useEffect` principal ou via un handler global :**

Ajouter dans le JSX un overlay transparent quand le dropdown est ouvert :
```tsx
{showGroupsDropdown && (
  <div
    className="fixed inset-0 z-40"
    onClick={() => setShowGroupsDropdown(false)}
  />
)}
```

- [ ] **Vérifier la compilation :**
```bash
npx tsc --noEmit
```

- [ ] **Commit :**
```bash
git add components/map/MapView.tsx
git commit -m "feat(groups): add groups dropdown to filter bar with create group form"
```

---

## Task 5 : AddSpotModal — sélecteur de visibilité

**Files:**
- Modify: `components/map/AddSpotModal.tsx`
- Modify: `components/map/MapView.tsx`

- [ ] **Dans `AddSpotModal.tsx`, étendre l'interface `AddSpotModalProps` — ajouter `groups` et mettre à jour le type de retour de `onAdd` :**

Trouver :
```ts
interface AddSpotModalProps {
  isOpen: boolean
  onClose: () => void
  onAdd: (spot: {
    title: string
    ...
    expires_at: string | null
  }) => Promise<void>
  initialUrl?: string
  userLat?: number
  userLng?: number
}
```

Modifier `onAdd` pour ajouter `visibility` et `group_id`, et ajouter `groups` :
```ts
interface AddSpotModalProps {
  isOpen: boolean
  onClose: () => void
  onAdd: (spot: {
    title: string
    description: string | null
    lat: number
    lng: number
    category: string
    instagram_url: string | null
    image_url: string | null
    address: string | null
    opening_hours: Record<string, string> | null
    weekday_descriptions: string[] | null
    maps_url: string | null
    price_range: string | null
    expires_at: string | null
    visibility: 'friends' | 'group' | 'private'
    group_id: string | null
  }) => Promise<void>
  initialUrl?: string
  userLat?: number
  userLng?: number
  groups?: Array<{ id: string; name: string; emoji: string }>
}
```

- [ ] **Dans le composant `AddSpotModal`, ajouter le state de visibilité et destructurer `groups` :**

Trouver la ligne `export default function AddSpotModal({` et ajouter `groups = []` dans la destructuration :
```ts
export default function AddSpotModal({
  isOpen, onClose, onAdd, initialUrl, userLat, userLng, groups = [],
}: AddSpotModalProps) {
```

Ajouter les states :
```ts
const [visibility, setVisibility] = useState<'friends' | 'group' | 'private'>('friends')
const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
const [showVisibilityPicker, setShowVisibilityPicker] = useState(false)
```

- [ ] **Ajouter le sélecteur de visibilité dans le formulaire, juste avant le bouton de soumission.**

Trouver le bouton de soumission (chercher `type="submit"` ou le bouton "Ajouter") et insérer avant :

```tsx
{/* Sélecteur de visibilité */}
<div className="space-y-1.5">
  <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wide">Partager avec</label>
  <button
    type="button"
    onClick={() => setShowVisibilityPicker(v => !v)}
    className="w-full flex items-center justify-between gap-2 rounded-xl bg-white/[0.06] border border-white/[0.08] px-3 py-2.5 text-left"
  >
    <div className="flex items-center gap-2">
      <span className="text-base">
        {visibility === 'private' ? '🔒' : visibility === 'group' ? (groups.find(g => g.id === selectedGroupId)?.emoji ?? '🗂️') : '👥'}
      </span>
      <span className="text-[13px] font-semibold text-white">
        {visibility === 'private' ? 'Privé' : visibility === 'group' ? (groups.find(g => g.id === selectedGroupId)?.name ?? 'Groupe') : 'Tous mes amis'}
      </span>
    </div>
    <ChevronDown size={14} className={`text-zinc-500 transition-transform ${showVisibilityPicker ? 'rotate-180' : ''}`} />
  </button>

  {showVisibilityPicker && (
    <div className="rounded-xl border border-white/[0.07] bg-zinc-900 overflow-hidden">
      {/* Amis */}
      <button
        type="button"
        onClick={() => { setVisibility('friends'); setSelectedGroupId(null); setShowVisibilityPicker(false) }}
        className={`w-full flex items-center gap-3 px-3 py-2.5 border-b border-white/[0.05] transition-colors ${visibility === 'friends' ? 'bg-indigo-500/10' : 'hover:bg-white/[0.03]'}`}
      >
        <span className="text-base">👥</span>
        <div className="flex-1 text-left">
          <p className="text-[12px] font-bold text-white">Tous mes amis</p>
          <p className="text-[10px] text-zinc-500">Visible par tous tes abonnés</p>
        </div>
        {visibility === 'friends' && <span className="text-indigo-400 text-xs font-bold">✓</span>}
      </button>

      {/* Groupes */}
      {groups.map(group => (
        <button
          key={group.id}
          type="button"
          onClick={() => { setVisibility('group'); setSelectedGroupId(group.id); setShowVisibilityPicker(false) }}
          className={`w-full flex items-center gap-3 px-3 py-2.5 border-b border-white/[0.05] transition-colors ${visibility === 'group' && selectedGroupId === group.id ? 'bg-indigo-500/10' : 'hover:bg-white/[0.03]'}`}
        >
          <span className="text-base">{group.emoji}</span>
          <div className="flex-1 text-left">
            <p className="text-[12px] font-bold text-white">{group.name}</p>
            <p className="text-[10px] text-zinc-500">Membres du groupe uniquement</p>
          </div>
          {visibility === 'group' && selectedGroupId === group.id && <span className="text-indigo-400 text-xs font-bold">✓</span>}
        </button>
      ))}

      {/* Privé */}
      <button
        type="button"
        onClick={() => { setVisibility('private'); setSelectedGroupId(null); setShowVisibilityPicker(false) }}
        className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors ${visibility === 'private' ? 'bg-indigo-500/10' : 'hover:bg-white/[0.03]'}`}
      >
        <span className="text-base">🔒</span>
        <div className="flex-1 text-left">
          <p className="text-[12px] font-bold text-white">Privé</p>
          <p className="text-[10px] text-zinc-500">Seulement moi</p>
        </div>
        {visibility === 'private' && <span className="text-indigo-400 text-xs font-bold">✓</span>}
      </button>
    </div>
  )}
</div>
```

- [ ] **Ajouter `ChevronDown` aux imports Lucide de `AddSpotModal.tsx`.**

- [ ] **Modifier l'appel à `onAdd` pour passer `visibility` et `group_id` :**

Chercher tous les appels à `onAdd({` dans `AddSpotModal.tsx` et ajouter :
```ts
visibility,
group_id: visibility === 'group' ? selectedGroupId : null,
```

- [ ] **Dans `MapView.tsx`, mettre à jour `handleAddSpot` pour accepter et utiliser `visibility` et `group_id` :**

Trouver la signature de `handleAddSpot` et ajouter les champs :
```ts
const handleAddSpot = async (spotData: {
    title: string
    description: string | null
    lat: number
    lng: number
    category: string
    instagram_url: string | null
    image_url: string | null
    address: string | null
    opening_hours: Record<string, string> | null
    weekday_descriptions: string[] | null
    maps_url: string | null
    price_range: string | null
    expires_at: string | null
    visibility: 'friends' | 'group' | 'private'
    group_id: string | null
  }) => {
```

- [ ] **Passer `groups` à `<AddSpotModal>` dans le JSX de MapView :**

Chercher `<AddSpotModal` dans MapView et ajouter la prop :
```tsx
<AddSpotModal
  ...
  groups={groups}
  ...
/>
```

- [ ] **Vérifier la compilation :**
```bash
npx tsc --noEmit
```

- [ ] **Commit :**
```bash
git add components/map/AddSpotModal.tsx components/map/MapView.tsx
git commit -m "feat(groups): add visibility selector to AddSpotModal"
```

---

## Task 6 : GroupSettingsModal

**Files:**
- Create: `components/map/GroupSettingsModal.tsx`
- Modify: `components/map/MapView.tsx`

- [ ] **Créer `components/map/GroupSettingsModal.tsx` :**

```tsx
"use client"

import { useState, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, UserPlus, Trash2, LoaderCircle } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import type { SpotGroup } from "@/lib/types"

interface Member {
  user_id: string
  profiles?: { username: string | null; avatar_url: string | null }
}

interface PendingInvite {
  id: string
  invitee_id: string
  profiles?: { username: string | null; avatar_url: string | null }
}

interface GroupSettingsModalProps {
  group: SpotGroup
  currentUserId: string
  followingProfiles: Array<{ id: string; username: string | null; avatar_url: string | null }>
  onClose: () => void
  onGroupDeleted: (groupId: string) => void
  onGroupUpdated: (group: SpotGroup) => void
}

export default function GroupSettingsModal({
  group, currentUserId, followingProfiles, onClose, onGroupDeleted, onGroupUpdated,
}: GroupSettingsModalProps) {
  const supabase = useRef(createClient())
  const [members, setMembers] = useState<Member[]>([])
  const [pending, setPending] = useState<PendingInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [invitingId, setInvitingId] = useState<string | null>(null)
  const [showInvitePicker, setShowInvitePicker] = useState(false)

  const isCreator = group.creator_id === currentUserId

  useEffect(() => {
    loadMembers()
  }, [group.id])

  const loadMembers = async () => {
    setLoading(true)
    try {
      const { data: memberData } = await supabase.current
        .from("spot_group_members")
        .select("user_id")
        .eq("group_id", group.id)

      const { data: inviteData } = await supabase.current
        .from("spot_group_invitations")
        .select("id, invitee_id")
        .eq("group_id", group.id)
        .eq("status", "pending")

      if (memberData) {
        const ids = memberData.map((m: any) => m.user_id)
        const { data: profiles } = await supabase.current
          .from("profiles").select("id, username, avatar_url").in("id", ids)
        const profileMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]))
        setMembers(memberData.map((m: any) => ({ user_id: m.user_id, profiles: profileMap[m.user_id] })))
      }

      if (inviteData) {
        const ids = inviteData.map((i: any) => i.invitee_id)
        const { data: profiles } = await supabase.current
          .from("profiles").select("id, username, avatar_url").in("id", ids)
        const profileMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]))
        setPending(inviteData.map((i: any) => ({ ...i, profiles: profileMap[i.invitee_id] })))
      }
    } catch (e) {
      console.error("loadMembers:", e)
    }
    setLoading(false)
  }

  const inviteFriend = async (friendId: string, friendUsername: string | null) => {
    setInvitingId(friendId)
    try {
      const { error } = await supabase.current
        .from("spot_group_invitations")
        .insert({ group_id: group.id, invitee_id: friendId, inviter_id: currentUserId, status: "pending" })
      if (error) throw error
      toast.success(`Invitation envoyée à @${friendUsername ?? friendId}`)
      setShowInvitePicker(false)
      loadMembers()
    } catch (e: any) {
      if (e?.code === "23505") toast.error("Déjà invité")
      else toast.error("Erreur lors de l'invitation")
    }
    setInvitingId(null)
  }

  const removeMember = async (userId: string) => {
    setRemovingId(userId)
    try {
      await supabase.current
        .from("spot_group_members")
        .delete()
        .eq("group_id", group.id)
        .eq("user_id", userId)
      setMembers(prev => prev.filter(m => m.user_id !== userId))
      toast.success("Membre retiré")
    } catch {
      toast.error("Erreur")
    }
    setRemovingId(null)
  }

  const deleteGroup = async () => {
    try {
      await supabase.current.from("spot_groups").delete().eq("id", group.id)
      onGroupDeleted(group.id)
      onClose()
      toast.success(`Groupe "${group.name}" supprimé`)
    } catch {
      toast.error("Erreur lors de la suppression")
    }
  }

  const alreadyInGroup = new Set([
    ...members.map(m => m.user_id),
    ...pending.map(p => p.invitee_id),
  ])
  const invitableFriends = followingProfiles.filter(f => !alreadyInGroup.has(f.id))

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <motion.div
          className="relative z-10 w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-zinc-900 border border-white/[0.07] overflow-hidden"
          initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-white/[0.06]">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-xl flex-shrink-0">
              {group.emoji}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-bold text-white truncate">{group.name}</p>
              <p className="text-[11px] text-zinc-500">{members.length} membre{members.length > 1 ? "s" : ""}</p>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/[0.06] flex items-center justify-center text-zinc-400 hover:text-white">
              <X size={15} />
            </button>
          </div>

          <div className="max-h-[70vh] overflow-y-auto">
            {/* Inviter */}
            {isCreator && (
              <div className="px-4 pt-3">
                <button
                  onClick={() => setShowInvitePicker(v => !v)}
                  className="flex items-center gap-2 w-full rounded-xl bg-indigo-500/10 border border-indigo-500/20 px-3 py-2.5 text-indigo-400 hover:bg-indigo-500/15 transition-colors"
                >
                  <UserPlus size={14} />
                  <span className="text-[12px] font-semibold">Inviter un ami</span>
                </button>
                {showInvitePicker && invitableFriends.length > 0 && (
                  <div className="mt-2 rounded-xl border border-white/[0.07] bg-zinc-800 overflow-hidden">
                    {invitableFriends.map(f => (
                      <button
                        key={f.id}
                        onClick={() => inviteFriend(f.id, f.username)}
                        disabled={invitingId === f.id}
                        className="flex items-center gap-3 w-full px-3 py-2 hover:bg-white/[0.04] border-b border-white/[0.05] last:border-0 transition-colors"
                      >
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0 overflow-hidden">
                          {f.avatar_url
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={f.avatar_url} alt="" className="w-full h-full object-cover" />
                            : (f.username?.[0]?.toUpperCase() ?? "?")}
                        </div>
                        <span className="text-[12px] font-medium text-white flex-1 text-left">@{f.username ?? "?"}</span>
                        {invitingId === f.id
                          ? <LoaderCircle size={12} className="animate-spin text-zinc-500" />
                          : <span className="text-[10px] text-indigo-400 font-semibold">Inviter</span>}
                      </button>
                    ))}
                    {invitableFriends.length === 0 && (
                      <p className="text-center text-[11px] text-zinc-500 py-3">Tous tes amis sont déjà dans ce groupe</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Membres */}
            <div className="px-4 pt-3 pb-1">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide mb-2">Membres</p>
              {loading ? (
                <div className="flex justify-center py-4"><LoaderCircle size={18} className="animate-spin text-zinc-600" /></div>
              ) : (
                <div className="space-y-1.5">
                  {members.map(m => (
                    <div key={m.user_id} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0 overflow-hidden">
                        {m.profiles?.avatar_url
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={m.profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                          : (m.profiles?.username?.[0]?.toUpperCase() ?? "?")}
                      </div>
                      <span className="flex-1 text-[12px] font-medium text-white">
                        @{m.profiles?.username ?? "?"}
                        {m.user_id === group.creator_id && (
                          <span className="ml-1.5 text-[10px] text-indigo-400 font-semibold">admin</span>
                        )}
                        {m.user_id === currentUserId && m.user_id !== group.creator_id && (
                          <span className="ml-1.5 text-[10px] text-zinc-500">vous</span>
                        )}
                      </span>
                      {isCreator && m.user_id !== currentUserId && (
                        <button
                          onClick={() => removeMember(m.user_id)}
                          disabled={removingId === m.user_id}
                          className="text-[10px] text-zinc-600 hover:text-red-400 transition-colors px-2 py-0.5 rounded-lg bg-white/[0.04]"
                        >
                          {removingId === m.user_id ? "..." : "Retirer"}
                        </button>
                      )}
                    </div>
                  ))}

                  {/* En attente */}
                  {pending.map(p => (
                    <div key={p.id} className="flex items-center gap-3 opacity-50">
                      <div className="w-8 h-8 rounded-full bg-zinc-700 border border-dashed border-zinc-500 flex items-center justify-center text-[11px] text-zinc-400 flex-shrink-0">
                        ?
                      </div>
                      <span className="flex-1 text-[12px] text-zinc-500">
                        @{p.profiles?.username ?? "?"}
                        <span className="ml-1.5 text-[10px] text-amber-500">· invitation envoyée</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Supprimer le groupe */}
            {isCreator && (
              <div className="px-4 py-3 mt-1 border-t border-white/[0.05]">
                <button
                  onClick={deleteGroup}
                  className="flex items-center gap-2 text-[12px] font-semibold text-red-400 hover:text-red-300 transition-colors"
                >
                  <Trash2 size={13} />
                  Supprimer le groupe
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
```

- [ ] **Dans `MapView.tsx`, importer `GroupSettingsModal` avec dynamic import :**

Chercher les autres dynamic imports (ex: `const FriendsModal = dynamic(...)`) et ajouter :
```ts
const GroupSettingsModal = dynamic(() => import("./GroupSettingsModal"), { ssr: false })
```

- [ ] **Ajouter `followingProfiles` (déjà disponible dans MapView) et le rendu de `GroupSettingsModal` dans le JSX de MapView :**

Chercher la zone où les modals sont rendus et ajouter :
```tsx
{selectedGroupForSettings && (
  <GroupSettingsModal
    group={selectedGroupForSettings}
    currentUserId={user?.id ?? ""}
    followingProfiles={friendProfiles}
    onClose={() => setSelectedGroupForSettings(null)}
    onGroupDeleted={(id) => {
      setGroups(prev => prev.filter(g => g.id !== id))
      if (activeGroupId === id) { setActiveGroupId(null); setFilter("friends") }
    }}
    onGroupUpdated={(updated) => setGroups(prev => prev.map(g => g.id === updated.id ? updated : g))}
  />
)}
```

> `friendProfiles` est le `useMemo` (ligne ~859 de MapView.tsx) qui liste `{ id, username, avatar_url }` pour chaque ami visible.

- [ ] **Vérifier la compilation :**
```bash
npx tsc --noEmit
```

- [ ] **Commit :**
```bash
git add components/map/GroupSettingsModal.tsx components/map/MapView.tsx
git commit -m "feat(groups): add GroupSettingsModal with members management and invitations"
```

---

## Task 7 : FriendsModal — invitations de groupe

**Files:**
- Modify: `components/map/FriendsModal.tsx`

- [ ] **Ajouter l'import du type `SpotGroupInvitation` dans `FriendsModal.tsx` :**

Trouver la ligne d'import des types et ajouter `SpotGroupInvitation`.

- [ ] **Ajouter le state des invitations de groupe dans le composant `FriendsModal` :**

```ts
const [groupInvitations, setGroupInvitations] = useState<SpotGroupInvitation[]>([])
```

- [ ] **Ajouter le callback `loadGroupInvitations` :**

```ts
const loadGroupInvitations = useCallback(async () => {
  if (!currentUser) return
  try {
    const { data } = await supabaseRef.current
      .from("spot_group_invitations")
      .select("*, spot_groups(id, creator_id, name, emoji)")
      .eq("invitee_id", currentUser.id)
      .eq("status", "pending")
    if (data) {
      const inviterIds = [...new Set(data.map((d: any) => d.inviter_id).filter(Boolean))]
      let inviterMap: Record<string, { username: string | null; avatar_url: string | null }> = {}
      if (inviterIds.length > 0) {
        const { data: profiles } = await supabaseRef.current
          .from("profiles").select("id, username, avatar_url").in("id", inviterIds)
        inviterMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]))
      }
      setGroupInvitations(data.map((d: any) => ({
        ...d,
        spot_groups: d.spot_groups ? {
          ...d.spot_groups,
          profiles: inviterMap[d.inviter_id] ?? null,
        } : null,
      })) as SpotGroupInvitation[])
    }
  } catch (e) {
    console.error("loadGroupInvitations:", e)
  }
}, [currentUser])
```

- [ ] **Appeler `loadGroupInvitations()` dans le `useEffect` principal de FriendsModal (celui qui charge les données à l'ouverture) :**

```ts
loadGroupInvitations()
```

- [ ] **Ajouter les handlers accepter/refuser :**

```ts
const acceptGroupInvitation = async (inv: SpotGroupInvitation) => {
  try {
    await supabaseRef.current
      .from("spot_group_invitations")
      .update({ status: "accepted" })
      .eq("id", inv.id)
    await supabaseRef.current
      .from("spot_group_members")
      .insert({ group_id: inv.group_id, user_id: currentUser!.id })
    setGroupInvitations(prev => prev.filter(i => i.id !== inv.id))
    toast.success(`Tu as rejoint le groupe "${inv.spot_groups?.name}" !`)
  } catch {
    toast.error("Erreur")
  }
}

const declineGroupInvitation = async (invId: string) => {
  try {
    await supabaseRef.current
      .from("spot_group_invitations")
      .update({ status: "declined" })
      .eq("id", invId)
    setGroupInvitations(prev => prev.filter(i => i.id !== invId))
  } catch {
    toast.error("Erreur")
  }
}
```

- [ ] **Dans le JSX de l'onglet Invitations de `FriendsModal`, ajouter la section des invitations de groupe.**

Chercher la section `{outingInvitations.length > 0 && (` dans l'onglet Invitations et ajouter **avant** cette section :

```tsx
{/* Invitations de groupe */}
{groupInvitations.length > 0 && (
  <div className="space-y-2">
    <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide px-1">
      Invitations de groupe · {groupInvitations.length}
    </p>
    {groupInvitations.map(inv => (
      <div key={inv.id} className="rounded-2xl border border-indigo-500/15 bg-white dark:bg-zinc-900 p-3 space-y-2.5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-xl flex-shrink-0">
            {inv.spot_groups?.emoji ?? "🗂️"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold text-gray-900 dark:text-white truncate">
              {inv.spot_groups?.name ?? "Groupe"}
            </p>
            <p className="text-[11px] text-zinc-500">
              Invité par <span className="text-indigo-400">@{(inv.spot_groups as any)?.profiles?.username ?? "?"}</span>
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => acceptGroupInvitation(inv)}
            className="flex-1 rounded-xl bg-indigo-500 py-2 text-[12px] font-bold text-white"
          >
            Rejoindre
          </button>
          <button
            onClick={() => declineGroupInvitation(inv.id)}
            className="flex-1 rounded-xl border border-gray-200 dark:border-white/[0.08] py-2 text-[12px] font-semibold text-gray-500 dark:text-zinc-400"
          >
            Refuser
          </button>
        </div>
      </div>
    ))}
  </div>
)}
```

- [ ] **Mettre à jour le calcul `totalInvitations` pour inclure les invitations de groupe :**

Chercher :
```ts
const totalInvitations = incomingRequests.length + outingInvitations.length
```
Remplacer par :
```ts
const totalInvitations = incomingRequests.length + outingInvitations.length + groupInvitations.length
```

- [ ] **Ajouter le listener realtime pour les invitations de groupe dans le `useEffect` du canal existant :**

Chercher le canal `friends-modal-${currentUser.id}` et ajouter un listener :
```ts
.on("postgres_changes", {
  event: "INSERT", schema: "public", table: "spot_group_invitations",
  filter: `invitee_id=eq.${currentUser.id}`,
}, () => loadGroupInvitations())
```

- [ ] **Vérifier la compilation :**
```bash
npx tsc --noEmit
```

- [ ] **Commit :**
```bash
git add components/map/FriendsModal.tsx
git commit -m "feat(groups): add group invitations in FriendsModal Invitations tab with realtime"
```

---

## Task 8 : Build final et vérification

- [ ] **Build de production :**
```bash
npx next build
```
Expected : build réussi (ignorer l'erreur prerender `/login` en local — variable d'env manquante).

- [ ] **Tester manuellement dans le navigateur :**
  - Créer un groupe via le dropdown "Groupes" dans la barre de filtres
  - Ajouter un spot avec visibilité "Groupe"
  - Vérifier que le spot apparaît dans le filtre du groupe
  - Inviter un ami depuis GroupSettingsModal
  - Se connecter avec le compte invité → vérifier l'invitation dans l'onglet Invitations de FriendsModal
  - Accepter l'invitation → vérifier que le membre apparaît dans les réglages du groupe

- [ ] **Déployer :**
```bash
echo "y" | npx vercel deploy --prod
```

- [ ] **Commit final si des corrections mineures ont été faites :**
```bash
git add -A
git commit -m "feat(groups): spot sharing with groups - complete implementation"
```
