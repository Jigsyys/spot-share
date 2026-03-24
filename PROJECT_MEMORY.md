# 🧠 SpotShare - Project Memory

## 🚀 Vue d'Ensemble

SpotShare est une application Web Node.js/Next.js (App Router) qui permet aux utilisateurs de partager et visualiser des "spots" intéressants (cafés, restaurants, vues extérieures) avec leurs amis sur une carte interactive.

## ⚙️ Stack Technique

- **Frontend** : Next.js 14+ (App Router), React, Tailwind CSS, TypeScript, Framer Motion (Animations), Lucide React (Icônes).
- **Cartographie** : Mapbox (via Token `NEXT_PUBLIC_MAPBOX_TOKEN`).
- **Backend / BDD** : Supabase (Authentification, Base de données PostgreSQL, Storage pour les avatars/photos).
- **IA / Web Scraping** : Google Generative AI (Gemini 1.5 Flash) utilisé pour extraire la localisation et les catégories à partir de liens Instagram.

## 📂 Architecture des Composants Principaux

### 🗺️ `MapView.tsx` (Carte Principale)

Gère l'affichage de Mapbox, le chargement des spots, la logique de clustering, et les appels pour les différents modaux (Ajout de spot, profil, amis).

### ✍️ `AddSpotModal.tsx` (Ajout de Spot)

Permet l'ajout de points d'intérêt sur la carte :

1. **Via Instagram** : Récupère automatiquement les données (Titre, description, `og:image`, lieu) via l'API locale `/api/instagram`. (Note : Gemini utilisé pour inférer le GPS et le Titre, mais on garde obligatoirement `og:image` du post pour éviter toute URL hallucinatoire depuis mars 2026).
2. **Manuel** : L'utilisateur recherche une adresse via Mapbox Geocoding, ajoute une description texte et upload optionnellement des photos vers le bucket Supabase `avatars/spots/`.

### 👤 `ProfileModal.tsx` (Profil utilisateur)

- Permet de gérer le pseudonyme (`username`). (Note technique : les photos de profils ont été retirées du code pour simplifier la base, donc la colonne avatar_url n'est plus utilisée).
- Réglage du **Mode Fantôme** (`is_ghost_mode`) permettant de cacher sa dernière position sur la carte à ses amis.

### 👥 `FriendsModal.tsx` (Système d'Amis)

Gère :

- La recherche d'autres utilisateurs via leur pseudonyme (`ilike username`).
- La relation d'amitié (Suivi/Abonnés), invitation envoyée, invitations reçues.
- L'affichage de la position en ligne (`isOnline`) et l'accès à la position GPS du dernier spot vu, sauf si l'ami est en Mode Fantôme.

## 🔗 APIs Locales

- **`app/api/instagram/route.ts`** : Point d'entrée backend classique qui parse le `<meta property="og:...">` d'un post IG et envoie occasionnellement le reste à Gemini API pour obtenir l'adresse GPS complète textuelle, puis renvoie la Photo Originale (+Titre+Description).

## 💾 Schéma de Base de Données Supabase (Résumé Utilisé Actuellement)

- **`profiles`** : `id`, `username`, `is_ghost_mode`, `last_active_at`, `last_lat`, `last_lng`.
- **`spots`** : `title`, `description`, `lat`, `lng`, `category`, `instagram_url`, `image_url`, `address`, `opening_hours`.
- **`followers`** / **`friend_requests`** : Gère les permissions de lecture croisées entre amis.

## 🧹 Principes et Optimisation Token/Architecture

- Mettre l'accent sur la consommation de code en privilégiant l'approche minimaliste.
- Garder le code propre pour chaque fonction : Retrait immédiat des commentaires obsolètes ("fallback SQL", etc.).
- Chaque ajout de fonctionnalité modifie ce document pour garder une synchronisation parfaite à chaque nouvelle session de l'agent.
