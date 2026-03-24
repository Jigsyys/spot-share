import { NextResponse } from "next/server"
import { GoogleGenerativeAI } from "@google/generative-ai"

export const maxDuration = 60

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ""

// ---------------------------------------------------------------------------
// Guide catégories (injecté dans les prompts LLM)
// ---------------------------------------------------------------------------
const CATEGORY_GUIDE = `Catégories disponibles (une seule, strictement) :
- cafe : café, boulangerie, pâtisserie, salon de thé, coffee shop, brunch
- restaurant : restaurant, pizzeria, brasserie, gastronomie, sushi, fast-food
- bar : bar, cocktail bar, pub, boîte de nuit, rooftop bar, wine bar
- outdoor : parc, plage, forêt, jardin, randonnée, lac, nature, piscine
- vue : belvédère, panorama, point de vue, terrasse avec vue, rooftop panoramique
- culture : musée, galerie d'art, théâtre, monument, église, exposition, cinéma
- shopping : boutique, magasin, salon de beauté, spa, nail art, coiffeur, institut, friperie, marché
- other : tout ce qui ne rentre dans aucune catégorie ci-dessus`

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function decodeHTML(str: string): string {
  if (!str) return ""
  return str
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/\\n/g, " ").replace(/\s+/g, " ").trim()
}

function extractOG(html: string) {
  const get = (prop: string) =>
    html.match(new RegExp(`<meta property="${prop}" content="([^"]*?)"\\s*/?>`)) ?.[1] ?? null
  return { title: get("og:title"), description: get("og:description") }
}

function usernameToName(handle: string): string {
  return handle.replace(/_/g, " ").replace(/-/g, " ")
    .split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ").trim()
}

