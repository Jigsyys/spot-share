import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url)
  const spotId = searchParams.get("id")
  if (!spotId) return NextResponse.json({ error: "Missing id" }, { status: 400 })

  // Auth via server client (reads session from cookies)
  const authSb = await createClient()
  const { data: { user } } = await authSb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // DB ops via service client (bypasses RLS)
  const sb = createServiceClient()

  const { data: spot } = await sb.from("spots").select("user_id").eq("id", spotId).single()
  if (!spot) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const { data: profile } = await sb.from("profiles").select("is_admin").eq("id", user.id).single()
  const isAdmin = profile?.is_admin === true

  if (spot.user_id !== user.id && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { error } = await sb.from("spots").delete().eq("id", spotId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
