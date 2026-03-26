/**
 * identify-place.ts — Architecture "Cascade + Enrichissement"
 *
 * Flux :
 *   1. Gemini Sniper    — extrait jusqu'à 3 requêtes classées + catégorie de secours
 *   2. Google Places v1 — source de vérité (nom, adresse, type, note, prix, horaires)
 *   3. En parallèle     — résolution photos + Gemini rédige description enrichie
 *   4. Assemblage final
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
  queries: string[]
  categorie_suggeree: string
}

interface PlacesResult {
  displayName?: { text: string }
  formattedAddress?: string
  location?: { latitude: number; longitude: number }
  photos?: Array<{ name: string }>
  regularOpeningHours?: { weekdayDescriptions?: string[] }
  primaryType?: string
  primaryTypeDisplayName?: { text: string }
  editorialSummary?: { text: string }
  rating?: number
  userRatingCount?: number
  priceLevel?: string
}

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = [
  "Café", "Restaurant", "Bar", "Outdoor", "Vue", "Culture", "Shopping",
] as const

const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
const PLACES_PHOTO_BASE = "https://places.googleapis.com/v1"
const PLACES_FIELD_MASK = [
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.photos",
  "places.regularOpeningHours",
  "places.primaryType",
  "places.primaryTypeDisplayName",
  "places.editorialSummary",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
].join(",")

/** Mapping Google Places primaryType → nos catégories */
const PRIMARY_TYPE_TO_CATEGORY: Record<string, IdentifiedPlace["categorie"]> = {
  // Café
  coffee_shop: "Café", cafe: "Café", bakery: "Café", tea_house: "Café",
  dessert_shop: "Café", ice_cream_shop: "Café", juice_shop: "Café",
  // Restaurant
  restaurant: "Restaurant", fast_food_restaurant: "Restaurant",
  pizza_restaurant: "Restaurant", hamburger_restaurant: "Restaurant",
  sandwich_shop: "Restaurant", sushi_restaurant: "Restaurant",
  ramen_restaurant: "Restaurant", thai_restaurant: "Restaurant",
  vietnamese_restaurant: "Restaurant", chinese_restaurant: "Restaurant",
  japanese_restaurant: "Restaurant", korean_restaurant: "Restaurant",
  indian_restaurant: "Restaurant", italian_restaurant: "Restaurant",
  french_restaurant: "Restaurant", mediterranean_restaurant: "Restaurant",
  seafood_restaurant: "Restaurant", steak_house: "Restaurant",
  brasserie: "Restaurant", buffet_restaurant: "Restaurant",
  brunch_restaurant: "Restaurant", diner: "Restaurant",
  // Bar
  bar: "Bar", wine_bar: "Bar", cocktail_bar: "Bar", pub: "Bar",
  night_club: "Bar", sports_bar: "Bar", bar_and_grill: "Bar",
  rooftop_bar: "Bar", lounge: "Bar",
  // Outdoor
  park: "Outdoor", national_park: "Outdoor", campground: "Outdoor",
  beach: "Outdoor", hiking_area: "Outdoor", garden: "Outdoor",
  botanical_garden: "Outdoor", forest: "Outdoor", lake: "Outdoor",
  nature_reserve: "Outdoor",
  // Vue
  observation_deck: "Vue", scenic_point: "Vue", viewpoint: "Vue",
  lighthouse: "Vue",
  // Culture
  museum: "Culture", art_gallery: "Culture", cultural_center: "Culture",
  performing_arts_theater: "Culture", movie_theater: "Culture",
  tourist_attraction: "Culture", historic_site: "Culture",
  monument: "Culture", aquarium: "Culture", zoo: "Culture",
  amusement_park: "Culture", planetarium: "Culture",
  // Shopping
  shopping_mall: "Shopping", clothing_store: "Shopping",
  shoe_store: "Shopping", jewelry_store: "Shopping",
  beauty_salon: "Shopping", hair_salon: "Shopping", spa: "Shopping",
  market: "Shopping", florist: "Shopping", book_store: "Shopping",
  department_store: "Shopping", electronics_store: "Shopping",
  gift_shop: "Shopping", cosmetics_store: "Shopping",
}

