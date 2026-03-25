/**
 * identify-place.ts
 *
 * Agent IA "Anti-Crash" pour identifier un lieu à partir des métadonnées d'une vidéo.
 *
 * Architecture en 6 phases :
 *   1. Gemini Pass 1  — Ancrage géographique (nom + ville + query)
 *   2. Google Places  — Recherche via la NEW API (v1 / searchText)
 *   3. Fallback       — DuckDuckGo → Gemini correction → 2e tentative Places
 *   4. Photos         — Construction des URLs signées
 *   5. Gemini Pass 2  — Description courte + catégorie normalisée
 *   6. Assemblage     — Objet final fusionné
 */

import { GoogleGenerativeAI } from "@google/generative-ai"

// ---------------------------------------------------------------------------
// Types publics
// ---------------------------------------------------------------------------

export interface VideoMetadata {
  description?: string | null
  hashtags?: string[] | null
  bio?: string | null
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
  erreur: "Lieu impossible à vérifier avec certitude"
  donnees_brutes: string
}

export type IdentifyPlaceResult = IdentifiedPlace | IdentifyPlaceError

// ---------------------------------------------------------------------------
// Types internes
// ---------------------------------------------------------------------------

interface GeminiAnchor {
  nom_lieu: string | null
  ville: string | null
  pays: string | null
  search_query: string
}

interface GeminiFinal {
  nom_du_lieu: string
  description: string
  categorie: string
}

interface PlacesResult {
  displayName?: { text: string }
  formattedAddress?: string
  location?: { latitude: number; longitude: number }
  types?: string[]
  editorialSummary?: { text: string }
  photos?: Array<{ name: string }>
}

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
const PLACES_PHOTO_BASE = "https://places.googleapis.com/v1"
const PLACES_FIELD_MASK =
  "places.displayName,places.formattedAddress,places.location,places.types,places.editorialSummary,places.photos"

const VALID_CATEGORIES = [
  "Café",
  "Restaurant",
  "Bar",
  "Outdoor",
  "Vue",
  "Culture",
  "Shopping",
] as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRequiredEnv(name: string): string {
  const val = process.env[name]
  if (!val) throw new Error(`Variable d'environnement manquante : ${name}`)
  return val
}

/** Parse le JSON renvoyé par Gemini en mode JSON (responseMimeType application/json). */
function parseGeminiJson<T>(raw: string): T {
  // Gemini peut parfois entourer le JSON de backticks — on les enlève par sécurité.
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim()
  return JSON.parse(cleaned) as T
}

/** Normalise la catégorie renvoyée par Gemini vers l'union de types stricte. */
function normalizeCategory(
  raw: string | null | undefined
): IdentifiedPlace["categorie"] {
  if (!raw) return "Culture"
  const trimmed = raw.trim()
  // Correspondance exacte d'abord
  if ((VALID_CATEGORIES as readonly string[]).includes(trimmed)) {
    return trimmed as IdentifiedPlace["categorie"]
  }
  // Correspondance insensible à la casse en fallback
  const lower = trimmed.toLowerCase()
  const match = VALID_CATEGORIES.find((c) => c.toLowerCase() === lower)
  return match ?? "Culture"
}

// ---------------------------------------------------------------------------
// Phase 1 : Gemini Pass 1 — Ancrage géographique
// ---------------------------------------------------------------------------

