import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const maxDuration = 60

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Non authentifié." }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const name = searchParams.get("name")

  if (!name || name.trim().length < 2) {
    return NextResponse.json({ error: "Nom requis." }, { status: 400 })
  }

  try {
    const { identifyPlace } = await import("@/lib/identify-place")
    const result = await identifyPlace({
      title: name.trim(),
      description: null,
      hashtags: null,
      author: null,
      locationHint: name.trim(),
    })

    if ("erreur" in result) {
      return NextResponse.json({ error: result.erreur }, { status: 404 })
    }

    return NextResponse.json({
      title:                result.titre,
      description:          result.description,
      location:             result.adresse,
      category:             result.categorie,
      photos:               result.photos,
      image_url:            result.photos[0] ?? null,
      coordinates:          result.coordonnees,
      weekday_descriptions: result.horaires.length > 0 ? result.horaires : null,
    })
  } catch (e) {
    console.error("[search-place error]:", e)
    return NextResponse.json({ error: "Erreur lors de la recherche." }, { status: 500 })
  }
}
