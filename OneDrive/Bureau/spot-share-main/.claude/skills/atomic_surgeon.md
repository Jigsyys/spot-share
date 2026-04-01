# Atomic Surgeon — Règles de lecture économe

## Règle principale
Ne jamais lire plus de 100 lignes d'un fichier lourd (>1000 lignes) sans utiliser Grep ou une lecture ciblée avec offset/limit.

## Protocole
1. **Avant de lire un gros fichier**, identifier précisément ce qu'on cherche.
2. **Utiliser Grep** pour localiser la ligne exacte (fonction, composant, variable).
3. **Utiliser Read avec offset+limit** pour lire uniquement la zone pertinente (~50-100 lignes autour).
4. **Jamais de lecture complète** de MapView.tsx, FriendsModal.tsx, ExploreModal.tsx, ProfileModal.tsx sans justification explicite.

## Fichiers critiques (>1000 lignes)
- `components/map/MapView.tsx` (~2425 l)
- `components/map/FriendsModal.tsx` (~2900 l)
- `components/map/ExploreModal.tsx` (~927 l)
- `components/map/ProfileModal.tsx` (~975 l)

## Workflow pour modifier un fichier critique
1. Grep → trouver la zone exacte
2. Read offset/limit → lire uniquement cette zone
3. Superpowers brainstorm → valider l'impact
4. Edit → modification chirurgicale, pas de réécriture