/** Extrait @username et 📍 lieu depuis les données OG */
function parseOGData(rawTitle: string | null, rawDesc: string | null) {
  const full = `${rawTitle || ""} ${rawDesc || ""}`
  const usernameMatch = full.match(/@([\w.]+)/)
  const username = usernameMatch?.[1] || null

  const locMatch = full.match(/📍\s*([^"#\n]+)/i)
  let location = locMatch ? locMatch[1].replace(/["\s]+$/, "").replace(/#\w+/g, "").trim() : null

  let title = ""
  if (rawTitle) {
    const quoteMatch = rawTitle.match(/(?:sur|on) Instagram\s*:\s*"(.+?)"/i)
    if (quoteMatch) {
      const extracted = quoteMatch[1].replace(/📍\s*/g, "").replace(/#\w+/g, "").trim()
      title = extracted.split(",")[0].trim()
      if (!location && extracted.includes(",")) location = extracted.trim()
    } else {
      title = rawTitle.replace(/\s*(on|sur)\s*Instagram.*$/i, "").replace(/📍\s*/g, "").replace(/#\w+/g, "").trim()
    }
    title = title.replace(/^[A-Za-zÀ-ÿ\s]+\(@[\w.]+\)\s*$/i, "").trim()
    if (!title || title.toLowerCase().includes("instagram") || title.length < 2 || title.length > 50) title = ""
  }

  const rawText = full
    .replace(/^[\d,.]+ likes?,?\s*[\d,.]+ comments?\s*-\s*\w+\s*(le|on)?\s*[\w\s,.]+\.\s*/i, "")
    .replace(/\s*(on|sur)\s*Instagram.*$/i, "")
    .replace(/["']+/g, " ").replace(/📍\s*[^#\n]+/i, "").trim()

  return { title, location, rawText, username }
}

// ---------------------------------------------------------------------------
// ÉTAPE 1 : Extraction des métadonnées (yt-dlp → fallback OG)
// ---------------------------------------------------------------------------

interface VideoMeta {
  title: string
  description: string
  tags: string[]
  uploader: string | null
  username: string | null
}

async function extractMetadata(url: string): Promise<VideoMeta> {
  // Tentative yt-dlp (extrait les vraies métadonnées : titre, description, hashtags)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ytDlp = require("yt-dlp-exec")
    const info = await ytDlp(url, {
      dumpSingleJson: true,
      skipDownload: true,
      noWarnings: true,
      quiet: true,
    }) as {
      title?: string
      description?: string
      tags?: string[]
      uploader?: string
      uploader_id?: string
      channel?: string
    }
    if (info?.title || info?.description) {
      console.log("[yt-dlp] OK — title:", info.title?.slice(0, 80))
      const uploaderRaw = info.uploader_id || info.uploader || info.channel || null
      const username = uploaderRaw ? uploaderRaw.replace(/^@/, "") : null
      return {
        title: info.title || "",
        description: info.description || "",
        tags: info.tags || [],
        uploader: info.uploader || null,
        username,
      }
    }
  } catch (e) {
    console.warn("[yt-dlp] failed:", (e as Error).message?.slice(0, 100))
  }

  // Fallback : scraping OG tags
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      },
      signal: AbortSignal.timeout(8000),
    })
    if (res.ok) {
      const html = await res.text()
      const og = extractOG(html)
      const ogTitle = og.title ? decodeHTML(og.title) : null
      const ogDesc = og.description ? decodeHTML(og.description) : null
      const parsed = parseOGData(ogTitle, ogDesc)
      return {
        title: parsed.title || ogTitle || "",
        description: parsed.rawText,
        tags: [],
        uploader: parsed.username ? usernameToName(parsed.username) : null,
        username: parsed.username,
      }
    }
  } catch { /* bloqué */ }

  return { title: "", description: "", tags: [], uploader: null, username: null }
}

// ---------------------------------------------------------------------------
// ÉTAPE 2 : LLM Pass 1 — Hypothèse nom+ville (avec ou sans grounding)
// ---------------------------------------------------------------------------

interface AiHypothesis {
  name: string
  city: string
  address: string | null
  category: string
}

async function callGemini(prompt: string, maxTokens = 150): Promise<string | null> {
  if (!process.env.GEMINI_API_KEY) return null
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const modelId = attempt === 0 ? "gemini-2.0-flash" : "gemma-3-27b-it"
      const model = genAI.getGenerativeModel({ model: modelId })
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: maxTokens },
      })
      return result.response.text().trim()
    } catch (e: any) {
      if (e?.status === 429 || e?.message?.includes("429")) {
        console.warn(`[Gemini 429] attempt ${attempt + 1}, waiting 2s...`)
        await new Promise((r) => setTimeout(r, 2000))
        continue
      }
      console.error("[Gemini error]:", e?.message)
      return null
    }
  }
  return null
}

