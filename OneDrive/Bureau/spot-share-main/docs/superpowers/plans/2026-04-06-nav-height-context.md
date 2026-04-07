# NavHeightContext — Hauteur dynamique de la nav bar

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer toutes les valeurs hardcodées de positionnement basées sur la hauteur de la nav bar mobile par une valeur dynamique mesurée via ResizeObserver, de sorte que modals et boutons s'alignent parfaitement quelle que soit la hauteur réelle (PWA, Safari, Chrome, rotation).

**Architecture:** Un `NavHeightContext` React dans `MapView.tsx` mesure la hauteur réelle de la nav bar via un `ref` + `ResizeObserver`. La valeur est publiée via context et/ou passée en prop aux modals. Tous les éléments positionnés au-dessus de la nav bar utilisent cette valeur dynamique au lieu de `calc(4.25rem + env(...))` ou `bottom-16`.

**Tech Stack:** React context, ResizeObserver, Tailwind CSS (classes mobiles `sm:hidden`), Framer Motion (modals existantes).

---

## Fichiers modifiés

| Fichier | Rôle |
|---|---|
| `components/map/MapView.tsx` | Ajout context + ref + ResizeObserver, remplacement valeurs hardcodées, passage `navHeight` en prop aux modals |
| `components/map/ExploreModal.tsx` | Prop `navHeight`, remplacement `bottom-16` |
| `components/map/FriendsModal.tsx` | Prop `navHeight`, remplacement `bottom-0` sur mobile |
| `components/map/AddSpotModal.tsx` | Prop `navHeight`, remplacement `bottom-0` sur mobile |
| `components/map/ProfileModal.tsx` | Prop `navHeight`, remplacement `bottom-0` sur mobile |

---

## Task 1 : Créer NavHeightContext et mesurer la nav bar dans MapView

**Files:**
- Modify: `components/map/MapView.tsx:3` (imports)
- Modify: `components/map/MapView.tsx` (state + ref + ResizeObserver + context)

- [ ] **Step 1 : Ajouter `createContext` à l'import React**

À la ligne 3, remplacer :
```tsx
import { useEffect, useRef, useState, useCallback, useMemo, startTransition } from "react"
```
Par :
```tsx
import { useEffect, useRef, useState, useCallback, useMemo, startTransition, createContext, useContext } from "react"
```

- [ ] **Step 2 : Créer le context juste après les imports (avant le composant)**

Chercher la ligne qui déclare `export default function MapView` (vers ligne 200). Juste avant, ajouter :
```tsx
export const NavHeightContext = createContext(64)
```

- [ ] **Step 3 : Ajouter le ref et le state dans le composant MapView**

Dans le bloc des `useState` au début de MapView (vers ligne 210), ajouter :
```tsx
const navRef = useRef<HTMLDivElement>(null)
const [navHeight, setNavHeight] = useState(80)
```

- [ ] **Step 4 : Ajouter le ResizeObserver dans un useEffect**

Après les useEffect existants, ajouter :
```tsx
// Mesure la hauteur réelle de la nav bar mobile
useEffect(() => {
  const el = navRef.current
  if (!el) return
  const ro = new ResizeObserver(() => setNavHeight(el.offsetHeight))
  ro.observe(el)
  return () => ro.disconnect()
}, [])
```

- [ ] **Step 5 : Wrapper le return de MapView avec le provider**

À la ligne 1656, remplacer :
```tsx
  return (
    <div className="relative h-screen w-full overflow-hidden bg-gray-50 dark:bg-zinc-950">
```
Par :
```tsx
  return (
    <NavHeightContext.Provider value={navHeight}>
    <div className="relative h-screen w-full overflow-hidden bg-gray-50 dark:bg-zinc-950">
```

Et fermer le provider à la toute fin du return, juste avant le dernier `}` du composant. Chercher la dernière ligne du JSX (après `</AnimatePresence>` final) et ajouter `</NavHeightContext.Provider>`.