async function geminiAnchorPhase(
  meta: VideoMetadata,
  geminiKey: string
): Promise<GeminiAnchor> {
  const genAI = new GoogleGenerativeAI(geminiKey)
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
      maxOutputTokens: 200,
    },
  })

  const contextParts: string[] = []
  if (meta.description) contextParts.push(`Description : ${meta.description.slice(0, 600)}`)
  if (meta.hashtags?.length) contextParts.push(`Hashtags : ${meta.hashtags.join(" ")}`)
  if (meta.bio) contextParts.push(`Bio du compte : ${meta.bio.slice(0, 300)}`)

  const contextText =
    contextParts.length > 0 ? contextParts.join("\n") : "(aucune métadonnée fournie)"

  const prompt = `Tu es un détective OSINT. Analyse ce texte. Ta priorité est de trouver le NOM du lieu principal, ainsi que sa VILLE et son PAYS (cherche dans les hashtags et la bio).

RÈGLE ANTI-HALLUCINATION : Si tu ne trouves VRAIMENT aucun indice géographique, mets null pour ville et pays. Ne devine jamais au hasard.

Renvoie UNIQUEMENT un JSON structuré ainsi :
{ "nom_lieu": "Nom ou null", "ville": "Ville ou null", "pays": "Pays ou null", "search_query": "Nom, Ville, Pays (omets les nulls de cette string)" }

Texte à analyser :
${contextText}`

  const result = await model.generateContent(prompt)
  const raw = result.response.text().trim()
  console.log("[Phase 1] Gemini anchor:", raw.slice(0, 200))

  const anchor = parseGeminiJson<GeminiAnchor>(raw)

  // Garantir un search_query minimal si Gemini retourne une chaîne vide
  if (!anchor.search_query?.trim()) {
    const parts = [anchor.nom_lieu, anchor.ville, anchor.pays].filter(Boolean)
    anchor.search_query = parts.join(", ") || "lieu inconnu"
  }

  return anchor
}

// ---------------------------------------------------------------------------
// Phase 2 : Google Places NEW API (v1) — searchText
// ---------------------------------------------------------------------------

async function searchGooglePlacesNew(
  query: string,
  placesKey: string
): Promise<PlacesResult[]> {
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
    const errText = await res.text().catch(() => "")
    throw new Error(`Google Places HTTP ${res.status}: ${errText.slice(0, 200)}`)
  }

  const data = (await res.json()) as { places?: PlacesResult[] }
  console.log(`[Phase 2] Places "${query}" → ${data.places?.length ?? 0} résultat(s)`)
  return data.places ?? []
}

// ---------------------------------------------------------------------------
// Phase 3 : Fallback DuckDuckGo + 2e tentative Places
// ---------------------------------------------------------------------------

async function duckDuckGoSearch(query: string): Promise<string | null> {
  // DuckDuckGo Instant Answer API — gratuit, sans clé, résultats textuels.
  // Ne retourne pas toujours un AbstractText, mais c'est notre meilleur outil sans SDK.
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SpotShare/1.0)" },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      AbstractText?: string
      AbstractURL?: string
      RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>
    }

    // Priorité : résumé principal
    if (data.AbstractText?.trim()) {
      const snippet = data.AbstractText.slice(0, 400)
      const source = data.AbstractURL ? ` (source: ${data.AbstractURL})` : ""
      console.log("[Phase 3 DDG] AbstractText:", snippet.slice(0, 100))
      return snippet + source
    }

    // Fallback : premier topic lié
    const firstTopic = data.RelatedTopics?.find((t) => t.Text && t.Text.length > 20)
    if (firstTopic?.Text) {
      console.log("[Phase 3 DDG] RelatedTopic:", firstTopic.Text.slice(0, 100))
      return firstTopic.Text.slice(0, 400)
    }

    return null
  } catch (e) {
    console.warn("[Phase 3 DDG] erreur:", (e as Error).message?.slice(0, 80))
    return null
  }
}

async function geminiCorrectQuery(
  originalQuery: string,
  webSnippet: string,
  geminiKey: string
): Promise<string> {
  const genAI = new GoogleGenerativeAI(geminiKey)
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
      maxOutputTokens: 100,
    },
  })

  const prompt = `Voici un résultat de recherche web à propos d'un lieu :

"${webSnippet}"

La requête de recherche initiale était : "${originalQuery}"

En te basant sur ce résultat web, corrige le nom exact du lieu et propose une meilleure query pour Google Maps.
Renvoie UNIQUEMENT : { "corrected_query": "Nom exact du lieu, Ville, Pays" }`

  const result = await model.generateContent(prompt)
  const raw = result.response.text().trim()
  const parsed = parseGeminiJson<{ corrected_query?: string }>(raw)
  return parsed.corrected_query?.trim() || originalQuery
}