async function extractHypothesis(
  postUrl: string,
  meta: VideoMeta,
  userCity: string | null
): Promise<AiHypothesis | null> {
  const noContext = !meta.title && !meta.description && !meta.tags.length

  if (noContext && meta.username) {
    // Aucun texte disponible → Gemini grounding cherche sur Google
    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", tools: [{ googleSearch: {} }] as any })
      const ctx = [
        `URL du post: ${postUrl}`,
        `Compte Instagram: @${meta.username} (nom: "${usernameToName(meta.username)}")`,
        userCity ? `Ville de l'utilisateur: ${userCity}` : "",
      ].filter(Boolean).join("\n")

      const prompt = `Tu es un expert OSINT spécialisé dans l'identification de lieux.
${ctx}

1. Recherche sur Google le compte "@${meta.username}"${userCity ? ` dans "${userCity}"` : ""}.
2. Identifie l'établissement exact (nom officiel, adresse, type).

${CATEGORY_GUIDE}

Réponds UNIQUEMENT avec ce JSON valide :
{"name":"Nom officiel exact","city":"Ville","address":"Numéro rue, Ville","category":"..."}
Si c'est un compte personnel : {"name":null}`

      const result = await model.generateContent(prompt)
      const text = result.response.text().trim()
      console.log("[Gemini grounding]", text.slice(0, 200))
      const match = text.match(/\{[\s\S]*?\}/)
      if (match) {
        const parsed = JSON.parse(match[0])
        if (parsed.name && parsed.name !== "null") return { address: null, ...parsed }
      }
    } catch (e) {
      console.error("[Gemini grounding error]:", e)
    }
    return null
  }

  // Contexte disponible → LLM classique
  const ctx = [
    `URL: ${postUrl}`,
    meta.username ? `Compte: @${meta.username} (nom: "${usernameToName(meta.username)}")` : "",
    meta.title ? `Titre: "${meta.title}"` : "",
    meta.description ? `Description: "${meta.description.slice(0, 500)}"` : "",
    meta.tags.length ? `Hashtags: ${meta.tags.slice(0, 10).join(" ")}` : "",
    userCity ? `Ville de l'utilisateur: ${userCity}` : "",
  ].filter(Boolean).join("\n")

  const prompt = `Tu es un expert en identification de lieux à partir de vidéos sociales.

Données de la vidéo :
${ctx}

MISSION : Identifie le lieu exact présenté dans cette vidéo.
- Utilise le contexte géographique de l'utilisateur.
- Extrait le nom officiel et l'adresse si mentionnés.

${CATEGORY_GUIDE}

Réponds UNIQUEMENT avec ce JSON valide :
{"name":"Nom exact","city":"Ville","address":"Adresse ou null","category":"..."}`

  const raw = await callGemini(prompt, 150)
  if (!raw) return null
  try {
    const match = raw.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
  } catch { /* */ }
  return null
}

// ---------------------------------------------------------------------------
// ÉTAPE 3a : Google Places Text Search → place_id
// ---------------------------------------------------------------------------

interface PlaceSearchResult {
  placeId: string
  name: string
  address: string
  lat: number
  lng: number
  types: string[]
  photoRef: string | null
}

async function searchGooglePlace(
  query: string,
  userLat: number | null,
  userLng: number | null
): Promise<PlaceSearchResult | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey || !query) return null
  const locationBias = userLat != null && userLng != null
    ? `&location=${userLat},${userLng}&radius=15000` : ""
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&language=fr${locationBias}&key=${apiKey}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (res.status === 429) {
      console.warn("[Google Places 429] waiting 1s...")
      await new Promise((r) => setTimeout(r, 1000))
      const retry = await fetch(url, { signal: AbortSignal.timeout(8000) })
      if (!retry.ok) return null
      const d = await retry.json()
      return d.results?.[0] ? mapPlaceResult(d.results[0]) : null
    }
    const data = await res.json()
    console.log(`[Google textsearch] "${query}" → ${data.results?.length ?? 0} résultats (${data.status})`)
    if (!data.results?.length) return null
    return mapPlaceResult(data.results[0])
  } catch (e) {
    console.error("[Google textsearch error]:", e)
    return null
  }
}

function mapPlaceResult(p: any): PlaceSearchResult {
  return {
    placeId: p.place_id,
    name: p.name || "",
    address: p.formatted_address || "",
    lat: p.geometry?.location?.lat ?? 0,
    lng: p.geometry?.location?.lng ?? 0,
    types: p.types || [],
    photoRef: p.photos?.[0]?.photo_reference || null,
  }
}

// ---------------------------------------------------------------------------
// ÉTAPE 3b : Google Place Details → adresse exacte, URL Maps, photos
// ---------------------------------------------------------------------------

interface PlaceDetails {
  name: string
  address: string
  lat: number
  lng: number
  types: string[]
  mapsUrl: string | null
  photoUrls: string[]
}

