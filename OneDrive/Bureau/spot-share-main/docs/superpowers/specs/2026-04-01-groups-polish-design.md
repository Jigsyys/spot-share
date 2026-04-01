# Groups Polish — Design Spec
_Date: 2026-04-01_

## Scope

Four targeted fixes to make the groups feature complete and correct:

1. **PublicProfileModal slow load** — parallelise sequential DB queries
2. **Group deletion UX** — add confirmation, fix spots visibility on delete, add "leave group" for members
3. **Invitation shows "Groupe"** — RLS fix so invitees can see group name before accepting
4. **Spots missing after joining group** — reload spots after accepting an invitation

---

## Fix 1 — PublicProfileModal: parallel queries

**File:** `components/map/PublicProfileModal.tsx`

**Root cause:** `loadData` runs 4–5 Supabase queries sequentially with `await`. On mobile latency (~200ms each) this adds up to ~1s+ total.

**Fix:** Wrap all independent queries in `Promise.allSettled`:

```
[profile, spots, followersCount, spotIds] = await Promise.allSettled([...])
```

Then compute likes count from the resolved spot IDs in a second batch only if needed. Profile and spots render immediately once resolved — no need to wait for follower/like counts.

**Success criteria:** Profile name and spots appear in ~1 network round-trip instead of 4.

---

## Fix 2 — Group deletion

**Files:** `components/map/GroupSettingsModal.tsx`, `components/map/MapView.tsx`

### 2a — Confirmation before delete

Reuse the existing `ConfirmDialog` component (already used in MapView). Show it inline in `GroupSettingsModal` before calling `deleteGroup`. Prevents accidental deletion.

### 2b — Fix spot visibility on delete

When a group is deleted, `spots.group_id` is set to `NULL` by the DB (`SET NULL` FK rule), but `spots.visibility` stays `'group'`. Those spots become invisible to everyone.

Fix: before deleting the group, update all its spots to `visibility = 'friends', group_id = null` so they remain visible to the owner's friends.

```typescript
await supabase.from("spots")
  .update({ visibility: "friends", group_id: null })
  .eq("group_id", group.id)
// then delete the group
```

### 2c — Leave group for non-creator members

Non-creators currently have no way to exit a group. Add a "Quitter le groupe" button at the bottom of `GroupSettingsModal` (visible only to non-creator members). It deletes the row from `spot_group_members` for the current user, then closes the modal and removes the group from the local state in MapView.

**Success criteria:** Creator can delete with confirmation. Non-creator can leave. Deleted group's spots stay visible as friends-only spots.

---

## Fix 3 — Group name visible on invitation card

**RLS migration + `FriendsModal.tsx`**

**Root cause:** The invitation query does `.select("*, spot_groups(*)")`. The `spot_groups_select` policy only allows members (`get_my_group_ids()`). Since the invitee is not yet a member, the join returns `null`. The UI then falls back to `"Groupe"`.

**DB fix:** Add pending invitees to `spot_groups_select`:

```sql
DROP POLICY IF EXISTS "spot_groups_select" ON public.spot_groups;
CREATE POLICY "spot_groups_select" ON public.spot_groups FOR SELECT USING (
  creator_id = auth.uid()
  OR id IN (SELECT get_my_group_ids())
  OR id IN (
    SELECT group_id FROM spot_group_invitations
    WHERE invitee_id = auth.uid() AND status = 'pending'
  )
);
```

No frontend code changes needed — once the policy passes, `inv.spot_groups?.name` will be populated.

**Success criteria:** Invitation card shows `{emoji} {name}` instead of "Groupe".

---

## Fix 4 — Spots visible after joining a group

**Files:** `components/map/MapView.tsx`, `components/map/FriendsModal.tsx`

**Root cause:** After `acceptGroupInvitation` in FriendsModal, `onRefreshGroups` reloads the groups list in MapView. But the `spots` array is not refreshed — group spots in the DB are now visible to the new member via RLS, but they aren't in the local state.

**Fix:** Add an `onRefreshSpots` prop to `FriendsModal` (alongside the existing `onRefreshGroups`). In MapView, pass a callback that triggers `loadSpots(true)` (force-refresh, bypass cache). Call it from `acceptGroupInvitation` after `onRefreshGroups`.

```typescript
// FriendsModal prop
onRefreshSpots?: () => void

// After accepting:
onRefreshGroups?.()
onRefreshSpots?.()
```

**Success criteria:** After accepting an invitation, the new group appears in the dropdown AND its spots are immediately visible on the map when the user selects that group filter.

---

## Files changed

| File | Change |
|------|--------|
| `components/map/PublicProfileModal.tsx` | Parallelise queries |
| `components/map/GroupSettingsModal.tsx` | Confirmation dialog, leave group button, fix spots before delete |
| `components/map/FriendsModal.tsx` | Add `onRefreshSpots` prop, call it on accept |
| `components/map/MapView.tsx` | Pass `onRefreshSpots` to FriendsModal |
| `supabase/migrations/20260401_groups.sql` | Update `spot_groups_select` policy |
| DB (via MCP) | Apply `spot_groups_select` migration |

---

## Out of scope

- Group chat / messaging
- Group spot feed (separate from map filter)
- Group discovery / public groups
- Editing group name or emoji
