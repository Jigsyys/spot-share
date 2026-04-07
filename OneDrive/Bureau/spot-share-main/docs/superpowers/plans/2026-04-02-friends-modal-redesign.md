# FriendsModal Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure FriendsModal from 3 tabs (Amis / Classement / Invitations) to 3 recentered tabs (Amis+Groupes / Sorties / Activité) — each with a single, clear responsibility and dedicated badge.

**Architecture:** All changes are contained within `components/map/FriendsModal.tsx` (~2900 lines) plus minor prop additions in `components/map/MapView.tsx`. No new files. No new network requests — the activity feed uses the existing `spots` prop filtered by `followingIds`.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase, Tailwind CSS, Framer Motion, Lucide icons

---

## Task 1 — Types, props, badge logic, tabs array

**Files:**
- Modify: `components/map/FriendsModal.tsx:156` (Tab type)
- Modify: `components/map/FriendsModal.tsx:171-187` (FriendsModalProps interface)
- Modify: `components/map/FriendsModal.tsx:193-209` (destructuring)
- Modify: `components/map/FriendsModal.tsx:221` (remove invitationsSeen state)
- Modify: `components/map/FriendsModal.tsx:1043-1051` (badge logic)
- Modify: `components/map/FriendsModal.tsx:1061-1065` (tabs array)
- Modify: `components/map/FriendsModal.tsx:1139` (tab click handler)
- Modify: `components/map/FriendsModal.tsx:1148-1153` (badge render)

- [ ] **Step 1: Change Tab type** at line 156

```typescript
// Replace:
type Tab = "amis" | "classement" | "invitations"
// With:
type Tab = "amis" | "sorties" | "activite"
```

- [ ] **Step 2: Add groups and onCreateGroup to FriendsModalProps** — add after `onLocateOuting` in the interface (around line 185):

```typescript
  groups?: Array<{ id: string; name: string; emoji: string; creator_id: string }>
  onCreateGroup?: (name: string, emoji: string) => Promise<void>
```

- [ ] **Step 3: Destructure new props** — add `groups` and `onCreateGroup` to the destructuring at line 193:

```typescript
export default function FriendsModal({
  isOpen,
  onClose,
  currentUser,
  followingIds,
  onFollowingChange,
  visibleFriendIds,
  setVisibleFriendIds,
  onRefreshFollowing,
  onGroupJoined,
  onLocateFriend,
  onSelectUser,
  onSelectSpot,
  spots,
  userProfile,
  onLocateOuting,
  groups = [],
  onCreateGroup,
}: FriendsModalProps) {
```

- [ ] **Step 4: Remove `invitationsSeen` state** at line 221

```typescript
// Remove this line entirely:
const [invitationsSeen, setInvitationsSeen] = useState(false)
```

- [ ] **Step 5: Add create-group form state** right after the other UI state declarations (after line ~222):

```typescript
  const [showCreateGroupForm, setShowCreateGroupForm] = useState(false)
  const [newGroupFormName, setNewGroupFormName] = useState("")
  const [newGroupFormEmoji, setNewGroupFormEmoji] = useState("🗂️")
  const [creatingGroupLocal, setCreatingGroupLocal] = useState(false)
```

- [ ] **Step 6: Add handleCreateGroupLocal callback** — add after `declineGroupInvitation` callback (around line 565):

```typescript
  const handleCreateGroupLocal = useCallback(async () => {
    if (!newGroupFormName.trim() || !onCreateGroup) return
    setCreatingGroupLocal(true)
    try {
      await onCreateGroup(newGroupFormName.trim(), newGroupFormEmoji)
      setNewGroupFormName("")
      setNewGroupFormEmoji("🗂️")
      setShowCreateGroupForm(false)
    } catch {}
    setCreatingGroupLocal(false)
  }, [newGroupFormName, newGroupFormEmoji, onCreateGroup])
```

- [ ] **Step 7: Add activityFeed useMemo** — add after `pastOutings` at line 1055:

```typescript
  const activityFeed = useMemo(() => {
    if (!spots || followingIds.length === 0) return []
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
    const followingSet = new Set(followingIds)
    return spots
      .filter(s => followingSet.has(s.user_id) && new Date(s.created_at).getTime() > cutoff)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 15)
  }, [spots, followingIds])
```

