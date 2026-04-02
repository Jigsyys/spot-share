# Rétention — Notifications PWA + Feed d'activité — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter des push notifications PWA système + un feed d'activité temps réel dans l'onglet Activité de FriendsModal pour ramener les utilisateurs sur FriendSpot même app fermée.

**Architecture:** Postgres triggers insèrent dans `activities` → Supabase Database Webhook → Vercel Edge Function (`/api/push/send`) → `web-push` → téléphone. In-app feed via query Supabase + Realtime sur `activities`. Service worker `public/sw.js` gère réception push + click → navigation.

**Tech Stack:** Next.js 16, Supabase (Postgres triggers + Realtime + Database Webhooks), `web-push` + `@types/web-push`, PWA Service Worker (Web Push API), Tailwind CSS, TypeScript

---

## Fichiers créés / modifiés

| Fichier | Rôle |
|---|---|
| `supabase/migrations/20260402_activities.sql` | Tables activities + push_subscriptions + RLS + triggers |
| `lib/types.ts` | Ajout type `Activity` |
| `lib/supabase/service.ts` | Client Supabase service role (pour webhook sans session) |
| `public/sw.js` | Service worker : push → notif système + click → navigation |
| `app/api/push/subscribe/route.ts` | POST/DELETE : enregistrer / supprimer une push subscription |
| `app/api/push/send/route.ts` | POST webhook Supabase → envoie push via web-push |
| `components/map/FriendsModal.tsx` | Feed notifications en haut de l'onglet Activité + badge unread |
| `components/map/MapView.tsx` | Register SW + bannière permission (après 3e ouverture) |
| `components/map/ProfileModal.tsx` | Toggle activer / désactiver les notifications |

---

### Task 1 — Installer web-push + générer les clés VAPID

**Files:**
- Modify: `package.json` (via npm)
- Modify: `.env.local`

- [ ] **Step 1 : Installer les dépendances**

```bash
cd spot-share-main
npm install web-push
npm install --save-dev @types/web-push
```

Résultat attendu : `web-push` apparaît dans `dependencies`, `@types/web-push` dans `devDependencies`.

- [ ] **Step 2 : Générer les clés VAPID**

```bash
npx web-push generate-vapid-keys
```

Résultat attendu :
```
Public Key: BxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxYYY=
Private Key: zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz=
```

Copier les deux valeurs.

- [ ] **Step 3 : Ajouter les variables dans .env.local**

Ajouter à `.env.local` (remplacer par les valeurs générées) :
```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=BxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxYYY=
VAPID_PRIVATE_KEY=zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz=
VAPID_SUBJECT=mailto:contact@friendspot.app
SUPABASE_WEBHOOK_SECRET=un-secret-aleatoire-a-choisir
```

`SUPABASE_WEBHOOK_SECRET` : générer une chaîne aléatoire (ex: `openssl rand -hex 32`).

- [ ] **Step 4 : Ajouter les mêmes variables dans Vercel**

Dans le dashboard Vercel → Settings → Environment Variables, ajouter les 4 variables ci-dessus pour Production + Preview.
`NEXT_PUBLIC_VAPID_PUBLIC_KEY` doit être en mode "Plaintext" (pas secret) car elle est lue côté client.

- [ ] **Step 5 : Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: install web-push for PWA push notifications"
```

---

### Task 2 — Migration DB : tables + RLS + triggers

**Files:**
- Create: `supabase/migrations/20260402_activities.sql`

- [ ] **Step 1 : Créer le fichier de migration**

Créer `supabase/migrations/20260402_activities.sql` avec ce contenu exact :

```sql
-- ═══════════════════════════════════════════════════════
-- Table activities
-- ═══════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.activities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type           text NOT NULL CHECK (type IN ('spot_added','reaction','friend_request_accepted','outing_invite')),
  actor_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  spot_id        uuid REFERENCES public.spots(id) ON DELETE SET NULL,
  outing_id      uuid REFERENCES public.outings(id) ON DELETE SET NULL,
  read_at        timestamptz,
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activities_target
  ON public.activities(target_user_id, created_at DESC);

-- ═══════════════════════════════════════════════════════
-- Table push_subscriptions
-- ═══════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint   text NOT NULL,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, endpoint)
);

-- ═══════════════════════════════════════════════════════
-- RLS
-- ═══════════════════════════════════════════════════════
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- activities : lire uniquement ses propres notifs
CREATE POLICY "activities_select_own" ON public.activities
  FOR SELECT USING (target_user_id = auth.uid());

