# Explorer Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refondre l'onglet Explorer pour le rendre plus sobre avec 3 onglets explicites (Mes spots / Amis / Général), une grille catégories 4×2 colorée, et refondre les 8 catégories de spots dans toute l'app.

**Architecture:** Toutes les modifications se font dans des fichiers existants. Le composant `CategoryGrid` est défini inline dans `ExploreModal.tsx` (même pattern que `SpotHCard`, `SpotGridCard`). La source de vérité des catégories reste `lib/categories.ts`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS, Framer Motion, Supabase

---

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `lib/categories.ts` | Nouvelles 8 catégories |
| `components/map/ExploreModal.tsx` | Refonte complète UI + logique tabs |
| `components/map/AddSpotModal.tsx` | expires_at conditionnel à la catégorie événement |
| `components/map/FriendsModal.tsx` | Suppression @ sur les usernames |
| `components/map/ProfileModal.tsx` | Suppression @ sur les usernames |
| `components/map/MapView.tsx` | Suppression @ sur les usernames |

---

## Task 1 : Refonte `lib/categories.ts`

**Files:**
- Modify: `lib/categories.ts`

- [ ] **Remplacer le contenu de `lib/categories.ts`**

```ts
// lib/categories.ts — Source unique de vérité pour les catégories de spots.
// Importer depuis ce fichier partout ; ne pas redéfinir localement.

export const CATEGORIES = [
  { key: "café",        label: "Café",       emoji: "☕"  },
  { key: "restaurant",  label: "Restaurant",  emoji: "🍽️" },
  { key: "extérieur",   label: "Extérieur",   emoji: "🌿" },
  { key: "bar",         label: "Bar",         emoji: "🍸" },
  { key: "vue",         label: "Vue",         emoji: "🌅" },
  { key: "culture",     label: "Culture",     emoji: "🎭" },
  { key: "sport",       label: "Sport",       emoji: "🏃" },
  { key: "événement",   label: "Événement",   emoji: "🎉" },
] as const

export type CategoryKey = typeof CATEGORIES[number]["key"]

/** Map key → emoji, ex: "café" → "☕" */
export const CATEGORY_EMOJIS: Record<string, string> = Object.fromEntries(
  CATEGORIES.map(c => [c.key, c.emoji])
)

/** Map key → label, ex: "café" → "Café" */
export const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  CATEGORIES.map(c => [c.key, c.label])
)
```

- [ ] **Vérifier TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Erreurs attendues : références à `"outdoor"`, `"shopping"`, `"other"` dans d'autres fichiers — normales, seront corrigées dans les prochaines tâches.

- [ ] **Commit**

```bash
git add lib/categories.ts
git commit -m "feat: refonte 8 catégories (outdoor→extérieur, shopping→sport, other→événement)"
```

---

## Task 2 : Migration SQL Supabase

**Files:** aucun fichier projet — à exécuter dans le dashboard Supabase SQL Editor.

- [ ] **Exécuter dans Supabase SQL Editor**

```sql
-- Migration catégories spots
UPDATE public.spots SET category = 'extérieur' WHERE category = 'outdoor';
UPDATE public.spots SET category = 'sport'     WHERE category = 'shopping';
UPDATE public.spots SET category = 'événement' WHERE category = 'other';
```

- [ ] **Vérifier**

```sql
SELECT category, COUNT(*) FROM public.spots GROUP BY category ORDER BY count DESC;
```

Résultat attendu : aucune ligne avec `outdoor`, `shopping` ou `other`.

- [ ] **Commit**

```bash
git commit --allow-empty -m "chore: migration SQL catégories spots (outdoor→extérieur, shopping→sport, other→événement)"
```

---

## Task 3 : ExploreModal — composant `CategoryGrid` + nouveau state

**Files:**
- Modify: `components/map/ExploreModal.tsx`

- [ ] **Ajouter la map de couleurs juste avant la définition des props (ligne ~349)**

Insérer après la ligne `function isOpenNow(...)` et avant `// ─── Dropdown filter`:

```tsx
// ─── CategoryGrid ────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  "café":       "linear-gradient(135deg, #78350f, #b45309)",
  "restaurant": "linear-gradient(135deg, #7c2d12, #dc2626)",
  "extérieur":  "linear-gradient(135deg, #14532d, #16a34a)",
  "bar":        "linear-gradient(135deg, #4c1d95, #7c3aed)",
  "vue":        "linear-gradient(135deg, #1e3a5f, #2563eb)",
  "culture":    "linear-gradient(135deg, #831843, #db2777)",
  "sport":      "linear-gradient(135deg, #064e3b, #059669)",
  "événement":  "linear-gradient(135deg, #1a1a2a, #6366f1)",
}

function CategoryGrid({
  value,
  onChange,
}: {
  value: string | null
  onChange: (v: string | null) => void
}) {
  const hasSelection = value !== null
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {CATEGORIES.map(c => {
        const isSelected = value === c.key
        return (
          <button
            key={c.key}
            onClick={() => onChange(isSelected ? null : c.key)}
            style={{ background: CATEGORY_COLORS[c.key] ?? "#1e1e1e" }}
            className={cn(
              "flex flex-col items-center gap-1 rounded-[14px] py-2.5 px-1 border-[2.5px] transition-all active:scale-95",
              isSelected
                ? "border-white opacity-100 shadow-[0_0_0_1px_rgba(255,255,255,0.2)]"
                : cn("border-transparent", hasSelection ? "opacity-35" : "opacity-80")
            )}
          >
            <span className="text-[20px] leading-none">{c.emoji}</span>
            <span className="text-[8px] font-bold text-white text-center leading-tight">{c.label}</span>
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Supprimer le composant `FilterDropdown` (lignes ~84–168)** — il est remplacé par `CategoryGrid`.

- [ ] **Mettre à jour le type `Mode` (ligne ~375)**

Remplacer :
```ts
type Mode = "explorer" | "mine" | "friends"
```
Par :
```ts
type Mode = "general" | "mine" | "friends"
```

- [ ] **Mettre à jour `useState` du mode (ligne ~381)** et la fonction `handleTab`

Remplacer :
```ts
const [mode, setMode] = useState<Mode>("explorer")
```
Par :
```ts
const [mode, setMode] = useState<Mode>("general")
```

Remplacer la fonction `handleTab` (lignes ~410–413) :
```ts
const handleTab = (tab: "mine" | "friends") => {
  setMode((prev: Mode) => prev === tab ? "explorer" : tab)
  setFriendFilter(null)
}
```
Par :
```ts
const handleTab = (tab: Mode) => {
  setMode(tab)
  setFriendFilter(null)
  // Café sélectionné par défaut dans l'onglet Amis
  setCategoryFilter(tab === "friends" ? "café" : null)
}
```

- [ ] **Mettre à jour le reset au close (lignes ~399–407)**

Remplacer `setMode("explorer")` par `setMode("general")`.

- [ ] **Supprimer le state `categoryOptions` (lignes ~574–577)** — devenu inutile.

- [ ] **Vérifier TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Commit**

```bash
git add components/map/ExploreModal.tsx
git commit -m "feat: ExploreModal — CategoryGrid composant + nouveau Mode type"
```

---

## Task 4 : ExploreModal — nouveau layout du header (tabs)

**Files:**
- Modify: `components/map/ExploreModal.tsx`

- [ ] **Remplacer la section `{/* ── Tabs Moi / Amis ── */}` (lignes ~628–652)**

Remplacer l'intégralité du bloc tabs par :

```tsx
{/* ── Tabs ── */}
<div className="flex flex-col gap-1.5 mb-4">
  <div className="flex gap-2">
    <button
      onClick={() => handleTab("mine")}
      className={cn(
        "flex-1 rounded-xl py-2.5 text-sm font-semibold transition-all",
        mode === "mine"
          ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900 shadow-sm"
          : "bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 text-gray-500 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-800"
      )}
    >
      Mes spots
    </button>
    <button
      onClick={() => handleTab("friends")}
      className={cn(
        "flex-1 rounded-xl py-2.5 text-sm font-semibold transition-all",
        mode === "friends"
          ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900 shadow-sm"
          : "bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 text-gray-500 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-800"
      )}
    >
      Amis
    </button>
  </div>
  <button
    onClick={() => handleTab("general")}
    className={cn(
      "w-full rounded-xl py-2.5 text-sm font-semibold transition-all",
      mode === "general"
        ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900 shadow-sm"
        : "bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 text-gray-500 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-800"
    )}
  >
    Général
  </button>