- [ ] **Step 6 : Attacher le ref à la nav bar**

À la ligne 2640-2641, ajouter `ref={navRef}` :
```tsx
      <div
        ref={navRef}
        className="sm:hidden fixed right-0 bottom-0 left-0 z-[90] border-t border-gray-200 dark:border-white/10 bg-white/90 dark:bg-zinc-950/90 backdrop-blur-xl"
        style={{ paddingBottom: "min(env(safe-area-inset-bottom), 16px)" }}
      >
```

- [ ] **Step 7 : Vérifier que TypeScript ne signale pas d'erreur**

```bash
cd spot-share-main && npx tsc --noEmit 2>&1 | grep -i "NavHeightContext\|navHeight\|navRef"
```
Résultat attendu : aucune ligne d'erreur.

- [ ] **Step 8 : Commit**

```bash
git add components/map/MapView.tsx
git commit -m "feat: add NavHeightContext — measure real nav bar height via ResizeObserver"
```

---

## Task 2 : Remplacer les valeurs hardcodées dans MapView

**Files:**
- Modify: `components/map/MapView.tsx:2078` (boutons flottants droite)
- Modify: `components/map/MapView.tsx:2113` (boutons flottants gauche)
- Modify: `components/map/MapView.tsx:2154` (spot panel)
- Modify: `components/map/MapView.tsx:2282` (padding contenu spot panel)
- Modify: `components/map/MapView.tsx:2545` (group picker overlay)
- Modify: `components/map/MapView.tsx:3059` (bannière push notifications)

- [ ] **Step 1 : Boutons flottants droite (ligne ~2078)**

Remplacer :
```tsx
<div className={cn("pointer-events-none absolute right-4 bottom-[calc(9rem+env(safe-area-inset-bottom))] flex flex-col items-end gap-3 sm:bottom-6", selectedSpot ? "z-10" : "z-40")}>
```
Par :
```tsx
<div className={cn("pointer-events-none absolute right-4 flex flex-col items-end gap-3 sm:bottom-6", selectedSpot ? "z-10" : "z-40")} style={{ bottom: window.innerWidth < 640 ? navHeight + 80 : undefined }}>
```

- [ ] **Step 2 : Boutons flottants gauche (ligne ~2113)**

Remplacer :
```tsx
<div className={cn("pointer-events-none absolute bottom-[calc(9rem+env(safe-area-inset-bottom))] left-4 sm:bottom-6 sm:left-[4.5rem]", selectedSpot ? "z-10" : "z-40")}>
```
Par :
```tsx
<div className={cn("pointer-events-none absolute left-4 sm:bottom-6 sm:left-[4.5rem]", selectedSpot ? "z-10" : "z-40")} style={{ bottom: window.innerWidth < 640 ? navHeight + 80 : undefined }}>
```

- [ ] **Step 3 : Spot panel (ligne ~2154)**

Remplacer la className :
```tsx
className="absolute right-2 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] left-2 z-20 flex max-h-[78vh] flex-col overflow-hidden rounded-[2.5rem] border border-gray-200 dark:border-white/10 bg-white/95 dark:bg-zinc-950/95 text-gray-900 dark:text-white shadow-[0_-10px_50px_rgba(0,0,0,0.2)] dark:shadow-[0_-10px_50px_rgba(0,0,0,0.5)] backdrop-blur-2xl sm:right-auto sm:bottom-6 sm:left-[4.5rem] sm:max-h-[88vh] sm:w-[440px] sm:rounded-3xl sm:shadow-2xl"
```
Par (retirer `bottom-[calc(4.25rem+env(safe-area-inset-bottom))]`, ajouter style inline) :
```tsx
className="absolute right-2 left-2 z-20 flex max-h-[78vh] flex-col overflow-hidden rounded-[2.5rem] border border-gray-200 dark:border-white/10 bg-white/95 dark:bg-zinc-950/95 text-gray-900 dark:text-white shadow-[0_-10px_50px_rgba(0,0,0,0.2)] dark:shadow-[0_-10px_50px_rgba(0,0,0,0.5)] backdrop-blur-2xl sm:right-auto sm:bottom-6 sm:left-[4.5rem] sm:max-h-[88vh] sm:w-[440px] sm:rounded-3xl sm:shadow-2xl"
style={{ bottom: window.innerWidth < 640 ? navHeight + 4 : undefined }}
```