-- activities : marquer comme lu (UPDATE read_at)
CREATE POLICY "activities_update_own" ON public.activities
  FOR UPDATE USING (target_user_id = auth.uid());

-- push_subscriptions : CRUD sur ses propres rows
CREATE POLICY "push_sub_all_own" ON public.push_subscriptions
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════
-- Grants pour les triggers SECURITY DEFINER
-- ═══════════════════════════════════════════════════════
GRANT INSERT ON public.activities TO postgres;

-- ═══════════════════════════════════════════════════════
-- Trigger 1 : reaction → activity (avec cooldown 15min)
-- ═══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.on_reaction_inserted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner uuid;
BEGIN
  SELECT user_id INTO v_owner FROM spots WHERE id = NEW.spot_id;
  -- Pas de notif si pas de spot trouvé ou auto-reaction
  IF v_owner IS NULL OR v_owner = NEW.user_id THEN RETURN NEW; END IF;
  -- Cooldown : 1 notif max par (owner, spot) toutes les 15 min
  IF EXISTS (
    SELECT 1 FROM activities
    WHERE target_user_id = v_owner AND type = 'reaction'
      AND spot_id = NEW.spot_id
      AND created_at > now() - interval '15 minutes'
  ) THEN RETURN NEW; END IF;

  INSERT INTO activities (type, actor_id, target_user_id, spot_id)
  VALUES ('reaction', NEW.user_id, v_owner, NEW.spot_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reaction_inserted ON public.spot_reactions;
CREATE TRIGGER trg_reaction_inserted
  AFTER INSERT ON public.spot_reactions
  FOR EACH ROW EXECUTE FUNCTION public.on_reaction_inserted();

-- ═══════════════════════════════════════════════════════
-- Trigger 2 : spot ajouté → activity pour tous les followers
-- ═══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.on_spot_inserted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO activities (type, actor_id, target_user_id, spot_id)
  SELECT 'spot_added', NEW.user_id, f.follower_id, NEW.id
  FROM followers f
  WHERE f.following_id = NEW.user_id
    AND f.follower_id != NEW.user_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_spot_inserted ON public.spots;
CREATE TRIGGER trg_spot_inserted
  AFTER INSERT ON public.spots
  FOR EACH ROW EXECUTE FUNCTION public.on_spot_inserted();

-- ═══════════════════════════════════════════════════════
-- Trigger 3 : demande d'ami acceptée
-- ═══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.on_friend_request_accepted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'accepted' AND OLD.status = 'pending' THEN
    -- Notifier la personne qui avait envoyé la demande (from_id)
    INSERT INTO activities (type, actor_id, target_user_id)
    VALUES ('friend_request_accepted', NEW.to_id, NEW.from_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_friend_request_accepted ON public.friend_requests;
CREATE TRIGGER trg_friend_request_accepted
  AFTER UPDATE ON public.friend_requests
  FOR EACH ROW EXECUTE FUNCTION public.on_friend_request_accepted();

-- ═══════════════════════════════════════════════════════
-- Trigger 4 : invitation à une sortie
-- ═══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.on_outing_invite_inserted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_creator uuid;
  v_spot    uuid;
BEGIN
  SELECT creator_id, spot_id INTO v_creator, v_spot FROM outings WHERE id = NEW.outing_id;
  IF v_creator IS NULL THEN RETURN NEW; END IF;

  INSERT INTO activities (type, actor_id, target_user_id, spot_id, outing_id)
  VALUES ('outing_invite', v_creator, NEW.invitee_id, v_spot, NEW.outing_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_outing_invite_inserted ON public.outing_invitations;
CREATE TRIGGER trg_outing_invite_inserted
  AFTER INSERT ON public.outing_invitations
  FOR EACH ROW EXECUTE FUNCTION public.on_outing_invite_inserted();

-- ═══════════════════════════════════════════════════════
-- Realtime sur activities
-- ═══════════════════════════════════════════════════════
ALTER TABLE public.activities REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE activities;

-- ═══════════════════════════════════════════════════════
-- Cleanup : supprimer les activities > 60 jours
-- (à appeler manuellement ou via pg_cron si disponible)
-- ═══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cleanup_old_activities()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.activities WHERE created_at < now() - interval '60 days';
$$;
```

- [ ] **Step 2 : Appliquer la migration via Supabase MCP**

```
mcp__supabase__apply_migration({ name: "20260402_activities", query: <contenu du fichier> })
```

Ou via SQL Editor dans le dashboard Supabase.

- [ ] **Step 3 : Vérifier les tables créées**

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('activities', 'push_subscriptions');
```

Résultat attendu : 2 rows.

- [ ] **Step 4 : Commit**

```bash
git add supabase/migrations/20260402_activities.sql
git commit -m "db: add activities + push_subscriptions tables with triggers and RLS"
```

---

### Task 3 — Service worker public/sw.js

**Files:**
- Create: `public/sw.js`

- [ ] **Step 1 : Créer public/sw.js**

```js
// public/sw.js
// Service worker FriendSpot — push notifications PWA

self.addEventListener('push', (event) => {
  let data = { title: 'FriendSpot', body: 'Nouvelle activité', url: '/' }
  try {
    if (event.data) data = { ...data, ...event.data.json() }
  } catch { /* ignore parse error */ }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url },
      vibrate: [100, 50, 100],
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url ?? '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Si l'app est déjà ouverte, focus + navigate
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus()
          if ('navigate' in client) client.navigate(url)
          return
        }
      }
      // Sinon ouvrir une nouvelle fenêtre
      if (clients.openWindow) return clients.openWindow(url)
    })
  )
})

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim())
})
```

- [ ] **Step 2 : Vérifier qu'un fichier icon-192.png existe**

```bash
ls public/icon-192.png
```

S'il n'existe pas, créer un placeholder ou utiliser une icône existante dans `public/`. Modifier `icon: '/icon-192.png'` dans sw.js pour pointer vers l'icône existante (ex: `/favicon.ico`).

- [ ] **Step 3 : Commit**

```bash
git add public/sw.js
git commit -m "feat: add PWA service worker for push notifications"
```

---

### Task 4 — Service client Supabase + route subscribe/unsubscribe

**Files:**
- Create: `lib/supabase/service.ts`
- Create: `app/api/push/subscribe/route.ts`

- [ ] **Step 1 : Créer lib/supabase/service.ts**

```ts
// lib/supabase/service.ts
import { createClient } from "@supabase/supabase-js"

// Client service role — bypass RLS, utilisé uniquement côté serveur (webhooks)
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis")
  return createClient(url, key)
}
```

- [ ] **Step 2 : Ajouter SUPABASE_SERVICE_ROLE_KEY dans .env.local**

Récupérer la clé dans Supabase Dashboard → Settings → API → service_role key.
Ajouter à `.env.local` :
```
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
```
Ajouter aussi dans Vercel (Settings → Environment Variables) comme variable **secrète** (pas NEXT_PUBLIC_).

- [ ] **Step 3 : Créer app/api/push/subscribe/route.ts**

```ts
// app/api/push/subscribe/route.ts
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 })

    const { endpoint, p256dh, auth } = await req.json()
    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json({ error: "endpoint, p256dh et auth requis" }, { status: 400 })
    }

    const { error } = await supabase
      .from("push_subscriptions")
      .upsert(
        { user_id: user.id, endpoint, p256dh, auth },
        { onConflict: "user_id,endpoint" }
      )

    if (error) {
      console.error("push subscribe error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("push subscribe exception:", err)
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 })

    const { endpoint } = await req.json()
    if (!endpoint) return NextResponse.json({ error: "endpoint requis" }, { status: 400 })

    await supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_id", user.id)
      .eq("endpoint", endpoint)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("push unsubscribe exception:", err)
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 })
  }
}
```

- [ ] **Step 4 : Vérifier TypeScript**

Utiliser `getDiagnostics` sur `lib/supabase/service.ts` et `app/api/push/subscribe/route.ts`.
Résultat attendu : 0 erreur.

- [ ] **Step 5 : Commit**

```bash
git add lib/supabase/service.ts app/api/push/subscribe/route.ts
git commit -m "feat: add Supabase service client and push subscribe/unsubscribe route"
```

---

### Task 5 — Route push/send (webhook Supabase → Web Push)

**Files:**
- Create: `app/api/push/send/route.ts`

- [ ] **Step 1 : Créer app/api/push/send/route.ts**

```ts
// app/api/push/send/route.ts
import { NextRequest, NextResponse } from "next/server"
import webpush from "web-push"
import { createServiceClient } from "@/lib/supabase/service"

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
)

type ActivityType = "spot_added" | "reaction" | "friend_request_accepted" | "outing_invite"

function buildMessage(type: ActivityType, actorName: string): { title: string; body: string } {
  switch (type) {
    case "spot_added":
      return { title: "Nouveau spot 📍", body: `${actorName} a ajouté un nouveau lieu` }
    case "reaction":
      return { title: "❤️ Quelqu'un aime ton spot", body: `${actorName} a aimé un de tes spots` }
    case "friend_request_accepted":
      return { title: "Nouvel ami 🤝", body: `${actorName} a accepté ta demande d'ami` }
    case "outing_invite":
      return { title: "Invitation à une sortie 🎉", body: `${actorName} t'invite à une sortie` }
  }
}

export async function POST(req: NextRequest) {
  try {
    // Vérifier le secret webhook
    const secret = req.headers.get("x-webhook-secret")
    if (secret !== process.env.SUPABASE_WEBHOOK_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await req.json()
    // Supabase envoie { type: "INSERT", record: {...}, ... }
    if (body.type !== "INSERT") return NextResponse.json({ ok: true })

    const activity = body.record as {
      id: string
      type: ActivityType
      actor_id: string
      target_user_id: string
      spot_id: string | null
      outing_id: string | null
    }

    const supabase = createServiceClient()

    // Récupérer le profil de l'acteur
    const { data: actor } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", activity.actor_id)
      .single()

    // Récupérer les subscriptions push du destinataire
    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", activity.target_user_id)

    if (!subs?.length) return NextResponse.json({ ok: true })

    const actorName = actor?.username ?? "Un ami"
    const { title, body: msgBody } = buildMessage(activity.type, actorName)
    const url = activity.spot_id ? `/?spot=${activity.spot_id}` : `/?tab=activity`
    const payload = JSON.stringify({ title, body: msgBody, url })

    // Envoyer à tous les appareils du destinataire
    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            { TTL: 86400 } // 24h
          )
        } catch (err: unknown) {
          const e = err as { statusCode?: number }
          // 410 Gone = subscription expirée → supprimer
          if (e.statusCode === 410 || e.statusCode === 404) {
            await supabase
              .from("push_subscriptions")
              .delete()
              .eq("endpoint", sub.endpoint)
          }
        }
      })
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("push send exception:", err)
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 })
  }
}
```

- [ ] **Step 2 : Vérifier TypeScript**

`getDiagnostics` sur `app/api/push/send/route.ts`.
Résultat attendu : 0 erreur.

- [ ] **Step 3 : Configurer le Supabase Database Webhook (étape manuelle)**

Dans le dashboard Supabase → Database → Webhooks → Create a new hook :
- **Name:** `activities_push_send`
- **Table:** `activities`
- **Events:** ✅ INSERT
- **Type:** HTTP Request
- **URL:** `https://spot-share-kappa.vercel.app/api/push/send`
- **HTTP Headers:** ajouter `x-webhook-secret` = valeur de `SUPABASE_WEBHOOK_SECRET`

