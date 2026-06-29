# Refonte responsive premium — lecabanondaix.fr

Date : 2026-06-30
Source : `prompt-claude-code-lecabanondaix.md` (brief client) + audit Phase 0 + clarifications utilisateur

## 1. Objectif

Rendre `lecabanondaix.fr` net et premium sur mobile/tablette/desktop, supprimer les doublons de contenu, et afficher de vrais avis Google — sans rien casser (calendrier Airbnb, calcul de prix, formulaire de réservation, SEO, ancres internes).

## 2. Constraintes absolues (rappel)

- Calendrier Airbnb synchronisé + statuts dispo/sélectionné/réservé : intact.
- Calcul de prix dynamique (saison/durée/options) : intact.
- Formulaire de réservation + envoi (Stripe checkout) : intact.
- Tous les liens internes/ancres (`#lieu`, `#confort`, `#avis`, pages `/que-faire`, etc.) : intacts.
- SEO existant (meta, h1, alt, JSON-LD) : intact.
- Aucune clé API en clair côté client.
- Pas de framework lourd. On reste HTML/CSS/JS vanilla + PHP existant.

## 3. Constat d'audit (résumé)

- **Bug critique** : à `max-width: 680px`, `styles.css` masque entièrement `.intro`, `.decision`, `.surroundings`, `.faq` (`display: none`). Ces sections (Le lieu, Avant de réserver, Autour, FAQ) sont invisibles sur mobile.
- **Doublon réel** : `.guide-links` (3 liens texte) redondant avec les 3 cartes `.place` déjà affichées dans `#alentours`.
- **Pas de doublon de nav** : `.main-nav` (desktop) et `.mobile-nav` (overlay) sont deux variantes responsive légitimes, pas un bug.
- **Avis Google** : `google-reviews.php` est déjà correctement architecturé (clé + place_id côté serveur via `getenv()`, aucune exposition client). Il ne fonctionne pas faute de variables d'environnement configurées.
- **Pas de palier tablette explicite** : le CSS saute de mobile à desktop à 980px, sans grille 2 colonnes intermédiaire (640–1023px) telle que demandée par le brief.
- **Typographie** : Georgia (titres) + Inter (corps), `font-weight` à valeurs non standards (760/780/820/850).
- **Boutons** : `min-height: 46px`, sous le seuil tactile recommandé de 48px.
- **Images** : pas de `loading="lazy"` hors hero, pas de `srcset`, formats `.jpg`/`.jpeg` non convertis en WebP.

## 4. Décisions d'architecture

### 4.1 Design tokens
Consolider les variables CSS existantes (palette pine/cream/clay/stone conservée — identité du logo) avec le système du brief : `--gutter` responsive (20px mobile → 32px tablette → 48px desktop), `--container: 1160px` (garde la valeur existante `--max`), espacement grille 8pt, `--r-card`/`--r-btn`/`--r-pill`, `--shadow` unique. Renommer/étendre `:root` dans `styles.css`, ne pas dupliquer dans `site-pages.css` (vérifier le partage entre les deux fichiers CSS).

### 4.2 Typographie
**Fraunces** (titres, remplace Georgia) + **Inter** (corps, conservé), chargées via Google Fonts avec `font-display: swap`. Poids standardisés sur l'échelle classique (400/500/600/700/800) — élimine les valeurs non standards actuelles (760/780/820/850/900).

### 4.3 Breakpoints
Trois paliers explicites :
- Mobile : `< 640px`
- Tablette : `640px – 1023px` (nouveau palier à créer — actuellement absent)
- Desktop : `≥ 1024px`

Migration depuis les breakpoints actuels (980px / 680px) vers ce système à trois paliers, en conservant le comportement desktop existant au-delà de 1024px.

