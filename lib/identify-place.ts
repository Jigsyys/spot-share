/**
 * identify-place.ts — Architecture "Single-Pass Pure Source"
 *
 * Flux :
 *   1. Gemini "Sniper"  — search_query + description + catégorie
 *   2. Google Places v1 — source unique de vérité (titre, adresse, coords, photos)
 *   3. Assemblage       — 404 immédiat si introuvable, jamais de crash
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
}

export interface IdentifiedPlace {
  titre: string
  nom_officiel_google: string
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
// Types internes
// ---------------------------------------------------------------------------

interface GeminiPass {
  search_query: string
  titre_explicite: string
  description_suggeree: string
  categorie_suggeree: string
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

/**
 * Résout les URLs photos côté serveur en suivant le redirect 302
 * → URL CDN publique (lh3.googleusercontent.com), sans exposer la clé API au frontend.
 */
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
// Phase 1 : Gemini "Sniper" — search_query + description + catégorie
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

  const prompt = `Tu es un extracteur de données géographique ultra-précis. Analyse les métadonnées fournies.

RÈGLES VITALES :
- IGNORE totalement le bruit SEO (blocs "Keywords:", tags répétitifs, résumés générés par l'IA à la fin du texte).
- IDENTIFIE LE VRAI NOM : Scanne le texte pour trouver le nom réel du lieu (ex: "A Braccetto"), ignore les slogans aguicheurs (ex: "Mini pizzas").
- CHERCHE L'ADRESSE EXACTE : Scanne pour trouver des emojis comme 📍, ou des mots comme "Rue", "Avenue", "Boulevard", "Code postal".
- Rédige une description RÉALISTE (2 phrases maximum) de ce qu'on y mange ou fait, basée UNIQUEMENT sur les indices de la vidéo.
- Choisis STRICTEMENT UNE catégorie parmi cette liste : [Café, Restaurant, Bar, Outdoor, Vue, Culture, Shopping].

CONSTRUIRE LA SEARCH_QUERY (Impératif) :
- S'il y a une adresse exacte : Ta search_query DOIT être : "Nom du lieu, Adresse exacte" (ex: "A Braccetto, 19 Rue Soufflot, 75005 Paris").
- S'il n'y a pas d'adresse exacte : Ta search_query DOIT être : "Nom du lieu, Ville, Pays".

CRÉATION DU TITRE EXPLICITE :
Tu dois forger un titre_explicite qui donne immédiatement envie et décrit l'activité réelle + le lieu.
Règle : Combine l'activité phare avec le nom officiel du lieu.
Exemples : Au lieu de juste "Atelier des Lumières", écris "Exposition Immersive Van Gogh à l'Atelier des Lumières". Au lieu de "A Braccetto", écris "Mini Pizzas à Volonté chez A Braccetto".

Métadonnées :
${context}

Renvoie UNIQUEMENT ce JSON :
{
  "search_query": "Requête brute pour Google Maps (ex: A Braccetto, 19 Rue Soufflot)",
  "titre_explicite": "Ton super titre éditorial (ex: Mini Pizzas à Volonté chez A Braccetto)",
  "description_suggeree": "Ta description",
  "categorie_suggeree": "Ta catégorie choisie"
}`

  const result = await model.generateContent(prompt)
  const raw = result.response.text().trim()
  console.log("[Phase 1] Gemini:", raw.slice(0, 250))

  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim()
  return JSON.parse(cleaned) as GeminiPass
}

// ---------------------------------------------------------------------------
// Phase 2 : Google Places NEW API — source unique de vérité
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

  // ── Phase 1 : Gemini Sniper ──────────────────────────────────────────────
  let geminiData: GeminiPass
  try {
    geminiData = await geminiSinglePass(meta, geminiKey)
  } catch (e) {
    console.error("[Phase 1] Erreur Gemini:", (e as Error).message)
    return { erreur: "L'analyse IA a échoué. Réessaie dans quelques secondes." }
  }

  // ── Phase 2 : Google Places ──────────────────────────────────────────────
  let places: PlacesResult[] = []
  try {
    places = await searchGooglePlaces(geminiData.search_query, placesKey)
  } catch (e) {
    console.error("[Phase 2] Erreur Google Places:", (e as Error).message)
    return { erreur: "La recherche Google Maps a échoué. Réessaie dans quelques secondes." }
  }

  // ── Phase 3 : Validation & Assemblage ───────────────────────────────────
  if (places.length === 0) {
    console.warn("[Phase 3] Aucun résultat Google Maps — retour 404")
    return {
      erreur:
        "Adresse exacte introuvable sur Google Maps. Le lieu a peut-être fermé ou le nom est incorrect.",
    }
  }

  const best = places[0]

  // NOM OFFICIEL : Google Maps, source unique de vérité
  const nom_officiel_google = best.displayName?.text ?? ""

  // TITRE ÉDITORIAL : généré par Gemini (activité + lieu), donne envie
  const titre = geminiData.titre_explicite || nom_officiel_google

  // PHOTOS : EXCLUSIVEMENT depuis places[0].photos (Google Maps)
  // Aucun fallback sur les métadonnées vidéo, og:image ou miniature de scraping.
  // Si Google Places ne fournit pas de photos → tableau vide, c'est tout.
  const googlePhotosUrls = await resolvePhotoUrls(best.photos ?? [], placesKey)

  console.log(`[Phase 3] titre="${titre}" | officiel="${nom_officiel_google}" | ${best.formattedAddress} | ${googlePhotosUrls.length} photo(s)`)

  return {
    titre,                   // Titre éditorial hybride (Gemini)
    nom_officiel_google,     // Nom brut Google Maps (utile en BDD)
    description: geminiData.description_suggeree,
    categorie: normalizeCategory(geminiData.categorie_suggeree),
    adresse: best.formattedAddress ?? "",
    coordonnees: {
      lat: best.location?.latitude ?? 0,
      lng: best.location?.longitude ?? 0,
    },
    photos: googlePhotosUrls, // EXCLUSIVEMENT Google Places — jamais de fallback vidéo
  }
}