- [ ] **Step 4 : Commit**

```bash
git add app/api/push/send/route.ts
git commit -m "feat: add push send webhook route with VAPID + 410 cleanup"
```

---

### Task 6 — Feed d'activité dans FriendsModal (onglet Activité)

**Files:**
- Modify: `lib/types.ts`
- Modify: `components/map/FriendsModal.tsx`

- [ ] **Step 1 : Ajouter le type Activity dans lib/types.ts**

Ajouter à la fin de `lib/types.ts` :

```ts
export interface Activity {
  id: string
  type: "spot_added" | "reaction" | "friend_request_accepted" | "outing_invite"
  actor_id: string
  target_user_id: string
  spot_id: string | null
  outing_id: string | null
  read_at: string | null
  created_at: string
  // champs joints
  actor_username: string | null
  actor_avatar_url: string | null
  spot_title: string | null
  spot_image_url: string | null
}
```

- [ ] **Step 2 : Ajouter les imports dans FriendsModal.tsx**

Lire la ligne 1 de `components/map/FriendsModal.tsx` pour voir les imports existants.
Ajouter `Activity` à l'import de `lib/types` :
```ts
import type { ..., Activity } from "@/lib/types"
```

- [ ] **Step 3 : Ajouter le state activities dans FriendsModal**