### 4.4 Avis Google
- Clé API et Place ID confirmés et fonctionnels (5/5, 10 avis) :
  - `GOOGLE_PLACES_API_KEY` = (fournie par l'utilisateur, à ne jamais committer)
  - `GOOGLE_PLACE_ID` = `ChIJk7p2_R-NyRIRC4R3xuyZaR0`
- Pas de `.env` disponible → configuration via `.htaccess` (`SetEnv GOOGLE_PLACES_API_KEY ...`, `SetEnv GOOGLE_PLACE_ID ...`), suppose un hébergement Apache (à confirmer en implémentation ; fallback `php.ini`/panel hébergeur si Apache indisponible).
- `google-reviews.php` modifié pour écrire/lire un cache fichier local (`reviews-cache.json`, à la racine du site comme les autres scripts PHP, accès direct bloqué via une règle `.htaccess` `<Files reviews-cache.json> Require all denied </Files>`) avec TTL ~6h : sert le cache si frais, sinon rappelle l'API Google Places et réécrit le cache. Pas de dépendance serverless/GitHub Action.
- Affichage : en-tête (note moyenne + nb avis + logo Google + lien Maps), cartes 3–5 avis (étoiles, date relative, texte non modifié, troncature propre), carrousel scroll-snap mobile / grille 2-3 col desktop, fallback lien Google si vide.

### 4.5 Sections à corriger (priorité)
1. **Restaurer sur mobile** (au lieu de `display:none`) : `.intro` (Le lieu), `.decision` (Avant de réserver), `.surroundings` (Autour), `.faq` — chacune avec sa propre mise en page mobile (empilée), pas la mise en page desktop écrasée.
2. **Supprimer** `.guide-links` (doublon des cartes `.place`).
3. **Réduire** le bloc `.reservation` (teaser) à 3 puces de réassurance + CTA, sans re-détail de prix (déjà présent en `#tarifs`).
4. Tout le reste suit le détail section-par-section du brief (`prompt-claude-code-lecabanondaix.md`, Phase 5), qui fait foi pour les specs visuelles (hero, photos, confort, tarifs, modal de réservation, footer).

### 4.6 Accessibilité & performance
Suit le brief Phase 6 tel quel : contrastes AA, cibles tactiles ≥44px, focus visibles, `aria-*` sur menu/accordéon/modal, `width`/`height` explicites sur images, `loading="lazy"` hors hero, `srcset`, conversion WebP, `hover` derrière `@media (hover:hover)`, `prefers-reduced-motion` (déjà partiellement géré).

## 5. Stratégie d'exécution

Approche **B — phases avec vérification à chaque étape** (validée avec l'utilisateur), dans cet ordre :

1. Design tokens (palette, espacement, rayons, ombres) appliqués globalement.
2. Fix du bug critique mobile (sections masquées) + breakpoint tablette.
3. Typographie (Fraunces + Inter, poids standardisés).
4. Intégration avis Google (cache fichier PHP + `.htaccess`).
5. Révision section par section (suppression doublons, alignement, cartes homogènes).
6. Accessibilité & performance (images, focus, contrastes, hover).

Après **chaque** étape : vérifier que le calendrier Airbnb, le calcul de prix et l'envoi du formulaire fonctionnent toujours, et tester aux paliers 360/390/430 (mobile), 768/1024 (tablette), 1280/1440 (desktop).

## 6. Critères d'acceptation

Voir la checklist finale du brief (`prompt-claude-code-lecabanondaix.md`, section "Critères d'acceptation") — reprise telle quelle comme définition de "done" pour ce projet.

## 7. Hors scope

- Pas de migration vers un framework JS/CSS.
- Pas de refonte du contenu éditorial des pages secondaires (`que-faire-*.html`, `week-end-*.html`, etc.) — uniquement `index.html` + CSS/JS partagés, sauf si un breakpoint partagé (header/footer/site-pages.css) doit être ajusté pour cohérence.
- Pas de mise en place de cache serverless/GitHub Actions pour les avis (cache fichier PHP suffisant pour le volume).