async function getPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey || !placeId) return null
  const fields = "name,formatted_address,geometry,types,photos,url"
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&language=fr&key=${apiKey}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    const data = await res.json()
    if (data.status !== "OK" || !data.result) return null
    const r = data.result

    const photoUrls: string[] = (r.photos || [])
      .slice(0, 3)
      .map((p: any) =>
        `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${p.photo_reference}&key=${apiKey}`
      )

    console.log(`[Place Details] "${r.name}" → ${r.formatted_address}`)
    return {
      name: r.name || "",
      address: r.formatted_address || "",
      lat: r.geometry?.location?.lat ?? 0,
      lng: r.geometry?.location?.lng ?? 0,
      types: r.types || [],
      mapsUrl: r.url || null,
      photoUrls,
    }
  } catch (e) {
    console.error("[Place Details error]:", e)
    return null
  }
}

// ---------------------------------------------------------------------------
// Catégorie : mapping Google types → nos catégories
// ---------------------------------------------------------------------------

const GOOGLE_TYPES_MAP: Record<string, string> = {
  cafe: "café", coffee_shop: "café", bakery: "café",
  restaurant: "restaurant", meal_delivery: "restaurant", meal_takeaway: "restaurant",
  bar: "bar", night_club: "bar",
  park: "outdoor", campground: "outdoor", natural_feature: "outdoor",
  museum: "culture", art_gallery: "culture", movie_theater: "culture",
  tourist_attraction: "culture", point_of_interest: "culture",
  shopping_mall: "shopping", clothing_store: "shopping", store: "shopping",
  beauty_salon: "shopping", hair_care: "shopping", spa: "shopping",
  gym: "shopping", health: "shopping",
}

function googleTypesToCategory(types: string[]): string | null {
  for (const t of types) {
    if (GOOGLE_TYPES_MAP[t]) return GOOGLE_TYPES_MAP[t]
  }
  if (types.some(t => t.includes("beauty") || t.includes("hair") || t.includes("spa") || t.includes("nail"))) return "shopping"
  if (types.some(t => t.includes("food") || t.includes("meal"))) return "restaurant"
  if (types.some(t => t.includes("bar") || t.includes("night"))) return "bar"
  return null
}

const CATEGORY_NORMALIZE: Record<string, string> = {
  "café": "café", "cafe": "café", "coffee": "café", "patisserie": "café", "pâtisserie": "café",
  "boulangerie": "café", "salon de thé": "café", "brunch": "café",
  "restaurant": "restaurant", "resto": "restaurant", "bistro": "restaurant",
  "brasserie": "restaurant", "pizzeria": "restaurant", "gastronomie": "restaurant",
  "bar": "bar", "cocktail": "bar", "pub": "bar", "rooftop": "bar",
  "outdoor": "outdoor", "parc": "outdoor", "nature": "outdoor", "plage": "outdoor",
  "vue": "vue", "panorama": "vue", "belvédère": "vue",
  "culture": "culture", "musée": "culture", "museum": "culture", "galerie": "culture",
  "shopping": "shopping", "boutique": "shopping", "friperie": "shopping",
  "salon": "shopping", "spa": "shopping", "beauté": "shopping", "beauty": "shopping",
  "institut": "shopping", "soin": "shopping", "nail": "shopping", "coiffeur": "shopping",
  "wellness": "shopping", "bien-être": "shopping", "massage": "shopping",
  "other": "other", "autre": "other",
}

function normalizeCategory(raw: string | null | undefined): string {
  if (!raw) return "other"
  const lower = raw.trim().toLowerCase()
  if (CATEGORY_NORMALIZE[lower]) return CATEGORY_NORMALIZE[lower]
  for (const [key, val] of Object.entries(CATEGORY_NORMALIZE)) {
    if (lower.includes(key) || key.includes(lower)) return val
  }
  return "other"
}

// ---------------------------------------------------------------------------
// ÉTAPE 4 : LLM Pass 2 — Formatage final avec données Google Maps réelles
// ---------------------------------------------------------------------------

interface FinalData {
  description: string
  category: string
}