Dans la section `// ── Data state ──` (autour de la ligne 237), ajouter :
```ts
const [activities, setActivities] = useState<Activity[]>([])
const [activitiesLoading, setActivitiesLoading] = useState(false)
const [unreadCount, setUnreadCount] = useState(0)
```

- [ ] **Step 4 : Ajouter la fonction loadActivities**

Après les autres fonctions de chargement dans FriendsModal, ajouter :

```ts
const loadActivities = useCallback(async () => {
  if (!currentUser) return
  setActivitiesLoading(true)
  try {
    const supabase = createClient()
    const { data, error } = await supabase
      .from("activities")
      .select(`
        id, type, actor_id, target_user_id, spot_id, outing_id, read_at, created_at,
        actor:profiles!activities_actor_id_fkey(username, avatar_url),
        spot:spots!activities_spot_id_fkey(title, image_url)
      `)
      .eq("target_user_id", currentUser.id)
      .order("created_at", { ascending: false })
      .limit(30)

    if (error) { console.error("loadActivities:", error); return }

    const mapped: Activity[] = (data ?? []).map((row: Record<string, unknown>) => {
      const actor = row.actor as { username: string | null; avatar_url: string | null } | null
      const spot = row.spot as { title: string | null; image_url: string | null } | null
      return {
        id: row.id as string,
        type: row.type as Activity["type"],
        actor_id: row.actor_id as string,
        target_user_id: row.target_user_id as string,
        spot_id: row.spot_id as string | null,
        outing_id: row.outing_id as string | null,
        read_at: row.read_at as string | null,
        created_at: row.created_at as string,
        actor_username: actor?.username ?? null,
        actor_avatar_url: actor?.avatar_url ?? null,
        spot_title: spot?.title ?? null,
        spot_image_url: spot?.image_url ?? null,
      }
    })

    setActivities(mapped)
    setUnreadCount(mapped.filter(a => !a.read_at).length)
  } finally {
    setActivitiesLoading(false)
  }
}, [currentUser])
```