const PRICE_LABELS: Record<string, string> = {
  PRICE_LEVEL_FREE: "Gratuit",
  PRICE_LEVEL_INEXPENSIVE: "€",
  PRICE_LEVEL_MODERATE: "€€",
  PRICE_LEVEL_EXPENSIVE: "€€€",
  PRICE_LEVEL_VERY_EXPENSIVE: "€€€€",
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function categoryFromPlaces(place: PlacesResult, geminiCategory: string): IdentifiedPlace["categorie"] {
  // 1. primaryType Google → le plus fiable
  if (place.primaryType && PRIMARY_TYPE_TO_CATEGORY[place.primaryType]) {
    return PRIMARY_TYPE_TO_CATEGORY[place.primaryType]
  }
  // 2. Types secondaires
  // (pas exposés dans l'interface — primaryType suffit dans 95% des cas)
  // 3. Fallback : suggestion Gemini (basée sur le texte vidéo)
  const trimmed = geminiCategory?.trim() ?? ""
  if ((VALID_CATEGORIES as readonly string[]).includes(trimmed)) {
    return trimmed as IdentifiedPlace["categorie"]
  }
  const lower = trimmed.toLowerCase()
  const match = VALID_CATEGORIES.find(c => c.toLowerCase() === lower)
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
      const res = await fetch(apiUrl, { redirect: "manual", signal: AbortSignal.timeout(5000) })
      const cdnUrl = res.headers.get("location")
      results.push(cdnUrl ?? apiUrl)
    } catch {
      results.push(apiUrl)
    }
  }
  return results
}

// ---------------------------------------------------------------------------
// Phase 1 : Gemini — extraction des requêtes de recherche
// ---------------------------------------------------------------------------

async function geminiExtractQueries(meta: VideoMetadata, geminiKey: string): Promise<GeminiPass> {
  const genAI = new GoogleGenerativeAI(geminiKey)
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0,
      maxOutputTokens: 2048,
      // @ts-ignore
      thinkingConfig: { thinkingBudget: 512 },
    },
  })

  const lines: string[] = []
  if (meta.locationHint) lines.push(`📍 Indication de lieu (source directe de la vidéo) : ${meta.locationHint}`)
  if (meta.title)         lines.push(`Titre : ${meta.title.slice(0, 300)}`)
  if (meta.description)   lines.push(`Description : ${meta.description.slice(0, 2000)}`)
  if (meta.hashtags?.length) lines.push(`Hashtags : ${meta.hashtags.slice(0, 20).join(" ")}`)
  if (meta.author)        lines.push(`Auteur : ${meta.author}`)

  const context = lines.length > 0 ? lines.join("\n") : "(aucune métadonnée)"

  const prompt = `Tu es un extracteur géographique ultra-précis. Ton seul objectif : trouver le nom et l'adresse du lieu montré dans cette vidéo.

PRIORITÉS pour identifier le lieu :
1. "📍 Indication de lieu" si présent → texte copié directement depuis la vidéo, priorité absolue.
2. Adresse postale explicite dans la description : numéro + rue + ville ou code postal.
3. Nom propre du lieu (établissement, restaurant, café, musée, etc.).
4. Ville dans les hashtags ou le contexte.

CONSTRUIRE LES REQUÊTES GOOGLE MAPS (1 à 3, de la plus précise à la plus vague) :
- Requête 1 : "Nom exact, Adresse complète" si adresse trouvée
- Requête 2 : "Nom exact, Ville, Pays" si ville connue
- Requête 3 : "Nom exact" seul en dernier recours

CATÉGORIE (une valeur parmi) : Café, Restaurant, Bar, Outdoor, Vue, Culture, Shopping
- Choisir selon le contenu réel de la vidéo.

RÈGLES : Ignore le bruit SEO. Si locationHint contient une virgule, après la virgule = adresse.

Métadonnées :
${context}

Renvoie UNIQUEMENT ce JSON :
{
  "queries": ["requête_1", "requête_2", "requête_3"],
  "categorie_suggeree": "UneCategorie"
}`

  const result = await model.generateContent(prompt)
  const raw = result.response.text().trim()
  console.log("[Phase 1] Gemini queries:", raw.slice(0, 300))

  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim()
  const parsed = JSON.parse(cleaned) as GeminiPass
  if (!Array.isArray(parsed.queries)) parsed.queries = []
  return parsed
}

// ---------------------------------------------------------------------------
// Phase 3b : Gemini — rédaction de la description enrichie (en parallèle)
// ---------------------------------------------------------------------------

