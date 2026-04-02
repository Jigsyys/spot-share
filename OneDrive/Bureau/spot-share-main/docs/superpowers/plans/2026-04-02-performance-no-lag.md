# Performance — Zéro Lag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Éliminer le lag perceptible sur la map et les modals (FriendsModal) sans refactorer l'architecture.

**Architecture:** Cinq fixes chirurgicaux dans MapView.tsx + un skeleton loader dans FriendsModal.tsx. Aucune dépendance externe ajoutée. React 19 `startTransition` pour le clustering, ref-pattern pour le realtime channel, batching des setSpots optimistes, fix des clés DOM, et shimmer loader pour les amis.

**Tech Stack:** React 19 (`startTransition`), Next.js 16, react-map-gl, useSupercluster, Supabase Realtime, Tailwind CSS animate-pulse

---

### Task 1 — Debounce clustering avec startTransition

**Files:**
- Modify: `components/map/MapView.tsx:1–5` (import React)
- Modify: `components/map/MapView.tsx:1628–1634` (onMove handler)

Le callback `onMove` fire à 60fps. Chaque appel déclenche `setBounds` + `setZoom` → `useSupercluster` recalcule les clusters → `markerElements` remapppe tout le JSX. `startTransition` marque ces updates comme non-urgentes : React laisse passer les interactions avant de re-rendre les markers.

- [ ] **Step 1 : Vérifier l'import startTransition**

Lire la ligne 1 de `components/map/MapView.tsx`. Si l'import React est :
```ts
import React, { useCallback, useEffect, ... } from "react"
```
Ajouter `startTransition` à la liste destructurée. Si c'est `import React from "react"`, ajouter :
```ts
import { startTransition } from "react"
```
en dessous.

- [ ] **Step 2 : Wrapper setBounds/setZoom dans startTransition**

Remplacer les lignes 1628–1634 :
```ts
// AVANT
onMove={() => {
  if (mapRef.current) {
    const b = mapRef.current.getBounds()?.toArray().flat()
    if (b) setBounds(b as [number, number, number, number])
    setZoom(mapRef.current.getZoom())
  }
}}
```
Par :
```ts
// APRÈS
onMove={() => {
  if (!mapRef.current) return
  const b = mapRef.current.getBounds()?.toArray().flat()
  const z = mapRef.current.getZoom()
  startTransition(() => {
    if (b) setBounds(b as [number, number, number, number])
    setZoom(z)
  })
}}
```

- [ ] **Step 3 : Vérifier TypeScript**

Utiliser `getDiagnostics` sur `components/map/MapView.tsx`. Résultat attendu : 0 nouvelle erreur.

- [ ] **Step 4 : Commit**
```bash
git add components/map/MapView.tsx
git commit -m "perf: defer clustering re-render with startTransition on map move"
```

---

### Task 2 — Stabiliser le channel Realtime (supprimer double-subscription)

**Files:**
- Modify: `components/map/MapView.tsx:806–810` (après checkIncomingRequests useCallback)
- Modify: `components/map/MapView.tsx:895–1003` (useEffect channel)

`checkIncomingRequests` dépend de `user` (ligne ~806 : `useCallback(..., [user])`). Il est aussi dans les deps du channel useEffect (`[user, checkIncomingRequests]` à la ligne 1003). Quand `user` change → `checkIncomingRequests` se recrée → le channel se détruit/recrée une 2ème fois inutilement. Fix : stocker dans un ref, retirer des deps.

- [ ] **Step 1 : Lire la définition exacte de checkIncomingRequests**

Lire `components/map/MapView.tsx` lignes 777–810 pour confirmer le tableau de dépendances du useCallback.

- [ ] **Step 2 : Ajouter le ref juste après le useCallback**

Après la fermeture du `useCallback` de `checkIncomingRequests` (ligne ~806), ajouter :
```ts
const checkIncomingRequestsRef = useRef(checkIncomingRequests)
useEffect(() => { checkIncomingRequestsRef.current = checkIncomingRequests }, [checkIncomingRequests])
```

- [ ] **Step 3 : Remplacer les appels dans le channel useEffect**

Dans le corps du useEffect lignes 895–1003, remplacer chaque `checkIncomingRequests()` par `checkIncomingRequestsRef.current()`.
Il y a ~7 occurrences aux lignes 909, 918, 928, 933, 940, 950, 955.

- [ ] **Step 4 : Retirer checkIncomingRequests des deps du channel**

Ligne 1003, remplacer :
```ts
}, [user, checkIncomingRequests])
```
Par :
```ts
}, [user])
```

- [ ] **Step 5 : Vérifier TypeScript**

`getDiagnostics` sur `components/map/MapView.tsx`. Attendu : 0 erreur.

- [ ] **Step 6 : Commit**
```bash
git add components/map/MapView.tsx
git commit -m "perf: stabilize realtime channel with ref pattern, remove double-subscription"
```

---

### Task 3 — Batcher duplicate-removal + optimistic spot (1 render au lieu de 2)

**Files:**
- Modify: `components/map/MapView.tsx:1185–1192`

Quand un doublon existe, deux `setSpots` consécutifs → deux re-renders. Les fusionner en un seul appel.

- [ ] **Step 1 : Remplacer le bloc doublon + optimiste**