- [ ] **Step 5 : Charger les activités quand l'onglet Activité s'ouvre**

Trouver l'useEffect qui charge le classement (ligne ~696) :
```ts
useEffect(() => {
  if (activeTab !== "activite" || !isOpen) return
  // ... chargement classement
```

Ajouter `loadActivities()` au début de cet effect :
```ts
useEffect(() => {
  if (activeTab !== "activite" || !isOpen) return
  loadActivities()
  // ... reste du chargement classement existant
```

- [ ] **Step 6 : Marquer les activités comme lues à l'ouverture de l'onglet**

Dans le même useEffect, après `loadActivities()`, ajouter :
```ts
// Marquer tout comme lu
if (currentUser) {
  createClient()
    .from("activities")
    .update({ read_at: new Date().toISOString() })
    .eq("target_user_id", currentUser.id)
    .is("read_at", null)
    .then(() => setUnreadCount(0))
}
```

- [ ] **Step 7 : Abonnement Realtime activities**

Dans l'useEffect qui gère les canaux Realtime existants dans FriendsModal (chercher `supabase.channel` avec grep), ajouter un nouveau canal. S'il n'y a pas de canal Realtime centralisé, ajouter un useEffect dédié :

```ts
useEffect(() => {
  if (!isOpen || !currentUser) return
  const supabase = createClient()
  const channel = supabase
    .channel(`activities-${currentUser.id}`)
    .on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: "activities",
      filter: `target_user_id=eq.${currentUser.id}`,
    }, (payload) => {
      // Incrémenter le badge si l'onglet activité n'est pas actif
      if (activeTab !== "activite") {
        setUnreadCount(prev => prev + 1)
      }
      // Recharger le feed si l'onglet est ouvert
      if (activeTab === "activite") loadActivities()
    })
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}, [isOpen, currentUser, activeTab, loadActivities])
```

- [ ] **Step 8 : Ajouter le badge unread sur l'onglet Activité**

Lire les lignes 1200-1204 pour voir le rendu des tabs.
La définition du tab activite est :
```ts
{ id: "activite", label: "Activité", icon: <Bell size={12} /> },
```

Trouver où le label du tab est rendu (grep `tab.label` dans FriendsModal). Dans le rendu du tab button, modifier pour afficher le badge :

```tsx
{tab.id === "activite" && unreadCount > 0 ? (
  <span className="relative">
    {tab.label}
    <span className="absolute -top-1 -right-3 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
      {unreadCount > 9 ? "9+" : unreadCount}
    </span>
  </span>
) : tab.label}
```

- [ ] **Step 9 : Ajouter le feed UI en haut de l'onglet activite**

Lire les lignes 1649-1660 pour voir où commence le contenu de l'onglet activite.
Ajouter AVANT la section `{/* ── Classement mensuel ─────────────────────── */}` :

