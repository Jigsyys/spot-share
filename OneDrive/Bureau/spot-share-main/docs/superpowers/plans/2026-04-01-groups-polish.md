# Groups Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 issues in the groups feature: slow profile loads, broken group deletion, invitation showing "Groupe", and missing spots after joining a group.

**Architecture:** All fixes are surgical — no new files, no refactoring. Fix 1 is a one-function rewrite. Fix 2 adds UI state to an existing modal. Fix 3 is a DB migration + no frontend change. Fix 4 adds one prop and one callback.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Supabase JS client v2, Framer Motion, Tailwind CSS dark-mode, Sonner toasts. Deploy: `echo "y" | npx vercel deploy --prod`.

---

## File Map

| File | What changes |
|------|-------------|
| `components/map/PublicProfileModal.tsx` | Parallelise the 4 sequential Supabase queries in `loadData` |
| `components/map/GroupSettingsModal.tsx` | Add `showConfirm` state + `ConfirmDialog`; add "Quitter le groupe" button; update spots before group delete |
| `components/map/FriendsModal.tsx` | Add `onRefreshSpots?: () => void` prop; call it in `acceptGroupInvitation` |
| `components/map/MapView.tsx` | Pass `onRefreshSpots={fetchSpots}` to `<FriendsModal>` |
| `supabase/migrations/20260401_groups.sql` | Update `spot_groups_select` to include pending invitees |

---

## Task 1 — Parallelise PublicProfileModal queries

**Files:**
- Modify: `components/map/PublicProfileModal.tsx:43-85`

- [ ] **Step 1: Replace `loadData` with parallel version**

Open `components/map/PublicProfileModal.tsx`. Replace the entire `loadData` callback (lines 43–85) with:

```typescript
const loadData = useCallback(async () => {
  if (!userId) return
  setLoading(true)
  try {
    const [profileRes, spotsRes, followersRes] = await Promise.allSettled([
      supabaseRef.current
        .from("profiles")
        .select("username, avatar_url, last_active_at")
        .eq("id", userId)
        .single(),
      supabaseRef.current
        .from("spots")
        .select("id, title, category, address, image_url, lat, lng")
        .eq("user_id", userId),
      supabaseRef.current
        .from("followers")
        .select("*", { count: "exact", head: true })
        .eq("following_id", userId),
    ])

    if (profileRes.status === "fulfilled" && profileRes.value.data)
      setProfile(profileRes.value.data as typeof profile)

    const resolvedSpots =
      spotsRes.status === "fulfilled" ? (spotsRes.value.data as Spot[] ?? []) : []
    setSpots(resolvedSpots)

    if (followersRes.status === "fulfilled")
      setFollowers(followersRes.value.count ?? 0)

    // Likes count needs spot IDs — only fetch if spots loaded
    if (resolvedSpots.length > 0) {
      try {
        const ids = resolvedSpots.map(s => s.id)
        const { count: likesCount } = await supabaseRef.current
          .from("spot_reactions")
          .select("*", { count: "exact", head: true })
          .in("spot_id", ids)
          .eq("type", "love")
          .neq("user_id", userId)
        setTotalLikes(likesCount ?? 0)
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ } finally {
    setLoading(false)
  }
}, [userId])
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "C:/Users/maxen/OneDrive/Bureau/spot-share-main"
npx tsc --noEmit 2>&1 | grep -i "PublicProfileModal"
```

Expected: no output (no errors in that file).

- [ ] **Step 3: Manual test**

Open the app, click on any user's profile. The name and spots should appear in roughly 1 request time instead of sequentially. No loading spinner stall.

- [ ] **Step 4: Commit**

```bash
git add components/map/PublicProfileModal.tsx
git commit -m "perf: parallelise PublicProfileModal queries"
```

---

## Task 2 — Group deletion: confirmation + leave group + fix spots on delete

**Files:**
- Modify: `components/map/GroupSettingsModal.tsx`

### Step 2a — Add imports and `showConfirm` state

- [ ] **Step 1: Add ConfirmDialog import and state**

At the top of `components/map/GroupSettingsModal.tsx`, add the import:

```typescript
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
```

Inside the component body, after the existing `const [deleting, setDeleting] = useState(false)` line, add:

```typescript
const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
const [leaving, setLeaving] = useState(false)
const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
```

### Step 2b — Fix `deleteGroup`: reset spots visibility before deleting

- [ ] **Step 2: Update `deleteGroup` to reset spots first**

Replace the existing `deleteGroup` function with:

```typescript
const deleteGroup = async () => {
  setDeleting(true)
  try {
    // Reset group spots to friends visibility so they don't become invisible
    await supabase.current
      .from("spots")
      .update({ visibility: "friends", group_id: null })
      .eq("group_id", group.id)

    const { error } = await supabase.current.from("spot_groups").delete().eq("id", group.id)
    if (error) {
      toast.error("Impossible de supprimer le groupe")
      return
    }
    onGroupDeleted(group.id)
    onClose()
    toast.success(`Groupe "${group.name}" supprimé`)
  } catch {
    toast.error("Impossible de supprimer le groupe")
  } finally {
    setDeleting(false)
  }
}
```

### Step 2c — Add `leaveGroup` function

- [ ] **Step 3: Add leaveGroup after deleteGroup**

```typescript
const leaveGroup = async () => {
  setLeaving(true)
  try {
    const { error } = await supabase.current
      .from("spot_group_members")
      .delete()
      .eq("group_id", group.id)
      .eq("user_id", currentUserId)
    if (error) {
      toast.error("Impossible de quitter le groupe")
      return
    }
    onGroupDeleted(group.id) // reuse same callback — removes group from MapView state
    onClose()
    toast.success(`Tu as quitté ${group.emoji} ${group.name}`)
  } catch {
    toast.error("Impossible de quitter le groupe")
  } finally {
    setLeaving(false)
  }
}
```

### Step 2d — Update the JSX: wire confirmation dialogs

- [ ] **Step 4: Replace the "Supprimer le groupe" section in the JSX**

Find the section at the bottom of the modal JSX:

```tsx
{/* Supprimer le groupe */}
{isCreator && (
  <div className="px-4 py-3 mt-1 border-t border-white/[0.05]">
    <button
      onClick={deleteGroup}
      disabled={deleting}
      className="flex items-center gap-2 text-[12px] font-semibold text-red-400 hover:text-red-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {deleting ? <LoaderCircle size={13} className="animate-spin" /> : <Trash2 size={13} />}
      Supprimer le groupe
    </button>
  </div>
)}
```

Replace with:

```tsx
{/* Actions bas de page */}
<div className="px-4 py-3 mt-1 border-t border-white/[0.05] flex flex-col gap-2">
  {/* Quitter (membres non-créateurs seulement) */}
  {!isCreator && (
    <button
      onClick={() => setShowLeaveConfirm(true)}
      disabled={leaving}
      className="flex items-center gap-2 text-[12px] font-semibold text-amber-400 hover:text-amber-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {leaving ? <LoaderCircle size={13} className="animate-spin" /> : <X size={13} />}
      Quitter le groupe
    </button>
  )}
  {/* Supprimer (créateur seulement) */}
  {isCreator && (
    <button
      onClick={() => setShowDeleteConfirm(true)}
      disabled={deleting}
      className="flex items-center gap-2 text-[12px] font-semibold text-red-400 hover:text-red-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {deleting ? <LoaderCircle size={13} className="animate-spin" /> : <Trash2 size={13} />}
      Supprimer le groupe
    </button>
  )}
</div>
```

- [ ] **Step 5: Add ConfirmDialog components just before the closing `</AnimatePresence>`**

Find `</AnimatePresence>` at the end of the component return. Insert just before it:

```tsx
<ConfirmDialog
  open={showDeleteConfirm}
  title="Supprimer le groupe ?"
  message={`Le groupe "${group.name}" sera supprimé. Les spots partagés redeviendront visibles pour tes amis.`}
  confirmLabel="Supprimer"
  danger
  onConfirm={() => { setShowDeleteConfirm(false); deleteGroup() }}
  onCancel={() => setShowDeleteConfirm(false)}
/>
<ConfirmDialog
  open={showLeaveConfirm}
  title="Quitter le groupe ?"
  message={`Tu n'auras plus accès aux spots de ${group.emoji} ${group.name}.`}
  confirmLabel="Quitter"
  danger
  onConfirm={() => { setShowLeaveConfirm(false); leaveGroup() }}
  onCancel={() => setShowLeaveConfirm(false)}
/>
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep -i "GroupSettings"
```

Expected: no output.

- [ ] **Step 7: Manual test**

1. Open a group you created → settings gear → "Supprimer le groupe" → confirm dialog appears → confirm → group disappears from list, toast shown.
2. Log in as a member (not creator) → settings gear → "Quitter le groupe" → confirm dialog appears → confirm → group disappears.

- [ ] **Step 8: Commit**

```bash
git add components/map/GroupSettingsModal.tsx
git commit -m "feat(groups): add delete confirmation, leave group, fix spots on delete"
```

---

## Task 3 — RLS: show group name on invitation card

**Files:**
- DB migration via MCP
- Modify: `supabase/migrations/20260401_groups.sql`

- [ ] **Step 1: Apply DB migration via Supabase MCP**

Apply this migration (name: `fix_spot_groups_select_invitees`):

```sql
-- Allow pending invitees to see the group (needed for invitation card to show group name)
DROP POLICY IF EXISTS "spot_groups_select" ON public.spot_groups;