- [ ] **Step 8: Replace badge logic** at lines 1043–1051

```typescript
// Replace the entire block:
// const totalInvitations = ...
// const prevTotalRef = useRef(0)
// useEffect(() => { ... }, [totalInvitations])
//
// With:
  const amisBadge = groupInvitations.length
  const sortiesBadge = outingInvitations.length
  const activiteBadge = incomingRequests.length
```

- [ ] **Step 9: Update tabs array** at lines 1061–1065

```typescript
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "amis", label: "Amis", icon: <UserCheck size={12} /> },
    { id: "sorties", label: "Sorties", icon: <CalendarCheck size={12} /> },
    { id: "activite", label: "Activité", icon: <Bell size={12} /> },
  ]
```

- [ ] **Step 10: Update tab click handler** at line 1139 — remove invitationsSeen side-effect

```typescript
// Replace:
onClick={() => { setActiveTab(tab.id as Tab); setQuery(""); if (tab.id === "invitations") setInvitationsSeen(true) }}
// With:
onClick={() => { setActiveTab(tab.id as Tab); setQuery("") }}
```

- [ ] **Step 11: Update tab badge render** — replace lines 1148–1153:

```tsx
// Replace:
{tab.id === "invitations" && totalInvitations > 0 && !invitationsSeen && (
  <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white leading-none">
    {totalInvitations}
  </span>
)}
// With:
{tab.id === "amis" && amisBadge > 0 && (
  <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white leading-none">
    {amisBadge}
  </span>
)}
{tab.id === "sorties" && sortiesBadge > 0 && (
  <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white leading-none">
    {sortiesBadge}
  </span>
)}
{tab.id === "activite" && activiteBadge > 0 && (
  <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white leading-none">
    {activiteBadge}
  </span>
)}
```

- [ ] **Step 12: Verify TypeScript** — run `getDiagnostics` on `components/map/FriendsModal.tsx`. Fix any type errors (common: `invitationsSeen` still referenced somewhere — grep and remove all remaining references).

- [ ] **Step 13: Commit**

```bash
git add components/map/FriendsModal.tsx
git commit -m "refactor: update Tab type, props, badge logic for 3-tab redesign"
```

---

## Task 2 — Restructure Amis tab: remove outing sections, add Groups section

**Files:**
- Modify: `components/map/FriendsModal.tsx:1181-1330` (Amis tab content)

The Amis tab currently starts at `{activeTab === "amis" && (` (line 1181) and ends at line 1330.
It contains: "Proposer sortie" CTA, upcoming outings, past outings, then the friends list.

- [ ] **Step 1: Remove "Proposer une sortie" CTA from Amis tab** — delete lines 1184–1201 (the `<button onClick={() => setShowCreateOuting(true)} ...>` block labelled `{/* CTA Proposer une sortie */}`).

- [ ] **Step 2: Remove upcoming outings section from Amis tab** — delete lines 1203–1221 (the `{upcomingOutings.length > 0 && query.length < 2 && (` block labelled `{/* Sortie à venir */}`).

- [ ] **Step 3: Remove past outings section from Amis tab** — delete lines 1224–1237 (the `{pastOutings.length > 0 && query.length < 2 && (` block labelled `{/* Sorties passées */}`).

- [ ] **Step 4: Add Groups section** — insert before the closing `</div>` of the Amis tab content (just before line 1329 `</div>` that closes `{activeTab === "amis" && (<div className="space-y-5">`):