async function geminiWriteDescription(
  place: PlacesResult,
  videoTitle: string | null | undefined,
  videoDesc: string | null | undefined,
  geminiKey: string
): Promise<string> {
  const genAI = new GoogleGenerativeAI(geminiKey)
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 300,
      // @ts-ignore
      thinkingConfig: { thinkingBudget: 0 },
    },
  })

  const nom = place.displayName?.text ?? ""
  const type = place.primaryTypeDisplayName?.text ?? ""
  const editorial = place.editorialSummary?.text ?? ""
  const rating = place.rating ? `${place.rating}/5 (${place.userRatingCount?.toLocaleString("fr-FR") ?? "?"} avis)` : null
  const price = place.priceLevel ? PRICE_LABELS[place.priceLevel] ?? null : null

  const contextLines: string[] = []
  if (editorial) contextLines.push(`Résumé Google : ${editorial}`)
  if (rating) contextLines.push(`Note : ${rating}`)
  if (price) contextLines.push(`Prix : ${price}`)
  if (videoTitle) contextLines.push(`Titre vidéo : ${videoTitle.slice(0, 150)}`)
  if (videoDesc) contextLines.push(`Contexte vidéo : ${videoDesc.slice(0, 400)}`)

  const prompt = `Rédige une description courte (2-3 phrases max) et utile pour un utilisateur qui découvre "${nom}" (${type || "lieu"}).

Données disponibles :
${contextLines.join("\n")}

Règles :
- Commence par ce qui rend l'endroit unique ou spécial.
- Inclure le niveau de prix si disponible (€, €€, etc.).
- Inclure la note Google si elle est ≥ 4.0 et pertinente.
- Intègre les détails concrets de la vidéo si utiles (plat phare, format, ambiance).
- Ton naturel, en français, sans marketing excessif.
- NE PAS commencer par le nom du lieu.`

  try {
    const result = await model.generateContent(prompt)
    return result.response.text().trim()
  } catch {
    return editorial || `${type} situé à ${place.formattedAddress ?? "Paris"}.`
  }
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

  if (!geminiKey) return { erreur: "Configuration serveur incorrecte (clé IA manquante)." }
  if (!placesKey) return { erreur: "Configuration serveur incorrecte (clé Maps manquante)." }

  // ── Phase 1 : Gemini extrait les requêtes ───────────────────────────────
  let geminiData: GeminiPass = { queries: [], categorie_suggeree: "" }
  try {
    geminiData = await geminiExtractQueries(meta, geminiKey)
  } catch (e) {
    console.error("[Phase 1] Erreur Gemini:", (e as Error).message)
  }

  // Cascade : locationHint avec nom en premier, adresse seule en dernier recours
  const allQueries: string[] = []
  const hint = meta.locationHint?.trim() ?? null
  const hintIsAddress = hint ? /^\d/.test(hint) : false

  if (hint && !hintIsAddress) allQueries.push(hint)
  for (const q of geminiData.queries) {
    if (q?.trim() && !allQueries.includes(q.trim())) allQueries.push(q.trim())
  }
  if (hint && hintIsAddress && !allQueries.includes(hint)) allQueries.push(hint)

  if (allQueries.length === 0) {
    return { erreur: "Lieu introuvable : aucun signal géographique détecté dans la vidéo." }
  }

  // ── Phase 2 : Google Places — cascade ──────────────────────────────────
  let places: PlacesResult[] = []
  let usedQuery = ""

  for (const query of allQueries) {
    try {
      const results = await searchGooglePlaces(query, placesKey)
      if (results.length > 0) {
        places = results
        usedQuery = query
        break
      }
    } catch (e) {
      console.error(`[Phase 2] Erreur Places "${query}":`, (e as Error).message)
    }
  }

  if (places.length === 0) {
    return { erreur: "Lieu introuvable sur Google Maps. Le nom n'est peut-être pas assez précis." }
  }

  const best = places[0]
  const nom_officiel_google = best.displayName?.text ?? ""
  const horaires = best.regularOpeningHours?.weekdayDescriptions ?? []

  // ── Phase 3 : Photos + Description en parallèle ─────────────────────────
  const [googlePhotosUrls, description] = await Promise.all([
    resolvePhotoUrls(best.photos ?? [], placesKey),
    geminiWriteDescription(best, meta.title, meta.description, geminiKey),
  ])

  // ── Phase 4 : Catégorie + Assemblage ────────────────────────────────────
  const categorie = categoryFromPlaces(best, geminiData.categorie_suggeree)

  const priceLine = best.priceLevel ? ` · ${PRICE_LABELS[best.priceLevel] ?? ""}` : ""
  const ratingLine = best.rating ? ` · ⭐ ${best.rating}/5` : ""
  console.log(`[Phase 4] ✓ "${nom_officiel_google}" | ${best.formattedAddress} | ${categorie}${priceLine}${ratingLine} | q: "${usedQuery}" | ${googlePhotosUrls.length} photos | ${horaires.length} horaires`)

  return {
    titre: nom_officiel_google,
    nom_officiel_google,
    description,
    categorie,
    adresse: best.formattedAddress ?? "",
    coordonnees: {
      lat: best.location?.latitude ?? 0,
      lng: best.location?.longitude ?? 0,
    },
    photos: googlePhotosUrls,
    horaires,
  }
}