Remplacer les lignes 1185–1192 :
```ts
// AVANT
if (spotDbData.address) {
  const duplicate = spots.find(s => s.user_id === user.id && s.address === spotDbData.address)
  if (duplicate) {
    await supabaseRef.current.from("spots").delete().eq("id", duplicate.id)
    setSpots(prev => prev.filter(s => s.id !== duplicate.id))
  }
}
setSpots((prev) => [optimisticSpot, ...prev])
```
Par :
```ts
// APRÈS
let duplicateId: string | undefined
if (spotDbData.address) {
  const duplicate = spots.find(s => s.user_id === user.id && s.address === spotDbData.address)
  if (duplicate) {
    duplicateId = duplicate.id
    await supabaseRef.current.from("spots").delete().eq("id", duplicate.id)
  }
}
setSpots((prev) => [
  optimisticSpot,
  ...(duplicateId ? prev.filter(s => s.id !== duplicateId) : prev),
])
```

- [ ] **Step 2 : Vérifier TypeScript**

`getDiagnostics` sur `components/map/MapView.tsx`. Attendu : 0 erreur.

- [ ] **Step 3 : Commit**
```bash
git add components/map/MapView.tsx
git commit -m "perf: batch duplicate removal and optimistic spot into single setState"
```

---

### Task 4 — Fixer les keys de renderDescription

**Files:**
- Modify: `components/map/MapView.tsx:196–206`

`key={li}` (index) cause des mauvaises reconciliations DOM quand le texte d'un spot change (React réutilise des nodes au mauvais endroit). Utiliser une key basée sur le contenu.

- [ ] **Step 1 : Remplacer la key du span externe**

Ligne 198, remplacer :
```ts
<span key={li}>
```
Par :
```ts
<span key={`${li}-${line.length}`}>
```

- [ ] **Step 2 : Vérifier TypeScript**

`getDiagnostics` sur `components/map/MapView.tsx`. Attendu : 0 erreur.

- [ ] **Step 3 : Commit**
```bash
git add components/map/MapView.tsx
git commit -m "fix: content-based keys in renderDescription prevent incorrect DOM reuse"
```

---

### Task 5 — Skeleton loader dans FriendsModal (onglet Amis)

**Files:**
- Modify: `components/map/FriendsModal.tsx` (props interface + render amis)
- Modify: `components/map/MapView.tsx` (ajout state + passage prop)

FriendsModal affiche un vide pendant le chargement initial des amis. Ajouter un shimmer de 5 lignes pendant que `followingIds` est encore vide.

- [ ] **Step 1 : Localiser l'interface des props et le render de la liste amis dans FriendsModal**

Lire lignes 1–80 de `components/map/FriendsModal.tsx` pour trouver l'interface props.
Puis grep `followingIds\|followingProfiles\|friends\.map\|friendProfiles\.map` dans `FriendsModal.tsx` pour trouver où la liste amis est rendue.

- [ ] **Step 2 : Ajouter le state hasLoadedFriends dans MapView**

Dans `components/map/MapView.tsx`, après les déclarations de state (vers ligne 390), ajouter :
```ts
const [hasLoadedFriends, setHasLoadedFriends] = useState(false)
```

Dans `fetchFollowing` (ligne ~566), après `setFollowingIds(ids)` (ligne ~587), ajouter :
```ts
setHasLoadedFriends(true)
```

Également dans le bloc cache (ligne ~574-577), après `setFollowingIds(cached)` :
```ts
setHasLoadedFriends(true)
```

Dans le bloc `catch` de `fetchFollowing` (ligne ~602), ajouter pour éviter un skeleton infini si le fetch échoue :
```ts
} catch {
  setHasLoadedFriends(true)
  /* table might not exist */
}
```

- [ ] **Step 3 : Passer loadingFriends comme prop à FriendsModal**

Trouver le render de FriendsModal dans MapView (grep `<FriendsModal`). Ajouter la prop :
```tsx
loadingFriends={!hasLoadedFriends}
```

- [ ] **Step 4 : Ajouter loadingFriends à l'interface props de FriendsModal**

Dans l'interface des props (trouvée au Step 1), ajouter :
```ts
loadingFriends?: boolean
```

- [ ] **Step 5 : Ajouter le rendu skeleton dans l'onglet Amis**

À l'endroit où la liste amis est rendue (trouvé au Step 1 grep), entourer le contenu de liste avec :
```tsx
{loadingFriends ? (
  <div className="space-y-3 px-4 py-2">
    {Array.from({ length: 5 }).map((_, i) => (
      <div key={i} className="flex items-center gap-3 animate-pulse">
        <div className="h-10 w-10 rounded-full bg-gray-200 dark:bg-zinc-700 flex-shrink-0" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3 w-28 rounded bg-gray-200 dark:bg-zinc-700" />
          <div className="h-2.5 w-16 rounded bg-gray-100 dark:bg-zinc-800" />
        </div>
      </div>
    ))}
  </div>
) : (
  /* liste amis existante */
)}
```

- [ ] **Step 6 : Vérifier TypeScript**

`getDiagnostics` sur `components/map/FriendsModal.tsx` ET `components/map/MapView.tsx`. Attendu : 0 erreur.

- [ ] **Step 7 : Commit**
```bash
git add components/map/FriendsModal.tsx components/map/MapView.tsx
git commit -m "feat: skeleton loader in FriendsModal friends tab for perceived performance"
```
