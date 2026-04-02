# Rétention — Notifications PWA + Feed d'activité

## Objectif

Créer un mécanisme de pull externe qui ramène les utilisateurs sur FriendSpot même quand l'app est fermée, via des push notifications système + un feed d'activité in-app temps réel.

## Contexte

L'app est actuellement 100% passive — aucune raison d'ouvrir sans initiative de l'utilisateur. Pas de notifications, pas de feed. Les utilisateurs reviennent uniquement par habitude, pas par signal externe.

---

## Architecture

```
Événement DB → Postgres Trigger → table activities
                                → Supabase Webhook → Vercel Edge Function → Web Push API → téléphone
```

---

## Base de données

### Table `activities`

```sql
CREATE TABLE public.activities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type          text NOT NULL, -- spot_added | reaction | friend_request_accepted | outing_invite
  actor_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  spot_id       uuid REFERENCES spots(id) ON DELETE SET NULL,
  outing_id     uuid REFERENCES outings(id) ON DELETE SET NULL,
  read_at       timestamptz,
  created_at    timestamptz DEFAULT now()
);

-- Index pour le feed
CREATE INDEX idx_activities_target ON activities(target_user_id, created_at DESC);

-- Cleanup auto : supprimer les activities > 60 jours
-- (via pg_cron ou trigger sur INSERT)
```

### Table `push_subscriptions`

```sql
CREATE TABLE public.push_subscriptions (
  user_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  endpoint  text NOT NULL,
  p256dh    text NOT NULL,
  auth      text NOT NULL,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, endpoint) -- N appareils par user
);
```

### Triggers Postgres

Un trigger sur chaque table source insère dans `activities` avec les guards suivants :
- **Anti-self-notif** : `IF NEW.user_id != target_user_id` (pas de notif pour ses propres actions)
- **Cooldown** : vérifier qu'il n'existe pas d'activity du même `(target_user_id, type, spot_id)` dans les 15 dernières minutes avant d'insérer

Tables déclenchantes :
- `spot_reactions` INSERT → type `reaction`, target = propriétaire du spot
- `spots` INSERT → type `spot_added`, target = tous les followers de l'acteur
- `followers` INSERT (accept) → type `friend_request_accepted`, target = le followé
- `outing_invitations` INSERT → type `outing_invite`, target = l'invité

---

## Push Notifications

### Service Worker `public/sw.js`

```js
// Recevoir le push
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      data: { url: data.url }
    })
  )
})

// Click → ouvrir l'app au bon endroit
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(clients.openWindow(event.notification.data.url))
})

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', () => clients.claim())
```

Tout le code SW est dans un `try/catch` — l'app fonctionne sans push en navigation privée ou navigateurs non compatibles.

### Edge Function `app/api/push/send/route.ts`

- Reçoit le webhook Supabase (INSERT dans `activities`)
- Récupère les `push_subscriptions` du `target_user_id`
- Envoie via `web-push` (VAPID keys en env vars)
- Si réponse `410 Gone` → `DELETE FROM push_subscriptions WHERE endpoint = $1` (subscription expirée)
- Payload : `{ title, body, url }` où `url` est `/?spot=<id>` ou `/?tab=activity`

### Route `app/api/push/subscribe/route.ts`

- `UPSERT` dans `push_subscriptions` sur `(user_id, endpoint)` — idempotent, gère multi-appareils

### Variables d'environnement requises

```
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:contact@friendspot.app
SUPABASE_WEBHOOK_SECRET=...
```

---

## Feed d'activité (in-app)

### Onglet "Activité" dans FriendsModal

Nouvel onglet entre "Amis" et "Classement" (ou remplace "Invitations" qui absorbe déjà les notifs).

**Query :**
```sql
SELECT a.*, p.username, p.avatar_url, s.title as spot_title, s.image_url as spot_image
FROM activities a
JOIN profiles p ON p.id = a.actor_id
LEFT JOIN spots s ON s.id = a.spot_id
WHERE a.target_user_id = $me
ORDER BY a.created_at DESC
LIMIT 30
```

**Format d'une ligne :**
```
[avatar] Jules a ajouté "Le Comptoir" · 2h        → tap → flyTo spot
[avatar] Thomas a aimé ton spot "Café Oberkampf" · hier
[avatar] Sara a accepté ta demande d'ami · 3j
```

**Real-time :** canal Supabase existant — s'abonner aux INSERT sur `activities WHERE target_user_id = me`.

**Badge :** compteur rouge sur le bouton FriendsModal = nombre d'activities non lues (`read_at IS NULL`). Marquer toutes comme lues à l'ouverture de l'onglet.

---

## UX Notifications

### Demande de permission

Ne jamais demander au boot. Stratégie :
1. Compteur `friendspot_open_count` dans localStorage, incrémenté à chaque montage de MapView
2. Au 3ème lancement : afficher une bannière non-intrusive en bas de l'écran
3. Si refus → ne plus jamais afficher
4. Si accord → appeler `/api/push/subscribe`

### Guide iOS

Sur iOS, les push nécessitent l'ajout à l'écran d'accueil (iOS 16.4+). Après accord de permission, si `navigator.standalone === false` sur iOS → afficher un tooltip :
*"Pour recevoir les notifs, ajoute FriendSpot à ton écran d'accueil : Partager → Sur l'écran d'accueil"*

### Toggle dans ProfileModal

Bouton "Notifications" dans les paramètres du profil — appelle `/api/push/subscribe` (on) ou supprime la subscription de l'appareil courant (off).

---

## Robustesse

| Problème | Fix |
|---|---|
| Spam (20 reactions = 20 notifs) | Cooldown 15min par `(target, type, spot_id)` dans le trigger |
| Subscription expirée | 410 Gone → DELETE automatique dans l'Edge Function |
| Multi-appareils | PK composite `(user_id, endpoint)` |
| Permission bloquée définitivement | Bannière seulement au 3ème lancement, jamais au boot |
| Auto-notification | Guard `actor_id != target_user_id` dans chaque trigger |
| Spot supprimé | `spot_id FK ON DELETE SET NULL` + afficher "[spot supprimé]" dans le feed |
| SW en navigation privée | Tout dans `try/catch`, app fonctionnelle sans SW |
| Click notif → mauvaise page | Payload contient `url`, SW fait `clients.openWindow(url)` |
| RGPD suppression compte | CASCADE sur `user_id` dans `activities` et `push_subscriptions` |
| Feed infini | Cron ou trigger cleanup `activities > 60 jours` |

---

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `supabase/migrations/20260402_activities.sql` | Tables + triggers + indexes + cleanup |
| `public/sw.js` | Nouveau service worker |
| `app/api/push/send/route.ts` | Edge function Web Push + gestion 410 |
| `app/api/push/subscribe/route.ts` | Upsert subscription |
| `components/map/FriendsModal.tsx` | Onglet Activité + real-time + badge |
| `components/map/MapView.tsx` | Compteur lancements + bannière permission |
| `components/map/ProfileModal.tsx` | Toggle notifications |

## Hors scope

- Sous-projet 2 : Recommandation intelligente + Spots tendance all-time (spec séparé)
- Notifications email
- Paramètres de notif par type (ex: désactiver seulement les reactions)
- App Store / React Native