- [ ] **Step 4 : Padding contenu spot panel (ligne ~2282)**

Remplacer :
```tsx
<div className="px-5 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-6">
```
Par :
```tsx
<div className="px-5 pt-4 sm:pb-6" style={{ paddingBottom: window.innerWidth < 640 ? navHeight + 16 : undefined }}>
```

- [ ] **Step 5 : Group picker overlay padding (ligne ~2545)**

Remplacer :
```tsx
className="relative z-10 rounded-t-3xl bg-white dark:bg-zinc-950 px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))]"
```
Par :
```tsx
className="relative z-10 rounded-t-3xl bg-white dark:bg-zinc-950 px-4 pt-4"
style={{ paddingBottom: window.innerWidth < 640 ? navHeight + 16 : 24 }}
```

- [ ] **Step 6 : Bannière push notifications (ligne ~3059)**

Remplacer :
```tsx
className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 w-[calc(100%-2rem)] max-w-sm"
```
Par :
```tsx
className="fixed left-1/2 z-50 -translate-x-1/2 w-[calc(100%-2rem)] max-w-sm"
style={{ bottom: navHeight + 16 }}
```

- [ ] **Step 7 : Vérifier TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Résultat attendu : 0 erreurs (les warnings unused imports existants sont ignorés).

- [ ] **Step 8 : Commit**

```bash
git add components/map/MapView.tsx
git commit -m "fix: replace hardcoded bottom positions with dynamic navHeight in MapView"
```

---

## Task 3 : Passer navHeight en prop aux modals

**Files:**
- Modify: `components/map/ExploreModal.tsx:1` (interface props)
- Modify: `components/map/ExploreModal.tsx:541,557` (positionnement)
- Modify: `components/map/FriendsModal.tsx:1` (interface props)
- Modify: `components/map/FriendsModal.tsx:1237` (positionnement)
- Modify: `components/map/AddSpotModal.tsx:1` (interface props)
- Modify: `components/map/AddSpotModal.tsx:400` (positionnement)
- Modify: `components/map/ProfileModal.tsx:1` (interface props)
- Modify: `components/map/ProfileModal.tsx:656` (positionnement)
- Modify: `components/map/MapView.tsx` (passer la prop)

### ExploreModal

- [ ] **Step 1 : Ajouter `navHeight` à l'interface ExploreModalProps**

Dans `ExploreModal.tsx`, trouver l'interface des props (chercher `interface ExploreModal` ou `ExploreModalProps`). Ajouter :
```tsx
navHeight?: number
```

- [ ] **Step 2 : Déstructurer `navHeight` dans le composant**

Dans la signature du composant, ajouter `navHeight = 80` :
```tsx
export default function ExploreModal({ isOpen, onClose, ..., navHeight = 80 }: ExploreModalProps) {
```

- [ ] **Step 3 : Remplacer bottom-16 sur le backdrop (ligne 541)**

Remplacer :
```tsx
className="fixed inset-x-0 top-0 bottom-16 z-[70] sm:inset-0 bg-black/50 backdrop-blur-sm"
```
Par :
```tsx
className="fixed inset-x-0 top-0 z-[70] sm:inset-0 bg-black/50 backdrop-blur-sm"
style={{ bottom: window.innerWidth < 640 ? navHeight : 0 }}
```

