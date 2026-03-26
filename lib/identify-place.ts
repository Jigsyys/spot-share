/**
 * identify-place.ts — Architecture "Cascade Queries"
 *
 * Flux :
 *   1. Gemini "Sniper"  — extrait jusqu'à 3 requêtes classées par précision
 *   2. Google Places v1 — essaie chaque requête en cascade jusqu'à un résultat
 *   3. Assemblage       — source unique de vérité Google Maps
 */

import { GoogleGenerativeAI } from "@google/generative-ai"

// ---------------------------------------------------------------------------
// Types publics
// ---------------------------------------------------------------------------

export interface VideoMetadata {
  title?: string | null
  description?: string | null
  hashtags?: string[] | null
  author?: string | null
  /** Texte brut extrait après 📍/📌 dans la vidéo — signal haute confiance */
  locationHint?: string | null
}

export interface IdentifiedPlace {
  titre: string
  nom_officiel_google: string
  description: string
  categorie: "Café" | "Restaurant" | "Bar" | "Outdoor" | "Vue" | "Culture" | "Shopping"
  adresse: string
  coordonnees: { lat: number; lng: number }
  photos: string[]
  horaires: string[]
}

export interface IdentifyPlaceError {
  erreur: string
}

export type IdentifyPlaceResult = IdentifiedPlace | IdentifyPlaceError

// ---------------------------------------------------------------------------
// Types internes
// ---------------------------------------------------------------------------

interface GeminiPass {
  /** Requêtes classées du plus précis au plus vague, max 3 */
  queries: string[]
  description_suggeree: string
  categorie_suggeree: string
}

interface PlacesResult {
  displayName?: { text: string }
  formattedAddress?: string
  location?: { latitude: number; longitude: number }
  photos?: Array<{ name: string }>
  regularOpeningHours?: { weekdayDescriptions?: string[] }
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
  "places.displayName,places.formattedAddress,places.location,places.photos,places.regularOpeningHours"

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

async function resolvePhotoUrls(
  photos: PlacesResult["photos"],
  apiKey: string
): Promise<string[]> {
  if (!photos?.length) return []
  const results: string[] = []
  for (const photo of photos.slice(0, 3)) {
    const apiUrl = `${PLACES_PHOTO_BASE}/${photo.name}/media?key=${apiKey}&maxHeightPx=1000`
    try {
      const res = await fetch(apiUrl, {
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      })
      const cdnUrl = res.headers.get("location")
      results.push(cdnUrl ?? apiUrl)
    } catch {
      results.push(apiUrl)
    }
  }
  return results
}

// ---------------------------------------------------------------------------
// Phase 1 : Gemini — extraction de 1 à 3 requêtes classées
// ---------------------------------------------------------------------------

async function geminiExtractQueries(meta: VideoMetadata, geminiKey: string): Promise<GeminiPass> {
  const genAI = new GoogleGenerativeAI(geminiKey)
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
      maxOutputTokens: 512,
      // @ts-ignore
      thinkingConfig: { thinkingBudget: 0 },
    },
  })

  const lines: string[] = []

  // locationHint = signal le plus fiable (texte direct du 📍 de la vidéo)
  if (meta.locationHint) lines.push(`📍 Indication de lieu (source directe de la vidéo) : ${meta.locationHint}`)
  if (meta.title)         lines.push(`Titre : ${meta.title.slice(0, 300)}`)
  if (meta.description)   lines.push(`Description : ${meta.description.slice(0, 2000)}`)
  if (meta.hashtags?.length) lines.push(`Hashtags : ${meta.hashtags.slice(0, 20).join(" ")}`)
  if (meta.author)        lines.push(`Auteur : ${meta.author}`)

  const context = lines.length > 0 ? lines.join("\n") : "(aucune métadonnée)"

  const prompt = `Tu es un extracteur géographique ultra-précis. Ton seul objectif : trouver le nom et l'adresse du lieu montré dans cette vidéo.

PRIORITÉS pour identifier le lieu :
1. "📍 Indication de lieu" si présent → c'est le texte copié DIRECTEMENT depuis la vidéo, utilise-le en priorité absolue pour le nom du lieu et l'adresse.
2. Scanne la description pour trouver une adresse postale explicite : numéro + rue + ville ou code postal (ex: "19 Rue Soufflot, 75005 Paris", "12 bd Haussmann Paris 9").
3. Déduis le nom du lieu depuis le titre ou la description. Ignore les slogans et descriptions de l'activité — cherche le NOM PROPRE de l'établissement.
4. Cherche la ville dans les hashtags (#paris, #lyon...) ou le contexte.

CONSTRUIRE LES REQUÊTES GOOGLE MAPS :
Génère entre 1 et 3 requêtes, de la plus précise à la plus vague :
- Requête 1 (si adresse trouvée) : "Nom exact, Adresse complète"  ex: "A Braccetto, 19 Rue Soufflot, 75005 Paris"
- Requête 2 (si ville connue)    : "Nom exact, Ville, Pays"        ex: "Café de Flore, Paris, France"
- Requête 3 (fallback)           : "Nom exact" seul                ex: "Atelier des Lumières"

RÈGLES :
- IGNORE le bruit SEO (blocs "Keywords:", descriptions de l'activité, tags répétitifs).
- Si le locationHint contient une virgule, la partie APRÈS la virgule est probablement l'adresse.
- Ne génère PAS de requête si tu n'as aucun signal fiable sur le nom du lieu.

Métadonnées :
${context}

Renvoie UNIQUEMENT ce JSON (queries = tableau de 1 à 3 requêtes) :
{
  "queries": ["requête_précise", "requête_ville", "requête_nom_seul"],
  "description_suggeree": "2 phrases max sur ce qu'on y fait/mange, basé sur la vidéo",
  "categorie_suggeree": "une valeur parmi : Café, Restaurant, Bar, Outdoor, Vue, Culture, Shopping"
}`

  const result = await model.generateContent(prompt)
  const raw = result.response.text().trim()
  console.log("[Phase 1] Gemini queries:", raw.slice(0, 300))

  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim()
  const parsed = JSON.parse(cleaned) as GeminiPass

  // Normaliser : s'assurer que queries est bien un tableau non-vide
  if (!Array.isArray(parsed.queries) || parsed.queries.length === 0) {
    throw new Error("Gemini n'a retourné aucune requête valide")
  }

  return parsed
}

