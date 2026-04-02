# Token Optimization — Plugin Installation Design

## Goal

Réduire la consommation de tokens en session en évitant les lectures répétées de gros fichiers (`MapView.tsx` ~2600 lignes, `FriendsModal.tsx` ~2900 lignes) et les cycles de build coûteux pour la vérification TypeScript.

## Contexte

FriendSpot est un projet Next.js 16 / React 19 / TypeScript avec Supabase et Mapbox. Les deux principales sources de gaspillage de tokens sont :

1. **Gros fichiers** — chaque session nécessite du grepping pour retrouver les fonctions clés (ex: `handleAddSpot`, `visibleSpots`, `loadGroups`), ce qui entraîne plusieurs lectures partielles coûteuses.
2. **Cycles de build** — vérifier les erreurs TypeScript requiert `npx next build` (~2 min, output verbeux), alors qu'une vérification locale suffit.

## Solution retenue — Option A

Installer deux plugins complémentaires :

### 1. `claude-md-management`

**Outil `claude-md-improver` (skill)**
- Audite CLAUDE.md par rapport à l'état réel du code
- Détecte les sections obsolètes ou manquantes
- Usage : `"audit my CLAUDE.md"`

**Commande `/revise-claude-md`**
- À appeler en fin de session de travail importante
- Capture les nouveaux composants, fonctions, et numéros de ligne découverts
- Met à jour CLAUDE.md pour que la prochaine session commence avec un index précis

**Impact concret** : Au lieu de lire `MapView.tsx` en cherchant `handleAddSpot`, CLAUDE.md indique directement `MapView.tsx:1088`. Lecture ciblée, zéro exploration.

### 2. `typescript-lsp`

**Prérequis** : `npm install -g typescript-language-server typescript`

**Fonctionnement** : Diagnostics TypeScript en temps réel sur les fichiers modifiés via `getDiagnostics`. Remplace les appels à `npx next build` pour la vérification de types.

**Impact concret** : Après chaque modification d'un fichier, appel ciblé à `getDiagnostics("components/map/MapView.tsx")` au lieu d'un build complet. Résultat instantané, output minimal.

## Ce que ce design ne couvre pas

- Découpage des gros fichiers (MapView, FriendsModal) — traité séparément comme projet de refactoring
- `typescript-lsp` ne remplace pas le build Vercel final — uniquement la vérification TS locale pendant le développement

## Workflow post-installation

1. Fin de session → `/revise-claude-md` pour mettre à jour CLAUDE.md
2. Modification de fichier TS → `getDiagnostics` au lieu de `next build`
3. Audit périodique → `"audit my CLAUDE.md"` pour détecter les dérives

## Installation

```bash
# Plugin 1
/plugin install claude-md-management

# Plugin 2
/plugin install typescript-lsp
npm install -g typescript-language-server typescript
```
