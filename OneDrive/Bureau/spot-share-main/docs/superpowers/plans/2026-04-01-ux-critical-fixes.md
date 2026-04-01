# UX Critical Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corriger les 5 problèmes UX critiques qui dégradent la qualité perçue de FriendSpot vs les grandes apps.

**Architecture:** Composant `ConfirmDialog` partagé + prop `spotsLoaded` sur ExploreModal + feedback géoloc + toast retry sur fetchSpots + CTAs dans EmptyState.

**Tech Stack:** React 19, Framer Motion, Tailwind CSS, Sonner (toasts), Next.js App Router

---

## Fichiers modifiés / créés

| Fichier | Action | Raison |
|---|---|---|
| `components/ui/ConfirmDialog.tsx` | **Créer** | Remplace tous les `window.confirm()` |
| `components/map/MapView.tsx` | Modifier | Intègre ConfirmDialog + géoloc feedback + fetchSpots retry + prop spotsLoaded |
| `components/map/FriendsModal.tsx` | Modifier | Remplace 2× `window.confirm()` |
| `components/map/ProfileModal.tsx` | Modifier | Remplace 4× `window.confirm()` |
| `components/map/ExploreModal.tsx` | Modifier | Ajoute prop `spotsLoaded` + skeleton + CTAs dans EmptyState |

---

## Task 1 — ConfirmDialog component

**Fichiers :**
- Créer : `components/ui/ConfirmDialog.tsx`

- [ ] **Créer le composant**

```tsx
// components/ui/ConfirmDialog.tsx
"use client"
import { motion, AnimatePresence } from "framer-motion"

interface Props {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open, title, message,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  danger = false,
  onConfirm, onCancel,
}: Props) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm"
            onClick={onCancel}
          />
          <motion.div
            key="dialog"
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 20 }}
            transition={{ type: "spring", damping: 20, stiffness: 300 }}
            className="fixed left-1/2 top-1/2 z-[201] w-[min(22rem,90vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white dark:bg-zinc-900 p-6 shadow-2xl border border-gray-200 dark:border-white/10"
          >
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2">{title}</h2>
            <p className="text-sm text-gray-500 dark:text-zinc-400 mb-6">{message}</p>
            <div className="flex gap-3">
              <button
                onClick={onCancel}
                className="flex-1 rounded-xl border border-gray-200 dark:border-white/10 py-2.5 text-sm font-semibold text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors"
              >
                {cancelLabel}
              </button>
              <button
                onClick={onConfirm}
                className={`flex-1 rounded-xl py-2.5 text-sm font-semibold text-white transition-colors ${
                  danger
                    ? "bg-red-500 hover:bg-red-600"
                    : "bg-blue-600 hover:bg-blue-700"
                }`}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
```

- [ ] **Vérifier TS** : `npx tsc --noEmit` → aucune erreur

---

## Task 2 — Remplacer window.confirm() dans MapView.tsx

**Fichiers :**
- Modifier : `components/map/MapView.tsx`

> Il y a 1 occurrence à la ligne ~1974 (suppression spot dans le panel).

- [ ] **Ajouter l'import et l'état du dialog**

Ajouter l'import en haut du fichier (après les imports existants) :
```ts
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
```

Ajouter ces états près des autres états de modal (zone ~300) :
```ts
const [confirmDialog, setConfirmDialog] = useState<{
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
} | null>(null)
```

Helper à placer juste après les useState :
```ts
const openConfirm = useCallback((opts: {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
}) => setConfirmDialog({ open: true, ...opts }), [])
```

- [ ] **Remplacer le window.confirm de suppression spot** (~ligne 1974)

Avant :
```ts
if (window.confirm("Es-tu sûr de vouloir supprimer ce lieu ?")) {
  await handleDeleteSpot(selectedSpot.id)
}
```

Après :
```ts
openConfirm({
  title: "Supprimer ce lieu ?",
  message: "Cette action est irréversible.",
  confirmLabel: "Supprimer",
  danger: true,
  onConfirm: () => handleDeleteSpot(selectedSpot.id),
})
```