// ---------------------------------------------------------------------------
// Phase 2 : Google Places — cascade de requêtes
// ---------------------------------------------------------------------------

async function searchGooglePlaces(query: string, placesKey: string): Promise<PlacesResult[]> {
  const res = await fetch(PLACES_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": placesKey,
      "X-Goog-FieldMask": PLACES_FIELD_MASK,
    },
    body: JSON.stringify({ textQuery: query, languageCode: "fr" }),
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

  // ── Phase 1 : Gemini extrait les requêtes ───────────────────────────────
  let geminiData: GeminiPass
  try {
    geminiData = await geminiExtractQueries(meta, geminiKey)
  } catch (e) {
    console.error("[Phase 1] Erreur Gemini:", (e as Error).message)
    return { erreur: "L'analyse IA a échoué. Réessaie dans quelques secondes." }
  }

  // ── Phase 2 : Google Places — cascade ──────────────────────────────────
  let places: PlacesResult[] = []
  let usedQuery = ""

  for (const query of geminiData.queries) {
    if (!query?.trim()) continue
    try {
      const results = await searchGooglePlaces(query.trim(), placesKey)
      if (results.length > 0) {
        places = results
        usedQuery = query
        break
      }
    } catch (e) {
      console.error(`[Phase 2] Erreur Places pour "${query}":`, (e as Error).message)
    }
  }

  // ── Phase 3 : Validation & Assemblage ───────────────────────────────────
  if (places.length === 0) {
    console.warn("[Phase 3] Aucun résultat après cascade — retour 404")
    return {
      erreur: "Lieu introuvable sur Google Maps. Le nom n'est peut-être pas assez précis.",
    }
  }

  const best = places[0]
  const nom_officiel_google = best.displayName?.text ?? ""
  const titre = nom_officiel_google
  const horaires = best.regularOpeningHours?.weekdayDescriptions ?? []
  const googlePhotosUrls = await resolvePhotoUrls(best.photos ?? [], placesKey)

  console.log(`[Phase 3] ✓ "${titre}" | ${best.formattedAddress} | requête: "${usedQuery}" | ${googlePhotosUrls.length} photo(s) | ${horaires.length} horaires`)

  return {
    titre,
    nom_officiel_google,
    description: geminiData.description_suggeree,
    categorie: normalizeCategory(geminiData.categorie_suggeree),
    adresse: best.formattedAddress ?? "",
    coordonnees: {
      lat: best.location?.latitude ?? 0,
      lng: best.location?.longitude ?? 0,
    },
    photos: googlePhotosUrls,
    horaires,
  }
}