```tsx
                    {/* ── Groupes ─────────────────────────────────────── */}
                    {query.length < 2 && (
                      <Section title="Groupes" icon={<Building2 size={10} />}>
                        {/* Invitations de groupe en attente */}
                        {groupInvitations.map(inv => (
                          <div key={inv.id} className="flex items-center gap-3 rounded-2xl border border-gray-100 dark:border-white/[0.06] bg-white dark:bg-zinc-900 px-3 py-2.5">
                            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-500/10 text-xl">
                              {inv.spot_groups?.emoji ?? "🏠"}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] font-semibold text-gray-800 dark:text-zinc-100">
                                {inv.spot_groups?.name ?? "Groupe"}
                              </p>
                              <p className="truncate text-[11px] text-gray-400 dark:text-zinc-500">
                                Invité par @{inv.inviterProfile?.username ?? "quelqu'un"}
                              </p>
                            </div>
                            <div className="flex gap-1.5 flex-shrink-0">
                              <button
                                onClick={() => acceptGroupInvitation(inv)}
                                disabled={respondingGroupInviteId === inv.id}
                                className="rounded-xl bg-indigo-500 px-3 py-1.5 text-[12px] font-semibold text-white transition active:scale-95 hover:bg-indigo-400 disabled:opacity-50 disabled:pointer-events-none"
                              >
                                {respondingGroupInviteId === inv.id ? "…" : "Rejoindre"}
                              </button>
                              <button
                                onClick={() => declineGroupInvitation(inv)}
                                disabled={respondingGroupInviteId === inv.id}
                                className="rounded-xl border border-gray-200 dark:border-white/10 px-3 py-1.5 text-[12px] font-medium text-gray-500 dark:text-zinc-400 transition hover:bg-gray-50 dark:hover:bg-white/5 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
                              >
                                Décliner
                              </button>
                            </div>
                          </div>
                        ))}

                        {/* Groupes existants */}
                        {groups.map(group => (
                          <div key={group.id} className="flex items-center gap-3 rounded-2xl border border-gray-100 dark:border-white/[0.06] bg-white dark:bg-zinc-900 px-3 py-2.5">
                            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-500/10 text-xl">
                              {group.emoji}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] font-semibold text-gray-800 dark:text-zinc-100">
                                {group.name}
                              </p>
                            </div>
                          </div>
                        ))}

                        {/* Créer un groupe */}
                        {!showCreateGroupForm ? (
                          <button
                            onClick={() => setShowCreateGroupForm(true)}
                            className="flex w-full items-center gap-3 rounded-2xl border-2 border-dashed border-indigo-300/60 dark:border-indigo-500/25 bg-indigo-50/50 dark:bg-indigo-500/[0.04] px-4 py-3 text-left transition-all hover:border-indigo-400/80 dark:hover:border-indigo-500/50 active:scale-[0.99]"
                          >
                            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 text-lg font-bold">
                              +
                            </div>
                            <p className="text-[13px] font-semibold text-indigo-700 dark:text-indigo-300">
                              Créer un groupe
                            </p>
                          </button>
                        ) : (
                          <div className="rounded-2xl border border-gray-100 dark:border-white/[0.06] bg-white dark:bg-zinc-900 px-3 py-3 space-y-2">
                            <div className="flex gap-2">
                              <input
                                value={newGroupFormEmoji}
                                onChange={e => setNewGroupFormEmoji(e.target.value)}
                                className="w-10 text-center rounded-xl bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-white/10 text-sm py-2 focus:outline-none focus:border-indigo-500"
                                maxLength={2}
                              />
                              <input
                                autoFocus
                                value={newGroupFormName}
                                onChange={e => setNewGroupFormName(e.target.value)}
                                placeholder="Nom du groupe..."
                                className="flex-1 rounded-xl bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-white/10 text-gray-800 dark:text-zinc-100 text-[13px] px-3 py-2 placeholder:text-gray-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
                                onKeyDown={e => e.key === "Enter" && handleCreateGroupLocal()}
                              />
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => { setShowCreateGroupForm(false); setNewGroupFormName(""); setNewGroupFormEmoji("🗂️") }}
                                className="flex-1 rounded-xl bg-gray-100 dark:bg-zinc-800 py-2 text-[12px] font-semibold text-gray-500 dark:text-zinc-400"
                              >
                                Annuler
                              </button>
                              <button
                                onClick={handleCreateGroupLocal}
                                disabled={!newGroupFormName.trim() || creatingGroupLocal}
                                className="flex-1 rounded-xl bg-indigo-500 py-2 text-[12px] font-bold text-white disabled:opacity-50"
                              >
                                {creatingGroupLocal ? "…" : "Créer"}
                              </button>
                            </div>
                          </div>
                        )}
                      </Section>
                    )}
```

Note: `Building2` is already imported in MapView but needs to be checked in FriendsModal. If not imported, add it to the lucide-react imports at the top.