```tsx
{/* ── Feed notifications ────────────────────── */}
<div>
  <p className="text-[16px] font-bold text-gray-900 dark:text-white mb-3">Notifications</p>
  {activitiesLoading ? (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 animate-pulse">
          <div className="h-9 w-9 rounded-full bg-gray-200 dark:bg-zinc-700 flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-48 rounded bg-gray-200 dark:bg-zinc-700" />
            <div className="h-2.5 w-24 rounded bg-gray-100 dark:bg-zinc-800" />
          </div>
        </div>
      ))}
    </div>
  ) : activities.length === 0 ? (
    <div className="py-6 text-center text-sm text-gray-400 dark:text-zinc-500">
      Aucune activité récente
    </div>
  ) : (
    <div className="space-y-1">
      {activities.map((activity) => (
        <ActivityRow
          key={activity.id}
          activity={activity}
          onSelectSpot={onSelectSpot}
        />
      ))}
    </div>
  )}
</div>
```

- [ ] **Step 10 : Ajouter le composant ActivityRow dans FriendsModal**

Ajouter ce composant local juste avant le `export default function FriendsModal` :

```tsx
function ActivityRow({
  activity,
  onSelectSpot,
}: {
  activity: Activity
  onSelectSpot?: (spotId: string) => void
}) {
  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime()
    const min = Math.floor(diff / 60000)
    if (min < 60) return `${min}m`
    const h = Math.floor(min / 60)
    if (h < 24) return `${h}h`
    return `${Math.floor(h / 24)}j`
  }

  const text = () => {
    const name = activity.actor_username ?? "Quelqu'un"
    switch (activity.type) {
      case "spot_added": return `${name} a ajouté un nouveau spot`
      case "reaction": return `${name} a aimé ton spot${activity.spot_title ? ` "${activity.spot_title}"` : ""}`
      case "friend_request_accepted": return `${name} a accepté ta demande d'ami`
      case "outing_invite": return `${name} t'invite à une sortie`
    }
  }

  const handleClick = () => {
    if (activity.spot_id && onSelectSpot) onSelectSpot(activity.spot_id)
  }

  return (
    <button
      onClick={handleClick}
      className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-zinc-800/60 active:scale-[0.98]"
    >
      {activity.actor_avatar_url ? (
        <img
          src={activity.actor_avatar_url}
          alt=""
          className="h-9 w-9 rounded-full object-cover flex-shrink-0"
        />
      ) : (
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-sm font-bold text-indigo-600 dark:text-indigo-400">
          {(activity.actor_username ?? "?")[0].toUpperCase()}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-gray-800 dark:text-zinc-200 leading-snug line-clamp-2">
          {text()}
        </p>
        <p className="mt-0.5 text-[11px] text-gray-400 dark:text-zinc-500">
          {timeAgo(activity.created_at)}
        </p>
      </div>
      {!activity.read_at && (
        <div className="h-2 w-2 rounded-full bg-indigo-500 flex-shrink-0" />
      )}
    </button>
  )
}
```

- [ ] **Step 11 : Vérifier TypeScript**

`getDiagnostics` sur `components/map/FriendsModal.tsx` et `lib/types.ts`.
Résultat attendu : 0 erreur.

- [ ] **Step 12 : Commit**

```bash
git add lib/types.ts components/map/FriendsModal.tsx
git commit -m "feat: activity feed in FriendsModal Activité tab with realtime + unread badge"
```

---

### Task 7 — MapView : register service worker + bannière permission

**Files:**
- Modify: `components/map/MapView.tsx`

- [ ] **Step 1 : Ajouter l'utilitaire d'enregistrement SW et subscription**

Lire `components/map/MapView.tsx` lignes 1-60 pour identifier où ajouter les fonctions utilitaires.
Après les constantes CACHE_TTL (lignes ~55-58), ajouter :

```ts
// ─── Push notifications helpers ─────────────────────────────────────────────
async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null
  try {
    const reg = await navigator.serviceWorker.register("/sw.js")
    return reg
  } catch { return null }
}

