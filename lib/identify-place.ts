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
  if (meta.title)            lines.push(`Titre : ${meta.title.slice(0, 200)}`)
  if (meta.description)      lines.push(`Description : ${meta.description.slice(0, 1500)}`)
  if (meta.hashtags?.length) lines.push(`Hashtags : ${meta.hashtags.slice(0, 20).join(" ")}`)
  if (meta.author)           lines.push(`Nom de l'auteur : ${meta.author}`)

  const context = lines.length > 0 ? lines.join("\n") : "(aucune métadonnée)"

  const prompt = `Tu es un extracteur de données chirurgical. Analyse les métadonnées de cette vidéo pour trouver le lieu exact.

RÈGLES VITALES (Même si le texte est très long) :
- IGNORE totalement les blocs commençant par "Keywords:" ou les résumés générés par l'IA à la fin du texte. Ne te laisse pas distraire par le bruit.
- IDENTIFIE LE VRAI NOM : Ne confonds pas le concept (ex: "Mini pizzas à volonté") avec le nom du restaurant (ex: "A Braccetto").
- CHERCHE L'ADRESSE EXACTE : Scanne le texte à la recherche d'emojis comme 📍, ou de mots comme "Rue", "Avenue", "Boulevard". Les créateurs donnent très souvent l'adresse exacte.
- Rédige une courte description du concept (2 phrases) et choisis STRICTEMENT UNE catégorie parmi : [Café, Restaurant, Bar, Outdoor, Vue, Culture, Shopping].

CONSTRUIRE LA SEARCH_QUERY (Crucial) :
- S'il y a une adresse exacte dans le texte, ta search_query DOIT être : "Nom du lieu, Adresse exacte" (ex: "A Braccetto, 19 Rue Soufflot, 75005 Paris").
- S'il n'y a PAS d'adresse exacte, ta search_query DOIT être : "Nom du lieu, Ville, Pays".

Métadonnées :
${context}

Renvoie UNIQUEMENT ce JSON :
{
  "search_query": "Ta requête Google Maps optimisée",
  "nom_propose": "Vrai nom du lieu",
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

  if (!geminiKey) {
    console.error("[identifyPlace] GEMINI_API_KEY manquante")
    return { erreur: "Configuration serveur incorrecte (clé IA manquante)." }
  }
  if (!placesKey) {
    console.error("[identifyPlace] GOOGLE_MAPS_API_KEY manquante")
    return { erreur: "Configuration serveur incorrecte (clé Maps manquante)." }
  }

  // ── Phase 1 : Gemini ────────────────────────────────────────────────────
  let geminiData: GeminiPass
  try {
    geminiData = await geminiSinglePass(meta, geminiKey)
  } catch (e) {
    console.error("[Phase 1] Erreur Gemini:", (e as Error).message)
    return { erreur: "L'analyse IA a échoué. Réessaie dans quelques secondes." }
  }

  // ── Phase 2 : Google Places ─────────────────────────────────────────────
  let places: PlacesResult[] = []
  try {
    places = await searchGooglePlaces(geminiData.search_query, placesKey)
  } catch (e) {
    console.error("[Phase 2] Erreur Google Places:", (e as Error).message)
    return { erreur: "La recherche Google Maps a échoué. Réessaie dans quelques secondes." }
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