- [ ] **Step 4 : Remplacer bottom-16 sur le panel (ligne 557)**

Remplacer :
```tsx
className="fixed inset-x-0 bottom-16 z-[80] sm:inset-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2"
```
Par :
```tsx
className="fixed inset-x-0 z-[80] sm:inset-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2"
style={{ bottom: window.innerWidth < 640 ? navHeight : undefined }}
```

### FriendsModal

- [ ] **Step 5 : Ajouter `navHeight` à FriendsModal**

Même pattern — trouver l'interface props et ajouter `navHeight?: number`, déstructurer avec valeur par défaut `navHeight = 80`.

- [ ] **Step 6 : Remplacer bottom-0 sur le panel mobile (ligne 1237)**

Remplacer :
```tsx
className="fixed inset-x-0 bottom-0 z-50 sm:inset-auto sm:top-0 sm:right-0 sm:bottom-0 sm:w-[360px]"
```
Par :
```tsx
className="fixed inset-x-0 z-50 sm:inset-auto sm:top-0 sm:right-0 sm:bottom-0 sm:w-[360px]"
style={{ bottom: window.innerWidth < 640 ? navHeight : undefined }}
```

### AddSpotModal

- [ ] **Step 7 : Ajouter `navHeight` à AddSpotModal**

Même pattern — interface props + déstructuration avec `navHeight = 80`.

- [ ] **Step 8 : Remplacer bottom-0 (ligne 400)**

Remplacer :
```tsx
className="fixed inset-x-0 bottom-0 z-50 sm:inset-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2"
```
Par :
```tsx
className="fixed inset-x-0 z-50 sm:inset-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2"
style={{ bottom: window.innerWidth < 640 ? navHeight : undefined }}
```

### ProfileModal

- [ ] **Step 9 : Ajouter `navHeight` à ProfileModal**

Même pattern — interface props + déstructuration avec `navHeight = 80`.

- [ ] **Step 10 : Remplacer bottom-0 (ligne 656)**

Remplacer :
```tsx
className="fixed inset-x-0 bottom-0 z-50 sm:inset-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-[calc(50%+2rem)]"
```
Par :
```tsx
className="fixed inset-x-0 z-50 sm:inset-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-[calc(50%+2rem)]"
style={{ bottom: window.innerWidth < 640 ? navHeight : undefined }}
```

### MapView — passer la prop

- [ ] **Step 11 : Passer `navHeight` aux 4 modals dans MapView**

Dans MapView, chercher chaque instanciation des modals (chercher `<ExploreModal`, `<FriendsModal`, `<AddSpotModal`, `<ProfileModal`) et ajouter `navHeight={navHeight}` à chacune.

- [ ] **Step 12 : Vérifier TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Résultat attendu : 0 erreurs.

- [ ] **Step 13 : Commit**

```bash
git add components/map/ExploreModal.tsx components/map/FriendsModal.tsx components/map/AddSpotModal.tsx components/map/ProfileModal.tsx components/map/MapView.tsx
git commit -m "fix: pass dynamic navHeight to all modals — align panels above nav bar"
```

---

## Task 4 : Vérification finale et déploiement

- [ ] **Step 1 : Build de vérification**

```bash
npx next build 2>&1 | tail -20
```
Résultat attendu : `✓ Compiled successfully`, pas d'erreur TypeScript bloquante.

- [ ] **Step 2 : Déployer**

```bash
echo "y" | npx vercel deploy --prod
```

- [ ] **Step 3 : Vérifier sur mobile**

Tester sur iPhone Safari et PWA :
- La nav bar doit être visible sans espace blanc excessif
- Ouvrir Explorer, Amis, Profil, AddSpot → les panels doivent s'aligner exactement au-dessus de la nav bar
- Les boutons flottants (zoom, localisation) ne doivent pas être cachés derrière la nav bar
- Rotation portrait → paysage → les positions se recalculent automatiquement
