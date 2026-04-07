# Groups Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corriger l'affichage mobile de GroupSettingsModal et permettre d'accéder au groupe immédiatement après avoir accepté une invitation.

**Architecture:** 3 fichiers modifiés. GroupSettingsModal : fix CSS. FriendsModal : remplacer `onRefreshGroups` par `onGroupJoined(groupId)` avec toast + action. MapView : implémenter le callback `onGroupJoined`.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Sonner (toasts)

---

### Task 1 : Fix mobile GroupSettingsModal

**Files:**
- Modify: `components/map/GroupSettingsModal.tsx`

- [ ] **Step 1 : Fixer la structure flex + safe area**

Remplacer la `motion.div` container et le `div` interne scrollable :

```tsx
// Avant
<motion.div
  className="relative z-10 w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-zinc-900 border border-white/[0.07] overflow-hidden"
  ...
>
  {/* Header */}
  <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-white/[0.06]">
    ...
  </div>
  <div className="max-h-[70vh] overflow-y-auto">
    ...
  </div>
</motion.div>

// Après
<motion.div
  className="relative z-10 w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-zinc-900 border border-white/[0.07] overflow-hidden flex flex-col max-h-[85dvh]"
  ...
>
  {/* Header — fixe, ne scrolle pas */}
  <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-white/[0.06] flex-shrink-0">
    ...
  </div>
  {/* Body scrollable */}
  <div className="overflow-y-auto pb-[env(safe-area-inset-bottom,1rem)]">
    ...
  </div>
</motion.div>
```

- [ ] **Step 2 : Compacter les inputs de renommage**

Dans le header (bloc `isCreator`), réduire la taille des inputs pour éviter le débordement sur écrans étroits :

```tsx
// Avant
className="w-9 text-center rounded-lg bg-white/[0.06] border border-white/[0.08] text-white text-base py-1 focus:outline-none focus:border-indigo-500"
// Après
className="w-8 text-center rounded-lg bg-white/[0.06] border border-white/[0.08] text-white text-sm py-1 focus:outline-none focus:border-indigo-500"

// Avant (input nom)
className="flex-1 min-w-0 rounded-lg bg-white/[0.06] border border-white/[0.08] text-white text-[14px] font-bold px-2 py-1 focus:outline-none focus:border-indigo-500"
// Après
className="flex-1 min-w-0 rounded-lg bg-white/[0.06] border border-white/[0.08] text-white text-[13px] font-bold px-2 py-1 focus:outline-none focus:border-indigo-500"
```

- [ ] **Step 3 : Commit**

```bash
git add components/map/GroupSettingsModal.tsx
git commit -m "fix(groups): fix GroupSettingsModal mobile layout — safe area, flex scroll, compact inputs"
```

---

### Task 2 : FriendsModal — onGroupJoined + toast avec action

**Files:**
- Modify: `components/map/FriendsModal.tsx` (lignes ~180, ~202, ~536)

- [ ] **Step 1 : Remplacer la prop `onRefreshGroups` par `onGroupJoined`**

Ligne ~180, remplacer :
```tsx
onRefreshGroups?: () => void
```
Par :
```tsx
onGroupJoined?: (groupId: string) => void
```

Ligne ~202, remplacer :
```tsx
onRefreshGroups,
```
Par :
```tsx
onGroupJoined,
```

- [ ] **Step 2 : Mettre à jour `acceptGroupInvitation` pour appeler `onGroupJoined` avec toast action**

Ligne ~531-537, remplacer :
```tsx
await Promise.all([
  supabaseRef.current.from("spot_group_invitations").update({ status: "accepted" }).eq("id", inv.id),
  supabaseRef.current.from("spot_group_members").upsert({ group_id: inv.group_id, user_id: currentUser.id }, { onConflict: "group_id,user_id" }),
])
setGroupInvitations(prev => prev.filter(i => i.id !== inv.id))
onRefreshGroups?.()
toast.success(`Tu as rejoint ${inv.spot_groups?.emoji ?? "🏠"} ${inv.spot_groups?.name ?? "le groupe"} !`)
```
Par :
```tsx
await Promise.all([
  supabaseRef.current.from("spot_group_invitations").update({ status: "accepted" }).eq("id", inv.id),
  supabaseRef.current.from("spot_group_members").upsert({ group_id: inv.group_id, user_id: currentUser.id }, { onConflict: "group_id,user_id" }),
])
setGroupInvitations(prev => prev.filter(i => i.id !== inv.id))
const groupId = inv.group_id
toast.success(`Tu as rejoint ${inv.spot_groups?.emoji ?? "🏠"} ${inv.spot_groups?.name ?? "le groupe"} !`, {
  action: { label: "Voir les spots", onClick: () => onGroupJoined?.(groupId) },
})
```

- [ ] **Step 3 : Commit**

```bash
git add components/map/FriendsModal.tsx
git commit -m "feat(groups): replace onRefreshGroups with onGroupJoined + toast action to navigate to group"
```

---

### Task 3 : MapView — implémenter onGroupJoined

**Files:**
- Modify: `components/map/MapView.tsx` (lignes ~2623)

- [ ] **Step 1 : Remplacer `onRefreshGroups={loadGroups}` par `onGroupJoined`**

Ligne ~2623, remplacer :
```tsx
onRefreshGroups={loadGroups}
```
Par :
```tsx
onGroupJoined={async (groupId) => {
  await loadGroups()
  setFilter("groups")
  setActiveGroupId(groupId)
  setShowFriendsModal(false)
}}
```

- [ ] **Step 2 : Build TypeScript**

```bash
npx next build 2>&1 | grep -E "Type error|error TS" | head -10
```

Résultat attendu : aucune erreur TS (ignorer `/login` prerender).

- [ ] **Step 3 : Commit**

```bash
git add components/map/MapView.tsx
git commit -m "feat(groups): implement onGroupJoined — load groups, activate filter, close modal"
```
