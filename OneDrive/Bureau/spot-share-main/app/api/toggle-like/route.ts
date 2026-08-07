import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"

export async function POST(request: Request) {
  const { spotId, action } = await request.json()
  if (!spotId || !action) return NextResponse.json({ error: "Missing params" }, { status: 400 })

  const authSb = await createClient()
  const { data: { user } } = await authSb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const sb = createServiceClient()

  if (action === "remove") {
    const { error } = await sb.from("spot_reactions").delete()
      .eq("spot_id", spotId).eq("user_id", user.id).eq("type", "love")
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await sb.from("spot_reactions")
      .upsert({ spot_id: spotId, user_id: user.id, type: "love" }, { onConflict: "spot_id,user_id,type", ignoreDuplicates: true })
    if (error) {
      // 23503 = FK violation : le spot_id n'existe plus en DB
      if (error.code === "23503") return NextResponse.json({ error: "spot_not_found" }, { status: 404 })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  return NextResponse.json({ success: true })
}
