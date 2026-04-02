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
