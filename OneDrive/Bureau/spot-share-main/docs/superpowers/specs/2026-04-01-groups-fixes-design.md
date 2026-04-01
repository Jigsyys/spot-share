# Design — Groups Fixes: Mobile Layout + Post-Accept Navigation

**Date :** 2026-04-01
**Statut :** Approuvé

---

## Problèmes résolus

1. GroupSettingsModal coupé sur mobile
2. Après avoir accepté une invitation de groupe, le groupe n'est pas accessible

---

## Fix 1 : GroupSettingsModal mobile

**Cause :** `max-h-[70vh]` sans gestion des safe areas iOS, header non-fixe, inputs de renommage trop larges sur petit écran.

**Corrections :**
- Header fixe (ne scrolle pas), body `overflow-y-auto` avec hauteur calculée
- Ajouter `pb-[env(safe-area-inset-bottom)]` au container scrollable
- Inputs de renommage : réduire taille de police et padding pour tenir sur écrans étroits
- Garder `rounded-t-3xl sm:rounded-3xl` (existant)

---

## Fix 2 : Accès au groupe après acceptation

**Flux corrigé :**
1. Utilisateur accepte l'invitation dans FriendsModal (onglet Invitations)
2. `loadGroups()` est appelé dans MapView pour rafraîchir la liste
3. Toast : `"Tu as rejoint 🗂️ NomGroupe !"` avec action **"Voir les spots"**
4. Clic "Voir les spots" → ferme FriendsModal + active `filter = "groups"` + `activeGroupId = group.id`
5. La carte filtre et affiche les spots partagés dans ce groupe

**Changements d'interface :**

`FriendsModal` : remplacer `onRefreshGroups?: () => void` par `onGroupJoined?: (groupId: string) => void`

`MapView` : implémenter `onGroupJoined` :
```ts
(groupId: string) => {
  loadGroups()                    // rafraîchit la liste
  setFilter("groups")             // active le filtre groupe
  setActiveGroupId(groupId)       // sélectionne le groupe rejoint
  setShowFriendsModal(false)      // ferme la modal
}
```

Toast dans `acceptGroupInvitation` :
```ts
toast.success(`Tu as rejoint ${emoji} ${name} !`, {
  action: { label: "Voir les spots", onClick: () => onGroupJoined?.(inv.group_id) }
})
```

---

## Fichiers impactés

| Fichier | Changement |
|---|---|
| `components/map/GroupSettingsModal.tsx` | Fix CSS mobile : header fixe, body scrollable, safe area, inputs compacts |
| `components/map/FriendsModal.tsx` | `onRefreshGroups` → `onGroupJoined(groupId)` dans la prop et dans `acceptGroupInvitation` |
| `components/map/MapView.tsx` | Implémenter `onGroupJoined` callback + mise à jour prop passée à FriendsModal |

Aucun changement DB.
