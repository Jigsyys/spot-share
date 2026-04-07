# FriendsModal Redesign — Spec

## Contexte

FriendsModal a 3 onglets actuels : **Amis / Classement / Invitations**.
L'onglet "Invitations" est un fourre-tout (demandes amis + sorties reçues + mes sorties + demandes envoyées).
L'onglet "Classement" est bien mais enterré.
Les **Groupes** existent en DB et ont leur logique (fetch, accept/decline) mais leur section UI est noyée dans "Invitations" sans badge dédié. La création de groupe est uniquement dans le dropdown de la carte.

## Décision de design

Remplacer les 3 onglets actuels par **3 onglets recentrés** :

| Onglet | Contenu | Badge |
|--------|---------|-------|
| **Amis** | Liste amis (en ligne / hors ligne) + section Groupes (cartes groupes + invitations groupe + créer groupe) | `groupInvitations.length` |
| **Sorties** | Invitations sorties reçues (accept/decline) + mes sorties actives + bouton "Proposer une sortie" | `outingInvitations.length` |
| **Activité** | Classement mensuel (épinglé en haut) + demandes d'amis (accept/decline) + feed spots récents amis (7 derniers jours) | `incomingRequests.length` |

## Changements techniques

### FriendsModal.tsx
- `Tab` type : `"amis" | "classement" | "invitations"` → `"amis" | "sorties" | "activite"`
- Nouveau prop : `groups: SpotGroup[]` (liste des groupes de l'utilisateur)
- Nouveau prop : `onCreateGroup: (name: string, emoji: string) => Promise<void>` (déléguer la création à MapView)
- Feed d'activité : `useMemo` sur le prop `spots` existant filtré par `followingIds` (≤ 7j, ≤ 15 items) — pas de nouvelle requête réseau
- Badge "Amis" : `groupInvitations.length` (actuellement non comptabilisé dans `totalInvitations`)
- Badge "Sorties" : `outingInvitations.length`
- Badge "Activité" : `incomingRequests.length`
- Déplacements UI :
  - Section classement (lines ~1333–1622) → onglet "activite"
  - Section sorties/outings (lines ~1623+) → onglet "sorties"
  - Section group invitations → onglet "amis" (section Groupes)
  - Section friend requests → onglet "activite"

### MapView.tsx
- Ajouter prop `groups={groups}` à l'appel `<FriendsModal>`
- Ajouter prop `onCreateGroup={handleCreateGroup}` à l'appel `<FriendsModal>`

## Ce qui NE change pas
- Toute la logique de fetch existante (loadOutings, loadGroupInvitations, loadIncomingRequests, etc.)
- Les composants OutingInvitationCard, FeaturedOutingCard
- Les animations, swipe-to-close, layout du panel
- MapView dropdown (garde la création de groupe en doublon pour la map)