// ---------------------------------------------------------------------------
// Phase 4 : Construction des URLs photos
// ---------------------------------------------------------------------------

function buildPhotoUrls(photos: PlacesResult["photos"], apiKey: string): string[] {
  if (!photos?.length) return []
  return photos.slice(0, 3).map(
    (photo) =>
      `${PLACES_PHOTO_BASE}/${photo.name}/media?key=${apiKey}&maxHeightPx=1000`
  )
}

// ---------------------------------------------------------------------------
// Phase 5 : Gemini Pass 2 — Description + Catégorie
// ---------------------------------------------------------------------------

async function geminiFormatFinal(
  place: PlacesResult,
  originalMeta: VideoMetadata,
  geminiKey: string
): Promise<GeminiFinal> {
  const genAI = new GoogleGenerativeAI(geminiKey)
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.3,
      maxOutputTokens: 250,
    },
  })

  // On envoie uniquement les champs légers (économie de tokens)
  const placeContext = {
    nom: place.displayName?.text ?? "Inconnu",
    types: place.types?.slice(0, 5) ?? [],
    resume: place.editorialSummary?.text ?? null,
  }

  const videoContext = [
    originalMeta.description ? `Description vidéo : ${originalMeta.description.slice(0, 300)}` : "",
    originalMeta.hashtags?.length ? `Hashtags : ${originalMeta.hashtags.slice(0, 10).join(" ")}` : "",
  ]
    .filter(Boolean)
    .join("\n")

  const prompt = `Voici les infos Google d'un lieu et le contexte vidéo.

Infos Google :
- Nom : ${placeContext.nom}
- Types : ${placeContext.types.join(", ") || "non précisé"}
- Résumé éditorial : ${placeContext.resume ?? "non disponible"}

Contexte vidéo :
${videoContext || "(aucun contexte vidéo disponible)"}

Rédige une courte description accrocheuse (2 phrases max).
Détermine la catégorie STRICTEMENT parmi cette liste exacte : [Café, Restaurant, Bar, Outdoor, Vue, Culture, Shopping].

Renvoie un JSON contenant : nom_du_lieu, description, categorie.`

  const result = await model.generateContent(prompt)
  const raw = result.response.text().trim()
  console.log("[Phase 5] Gemini format:", raw.slice(0, 200))

  return parseGeminiJson<GeminiFinal>(raw)
}

// ---------------------------------------------------------------------------
// Fonction principale
// ---------------------------------------------------------------------------

/**
 * Identifie un lieu à partir des métadonnées d'une vidéo sociale.
 *
 * @param meta - Description, hashtags et/ou bio extraits de la vidéo.
 * @returns Un objet `IdentifiedPlace` si le lieu est trouvé et vérifié,
 *          ou un objet `IdentifyPlaceError` en cas d'échec définitif.
 *
 * @example
 * const result = await identifyPlace({
 *   description: "Incroyable soirée 🍸📍Le Syndicat, Paris",
 *   hashtags: ["#cocktail", "#paris", "#lesyndicat"],
 *   bio: "Bar à cocktails Paris 10e",
 * })
 */
