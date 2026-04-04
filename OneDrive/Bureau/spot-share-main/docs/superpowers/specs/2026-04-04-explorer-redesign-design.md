# Explorer Redesign — Design Spec
**Date:** 2026-04-04

---

## Objectif

Rendre l'onglet Explorer plus sobre, lisible et facile à prendre en main. Remplacer le scroll infini par une navigation par catégories visuelles. Ajouter un onglet "Général" explicite. Refondre les 8 catégories de spots pour mieux couvrir la réalité.

---

## Structure des onglets

Trois onglets disposés en deux rangées dans le header :

```
[ Mes spots ]  [ Amis ]    ← rangée du haut, boutons égaux
[    Général              ] ← barre pleine largeur en dessous
```

- Un seul onglet actif à la fois (les trois sont mutuellement exclusifs)
- Cliquer l'onglet déjà actif ne fait rien
- Au reset (fermeture du modal), retour sur Général par défaut

**Type `Mode` mis à jour :** `"general" | "mine" | "friends"`

---

## Refonte des 8 catégories

### Nouvelles catégories (source unique : `lib/categories.ts`)

| # | Clé | Label | Emoji | Dégradé tuile |
|---|---|---|---|---|
| 1 | `café` | Café | ☕ | `#78350f → #b45309` |
| 2 | `restaurant` | Restaurant | 🍽️ | `#7c2d12 → #dc2626` |
| 3 | `extérieur` | Extérieur | 🌿 | `#14532d → #16a34a` |
| 4 | `bar` | Bar | 🍸 | `#4c1d95 → #7c3aed` |
| 5 | `vue` | Vue | 🌅 | `#1e3a5f → #2563eb` |
| 6 | `culture` | Culture | 🎭 | `#831843 → #db2777` |
| 7 | `sport` | Sport | 🏃 | `#064e3b → #059669` |
| 8 | `événement` | Événement | 🎉 | `#1a1a2a → #6366f1` |

### Changements vs l'existant

| Ancienne clé | Nouvelle clé | Action |
|---|---|---|
| `outdoor` | `extérieur` | Renommer clé + label |
| `shopping` | `sport` | Remplacer |
| `other` | `événement` | Remplacer |
| `café`, `restaurant`, `bar`, `vue`, `culture` | inchangées | Aucune migration |

### Migration base de données

Les spots existants avec les anciennes clés doivent être migrés :

```sql
UPDATE spots SET category = 'extérieur' WHERE category = 'outdoor';
UPDATE spots SET category = 'sport'     WHERE category = 'shopping';
UPDATE spots SET category = 'événement' WHERE category = 'other';
```

### Catégorie Événement — dates éphémères

La catégorie `événement` est la **seule** à afficher le sélecteur de date d'expiration (`expires_at`) dans `AddSpotModal`. Pour les autres catégories, ce champ est masqué.

---

## Composant : grille catégories 4×2 (`CategoryGrid`)

Utilisée dans les 3 onglets. Comportement identique partout.

### Apparence
- Grille CSS 4 colonnes × 2 rangées (8 tuiles)
- Chaque tuile : fond dégradé coloré propre à la catégorie, emoji (20px), label court en blanc
- Opacité par défaut : `0.8`

### État sélectionné
- Contour blanc `border: 2.5px solid #fff`
- Opacité `1`
- Légère `box-shadow: 0 0 0 1px rgba(255,255,255,0.2)`
- Les autres tuiles passent à opacité `0.35`

### Interaction
- Cliquer une tuile inactive → la sélectionne, filtre les spots
- Cliquer la tuile active → la désélectionne, revient à "tout"
- Aucune tuile sélectionnée = tous les spots affichés

---

## Onglet Général

Contenu de haut en bas :

1. **Barre de recherche** (existante)
2. **Grille catégories 4×2**
3. **Bouton "Surprends-moi"** (existant, inchangé avec sélecteur de rayon)
4. **Section "Près de toi"** — carousel horizontal `SpotHCard` (si géolocalisation disponible)
5. **Liste spots** — `SpotListRow`, triée par distance ou récence selon filtres actifs

Quand une catégorie est sélectionnée : sections 4 et 5 montrent uniquement les spots de cette catégorie.

---

## Onglet Mes spots

Contenu de haut en bas :

1. **Barre de recherche** (existante)
2. **Grille catégories 4×2** — filtre sur les spots de l'utilisateur courant
3. **Compteur** — `"N spots"` en petit texte gris
4. **Grille 2×2** (`SpotGridCard`) — spots filtrés

---

## Onglet Amis

Contenu de haut en bas :

1. **Barre de recherche** (existante)
2. **Carousel avatars amis** — clic pour filtrer par ami (comportement existant, sans `@`)
3. **Section "Cette semaine"** — carousel `SpotHCard` des spots ajoutés dans les 7 derniers jours
   - **Masquée si `friendsThisWeek.length === 0`**
4. **Séparateur**
5. **Grille catégories 4×2** — catégorie `café` sélectionnée par défaut
6. **Liste spots** — `SpotListRow`, filtrée par ami + catégorie actifs

Les deux filtres (ami + catégorie) sont cumulables.

**Supprimé :** section "Tous leurs spots" (scroll infini).

---

## Suppression du `@` sur les prénoms

Retirer le préfixe `@` devant tous les usernames affichés dans toute l'app :

- `ExploreModal.tsx` — avatars amis, auteurs dans `SpotHCard` et `SpotListRow`
- `FriendsModal.tsx` — liste amis, classement, invitations
- `ProfileModal.tsx` — profil utilisateur
- `MapView.tsx` — tout affichage de username
- Tout autre composant affichant `` `@${username}` ``

Conserver `@` uniquement dans les **placeholders de recherche** (ex: `"Spot, adresse ou ami…"`).

---

## État local — changements

| État | Avant | Après |
|---|---|---|
| `mode` | `"explorer" \| "mine" \| "friends"` | `"general" \| "mine" \| "friends"` |
| `categoryFilter` | `string \| null` (dropdown) | `string \| null` (grille tuiles) |
| `friendFilter` | inchangé | inchangé |

Reset au close : `mode → "general"`, `categoryFilter → null`, `friendFilter → null`.

---

## Ce qui ne change pas

- Animation d'entrée/sortie du modal (Framer Motion)
- Swipe-to-close
- Barre de recherche avec debounce
- `SpotHCard`, `SpotGridCard`, `SpotListRow` — composants inchangés
- Logique de filtrage (`filteredPool`, `withDist`, etc.)
- `SkeletonCard` et `EmptyState`
- Bouton "Surprends-moi" et sélecteur de rayon
