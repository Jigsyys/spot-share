import { NextResponse } from "next/server"

export const maxDuration = 30

/**
 * GET /api/debug-spot
 * Vérifie que les clés API sont bien configurées et fonctionnelles.
 * À supprimer une fois les tests terminés.
 */
export async function GET() {
  const results: Record<string, unknown> = {
    env: {
      GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
      GOOGLE_MAPS_API_KEY: !!process.env.GOOGLE_MAPS_API_KEY,
      NEXT_PUBLIC_MAPBOX_TOKEN: !!process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
    },
    googlePlaces: null,
    googlePhoto: null,
  }

  // Test Google Places Text Search
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (apiKey) {
    try {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/place/textsearch/json?query=Le+Meurice+Paris&language=fr&key=${apiKey}`,
        { signal: AbortSignal.timeout(8000) }
      )
      const data = await res.json()
      const first = data.results?.[0]
      results.googlePlaces = {
        status: data.status,
        found: !!first,
        name: first?.name ?? null,
        types: first?.types?.slice(0, 4) ?? [],
        hasPhotos: !!(first?.photos?.length),
        placeId: first?.place_id ?? null,
      }

      // Test résolution photo (redirect → URL directe)
      if (first?.photos?.[0]?.photo_reference) {
        const photoRef = first.photos[0].photo_reference
        const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${photoRef}&key=${apiKey}`
        try {
          const photoRes = await fetch(photoUrl, { redirect: "manual", signal: AbortSignal.timeout(5000) })
          const directUrl = photoRes.headers.get("location")
          results.googlePhoto = {
            redirectStatus: photoRes.status,
            directUrlResolved: !!directUrl,
            directUrlPrefix: directUrl ? directUrl.slice(0, 60) + "…" : null,
          }
        } catch (e) {
          results.googlePhoto = { error: (e as Error).message }
        }
      }

      // Test Place Details (pour vérifier opening_hours)
      if (first?.place_id) {
        const detailRes = await fetch(
          `https://maps.googleapis.com/maps/api/place/details/json?place_id=${first.place_id}&fields=name,opening_hours&language=fr&key=${apiKey}`,
          { signal: AbortSignal.timeout(8000) }
        )
        const detailData = await detailRes.json()
        results.googleDetails = {
          status: detailData.status,
          name: detailData.result?.name ?? null,
          hasOpeningHours: !!(detailData.result?.opening_hours?.weekday_text?.length),
          weekdaySample: detailData.result?.opening_hours?.weekday_text?.[0] ?? null,
        }
      }
    } catch (e) {
      results.googlePlaces = { error: (e as Error).message }
    }
  }

  return NextResponse.json(results, { status: 200 })
}
