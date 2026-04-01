# Design — Groupes intégrés dans le bouton Amis

**Date :** 2026-04-01
**Statut :** Approuvé

---

## Contexte

Actuellement la barre de filtres affiche : `Moi | Amis | Groupes`

Le bouton "Groupes" ouvre un dropdown inline permettant de sélectionner un groupe custom et de créer de nouveaux groupes. Le bouton "Amis" active le filtre amis directement.

L'objectif est de fusionner ces deux boutons : supprimer "Groupes" et intégrer la sélection de groupe dans le bouton "Amis".

---

## Résultat final

**Barre de filtres :** `Moi | Amis ▾    🎚`

- Le `▾` (chevron) s'affiche uniquement quand le filtre `friends` ou `groups` est déjà actif
- Quand un groupe custom est actif, le bouton affiche son nom et emoji : `🗂️ Vacances ▾`
- Le bouton filtre `🎚` (SlidersHorizontal) reste à droite, visible quand `filter === "friends"` ou `filter === "groups"`

---

## Comportement du bouton Amis/Groupe

| État courant | Action | Résultat |
|---|---|---|
| `filter = "mine"` (Moi) | Clic sur "Amis" | Active `filter = "friends"` directement, pas de dropdown |
| `filter = "friends"` | Clic sur "Amis ▾" | Ouvre le dropdown groupe |
| `filter = "groups"` | Clic sur `🗂️ Vacances ▾` | Ouvre le dropdown groupe |

---

## Dropdown groupe

Même style que l'actuel (dark, rounded-2xl, z-50). Structure :

```
[👥 Amis]          ← ✓ si filter === "friends"
[🗂️ Vacances]  ⚙️  ← ✓ si activeGroupId === group.id
[🎯 Collègues] ⚙️
────────────────────
[+ Créer un groupe]
```

- "Amis" en premier : clic → `filter = "friends"`, `activeGroupId = null`
- Groupe custom : clic sur la ligne → `filter = "groups"`, `activeGroupId = group.id` ; si le groupe est déjà actif, clic le désactive → `filter = "friends"`, `activeGroupId = null` (comportement toggle existant)
- Icône ⚙️ à droite de chaque groupe custom → ouvre `GroupSettingsModal`
- Bouton "+ Créer un groupe" en bas → affiche le formulaire inline (comportement existant)

---

## Bouton filtre 🎚 (SlidersHorizontal)

Visible quand `filter === "friends"` ou `filter === "groups"`.

| Filtre actif | Contenu du panneau filtre |
|---|---|
| `friends` | Filtre par ami (liste checkboxes) + filtre par catégorie |
| `groups` | Filtre par catégorie uniquement (les membres sont fixes) |

---

## GroupSettingsModal — Fonctionnalités ajoutées

Le modal existe déjà avec : inviter un ami, liste membres, retirer un membre, invitations en attente, supprimer le groupe.

### Ajouts :

**1. Renommer / changer l'emoji** (créateur seulement)
- En haut du modal, le nom et l'emoji sont éditables inline
- Champ nom : éditable on click, sauvegarde on blur ou Enter
- Champ emoji : input court (maxLength=2), même comportement
- Appel `supabase.from("spot_groups").update(...)` + `onGroupUpdated(updatedGroup)`

**2. Quitter le groupe** (membres non-créateurs uniquement)
- Bouton rouge "Quitter le groupe" en bas (symétrique à "Supprimer le groupe" pour le créateur)
- Appel `supabase.from("spot_group_members").delete()` sur `(group_id, user_id)`
- Ferme le modal + retire le groupe de la liste locale

**3. Annuler une invitation en attente** (créateur seulement)
- Bouton "Annuler" à droite de chaque invitation en attente dans la liste
- Appel `supabase.from("spot_group_invitations").delete()` sur l'id
- Retire l'invitation de la liste locale

---

## Fichiers impactés

| Fichier | Changement |
|---|---|
| `components/map/MapView.tsx` | Supprimer `{ key: "groups", ... }` de `filterButtons` · Modifier le comportement clic du bouton "friends" · Modifier le label/chevron dynamique · Ajouter "Amis" comme premier item du dropdown · Étendre la condition d'affichage du bouton filtre à `groups` · Masquer les filtres par ami quand `filter === "groups"` |
| `components/map/GroupSettingsModal.tsx` | Ajouter : renommer/emoji inline, quitter groupe, annuler invitation |

Aucun changement DB, aucune migration nécessaire.