async function subscribeToPush(reg: ServiceWorkerRegistration): Promise<void> {
  try {
    const existing = await reg.pushManager.getSubscription()
    const sub = existing ?? await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    })
    const { endpoint, keys } = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint, p256dh: keys.p256dh, auth: keys.auth }),
    })
  } catch { /* ignore — user bloqué ou SW non dispo */ }
}
```

- [ ] **Step 2 : Ajouter le state bannière et le compteur de lancements**

Dans la section des useState de MapView (autour de la ligne 340), ajouter :
```ts
const [showPushBanner, setShowPushBanner] = useState(false)
const swRegRef = useRef<ServiceWorkerRegistration | null>(null)
```

- [ ] **Step 3 : Ajouter l'useEffect de SW registration**

Après l'useEffect `themeRef` (autour de la ligne 399), ajouter :
```ts
// Enregistrer le service worker + logique bannière permission
useEffect(() => {
  if (!user) return
  registerServiceWorker().then(reg => { swRegRef.current = reg })

  // Afficher la bannière après le 3ème lancement (jamais au premier)
  try {
    const count = parseInt(localStorage.getItem("friendspot_open_count") ?? "0", 10) + 1
    localStorage.setItem("friendspot_open_count", String(count))
    const alreadyDismissed = localStorage.getItem("friendspot_push_dismissed")
    if (count >= 3 && !alreadyDismissed && Notification.permission === "default") {
      setShowPushBanner(true)
    }
  } catch { /* ignore */ }
}, [user])
```

- [ ] **Step 4 : Ajouter les handlers bannière**

Près des autres useCallback handlers de MapView, ajouter :
```ts
const handlePushAccept = useCallback(async () => {
  setShowPushBanner(false)
  try { localStorage.setItem("friendspot_push_dismissed", "1") } catch {}
  const perm = await Notification.requestPermission()
  if (perm === "granted" && swRegRef.current) {
    await subscribeToPush(swRegRef.current)
    toast.success("Notifications activées !")
  }
}, [])

const handlePushDismiss = useCallback(() => {
  setShowPushBanner(false)
  try { localStorage.setItem("friendspot_push_dismissed", "1") } catch {}
}, [])
```

- [ ] **Step 5 : Ajouter la bannière dans le JSX**

Chercher dans MapView.tsx la zone où les toasts/banners sont affichés (grep `AnimatePresence` pour trouver les zones d'overlays). Ajouter la bannière juste avant la fermeture du `<main>` ou du dernier div du return :

```tsx
{/* Bannière permission push notifications */}
<AnimatePresence>
  {showPushBanner && (
    <motion.div
      initial={{ y: 80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 80, opacity: 0 }}
      className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 w-[calc(100%-2rem)] max-w-sm"
    >
      <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 shadow-xl p-4">
        <p className="text-sm font-semibold text-gray-900 dark:text-white mb-0.5">
          🔔 Ne rate rien
        </p>
        <p className="text-xs text-gray-500 dark:text-zinc-400 mb-3">
          Active les notifications pour savoir quand tes amis ajoutent des spots.
        </p>
        <div className="flex gap-2">
          <button
            onClick={handlePushAccept}
            className="flex-1 rounded-xl bg-indigo-500 py-2 text-xs font-semibold text-white hover:bg-indigo-400 transition-colors"
          >
            Activer
          </button>
          <button
            onClick={handlePushDismiss}
            className="rounded-xl px-3 py-2 text-xs text-gray-400 dark:text-zinc-500 hover:text-gray-600 transition-colors"
          >
            Plus tard
          </button>
        </div>
      </div>
    </motion.div>
  )}