export async function identifyPlace(
  meta: VideoMetadata
): Promise<IdentifyPlaceResult> {
  // Lecture des clés API — lève une erreur explicite si absentes
  const geminiKey = getRequiredEnv("GEMINI_API_KEY")
  const placesKey = getRequiredEnv("GOOGLE_MAPS_API_KEY")

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 1 : Ancrage géographique via Gemini
  // ─────────────────────────────────────────────────────────────────────────
  let anchor: GeminiAnchor
  try {
    anchor = await geminiAnchorPhase(meta, geminiKey)
    console.log("[Phase 1] anchor:", anchor)
  } catch (e) {
    console.error("[Phase 1] Erreur Gemini:", (e as Error).message)
    return {
      erreur: "Lieu impossible à vérifier avec certitude",
      donnees_brutes: "(erreur Gemini Phase 1)",
    }
  }

  // Si Gemini ne trouve aucun nom de lieu, on abandonne directement
  if (!anchor.nom_lieu) {
    console.warn("[Phase 1] Aucun nom de lieu détecté — abandon")
    return {
      erreur: "Lieu impossible à vérifier avec certitude",
      donnees_brutes: anchor.search_query,
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 2 : Recherche Google Places (1er essai)
  // ─────────────────────────────────────────────────────────────────────────
  let places: PlacesResult[] = []
  try {
    places = await searchGooglePlacesNew(anchor.search_query, placesKey)
  } catch (e) {
    console.error("[Phase 2] Erreur Google Places:", (e as Error).message)
    // On ne crash pas — on tente le fallback
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 3 : Fallback si Places vide
  // ─────────────────────────────────────────────────────────────────────────
  if (places.length === 0) {
    console.warn("[Phase 3] Places vide — déclenchement du fallback DuckDuckGo")

    const ddgQuery = `${anchor.nom_lieu}${anchor.ville ? " " + anchor.ville : ""} adresse officielle`
    const webSnippet = await duckDuckGoSearch(ddgQuery)

    if (webSnippet) {
      // Gemini corrige la query avec le contexte web
      let correctedQuery = anchor.search_query
      try {
        correctedQuery = await geminiCorrectQuery(
          anchor.search_query,
          webSnippet,
          geminiKey
        )
        console.log("[Phase 3] Query corrigée:", correctedQuery)
      } catch (e) {
        console.warn("[Phase 3] Gemini correction échouée:", (e as Error).message)
      }

      // 2e tentative Places (une seule fois)
      try {
        places = await searchGooglePlacesNew(correctedQuery, placesKey)
        console.log(`[Phase 3] 2e tentative Places → ${places.length} résultat(s)`)
      } catch (e) {
        console.error("[Phase 3] 2e tentative Places échouée:", (e as Error).message)
      }
    }

    // Cas C : échec total après fallback
    if (places.length === 0) {
      console.error("[Phase 3] Échec total — retour erreur propre")
      return {
        erreur: "Lieu impossible à vérifier avec certitude",
        donnees_brutes: anchor.search_query,
      }
    }
  }

  // On prend le premier résultat (le plus pertinent selon Google)
  const bestPlace = places[0]

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 4 : Construction des URLs photos (côté serveur, clé non exposée)
  // ─────────────────────────────────────────────────────────────────────────
  const photoUrls = buildPhotoUrls(bestPlace.photos, placesKey)
  console.log(`[Phase 4] ${photoUrls.length} photo(s) construite(s)`)

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 5 : Gemini Pass 2 — Description accrocheuse + catégorie
  // ─────────────────────────────────────────────────────────────────────────
  let finalData: GeminiFinal
  try {
    finalData = await geminiFormatFinal(bestPlace, meta, geminiKey)
  } catch (e) {
    console.error("[Phase 5] Erreur Gemini format:", (e as Error).message)
    // Fallback minimal pour ne pas crasher : on utilise les données brutes
    finalData = {
      nom_du_lieu: bestPlace.displayName?.text ?? anchor.nom_lieu ?? "Lieu inconnu",
      description:
        bestPlace.editorialSummary?.text ??
        `Découvrez ${bestPlace.displayName?.text ?? "ce lieu"}.`,
      categorie: "Culture",
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 6 : Assemblage de l'objet final
  // ─────────────────────────────────────────────────────────────────────────
  const result: IdentifiedPlace = {
    nom_du_lieu: finalData.nom_du_lieu || bestPlace.displayName?.text || anchor.nom_lieu || "",
    description: finalData.description || "",
    categorie: normalizeCategory(finalData.categorie),
    adresse: bestPlace.formattedAddress ?? "",
    coordonnees: {
      lat: bestPlace.location?.latitude ?? 0,
      lng: bestPlace.location?.longitude ?? 0,
    },
    photos: photoUrls,
  }

  console.log("[Phase 6] Résultat final:", JSON.stringify(result, null, 2))
  return result
}