async function formatFinalData(
  videoMeta: VideoMeta,
  placeDetails: PlaceDetails
): Promise<FinalData> {
  const videoCtx = [
    videoMeta.title,
    videoMeta.description.slice(0, 300),
    videoMeta.tags.slice(0, 8).join(" "),
  ].filter(Boolean).join(" | ").trim()

  const prompt = `Tu es un curateur local expert. Je te fournis des données officielles de Google Maps concernant un lieu identifié dans une vidéo.

Contexte de la vidéo : "${videoCtx || "non disponible"}"
Données Google Maps :
- Nom officiel : ${placeDetails.name}
- Adresse : ${placeDetails.address}
- Types Google : ${placeDetails.types.join(", ")}

Règles strictes :
1. Rédige une description courte et accrocheuse (2 phrases max) basée sur l'ambiance de la vidéo et du lieu.
2. Choisis UNE catégorie parmi : cafe, restaurant, bar, outdoor, vue, culture, shopping, other.
   ${CATEGORY_GUIDE}

Réponds UNIQUEMENT avec ce JSON valide :
{"description":"Ta description...","category":"..."}
`

  const raw = await callGemini(prompt, 150)
  if (raw) {
    try {
      const match = raw.match(/\{[\s\S]*\}/)
      if (match) {
        const parsed = JSON.parse(match[0])
        if (parsed.description && parsed.category) return parsed
      }
    } catch { /* */ }
  }

  // Fallback si LLM échoue
  const googleCat = googleTypesToCategory(placeDetails.types) || "other"
  return {
    description: `Découvrez ${placeDetails.name}, un lieu incontournable situé ${placeDetails.address}.`,
    category: googleCat,
  }
}

// ---------------------------------------------------------------------------
// Mapbox : reverse geocode (ville depuis GPS)
// ---------------------------------------------------------------------------

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  if (!MAPBOX_TOKEN) return null
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&types=place&language=fr&limit=1`,
      { signal: AbortSignal.timeout(5000) }
    )
    const data = await res.json()
    return data.features?.[0]?.text || null
  } catch { return null }
}

async function geocodeFallback(query: string): Promise<{ lat: number; lng: number; place_name: string } | null> {
  if (!MAPBOX_TOKEN || !query) return null
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&limit=1&language=fr`,
      { signal: AbortSignal.timeout(5000) }
    )
    const data = await res.json()
    if (data.features?.[0]) {
      const f = data.features[0]
      return { lat: f.center[1], lng: f.center[0], place_name: f.place_name }
    }
  } catch { /* */ }
  return null
}

