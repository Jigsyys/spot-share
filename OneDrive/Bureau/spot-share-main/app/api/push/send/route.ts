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