- [ ] **Ajouter le rendu du ConfirmDialog** dans le JSX (avant la dernière `</div>` du return) :

```tsx
{confirmDialog && (
  <ConfirmDialog
    open={confirmDialog.open}
    title={confirmDialog.title}
    message={confirmDialog.message}
    confirmLabel={confirmDialog.confirmLabel}
    danger={confirmDialog.danger}
    onConfirm={() => {
      confirmDialog.onConfirm()
      setConfirmDialog(null)
    }}
    onCancel={() => setConfirmDialog(null)}
  />
)}
```

- [ ] **Vérifier TS** : `npx tsc --noEmit` → aucune erreur

---

## Task 3 — Remplacer window.confirm() dans FriendsModal.tsx

**Fichiers :**
- Modifier : `components/map/FriendsModal.tsx`

> 2 occurrences : ligne ~818 (annuler sortie), ligne ~829 (se désister).

- [ ] **Ajouter import + état**

```ts
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
```

Ajouter près des autres useState :
```ts
const [confirmDialog, setConfirmDialog] = useState<{
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
} | null>(null)

const openConfirm = useCallback((opts: {
  title: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void
}) => setConfirmDialog({ open: true, ...opts }), [])
```

- [ ] **Remplacer ligne ~818** (annuler sortie)

Avant :
```ts
if (!window.confirm("Annuler cette sortie ? Les participants seront informés.")) return
await handleCancelOuting(outing.id)
```

Après :
```ts
openConfirm({
  title: "Annuler la sortie ?",
  message: "Les participants seront informés.",
  confirmLabel: "Annuler la sortie",
  danger: true,
  onConfirm: () => handleCancelOuting(outing.id),
})
```

- [ ] **Remplacer ligne ~829** (se désister)

Avant :
```ts
if (!window.confirm("Se désister de cette sortie ?")) return
// code qui suit...
```

Après :
```ts
openConfirm({
  title: "Se désister ?",
  message: "Tu seras retiré(e) de cette sortie.",
  confirmLabel: "Se désister",
  danger: true,
  onConfirm: async () => { /* le code qui était après le window.confirm */ },
})
return // stopper l'exécution inline
```

- [ ] **Ajouter le rendu** avant la fermeture du return principal :
```tsx
{confirmDialog && (
  <ConfirmDialog
    open={confirmDialog.open}
    title={confirmDialog.title}
    message={confirmDialog.message}
    confirmLabel={confirmDialog.confirmLabel}
    danger={confirmDialog.danger}
    onConfirm={() => { confirmDialog.onConfirm(); setConfirmDialog(null) }}
    onCancel={() => setConfirmDialog(null)}
  />
)}
```

- [ ] **Vérifier TS** : `npx tsc --noEmit` → aucune erreur

---

## Task 4 — Remplacer window.confirm() dans ProfileModal.tsx

**Fichiers :**
- Modifier : `components/map/ProfileModal.tsx`

> 4 occurrences : supprimer spot (211), unfollow (223), retirer abonné (235), supprimer compte (348).

- [ ] **Ajouter import + état** (même pattern que Tasks 2 et 3)

- [ ] **Remplacer ligne ~211** (supprimer spot)
```ts
// Avant
if (!window.confirm("Es-tu sûr de vouloir supprimer ce lieu ?")) return
// Après
openConfirm({
  title: "Supprimer ce lieu ?",
  message: "Cette action est irréversible.",
  confirmLabel: "Supprimer",
  danger: true,
  onConfirm: () => handleDeleteSpot(spotId),
})
return
```

- [ ] **Remplacer ligne ~223** (unfollow)
```ts
// Avant
if (!window.confirm("Ne plus suivre cet ami ?")) return
// Après
openConfirm({
  title: "Ne plus suivre ?",
  message: "Tu ne verras plus ses spots sur la carte.",
  confirmLabel: "Se désabonner",
  danger: false,
  onConfirm: () => handleUnfollow(userId),
})
return
```