// ---------------------------------------------------------------------------
// API Route principale — Pipeline 4 étapes
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const url = searchParams.get("url")
  const userLatParam = searchParams.get("lat")
  const userLngParam = searchParams.get("lng")

  if (!url || (!url.includes("instagram.com") && !url.includes("tiktok.com"))) {
    return NextResponse.json({ error: "URL invalide. Seuls Instagram et TikTok sont acceptés." }, { status: 400 })
  }

  try {
    const userLatN = userLatParam ? parseFloat(userLatParam) : null
    const userLngN = userLngParam ? parseFloat(userLngParam) : null

    // ── Ville GPS de l'utilisateur ──────────────────────────────────────
    let userCity: string | null = null
    if (userLatN != null && userLngN != null && !isNaN(userLatN) && !isNaN(userLngN)) {
      userCity = await reverseGeocode(userLatN, userLngN)
      console.log(`[GPS] ${userLatN},${userLngN} → "${userCity}"`)
    }

    // ── ÉTAPE 1 : Extraction métadonnées (yt-dlp → OG fallback) ─────────
    console.log("[Step 1] Extracting metadata...")
    const meta = await extractMetadata(url)
    console.log(`[Step 1] title="${meta.title.slice(0, 60)}" desc=${meta.description.length}chars username="${meta.username}"`)

    // ── ÉTAPE 2 : LLM Pass 1 — hypothèse nom+ville ──────────────────────
    console.log("[Step 2] LLM hypothesis...")
    const hypothesis = await extractHypothesis(url, meta, userCity)
    const usernameAsName = meta.username ? usernameToName(meta.username) : null
    const placeName = hypothesis?.name || usernameAsName || meta.title.split("\n")[0].slice(0, 60) || "Nouveau Spot"
    const placeCity = hypothesis?.city || userCity || null
    console.log(`[Step 2] name="${placeName}" city="${placeCity}" cat="${hypothesis?.category}"`)

    // ── ÉTAPE 3 : Google Places — Text Search puis Place Details ─────────
    console.log("[Step 3] Google Places...")
    let searchResult: PlaceSearchResult | null = null

    // Tentatives par ordre de précision
    const queries = [
      hypothesis?.address,
      placeCity ? `${placeName} ${placeCity}` : null,
      usernameAsName && placeCity && usernameAsName !== placeName ? `${usernameAsName} ${placeCity}` : null,
      placeName,
      usernameAsName !== placeName ? usernameAsName : null,
    ].filter(Boolean) as string[]

    for (const q of queries) {
      searchResult = await searchGooglePlace(q, userLatN, userLngN)
      if (searchResult) { console.log(`[Step 3] Found via "${q}": ${searchResult.name}`); break }
    }

    let placeDetails: PlaceDetails | null = null
    if (searchResult?.placeId) {
      placeDetails = await getPlaceDetails(searchResult.placeId)
    }

    // ── ÉTAPE 4 : LLM Pass 2 — Formatage final avec données Maps réelles ─
    console.log("[Step 4] Final LLM formatting...")
    let finalDesc = ""
    let finalCategory = "other"

    if (placeDetails) {
      const formatted = await formatFinalData(meta, placeDetails)
      finalDesc = formatted.description
      // Catégorie : LLM > Google types > hypothesis normalisée
      finalCategory = normalizeCategory(formatted.category) !== "other"
        ? normalizeCategory(formatted.category)
        : googleTypesToCategory(placeDetails.types) || normalizeCategory(hypothesis?.category) || "other"
    } else {
      // Aucun lieu Google trouvé : LLM seul pour la description
      finalCategory = normalizeCategory(hypothesis?.category)
      if (placeName !== "Nouveau Spot") {
        finalDesc = await callGemini(
          `Écris 2 phrases accrocheuses pour le lieu "${placeName}" (${finalCategory}). Ton dynamique, sans adresse ni hashtag.`,
          100
        ) || `Découvrez ${placeName}, un lieu à ne pas manquer !`
      }
    }

    // Coordonnées finales (Place Details > Mapbox fallback)
    let coordinates: { lat: number; lng: number } | null = null
    let resolvedAddress: string | null = null
    let photosUrl: string | null = null
    let mapsUrl: string | null = null

    if (placeDetails) {
      coordinates = { lat: placeDetails.lat, lng: placeDetails.lng }
      resolvedAddress = placeDetails.address
      photosUrl = placeDetails.photoUrls[0] || null
      mapsUrl = placeDetails.mapsUrl
    }

    if (!coordinates) {
      const fallbackQ = placeCity ? `${placeName}, ${placeCity}` : placeName
      const geo = await geocodeFallback(fallbackQ)
      if (geo) { coordinates = { lat: geo.lat, lng: geo.lng }; resolvedAddress = geo.place_name }
    }

    return NextResponse.json({
      title: placeDetails?.name || placeName,
      description: finalDesc || `Découvrez ${placeName}, un lieu à ne pas manquer !`,
      location: resolvedAddress,
      category: finalCategory,
      image_url: photosUrl,
      coordinates,
      maps_url: mapsUrl,
    })
  } catch (e) {
    console.error("[Pipeline error]:", e)
    return NextResponse.json({ error: "Erreur lors de la récupération" }, { status: 500 })
  }
}