CREATE POLICY "spot_groups_select" ON public.spot_groups FOR SELECT USING (
  creator_id = auth.uid()
  OR id IN (SELECT get_my_group_ids())
  OR id IN (
    SELECT group_id FROM public.spot_group_invitations
    WHERE invitee_id = auth.uid() AND status = 'pending'
  )
);
```

- [ ] **Step 2: Update the migration file to match DB state**

In `supabase/migrations/20260401_groups.sql`, find:

```sql
-- Creator can always see their own group (needed for insert().select() pattern)
create policy "spot_groups_select" on public.spot_groups for select using (
  creator_id = auth.uid()
  or id in (select get_my_group_ids())
);
```

Replace with:

```sql
-- Creator, members, and pending invitees can see the group
create policy "spot_groups_select" on public.spot_groups for select using (
  creator_id = auth.uid()
  or id in (select get_my_group_ids())
  or id in (
    select group_id from public.spot_group_invitations
    where invitee_id = auth.uid() and status = 'pending'
  )
);
```

- [ ] **Step 3: Manual test**

Send a group invitation to a second account. On the second account, open FriendsModal → Invitations tab. The card should now show the real group emoji and name instead of "Groupe".

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260401_groups.sql
git commit -m "fix(groups): allow invitees to see group name before accepting"
```

---

## Task 4 — Reload spots after accepting a group invitation

**Files:**
- Modify: `components/map/FriendsModal.tsx:171-184` (props interface) and `~line 527-545` (acceptGroupInvitation)
- Modify: `components/map/MapView.tsx` (~line 2579, FriendsModal usage)

### Step 4a — Add `onRefreshSpots` prop to FriendsModal

- [ ] **Step 1: Add prop to FriendsModalProps interface**

In `components/map/FriendsModal.tsx`, find the `FriendsModalProps` interface:

```typescript
interface FriendsModalProps {
  ...
  onRefreshGroups?: () => void
  ...
}
```

Add `onRefreshSpots` right after `onRefreshGroups`:

```typescript
  onRefreshGroups?: () => void
  onRefreshSpots?: () => void
```

- [ ] **Step 2: Destructure the new prop**

Find the component function signature (the line starting `export default function FriendsModal`). Add `onRefreshSpots` to the destructured props alongside `onRefreshGroups`:

```typescript
{ ..., onRefreshGroups, onRefreshSpots, ... }
```

- [ ] **Step 3: Call `onRefreshSpots` in `acceptGroupInvitation`**

Find the `acceptGroupInvitation` callback. After the existing `onRefreshGroups?.()` call, add:

```typescript
onRefreshGroups?.()
onRefreshSpots?.()
```

### Step 4b — Pass the callback from MapView

- [ ] **Step 4: Pass `onRefreshSpots` in MapView**

In `components/map/MapView.tsx`, find the `<FriendsModal>` JSX (around line 2579):

```tsx
onRefreshGroups={loadGroups}
```

Add the new prop on the next line:

```tsx
onRefreshGroups={loadGroups}
onRefreshSpots={fetchSpots}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep -iE "FriendsModal|MapView"
```

Expected: no output.

- [ ] **Step 6: Manual test**

1. On account A: create a group, add a spot with `visibility = group`.
2. On account B: receive and accept the invitation.
3. On account B: open the groups dropdown — the new group appears.
4. On account B: select the group filter — the spot from account A appears immediately on the map (no refresh needed).

- [ ] **Step 7: Commit**

```bash
git add components/map/FriendsModal.tsx components/map/MapView.tsx
git commit -m "fix(groups): reload spots after accepting group invitation"
```

---

## Task 5 — Deploy

- [ ] **Step 1: Final TypeScript check**

```bash
npx tsc --noEmit 2>&1
```

Expected: no errors (or only the known `/login` prerender warning unrelated to our changes).

- [ ] **Step 2: Deploy to production**

```bash
echo "y" | npx vercel deploy --prod
```

Expected: `Aliased: https://spot-share-kappa.vercel.app`

- [ ] **Step 3: Smoke test on prod**

- Open a profile → loads fast (no spinner stall)
- Create group → invite friend → friend sees group name on card → accepts → spots appear
- Delete a group → confirmation dialog → spots revert to friends visibility
- Non-creator member → can leave group via confirmation dialog