- [ ] **Step 5: Update swipe-to-close disabled condition** — line 276 currently has `showCreateOuting || !!editingOuting`. Add the group form:

```typescript
// Replace:
const swipe = useSwipeToClose(onClose, showCreateOuting || !!editingOuting)
// With:
const swipe = useSwipeToClose(onClose, showCreateOuting || !!editingOuting || showCreateGroupForm)
```

- [ ] **Step 6: Verify TypeScript** — run `getDiagnostics` on `components/map/FriendsModal.tsx`.

- [ ] **Step 7: Commit**

```bash
git add components/map/FriendsModal.tsx
git commit -m "feat: add Groups section to Amis tab, remove outing shortcuts from Amis"
```

---

## Task 3 — Build new Sorties tab

**Files:**
- Modify: `components/map/FriendsModal.tsx` — replace `{activeTab === "classement" && (...)}` block with new Sorties tab

The classement block starts at line 1333 (`{activeTab === "classement" && (`) and ends at line 1620 (`})`).
Replace that entire block with the new Sorties tab:

- [ ] **Step 1: Replace the classement block** (lines 1333–1622 inclusive) with:

```tsx
                {/* ════ SORTIES ══════════════════════════════════ */}
                {activeTab === "sorties" && (
                  <div className="space-y-5 pb-2">

                    {/* CTA Proposer une sortie */}
                    <button
                      onClick={() => setShowCreateOuting(true)}
                      className="group w-full flex items-center gap-3 rounded-xl border-2 border-dashed border-indigo-300/60 dark:border-indigo-500/25 bg-indigo-50/50 dark:bg-indigo-500/[0.04] px-4 py-3 text-left transition-all hover:border-indigo-400/80 dark:hover:border-indigo-500/50 hover:bg-indigo-50 dark:hover:bg-indigo-500/[0.08] active:scale-[0.99]"
                    >
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 dark:bg-indigo-500/15 transition-colors group-hover:bg-indigo-500/20">
                        <CalendarPlus size={16} className="text-indigo-600 dark:text-indigo-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-indigo-700 dark:text-indigo-300">
                          Proposer une sortie
                        </p>
                        <p className="text-[11px] text-indigo-500/70 dark:text-indigo-400/60">
                          Invite tes amis à un spot ou un endroit
                        </p>
                      </div>
                      <ChevronRight size={14} className="text-indigo-400 dark:text-indigo-600 flex-shrink-0" />
                    </button>

                    {/* Invitations reçues */}
                    {outingInvitations.length > 0 && (
                      <Section title={`Invitations reçues · ${outingInvitations.length}`} icon={<CalendarPlus size={10} />}>
                        <div className="space-y-3">
                          {outingInvitations.map(inv => {
                            const outing = inv.outings
                            const creator = outing?.profiles
                            const allInvitations = outing?.allInvitations ?? []
                            const appSpot = outing?.spot_id ? spots?.find(s => s.id === outing.spot_id) : null
                            const photoUrl = appSpot?.image_url?.split(",")[0]?.trim()
                              ?? (outing?.lat && outing?.lng
                                ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${outing.lng},${outing.lat},14,0/600x280?access_token=${process.env.NEXT_PUBLIC_MAPBOX_TOKEN}`
                                : null)
                            const countdown = getCountdown(outing?.scheduled_at)
                            const accepted = allInvitations.filter(i => i.status === "accepted")
                            const pending = allInvitations.filter(i => i.status === "pending")
                            if (!outing) return null
                            return (
                              <OutingInvitationCard
                                key={inv.id}
                                inv={inv}
                                outing={outing}
                                creator={creator ?? null}
                                photoUrl={photoUrl}
                                countdown={countdown}
                                accepted={accepted}
                                pending={pending}
                                currentUserId={currentUser?.id ?? ""}
                                respondingId={respondingId}
                                spots={spots}
                                onRespond={respondToInvitation}
                                onLocate={onLocateOuting}
                                onSelectSpot={onSelectSpot}
                              />
                            )
                          })}
                        </div>
                      </Section>
                    )}

                    {/* Mes sorties à venir */}
                    {upcomingOutings.length > 0 && (
                      <Section title="Mes sorties" icon={<CalendarCheck size={10} />}>
                        {upcomingOutings.map(outing => (
                          <FeaturedOutingCard
                            key={outing.id}
                            outing={outing}
                            currentUserId={currentUser?.id ?? ""}
                            spots={spots}
                            onCancel={cancelOuting}
                            onLocate={onLocateOuting}
                          />
                        ))}
                      </Section>
                    )}

                    {/* Sorties passées */}
                    {pastOutings.length > 0 && (
                      <Section title="Sorties passées" icon={<Clock size={10} />}>
                        {pastOutings.map(outing => (
                          <OutingCard
                            key={outing.id}
                            outing={outing}
                            currentUserId={currentUser?.id ?? ""}
                            onCancel={cancelOuting}
                            past
                          />
                        ))}
                      </Section>
                    )}

                    {/* Empty state */}
                    {outingInvitations.length === 0 && outings.length === 0 && (
                      <EmptyState
                        icon={<CalendarCheck size={24} />}
                        text="Aucune sortie pour l'instant"
                        sub="Propose une sortie à tes amis depuis n'importe quel spot !"
                      />
                    )}
                  </div>
                )}