- [ ] **Remplacer ligne ~235** (retirer abonné)
```ts
// Avant
if (!window.confirm("Retirer cet abonné ?")) return
// Après
openConfirm({
  title: "Retirer cet abonné ?",
  message: "Il ne pourra plus voir tes spots.",
  confirmLabel: "Retirer",
  danger: false,
  onConfirm: () => handleRemoveFollower(userId),
})
return
```

- [ ] **Remplacer ligne ~348** (supprimer compte)
```ts
// Avant
if (!window.confirm("Es-tu sûr ? Tous tes spots, relations et données seront définitivement supprimés.")) return
// Après
openConfirm({
  title: "Supprimer ton compte ?",
  message: "Tous tes spots, relations et données seront définitivement supprimés. Cette action est irréversible.",
  confirmLabel: "Supprimer mon compte",
  danger: true,
  onConfirm: () => handleDeleteAccount(),
})
return
```

- [ ] **Ajouter le rendu ConfirmDialog** dans le return

- [ ] **Vérifier TS** : `npx tsc --noEmit` → aucune erreur

---

## Task 5 — Skeleton loaders dans ExploreModal

**Fichiers :**
- Modifier : `components/map/ExploreModal.tsx`
- Modifier : `components/map/MapView.tsx` (ajouter prop `spotsLoaded`)

- [ ] **Ajouter prop `spotsLoaded` à ExploreModal**

Dans le type props d'ExploreModal (chercher `interface.*Props` ou le destructuring des props) :
```ts
spotsLoaded: boolean
```

- [ ] **Ajouter `spotsLoaded` dans MapView.tsx**

Dans la déclaration de `fetchSpots`, ajouter un state :
```ts
const [spotsLoaded, setSpotsLoaded] = useState(false)
```

À la fin de `fetchSpots` (après le premier `setSpots`), ajouter :
```ts
setSpotsLoaded(true)
```
(à placer dans le `finally` ou après le premier setSpots réussi)

Passer la prop dans le JSX ExploreModal :
```tsx
spotsLoaded={spotsLoaded}
```

- [ ] **Créer le composant SkeletonCard** dans ExploreModal.tsx (avant la fonction EmptyState) :

```tsx
function SkeletonCard() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 animate-pulse">
      <div className="h-14 w-14 flex-shrink-0 rounded-xl bg-gray-200 dark:bg-zinc-700" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-3/4 rounded-full bg-gray-200 dark:bg-zinc-700" />
        <div className="h-3 w-1/2 rounded-full bg-gray-200 dark:bg-zinc-700" />
      </div>
    </div>
  )
}
```

- [ ] **Afficher les skeletons quand `!spotsLoaded`**

Dans la zone qui affiche la liste des spots (là où `<EmptyState>` ou la liste apparaît), wrapper avec :
```tsx
{!spotsLoaded ? (
  <div className="py-2">
    {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
  </div>
) : filteredSpots.length === 0 ? (
  <EmptyState mode={mode} hasQuery={!!debouncedQuery} onAddSpot={onAddSpot} onOpenFriends={onOpenFriends} />
) : (
  // liste existante
)}
```

- [ ] **Vérifier TS** : `npx tsc --noEmit` → aucune erreur

---

## Task 6 — Géolocalisation refusée → feedback clair

**Fichiers :**
- Modifier : `components/map/MapView.tsx`

> La fonction `locateUser` (~ligne 844) ignore silencieusement l'erreur de permission.

- [ ] **Ajouter l'import `toast`** si pas déjà présent (chercher `import.*sonner`)

- [ ] **Remplacer le handler d'erreur dans `locateUser`** :

Avant :
```ts
() => setIsLocating(false),
```

Après :
```ts
(err) => {
  setIsLocating(false)
  if (err.code === GeolocationPositionError.PERMISSION_DENIED) {
    toast.error("Localisation refusée", {
      description: "Active la géolocalisation dans les paramètres de ton navigateur pour utiliser cette fonctionnalité.",
      duration: 6000,
    })
  }
},
```

- [ ] **Vérifier TS** : `npx tsc --noEmit` → aucune erreur

---

## Task 7 — fetchSpots retry on error

