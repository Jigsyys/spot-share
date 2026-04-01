# Groupes & Visibilité des spots — Design Spec

**Date :** 2026-04-01  
**Statut :** Approuvé

---

## Résumé

Ajouter un système de groupes permettant de partager des spots avec une audience précise : tous ses amis, un groupe spécifique, ou personne (privé). Les groupes sont filtrables directement depuis la barre de filtres de la carte.

---

## Comportement validé

### Visibilité d'un spot (3 niveaux)

| Valeur `visibility` | Qui voit le spot |
|---|---|
| `friends` | Tous les abonnés du créateur (comportement actuel) |
| `group` | Uniquement les membres du groupe ciblé (`group_id`) |
| `private` | Uniquement le créateur |

- Un spot a **une seule audience** (radio, pas multiselect).
- Valeur par défaut : `friends`.

### Filtre "Groupes" sur la carte

- Bouton **"Groupes"** dans la barre de filtres (après "Amis").
- Au clic → dropdown avec liste des groupes dont l'utilisateur est membre.
- Sélection d'**un seul groupe** à la fois (radio).
- Chaque groupe a un bouton ⚙️ → ouvre les réglages du groupe.
- Bouton "+ Créer un groupe" en bas du dropdown.
- Quand un groupe est actif : affiche tous les spots `visibility = 'group'` ET `group_id = activeGroupId` partagés dans ce groupe.

### Filtres existants — comportement inchangé

- **"Moi"** → mes spots quelle que soit leur visibilité.
- **"Amis"** → spots `visibility = 'friends'` des gens que je suis.

---

## Base de données

### Nouvelles tables

```sql
create table spot_groups (
  id uuid not null default gen_random_uuid() primary key,
  creator_id uuid not null references auth.users on delete cascade,
  name text not null,
  emoji text not null default '🗂️',
  created_at timestamptz not null default now()
);

create table spot_group_members (
  group_id uuid not null references spot_groups on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  primary key (group_id, user_id)
);

create table spot_group_invitations (
  id uuid not null default gen_random_uuid() primary key,
  group_id uuid not null references spot_groups on delete cascade,
  invitee_id uuid not null references auth.users on delete cascade,
  inviter_id uuid not null references auth.users on delete cascade,
  status text not null default 'pending', -- pending | accepted | declined
  created_at timestamptz not null default now(),
  unique (group_id, invitee_id)
);
```

### Colonnes ajoutées sur `spots`

```sql
alter table spots
  add column if not exists visibility text not null default 'friends',
  add column if not exists group_id uuid references spot_groups on delete set null;
```

### RLS sur `spots`

```sql
-- SELECT : un utilisateur voit un spot si :
-- 1. Il en est le créateur (toujours)
-- 2. visibility = 'friends' ET il suit le créateur
-- 3. visibility = 'group' ET il est membre du groupe
create policy "spots_select" on spots for select using (
  user_id = auth.uid()
  or (
    visibility = 'friends'
    and user_id in (
      select following_id from followers where follower_id = auth.uid()
    )
  )
  or (
    visibility = 'group'
    and group_id in (
      select group_id from spot_group_members where user_id = auth.uid()
    )
  )
);
```

### RLS sur les nouvelles tables

- `spot_groups` : lecture si membre, écriture si créateur.
- `spot_group_members` : lecture si membre du groupe, insert par le créateur.
- `spot_group_invitations` : lecture si `invitee_id = me` ou créateur du groupe, insert par créateur du groupe.

### Invariant

Le créateur est automatiquement inséré dans `spot_group_members` à la création du groupe.

---

## Frontend

### Nouveaux types (`lib/types.ts`)

```ts
interface SpotGroup {
  id: string
  creator_id: string
  name: string
  emoji: string
  created_at: string
  members?: SpotGroupMember[]
}

interface SpotGroupMember {
  group_id: string
  user_id: string
  profiles?: { username: string | null; avatar_url: string | null }
}

interface SpotGroupInvitation {
  id: string
  group_id: string
  invitee_id: string
  inviter_id: string
  status: 'pending' | 'accepted' | 'declined'
  spot_groups?: SpotGroup
}
```

### State ajouté dans `MapView`

```ts
const [groups, setGroups] = useState<SpotGroup[]>([])
const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
```

### `visibleSpots` (useMemo mis à jour)

```ts
if (filter === 'mine') return spots.filter(s => s.user_id === user?.id)
if (filter === 'friends') return spots.filter(s => friendSet.has(s.user_id) && s.visibility === 'friends')
if (filter === 'groups' && activeGroupId)
  return spots.filter(s => s.group_id === activeGroupId && s.visibility === 'group')
return []
```

### Barre de filtres

- Bouton "Groupes" ajouté après "Amis".
- Badge sur le bouton si un groupe est actif.
- Dropdown : liste des groupes (radio) + ⚙️ par groupe + "+ Créer un groupe".

### `AddSpotModal` — champ "Partager avec"

- Selector dropdown (style B) : **Tous mes amis** (défaut) / [groupes de l'utilisateur] / **Privé**.
- Sélection radio — un seul choix.
- Alimente `visibility` et `group_id` au moment de l'insert.

### Nouveau composant : `GroupSettingsModal`

- Chargé en `next/dynamic`.
- Affiche : nom du groupe, emoji, liste des membres avec statut.
- Actions : inviter un ami (picker depuis `followingIds`), retirer un membre, supprimer le groupe.
- Invitations en attente affichées avec statut "invitation envoyée".

### Invitations de groupe dans `FriendsModal`

- Onglet **Invitations** — nouvelle section "Invitations de groupe".
- Format compact : nom du groupe + inviteur → boutons **Rejoindre / Refuser**.
- Au clic "Rejoindre" : update `spot_group_invitations.status = 'accepted'` + insert dans `spot_group_members`.

### Realtime

- Canal existant `friends-modal-${userId}` — ajout d'un listener `INSERT` sur `spot_group_invitations` filtré par `invitee_id = me`.
- Déclenche rechargement des invitations de groupe.

---

## Performance

| Aspect | Impact |
|---|---|
| RLS côté DB | Réduit le volume de spots transférés (spots privés/groupes non autorisés exclus) |
| Groupes au boot | 1 requête légère (`spot_group_members` + `spot_groups`), pas de pagination |
| Filtre groupes | Client-side `.filter()` sur `spots[]` déjà chargés — 0 requête supplémentaire |
| `GroupSettingsModal` | Dynamic import — chargé uniquement si ouvert |
| Cache localStorage | Compatible — ajouter `visibility` et `group_id` aux champs sérialisés |

---

## Ce qui ne change pas

- Filtres "Moi" et "Amis" : comportement identique à aujourd'hui.
- Spots existants : `visibility = 'friends'` par défaut — aucune rupture.
- `handleDeleteSpot`, `handleUpdateSpot` : inchangés.