</AnimatePresence>
```

- [ ] **Step 6 : Vérifier TypeScript**

`getDiagnostics` sur `components/map/MapView.tsx`.
Résultat attendu : 0 erreur.

- [ ] **Step 7 : Commit**

```bash
git add components/map/MapView.tsx
git commit -m "feat: register service worker and show push permission banner on 3rd launch"
```

---

### Task 8 — ProfileModal : toggle notifications

**Files:**
- Modify: `components/map/ProfileModal.tsx`

- [ ] **Step 1 : Lire la structure de ProfileModal**

Lire `components/map/ProfileModal.tsx` lignes 1-50 pour comprendre les imports et props.
Chercher où est la section des paramètres / settings (grep `ghost_mode\|Fantôme\|toggle` dans ProfileModal.tsx).

- [ ] **Step 2 : Ajouter le state notifications dans ProfileModal**

Dans les useState de ProfileModal, ajouter :
```ts
const [notifPermission, setNotifPermission] = useState<NotificationPermission>("default")
const [notifLoading, setNotifLoading] = useState(false)
```

- [ ] **Step 3 : Lire le statut permission au montage**

Dans le useEffect de chargement du profil (ou créer un dédié), ajouter :
```ts
if ("Notification" in window) {
  setNotifPermission(Notification.permission)
}
```

- [ ] **Step 4 : Ajouter le handler toggle**

```ts
const handleToggleNotifications = useCallback(async () => {
  if (notifLoading) return
  setNotifLoading(true)
  try {
    if (notifPermission === "granted") {
      // Désabonner : supprimer la subscription de cet appareil
      const reg = await navigator.serviceWorker.getRegistration("/sw.js")
      if (reg) {
        const sub = await reg.pushManager.getSubscription()
        if (sub) {
          await sub.unsubscribe()
          await fetch("/api/push/subscribe", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          })
        }
      }
      toast.success("Notifications désactivées")
      setNotifPermission("denied")
    } else {
      // Demander la permission et s'abonner
      const perm = await Notification.requestPermission()
      setNotifPermission(perm)
      if (perm === "granted") {
        const reg = await navigator.serviceWorker.register("/sw.js")
        const existing = await reg.pushManager.getSubscription()
        const sub = existing ?? await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
        })
        const { endpoint, keys } = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint, p256dh: keys.p256dh, auth: keys.auth }),
        })
        toast.success("Notifications activées !")
      } else {
        toast.error("Permission refusée par le navigateur")
      }
    }
  } catch (err) {
    console.error("toggle notif error:", err)
    toast.error("Erreur lors de la configuration des notifications")
  } finally {
    setNotifLoading(false)
  }
}, [notifPermission, notifLoading])
```

- [ ] **Step 5 : Ajouter le bouton toggle dans le JSX de ProfileModal**

Trouver la section paramètres (ghost mode, etc.). Ajouter après le toggle ghost mode :

```tsx
{/* Toggle notifications */}
{"Notification" in window && (
  <button
    onClick={handleToggleNotifications}
    disabled={notifLoading}
    className="flex w-full items-center justify-between rounded-xl px-4 py-3 bg-gray-50 dark:bg-zinc-800/60 hover:bg-gray-100 dark:hover:bg-zinc-700/60 transition-colors disabled:opacity-50"
  >
    <div className="flex items-center gap-3">
      <Bell size={16} className="text-gray-500 dark:text-zinc-400" />
      <span className="text-sm text-gray-700 dark:text-zinc-300">Notifications</span>
    </div>
    <div className={cn(
      "h-5 w-9 rounded-full transition-colors",
      notifPermission === "granted" ? "bg-indigo-500" : "bg-gray-200 dark:bg-zinc-700"
    )}>
      <div className={cn(
        "h-4 w-4 rounded-full bg-white shadow-sm transition-transform mx-0.5 mt-0.5",
        notifPermission === "granted" ? "translate-x-4" : "translate-x-0"
      )} />
    </div>
  </button>
)}
```

S'assurer que `Bell` est importé depuis `lucide-react` (vérifier les imports existants de ProfileModal).

- [ ] **Step 6 : Vérifier TypeScript**

`getDiagnostics` sur `components/map/ProfileModal.tsx`.
Résultat attendu : 0 erreur.

- [ ] **Step 7 : Commit**

```bash
git add components/map/ProfileModal.tsx
git commit -m "feat: add notification toggle in ProfileModal settings"
```

---

### Task 9 — Déploiement et vérification end-to-end

- [ ] **Step 1 : Build de vérification TypeScript**

```bash
npx next build
```

Ignorer l'erreur prerender `/login` (env vars manquantes en local). Les autres erreurs TS doivent être à 0.

- [ ] **Step 2 : Déployer en production**

```bash
echo "y" | npx vercel deploy --prod
```

- [ ] **Step 3 : Vérifier le webhook Supabase est configuré**

Dans Supabase Dashboard → Database → Webhooks → confirmer que `activities_push_send` pointe vers l'URL prod.

- [ ] **Step 4 : Test end-to-end**

1. Ouvrir l'app sur téléphone (Chrome Android ou Safari iOS 16.4+ avec Add to Home Screen)
2. Ouvrir ProfileModal → activer les notifications
3. Depuis un autre compte : ajouter un spot ou liker un spot du compte principal
4. Vérifier : une push notification apparaît sur le téléphone
5. Taper la notification → l'app s'ouvre sur le bon spot
6. Ouvrir FriendsModal → onglet Activité → vérifier que la notif apparaît dans le feed avec le badge

- [ ] **Step 5 : Vérifier la gestion 410 Gone**

Dans Supabase SQL Editor :
```sql
-- Insérer une subscription avec un endpoint invalide pour tester le cleanup
INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
VALUES (auth.uid(), 'https://invalid-endpoint.example.com/xxx', 'fake_p256dh', 'fake_auth');
```
Déclencher un event → vérifier dans les logs Vercel que l'erreur 410 est catchée et la subscription supprimée.
