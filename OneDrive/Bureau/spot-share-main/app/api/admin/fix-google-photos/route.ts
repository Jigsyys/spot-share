import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"

function isExpiringUrl(url: string): boolean {
  return !url.includes(".supabase.co/storage/v1/object/public/")
}

function hashFromUrl(url: string): string {
  if (url.includes("/place-photos/")) return url.split("/place-photos/")[1]?.slice(0, 24) ?? Date.now().toString()
  if (url.includes("lh3.googleusercontent.com/places/")) return url.split("/places/")[1]?.slice(0, 24) ?? Date.now().toString()
  return Date.now().toString()
}

// Admin-only — repairs expiring Google Places photo URLs by downloading
// and storing them in Supabase Storage. Expired URLs are dropped entirely.
// Call repeatedly until remaining=0 (processes 10 spots per call).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const secret = searchParams.get("secret")
  if (secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const sb = createServiceClient()

  const { data: spots, error } = await sb
    .from("spots")
    .select("id, title, image_url")
    .not("image_url", "is", null)
    .not("image_url", "like", "%.supabase.co/storage%")
    .limit(10)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!spots || spots.length === 0) {
    return NextResponse.json({ message: "All done — no more expiring URLs", fixed: 0, remaining: 0 })
  }

  const results: { id: string; title: string; saved: number; dropped: number }[] = []

  for (const spot of spots) {
    if (!spot.image_url) continue
    const urls = spot.image_url.split(",").map((u: string) => u.trim()).filter(Boolean)
    const newUrls: string[] = []
    let saved = 0
    let dropped = 0

    for (const url of urls) {
      if (!isExpiringUrl(url)) {
        newUrls.push(url)
        continue
      }

      try {
        const imgRes = await fetch(url, { signal: AbortSignal.timeout(10000) })
        if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`)
        const blob = await imgRes.blob()
        const ext = blob.type.includes("png") ? "png" : "jpeg"
        const filename = `spots/google-${hashFromUrl(url)}-${Date.now()}.${ext}`

        const { error: uploadError } = await sb.storage
          .from("avatars")
          .upload(filename, blob, { contentType: blob.type, upsert: true })

        if (uploadError) throw new Error(uploadError.message)

        const { data: { publicUrl } } = sb.storage.from("avatars").getPublicUrl(filename)
        newUrls.push(publicUrl)
        saved++
      } catch {
        // URL already expired — drop it (emoji fallback is shown instead)
        dropped++
      }
    }

    const changed = saved + dropped > 0
    if (changed) {
      const newImageUrl = newUrls.join(",") || null
      await sb.from("spots").update({ image_url: newImageUrl }).eq("id", spot.id)
    }

    results.push({ id: spot.id, title: spot.title, saved, dropped })
  }

  // Delete spots that now have no image at all
  const { count: deletedCount } = await sb
    .from("spots")
    .delete({ count: "exact" })
    .or("image_url.is.null,image_url.eq.")

  // Count remaining non-Supabase URLs
  const { count: remaining } = await sb
    .from("spots")
    .select("id", { count: "exact", head: true })
    .not("image_url", "is", null)
    .not("image_url", "like", "%.supabase.co/storage%")

  return NextResponse.json({
    processed: spots.length,
    remaining: remaining ?? 0,
    deleted_no_image: deletedCount ?? 0,
    results,
  })
}