```

Note: `OutingInvitationCard` and `FeaturedOutingCard` and `OutingCard` are sub-components already defined in this file. Check that all props (`respondToInvitation`, `cancelOuting`) are in scope — they are defined earlier in FriendsModal.

- [ ] **Step 2: Verify TypeScript** — run `getDiagnostics` on the file.

- [ ] **Step 3: Commit**

```bash
git add components/map/FriendsModal.tsx
git commit -m "feat: add Sorties tab with outings and invitations"
```

---

## Task 4 — Build new Activité tab (replaces old Invitations tab)

**Files:**
- Modify: `components/map/FriendsModal.tsx` — replace `{activeTab === "invitations" && (...)}` block with new Activité tab

The invitations block starts at line 1623 (`{activeTab === "invitations" && (`) and ends at the closing `)}` before `</div>{/* fin scroll content */}` — approximately line 1865+ (the block containing demandes amis, invitations groupe, sorties proposées, mes sorties, demandes envoyées, and the empty state).

- [ ] **Step 1: Find exact end of the invitations block** — grep for `activeTab === "invitations"` and look at the surrounding structure. The block ends before the outer scrollable `</div>`.

- [ ] **Step 2: Replace the entire invitations block** with the new Activité tab:

```tsx
                {/* ════ ACTIVITÉ ════════════════════════════════ */}
                {activeTab === "activite" && (
                  <div className="space-y-6 pb-2">

                    {/* Classement mensuel — épinglé en haut */}
                    <div>
                      <div className="flex items-center justify-between mb-5">
                        <div>
                          <p className="text-[16px] font-bold text-gray-900 dark:text-white">Classement du mois</p>
                          <p className="mt-0.5 text-[11px] text-gray-400 dark:text-zinc-500 capitalize">
                            {new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}
                          </p>
                        </div>
                        <span className="flex items-center gap-1.5 rounded-full bg-amber-50 dark:bg-amber-500/10 border border-amber-200/50 dark:border-amber-500/20 px-2.5 py-1 text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wide">
                          <Trophy size={10} />
                          Spots ajoutés
                        </span>
                      </div>

                      {monthlyRankingLoading ? (
                        <div className="flex justify-center py-6">
                          <LoaderCircle size={20} className="animate-spin text-gray-300 dark:text-zinc-700" />
                        </div>
                      ) : monthlyRankingData.length === 0 ? (
                        <EmptyState
                          icon={<Trophy size={24} />}
                          text="Aucun classement ce mois-ci"
                          sub="Le classement apparaît quand tes amis ajoutent des spots !"
                        />
                      ) : (
                        /* Paste here the exact podium + ranking list JSX from the old classement tab
                           (lines ~1362 to ~1619 of the original file).
                           This is the podium top-3 + full ranking list + userMonthlyRank highlight.
                           Copy it verbatim, just wrapped inside this activeTab === "activite" block. */
                        <></>
                      )}
                    </div>

                    {/* Demandes d'amis */}
                    {incomingRequests.length > 0 && (
                      <Section title={`Demandes d'amis · ${incomingRequests.length}`} icon={<UserPlus size={10} />}>
                        <div className="space-y-1">
                          {incomingRequests.map(req => (
                            <InvitationRow
                              key={req.id} req={req}
                              loading={loadingId === req.from_id}
                              onAccept={() => acceptRequest(req)}
                              onDecline={() => declineRequest(req)}
                            />
                          ))}
                        </div>
                      </Section>
                    )}

                    {/* Feed — spots récents des amis (7 derniers jours) */}
                    {activityFeed.length > 0 && (
                      <Section title="Spots récents" icon={<MapPin size={10} />}>
                        <div className="space-y-1">
                          {activityFeed.map(spot => (
                            <button
                              key={spot.id}
                              onClick={() => { onSelectSpot?.(spot.id); onClose() }}
                              className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-gray-50 dark:hover:bg-zinc-800/60"
                            >
                              {spot.image_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={spot.image_url.split(",")[0].trim()}
                                  alt=""
                                  className="h-10 w-10 flex-shrink-0 rounded-xl object-cover"
                                />
                              ) : (
                                <div className="h-10 w-10 flex-shrink-0 rounded-xl bg-gray-100 dark:bg-zinc-800 flex items-center justify-center">
                                  <MapPin size={16} className="text-gray-400 dark:text-zinc-600" />
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[13px] font-semibold text-gray-800 dark:text-zinc-100">
                                  {spot.title}
                                </p>
                                <p className="text-[11px] text-gray-400 dark:text-zinc-500">
                                  @{spot.profiles?.username ?? "?"} · {timeAgo(spot.created_at)}
                                </p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </Section>
                    )}

                    {/* Demandes envoyées */}
                    {pendingSent.length > 0 && (
                      <Section title="Demandes envoyées" icon={<Clock size={10} />}>
                        <div className="space-y-1">
                          {pendingSent.map(p => (
                            <div key={p.id} className="flex items-center gap-3 px-2 py-2">
                              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-100 dark:bg-zinc-800 text-xs font-bold text-indigo-500">
                                {p.avatar_url
                                  // eslint-disable-next-line @next/next/no-img-element
                                  ? <img src={p.avatar_url} alt="" className="h-full w-full object-cover" />
                                  : (p.username ?? "?")[0].toUpperCase()}
                              </div>
                              <span className="flex-1 text-[13px] font-medium text-gray-700 dark:text-zinc-300">@{p.username ?? "?"}</span>
                              <span className="text-[11px] text-amber-500 dark:text-amber-400">En attente</span>
                            </div>
                          ))}
                        </div>
                      </Section>
                    )}

                    {/* Empty state */}
                    {monthlyRankingData.length === 0 && incomingRequests.length === 0 && activityFeed.length === 0 && pendingSent.length === 0 && !monthlyRankingLoading && (
                      <EmptyState
                        icon={<Bell size={24} />}
                        text="Tout est calme"
                        sub="L'activité de tes amis apparaîtra ici"
                      />
                    )}
                  </div>
                )}
```

**Important for the classement content**: in Step 2 above, where the comment says "Paste here the exact podium + ranking list JSX", copy verbatim the content of the old `monthlyRankingData.length === 0 ? (...) : (...)` else branch from the original classement tab (it contains the podium, the ranking list, and the `userMonthlyRank` highlight). It's the JSX that was previously at lines ~1362–1540. Replace the `<></>` placeholder with that exact code.

Additionally, the old classement tab also showed `topSpots` (top liked spots). Move that section to the Activité tab as well — place it after the classement section and before the "Demandes d'amis" section. Copy the `topSpotsLoading ? (...) : topSpots.length === 0 ? (...) : (...)` block verbatim from the old classement tab.

- [ ] **Step 3: Verify TypeScript** — run `getDiagnostics`. Fix any `MapPin` or `UserPlus` missing imports by adding to the lucide-react import at the top of the file.

- [ ] **Step 4: Commit**

```bash
git add components/map/FriendsModal.tsx
git commit -m "feat: add Activité tab with classement, friend requests, and activity feed"
```

---

## Task 5 — MapView.tsx: pass groups and onCreateGroup to FriendsModal

**Files:**
- Modify: `components/map/MapView.tsx:~674` (add createGroupWithArgs callback)
- Modify: `components/map/MapView.tsx:2655-2695` (FriendsModal props)

- [ ] **Step 1: Add `createGroupWithArgs` callback** — add right after `handleCreateGroup` in MapView.tsx (around line 697):

```typescript
  const createGroupWithArgs = useCallback(async (name: string, emoji: string) => {
    if (!user || !name.trim()) return
    try {
      const { data: group, error } = await supabaseRef.current
        .from("spot_groups")
        .insert({ creator_id: user.id, name: name.trim(), emoji })
        .select()
        .single()
      if (error) throw error
      await supabaseRef.current
        .from("spot_group_members")
        .insert({ group_id: group.id, user_id: user.id })
      setGroups(prev => [...prev, group as SpotGroup])
      toast.success(`Groupe "${group.name}" créé !`)
    } catch {
      toast.error("Erreur lors de la création du groupe")
    }
  }, [user])
```

- [ ] **Step 2: Pass new props to FriendsModal** — in the `<FriendsModal>` JSX (lines 2655–2695), add after the `onLocateOuting` prop:

```tsx
        groups={groups}
        onCreateGroup={createGroupWithArgs}
```

- [ ] **Step 3: Verify TypeScript** — run `getDiagnostics` on `components/map/MapView.tsx`.

- [ ] **Step 4: Commit**

```bash
git add components/map/MapView.tsx
git commit -m "feat: pass groups and onCreateGroup to FriendsModal"
```

---

## Task 6 — Cleanup and final verification

**Files:**
- Modify: `components/map/FriendsModal.tsx` (cleanup)

- [ ] **Step 1: Remove any remaining references to old tabs** — grep for `"classement"`, `"invitations"`, `invitationsSeen`, `totalInvitations`, `prevTotalRef` in FriendsModal.tsx and remove all remaining occurrences.

```bash
grep -n "classement\|invitationsSeen\|totalInvitations\|prevTotalRef" components/map/FriendsModal.tsx
```

Expected: no results. If any remain, remove them.

- [ ] **Step 2: Update empty message in Amis tab** — line ~1280 currently says `"Trouve des gens à suivre dans l'onglet Classement !"`. Update to reference the new tab name:

```typescript
// Replace:
sub="Trouve des gens à suivre dans l'onglet Classement !"
// With:
sub="Trouve des gens à suivre en cherchant par nom !"
```

- [ ] **Step 3: Check Building2 import** — verify `Building2` is imported from `lucide-react` in FriendsModal.tsx. If not, add it to the import list at the top.

- [ ] **Step 4: Run TypeScript build check**

```bash
npx next build 2>&1 | head -50
```

Expected: compilation succeeds (ignore `/login` prerender error — expected in local env without env vars).

- [ ] **Step 5: Final commit**

```bash
git add components/map/FriendsModal.tsx components/map/MapView.tsx
git commit -m "chore: cleanup old tab references, finalize FriendsModal 3-tab redesign"
```

---

## Self-Review

**Spec coverage:**
- ✅ Tab "Amis" → liste amis + section Groupes (invitations + cartes groupes + créer groupe)
- ✅ Tab "Sorties" → CTA + invitations reçues + mes sorties + passées
- ✅ Tab "Activité" → classement + demandes amis + feed spots récents
- ✅ Badge Amis = groupInvitations.length
- ✅ Badge Sorties = outingInvitations.length
- ✅ Badge Activité = incomingRequests.length
- ✅ Création de groupe dans FriendsModal (onCreateGroup prop)
- ✅ Invitations groupe avec UI accept/decline dans onglet Amis
- ✅ Activity feed sans nouvelle requête réseau (useMemo sur spots prop)

**Placeholder scan:** Task 4 Step 2 has an instruction to copy verbatim classement JSX — the agent must do this manually rather than using a placeholder `<></>`. This is a copy-paste, not novel logic.

**Type consistency:** `activityFeed` items are `Spot` objects (from the existing `spots` prop type). The `spot.profiles?.username` and `spot.created_at` fields are available per the FriendsModalProps type definition at line 184.