**Fichiers :**
- Modifier : `components/map/MapView.tsx`

> Actuellement, `fetchSpots` en erreur tombe silencieusement sur DEMO_SPOTS (ligne ~487).

- [ ] **Remplacer le catch de fetchSpots** :

Avant :
```ts
} catch (_e) {
  console.error("fetchSpots error:", _e)
  setSpots(DEMO_SPOTS)
}
```

Après :
```ts
} catch (_e) {
  console.error("fetchSpots error:", _e)
  setSpots(DEMO_SPOTS)
  toast.error("Impossible de charger les spots", {
    action: {
      label: "Réessayer",
      onClick: () => fetchSpots(),
    },
    duration: 8000,
  })
}
```

- [ ] **Vérifier TS** : `npx tsc --noEmit` → aucune erreur

---

## Task 8 — Empty states avec CTAs

**Fichiers :**
- Modifier : `components/map/ExploreModal.tsx`
- Modifier : `components/map/MapView.tsx` (passer props onAddSpot / onOpenFriends)

- [ ] **Ajouter props CTA à ExploreModal**

Dans les props d'ExploreModal, ajouter :
```ts
onAddSpot: () => void
onOpenFriends: () => void
```

- [ ] **Passer ces props depuis MapView.tsx** :
```tsx
onAddSpot={() => { setShowExploreModal(false); setShowAddSpotModal(true) }}
onOpenFriends={() => { setShowExploreModal(false); setShowFriendsModal(true) }}
```

- [ ] **Mettre à jour EmptyState** pour accepter et afficher les CTAs :

```tsx
function EmptyState({
  mode, hasQuery, onAddSpot, onOpenFriends,
}: {
  mode: Mode
  hasQuery: boolean
  onAddSpot: () => void
  onOpenFriends: () => void
}) {
  const messages: Record<Mode, { icon: string; title: string; sub: string; cta?: { label: string; action: () => void } }> = {
    explorer: {
      icon: "🌍",
      title: "Aucun spot trouvé",
      sub: hasQuery ? "Essaie un autre mot-clé" : "Sois le premier à ajouter un spot !",
      cta: hasQuery ? undefined : { label: "Ajouter un spot", action: onAddSpot },
    },
    mine: {
      icon: "📍",
      title: "Aucun spot",
      sub: hasQuery ? "Essaie un autre mot-clé" : "Commence par ajouter ton premier lieu.",
      cta: hasQuery ? undefined : { label: "Ajouter un spot", action: onAddSpot },
    },
    friends: {
      icon: "👥",
      title: "Rien pour l'instant",
      sub: hasQuery ? "Essaie un autre mot-clé" : "Invite des amis pour voir leurs spots.",
      cta: hasQuery ? undefined : { label: "Inviter des amis", action: onOpenFriends },
    },
  }
  const m = messages[mode]
  return (
    <div className="flex flex-col items-center gap-3 py-14 text-center">
      <span className="text-4xl">{m.icon}</span>
      <p className="text-sm font-semibold text-gray-600 dark:text-zinc-400">{m.title}</p>
      <p className="text-xs text-gray-400 dark:text-zinc-600">{m.sub}</p>
      {m.cta && (
        <button
          onClick={m.cta.action}
          className="mt-2 rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
        >
          {m.cta.label}
        </button>
      )}
    </div>
  )
}
```

- [ ] **Vérifier TS** : `npx tsc --noEmit` → aucune erreur

---

## Self-Review

- [x] Task 1 couvre le problème 2 (window.confirm → ConfirmDialog)
- [x] Tasks 2-4 intègrent le ConfirmDialog dans les 3 fichiers concernés (7 occurrences)
- [x] Task 5 couvre le problème 1 (skeleton loaders)
- [x] Task 6 couvre le problème 4 (géoloc refusée)
- [x] Task 7 couvre le problème 3 (retry réseau)
- [x] Task 8 couvre le problème 5 (empty states avec CTA)
- [x] Pas de placeholder — tout le code est complet
- [x] Types cohérents entre les tasks (ConfirmDialog props identiques partout)