</div>
```

- [ ] **Supprimer le bloc `{/* ── Dropdown catégorie uniquement ── */}` (lignes ~678–686)** — remplacé par CategoryGrid dans chaque onglet.

- [ ] **Mettre à jour `recentSpots` useMemo** — remplacer `mode === "explorer"` par `mode === "general"` (ligne ~486).

- [ ] **Mettre à jour `basePool` useMemo** — remplacer le cas `mode === "explorer"` (ligne ~443) :

Remplacer :
```ts
if (mode === "mine") return spots.filter((s: Spot) => s.user_id === currentUserId && notExpired(s))
if (mode === "friends") {
  const friendSet = new Set(followingIds)
  return spots.filter((s: Spot) => friendSet.has(s.user_id) && notExpired(s))
}
return (allSpots ?? spots).filter(notExpired)
```
Par :
```ts
if (mode === "mine") return spots.filter((s: Spot) => s.user_id === currentUserId && notExpired(s))
if (mode === "friends") {
  const friendSet = new Set(followingIds)
  return spots.filter((s: Spot) => friendSet.has(s.user_id) && notExpired(s))
}
// general
return (allSpots ?? spots).filter(notExpired)
```

- [ ] **Mettre à jour `friendsThisWeek` useMemo** — remplacer `mode !== "friends"` par `mode !== "friends"` (inchangé — déjà correct).

- [ ] **Vérifier TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Commit**

```bash
git add components/map/ExploreModal.tsx
git commit -m "feat: ExploreModal — nouveau layout tabs 2+1"
```

---

## Task 5 : ExploreModal — onglet Général

**Files:**
- Modify: `components/map/ExploreModal.tsx`

- [ ] **Remplacer le bloc `{/* ════ MODE EXPLORER ════ */}` (lignes ~693–792)**

Remplacer l'intégralité du bloc `mode === "explorer"` par :

```tsx
{/* ════ MODE GÉNÉRAL ════ */}
{mode === "general" && (
  <div className="space-y-6">

    {/* Grille catégories */}
    <CategoryGrid value={categoryFilter} onChange={setCategoryFilter} />

    {/* Surprise CTA */}
    {!hasFilters && (
      <div className="space-y-2">
        <button
          onClick={handleSurprise}
          disabled={surpriseLoading}
          className="group relative w-full overflow-hidden rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 p-5 text-left transition-all active:scale-[0.98] disabled:opacity-60"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-lg font-bold text-white">🎲 Surprends-moi</p>
              <p className="mt-0.5 text-sm text-white/70">Dans un rayon de {surpriseRadius} km</p>
            </div>
            <motion.div
              animate={surpriseLoading ? { rotate: 360 } : { rotate: 0 }}
              transition={surpriseLoading ? { duration: 0.6, ease: "linear", repeat: Infinity } : {}}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-white/20"
            >
              <Shuffle size={22} className="text-white" />
            </motion.div>
          </div>
        </button>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-gray-400 dark:text-zinc-500 flex-shrink-0">Rayon :</span>
          <div className="flex gap-1 flex-wrap">
            {[2, 5, 10, 20, 50].map(km => (
              <button
                key={km}
                onClick={() => setSurpriseRadius(km)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${
                  surpriseRadius === km
                    ? "bg-violet-500 text-white"
                    : "bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400 hover:bg-gray-200 dark:hover:bg-zinc-700"
                }`}
              >
                {km} km
              </button>
            ))}
          </div>
        </div>
      </div>
    )}

    {/* Près de toi */}
    {nearbySpots.length > 0 && !debouncedQuery && (
      <div>
        <p className="mb-3 text-sm font-bold text-gray-900 dark:text-white">📍 Près de toi</p>
        <div className="no-scrollbar -mx-5 flex gap-3 overflow-x-auto px-5 pb-1">
          {nearbySpots.map(({ spot, distance }: DistSpot) => (
            <SpotHCard
              key={spot.id}
              spot={spot}
              distance={distance}
              onSelect={() => onSelectSpot(spot)}
              onSelectUser={onSelectUser}
            />
          ))}
        </div>
      </div>
    )}

    {/* Liste spots */}
    <div>
      {!hasFilters && (
        <p className="mb-3 text-sm font-bold text-gray-900 dark:text-white">
          {userLocation ? "📍 Par distance" : "🆕 Récemment ajoutés"}
        </p>
      )}
      {!spotsLoaded ? (
        <div className="py-2">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : recentSpots.length === 0 ? (
        <EmptyState mode="general" hasQuery={!!debouncedQuery} onAddSpot={onAddSpot} onOpenFriends={onOpenFriends} />
      ) : (
        <div className="space-y-2">
          {hasFilters && (
            <p className="mb-2 text-xs text-gray-400">
              {recentSpots.length} résultat{recentSpots.length > 1 ? "s" : ""}
            </p>
          )}
          {recentSpots.map(({ spot, distance }: DistSpot) => (
            <SpotListRow
              key={spot.id}
              spot={spot}
              distance={nearbySpots.some((n: DistSpot) => n.spot.id === spot.id) ? distance : undefined}
              showAuthor
              onSelect={() => onSelectSpot(spot)}
              onSelectUser={onSelectUser}
            />
          ))}
        </div>
      )}
    </div>
  </div>
)}
```

- [ ] **Mettre à jour `EmptyState`** — le type `Mode` inclut désormais `"general"`. Mettre à jour les messages dans `EmptyState` (lignes ~966–985) :

Remplacer la clé `explorer` par `general` dans l'objet `messages` :
```ts
const messages: Record<Mode, { ... }> = {
  general: {   // ← était "explorer"
    icon: "🌍",
    title: "Aucun spot trouvé",
    sub: hasQuery ? "Essaie un autre mot-clé" : "Sois le premier à ajouter un spot !",
    cta: hasQuery ? undefined : { label: "Ajouter un spot", action: onAddSpot },
  },
  mine: { ... },
  friends: { ... },
}
```

- [ ] **Vérifier TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Commit**

```bash
git add components/map/ExploreModal.tsx
git commit -m "feat: ExploreModal — onglet Général avec CategoryGrid"
```

---

## Task 6 : ExploreModal — onglet Mes spots

**Files:**
- Modify: `components/map/ExploreModal.tsx`

- [ ] **Remplacer le bloc `{/* ════ MODE MES SPOTS ════ */}` (lignes ~794–820)**

```tsx
{/* ════ MODE MES SPOTS ════ */}
{mode === "mine" && (
  <div className="space-y-4">
    <CategoryGrid value={categoryFilter} onChange={setCategoryFilter} />
    {!spotsLoaded ? (
      <div className="py-2">
        {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    ) : filteredPool.length === 0 ? (
      <EmptyState mode="mine" hasQuery={!!debouncedQuery} onAddSpot={onAddSpot} onOpenFriends={onOpenFriends} />
    ) : (
      <>
        <p className="text-xs text-gray-400 dark:text-zinc-600">
          {filteredPool.length} spot{filteredPool.length > 1 ? "s" : ""}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {filteredPool.map((spot: Spot) => (
            <SpotGridCard
              key={spot.id}
              spot={spot}
              onSelect={() => onSelectSpot(spot)}
            />
          ))}
        </div>
      </>
    )}
  </div>
)}
```

- [ ] **Vérifier TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Commit**

```bash
git add components/map/ExploreModal.tsx
git commit -m "feat: ExploreModal — onglet Mes spots avec CategoryGrid"
```

---

## Task 7 : ExploreModal — onglet Amis

**Files:**
- Modify: `components/map/ExploreModal.tsx`

- [ ] **Remplacer le bloc `{/* ════ MODE AMIS ════ */}` (lignes ~822–931)**

```tsx
{/* ════ MODE AMIS ════ */}
{mode === "friends" && (
  <div className="space-y-4">

    {/* Surprise pin active banner */}
    {surprisePin && (
      <button
        onClick={() => onSelectSpot(surprisePin.spot)}
        className="w-full flex items-center gap-3 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-3 text-left"
      >
        <span className="text-2xl animate-pulse">🎲</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-white">{surprisePin.spot.title}</p>
          <p className="text-xs text-white/70">Spot surprise — clique pour y aller</p>
        </div>
        <MapPin size={16} className="flex-shrink-0 text-white/80" />
      </button>
    )}

    {/* Avatars amis */}
    {friendProfiles.length > 0 && (
      <div className="no-scrollbar -mx-5 flex gap-3 overflow-x-auto px-5 pb-1">
        {friendProfiles.map((f: FriendProfile) => {
          const isSelected = friendFilter === f.id
          return (
            <button
              key={f.id}
              onClick={() => setFriendFilter(isSelected ? null : f.id)}
              className="flex flex-shrink-0 flex-col items-center gap-1.5"
            >
              <div className={cn(
                "h-14 w-14 overflow-hidden rounded-full shadow-md bg-gradient-to-br from-indigo-400 to-purple-500 transition-all",
                isSelected
                  ? "border-[3px] border-blue-500 scale-105"
                  : "border-2 border-white dark:border-zinc-800"
              )}>
                {f.avatar_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={f.avatar_url} alt="" className="h-full w-full object-cover" />
                  : <div className="flex h-full w-full items-center justify-center text-lg font-bold text-white">
                      {(f.username ?? "?")[0]?.toUpperCase()}
                    </div>
                }
              </div>
              <span className={cn(
                "max-w-[3.5rem] truncate text-[10px]",
                isSelected ? "font-bold text-blue-600 dark:text-blue-400" : "text-gray-500 dark:text-zinc-500"
              )}>
                {f.username ?? "ami"}
              </span>
            </button>
          )
        })}
      </div>
    )}

    {/* Cette semaine — masquée si aucun spot cette semaine */}
    {friendsThisWeek.length > 0 && (
      <div>
        <p className="mb-3 text-sm font-bold text-gray-900 dark:text-white">🆕 Cette semaine</p>
        <div className="no-scrollbar -mx-5 flex gap-3 overflow-x-auto px-5 pb-1">
          {friendsThisWeek.map((spot: Spot) => (
            <SpotHCard
              key={spot.id}
              spot={spot}
              onSelect={() => onSelectSpot(spot)}
              onSelectUser={onSelectUser}
            />
          ))}
        </div>
      </div>
    )}

    {/* Séparateur */}
    <div className="h-px bg-gray-200 dark:bg-white/10" />

    {/* Grille catégories */}
    <CategoryGrid value={categoryFilter} onChange={setCategoryFilter} />

    {/* Spots filtrés */}
    {!spotsLoaded ? (
      <div className="py-2">
        {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    ) : filteredPool.length === 0 ? (
      <EmptyState mode="friends" hasQuery={!!debouncedQuery} onAddSpot={onAddSpot} onOpenFriends={onOpenFriends} />
    ) : (
      <div className="space-y-2">
        <p className="text-xs text-gray-400 dark:text-zinc-600">
          {filteredPool.length} spot{filteredPool.length > 1 ? "s" : ""}
        </p>
        {recentSpots.map(({ spot }: DistSpot) => (
          <SpotListRow
            key={spot.id}
            spot={spot}
            showAuthor
            onSelect={() => onSelectSpot(spot)}
            onSelectUser={onSelectUser}
          />
        ))}
      </div>
    )}
  </div>
)}
```

- [ ] **Vérifier TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Commit**

```bash
git add components/map/ExploreModal.tsx
git commit -m "feat: ExploreModal — onglet Amis avec CategoryGrid + spots filtrés"
```

---

## Task 8 : ExploreModal — suppression `@` sur les usernames

**Files:**
- Modify: `components/map/ExploreModal.tsx`

- [ ] **`SpotHCard` (ligne ~266)** — remplacer :
```tsx
<span className="truncate text-[10px] text-gray-400">@{username}</span>
```
Par :
```tsx
<span className="truncate text-[10px] text-gray-400">{username}</span>
```

- [ ] **`SpotListRow` (ligne ~337)** — remplacer :
```tsx
<span className="text-[11px] text-gray-400">@{username} · {timeSince(spot.created_at)}</span>
```
Par :
```tsx
<span className="text-[11px] text-gray-400">{username} · {timeSince(spot.created_at)}</span>
```

- [ ] **Avatars amis (ligne ~873)** — déjà corrigé dans Task 7 (on a mis `{f.username ?? "ami"}` sans `@`).

- [ ] **Commit**

```bash
git add components/map/ExploreModal.tsx
git commit -m "fix: suppression @ sur les usernames dans ExploreModal"
```

---

## Task 9 : Suppression `@` dans FriendsModal, ProfileModal, MapView

**Files:**
- Modify: `components/map/FriendsModal.tsx`
- Modify: `components/map/ProfileModal.tsx`
- Modify: `components/map/MapView.tsx`

- [ ] **FriendsModal.tsx** — remplacer toutes les occurrences de `` @{...username...} `` par la valeur sans `@`

Les lignes à modifier (vérifier avec `grep -n "@{" components/map/FriendsModal.tsx`) :

| Ligne | Avant | Après |
|---|---|---|
| ~1462 | `` @{s.username ?? "?"} `` | `` {s.username ?? "?"} `` |
| ~1496 | `` Invité par @{inv.inviterProfile?.username ?? "quelqu'un"} `` | `` Invité par {inv.inviterProfile?.username ?? "quelqu'un"} `` |
| ~1605 | `` @{p.username ?? "?"} `` | `` {p.username ?? "?"} `` |
| ~1742 | `` @{monthlyRankingData[1].username ?? "?"} `` | `` {monthlyRankingData[1].username ?? "?"} `` |
| ~1769 | `` @{monthlyRankingData[0].username ?? "?"} `` | `` {monthlyRankingData[0].username ?? "?"} `` |
| ~1798 | `` @{monthlyRankingData[2].username ?? "?"} `` | `` {monthlyRankingData[2].username ?? "?"} `` |
| ~1832 | `` @{entry.username ?? "?"} `` | `` {entry.username ?? "?"} `` |
| ~1859 | `` @{userMonthlyRank.entry.username ?? "?"} `` | `` {userMonthlyRank.entry.username ?? "?"} `` |
| ~1925 | `` @{topSpots[1].username ?? "?"} `` | `` {topSpots[1].username ?? "?"} `` |
| ~1950 | `` @{topSpots[0].username ?? "?"} `` | `` {topSpots[0].username ?? "?"} `` |
| ~1975 | `` @{topSpots[2].username ?? "?"} `` | `` {topSpots[2].username ?? "?"} `` |
| ~2491 | `` @{profile.username ?? "utilisateur"} `` | `` {profile.username ?? "utilisateur"} `` |
| ~2539 | `` @{profile.username ?? "utilisateur"} `` | `` {profile.username ?? "utilisateur"} `` |
| ~2582 | `` @{req.profiles?.username ?? "utilisateur"} `` | `` {req.profiles?.username ?? "utilisateur"} `` |
| ~2906 | `` Proposé par @{outing.profiles.username} `` | `` Proposé par {outing.profiles.username} `` |

- [ ] **ProfileModal.tsx** — remplacer toutes les occurrences :

| Ligne | Avant | Après |
|---|---|---|
| ~772 | `` @{p.username \|\| "utilisateur"} `` | `` {p.username \|\| "utilisateur"} `` |
| ~824 | `` @{p.username \|\| "utilisateur"} `` | `` {p.username \|\| "utilisateur"} `` |
| ~876 | `` @{item.likerUsername \|\| "utilisateur"} `` | `` {item.likerUsername \|\| "utilisateur"} `` |
| ~956 | `` @{username \|\| "…"} `` | `` {username \|\| "…"} `` |

- [ ] **MapView.tsx** — remplacer toutes les occurrences :

| Ligne | Avant | Après |
|---|---|---|
| ~2026 | `` @{fp.username ?? "ami"} `` | `` {fp.username ?? "ami"} `` |
| ~2513 | `` @{selectedSpot.profiles?.username ?? "inconnu"} `` | `` {selectedSpot.profiles?.username ?? "inconnu"} `` |
| ~2628 | `` @{r.username ?? "utilisateur"} `` | `` {r.username ?? "utilisateur"} `` |

- [ ] **Vérifier qu'il ne reste aucun `@{` en dehors des placeholders**

```bash
grep -rn "@{" components/map/ --include="*.tsx" | grep -v "placeholder"
```

Résultat attendu : aucune ligne.

- [ ] **Commit**

```bash
git add components/map/FriendsModal.tsx components/map/ProfileModal.tsx components/map/MapView.tsx
git commit -m "fix: suppression @ sur les usernames dans FriendsModal, ProfileModal, MapView"
```

---

## Task 10 : AddSpotModal — `expires_at` conditionnel à la catégorie Événement

**Files:**
- Modify: `components/map/AddSpotModal.tsx`

- [ ] **Ajouter un useEffect pour reset `isEphemeral` quand la catégorie change**

Ajouter après les déclarations de state existants (~ligne 124) :

```tsx
// Reset éphémère si on change de catégorie (hors événement)
useEffect(() => {
  const cat = tab === "instagram" ? igCategory : manCategory
  if (cat !== "événement") {
    setIsEphemeral(false)
    setEphemeralDate("")
  }
}, [igCategory, manCategory, tab])
```

- [ ] **Conditionner l'affichage de la section "Spot éphémère" (~ligne 689)**

Entourer le bloc `{/* ── Spot éphémère ── */}` d'une condition :

```tsx
{/* ── Spot éphémère — visible uniquement si catégorie = Événement ── */}
{(tab === "instagram" ? igCategory : manCategory) === "événement" && (
  <div className="rounded-2xl border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 p-4 space-y-3">
    {/* ... contenu existant inchangé ... */}
  </div>
)}
```

- [ ] **Vérifier TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Commit**

```bash
git add components/map/AddSpotModal.tsx
git commit -m "feat: expires_at visible uniquement pour la catégorie Événement"
```

---

## Task 11 : Build final de vérification

- [ ] **Build complet**

```bash
npx next build 2>&1 | tail -20
```

Erreur attendue connue : `/login` prerender échoue (variables d'env manquantes en local) — ignorer.
Toute autre erreur TypeScript ou build doit être corrigée.

- [ ] **Vérification visuelle** — ouvrir `http://localhost:3000` et vérifier :
  - [ ] Les 3 onglets s'affichent et switchent correctement
  - [ ] La grille 4×2 filtre les spots
  - [ ] Onglet Amis : café sélectionné par défaut, spots visibles
  - [ ] "Cette semaine" masquée si vide
  - [ ] AddSpotModal : section éphémère apparaît seulement si catégorie = Événement
  - [ ] Aucun `@` visible devant les noms d'utilisateurs

- [ ] **Déployer**

```bash
echo "y" | npx vercel deploy --prod
```
