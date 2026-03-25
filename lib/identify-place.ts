/**
 * identify-place.ts — Architecture Single-Pass
 *
 * Flux :
 *   1. Gemini (1 seul appel) — extraction + formatage complet
 *   2. Google Places NEW API (searchText) — 1 seul appel
 *   3. Validation + assemblage — 404 immédiat si lieu introuvable
 */

import { GoogleGenerativeAI } from "@google/generative-ai"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VideoMetadata {
  title?: string | null
  description?: string | null
  hashtags?: string[] | null
  author?: string | null
}

export interface IdentifiedPlace {
  nom_du_lieu: string
  description: string
  categorie: "Café" | "Restaurant" | "Bar" | "Outdoor" | "Vue" | "Culture" | "Shopping"
  adresse: string
  coordonnees: { lat: number; lng: number }
  photos: string[]
}

export interface IdentifyPlaceError {
  erreur: string
}

export type IdentifyPlaceResult = IdentifiedPlace | IdentifyPlaceError

// ---------------------------------------------------------------------------
// Interfaces internes
// ---------------------------------------------------------------------------

interface GeminiPass {
  search_query: string
  nom_propose: string
  description: string
  categorie: string
}

interface PlacesResult {
  displayName?: { text: string }
  formattedAddress?: string
  location?: { latitude: number; longitude: number }
  photos?: Array<{ name: string }>
}

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = [
  "Café",
  "Restaurant",
  "Bar",
  "Outdoor",
  "Vue",
  "Culture",
  "Shopping",
] as const

const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
const PLACES_PHOTO_BASE = "https://places.googleapis.com/v1"
const PLACES_FIELD_MASK =
  "places.displayName,places.formattedAddress,places.location,places.photos"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeCategory(raw: string | null | undefined): IdentifiedPlace["categorie"] {
  if (!raw) return "Restaurant"
  const trimmed = raw.trim()
  if ((VALID_CATEGORIES as readonly string[]).includes(trimmed)) {
    return trimmed as IdentifiedPlace["categorie"]
  }
  const lower = trimmed.toLowerCase()
  const match = VALID_CATEGORIES.find((c) => c.toLowerCase() === lower)
  return match ?? "Restaurant"
}

function buildPhotoUrls(photos: PlacesResult["photos"], apiKey: string): string[] {
  if (!photos?.length) return []
  return photos
    .slice(0, 3)
    .map((p) => `${PLACES_PHOTO_BASE}/${p.name}/media?key=${apiKey}&maxHeightPx=1000`)
}

// ---------------------------------------------------------------------------
// Phase 1 : Gemini Single-Pass
// ---------------------------------------------------------------------------

async function geminiSinglePass(meta: VideoMetadata, geminiKey: string): Promise<GeminiPass> {
  const genAI = new GoogleGenerativeAI(geminiKey)
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
      maxOutputTokens: 300,
    },
  })

  const lines: string[] = []
  if (meta.title)       lines.push(`Titre : ${meta.title.slice(0, 200)}`)
  if (meta.description) lines.push(`Description : ${meta.description.slice(0, 600)}`)
  if (meta.hashtags?.length) lines.push(`Hashtags : ${meta.hashtags.slice(0, 15).join(" ")}`)
  if (meta.author)      lines.push(`Nom de l'auteur : ${meta.author}`)

  const context = lines.length > 0 ? lines.join("\n") : "(aucune métadonnée)"

  const prompt = `Tu es un curateur de lieux expert. Analyse les métadonnées de cette vidéo (qui parle souvent de food/lieux).

RÈGLES STRICTES :
- IGNORE le nom du compte ou de l'auteur (ex: "El Negociateur") pour déduire le concept du lieu. Ne les confonds pas.
- Identifie le nom réel du lieu (corrige l'orthographe si ça semble être une erreur phonétique).
- Déduis la Ville et le Pays. Si tu ne les trouves pas, renvoie null dans search_query.
- Rédige une description (2 phrases) de ce qu'on y mange ou fait, basée UNIQUEMENT sur les indices de la vidéo (ex: si on parle de cookies, parle de cookies).
- Choisis UNE catégorie parmi : [Café, Restaurant, Bar, Outdoor, Vue, Culture, Shopping].

Métadonnées :
${context}

Renvoie un JSON strict :
{
  "search_query": "Nom corrigé du lieu, Ville, Pays",
  "nom_propose": "Nom du lieu",
  "description": "Ta description réaliste",
  "categorie": "Catégorie choisie"
}`

  const result = await model.generateContent(prompt)
  const raw = result.response.text().trim()
  console.log("[Phase 1] Gemini:", raw.slice(0, 250))

  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim()
  return JSON.parse(cleaned) as GeminiPass
}

// ---------------------------------------------------------------------------
// Phase 2 : Google Places NEW API
// ---------------------------------------------------------------------------

async function searchGooglePlaces(query: string, placesKey: string): Promise<PlacesResult[]> {
  const res = await fetch(PLACES_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": placesKey,
      "X-Goog-FieldMask": PLACES_FIELD_MASK,
    },
    body: JSON.stringify({ textQuery: query }),
    signal: AbortSignal.timeout(8000),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => "")
    throw new Error(`Google Places HTTP ${res.status}: ${err.slice(0, 200)}`)
  }

  const data = (await res.json()) as { places?: PlacesResult[] }
  console.log(`[Phase 2] Places "${query}" → ${data.places?.length ?? 0} résultat(s)`)
  return data.places ?? []
}

// ---------------------------------------------------------------------------
// Fonction principale
// ---------------------------------------------------------------------------

export async function identifyPlace(meta: VideoMetadata): Promise<IdentifyPlaceResult> {
  const geminiKey = process.env.GEMINI_API_KEY
  const placesKey = process.env.GOOGLE_MAPS_API_KEY

  if (!geminiKey) throw new Error("GEMINI_API_KEY manquante")
  if (!placesKey) throw new Error("GOOGLE_MAPS_API_KEY manquante")

  // ── Phase 1 : Gemini ────────────────────────────────────────────────────
  let geminiData: GeminiPass
  try {
    geminiData = await geminiSinglePass(meta, geminiKey)
  } catch (e) {
    console.error("[Phase 1] Erreur Gemini:", (e as Error).message)
    throw new Error("Erreur lors de l'analyse IA du contenu")
  }

  // ── Phase 2 : Google Places ─────────────────────────────────────────────
  let places: PlacesResult[] = []
  try {
    places = await searchGooglePlaces(geminiData.search_query, placesKey)
  } catch (e) {
    console.error("[Phase 2] Erreur Google Places:", (e as Error).message)
    throw new Error("Erreur lors de la recherche Google Maps")
  }

  // ── Phase 3 : Validation — 404 immédiat si rien trouvé ──────────────────
  if (places.length === 0) {
    console.warn("[Phase 3] Aucun résultat Google Maps — retour 404")
    return {
      erreur:
        "Adresse exacte introuvable sur Google Maps. Le lieu a peut-être fermé ou le nom est incorrect.",
    }
  }

  const best = places[0]
  const photos = buildPhotoUrls(best.photos, placesKey)

  console.log(`[Phase 3] Lieu retenu : "${best.displayName?.text}" — ${best.formattedAddress}`)

  return {
    nom_du_lieu: best.displayName?.text ?? geminiData.nom_propose,
    description: geminiData.description,
    categorie: normalizeCategory(geminiData.categorie),
    adresse: best.formattedAddress ?? "",
    coordonnees: {
      lat: best.location?.latitude ?? 0,
      lng: best.location?.longitude ?? 0,
    },
    photos,
  }
}
