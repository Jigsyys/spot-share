import { NextResponse } from "next/server"
import { GoogleGenerativeAI } from "@google/generative-ai"

export const maxDuration = 60

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ""

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function decodeHTML(str: string): string {
  if (!str) return ""
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function extractOG(html: string) {
  const get = (prop: string) =>
    html.match(
      new RegExp(`<meta property="${prop}" content="([^"]*?)"\\s*/?>`)
    )?.[1] ?? null
  return { title: get("og:title"), description: get("og:description") }
}

// ---------------------------------------------------------------------------
// Nettoyage OG brut Instagram + extraction username
// ---------------------------------------------------------------------------

/** Convertit un handle Instagram en nom lisible : "le_couteau" → "Le Couteau" */
function usernameToName(handle: string): string {
  return handle
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
    .trim()
}

function cleanOGData(rawTitle: string | null, rawDescription: string | null) {
  let title = ""
  let location: string | null = null
  let username: string | null = null
  const fullText = `${rawTitle || ""} ${rawDescription || ""}`

  // Extraire le @username du titre OG (ex: "Sarah Piot (@le_couteau) • Instagram reel")
  const usernameMatch = fullText.match(/@([\w.]+)/)
  if (usernameMatch) username = usernameMatch[1]

  // Extraire 📍 lieu
  const locMatch = fullText.match(/📍\s*([^"#\n]+)/i)
  if (locMatch) {
    location = locMatch[1].replace(/["\s]+$/, "").replace(/#\w+/g, "").trim()
  }

  if (rawTitle) {
    const quoteMatch = rawTitle.match(/(?:sur|on) Instagram\s*:\s*"(.+?)"/i)
    if (quoteMatch) {
      const extracted = quoteMatch[1].replace(/📍\s*/g, "").replace(/#\w+/g, "").trim()
      const parts = extracted.split(",")
      title = parts[0].trim()
      if (!location && parts.length > 1) location = extracted.trim()
    } else {
      title = rawTitle.replace(/\s*(on|sur)\s*Instagram.*$/i, "").replace(/📍\s*/g, "").replace(/#\w+/g, "").trim()
    }
  }

  // Supprimer le "Prénom Nom (@username)" si c'est juste le nom de l'auteur
  title = title.replace(/^[A-Za-zÀ-ÿ\s]+\(@[\w.]+\)\s*$/i, "").trim()

  if (!title || title.toLowerCase() === "instagram" || title.toLowerCase().includes("login") || title.length < 2) {
    title = location ? location.split(",")[0].trim() : ""
  }

  if (title.length > 50) title = ""

  const cleanRawText = fullText
    .replace(/^[\d,.]+ likes?,?\s*[\d,.]+ comments?\s*-\s*\w+\s*(le|on)?\s*[\w\s,.]+\.\s*/i, "")
    .replace(/\s*(on|sur)\s*Instagram.*$/i, "")
    .replace(/["']+/g, " ")
    .replace(/📍\s*[^#\n]+/i, "")
    .trim()

  return { title, location, rawText: cleanRawText, username }
}

// ---------------------------------------------------------------------------
// Catégorie : normalisation
// ---------------------------------------------------------------------------

const CATEGORY_NORMALIZE: Record<string, string> = {
  "café": "café", "cafe": "café", "coffee": "café", "patisserie": "café",
  "pâtisserie": "café", "boulangerie": "café", "salon de thé": "café",
  "restaurant": "restaurant", "resto": "restaurant", "bistro": "restaurant",
  "brasserie": "restaurant", "pizzeria": "restaurant", "gastronomie": "restaurant",
  "bar": "bar", "cocktail": "bar", "pub": "bar", "rooftop": "bar", "brasserie bar": "bar",
  "outdoor": "outdoor", "parc": "outdoor", "nature": "outdoor", "plage": "outdoor", "jardin": "outdoor",
  "vue": "vue", "panorama": "vue", "belvédère": "vue",
  "culture": "culture", "musée": "culture", "museum": "culture", "galerie": "culture",
  "shopping": "shopping", "boutique": "shopping", "friperie": "shopping",
  "salon": "shopping", "spa": "shopping", "beauté": "shopping", "beauty": "shopping",
  "institut": "shopping", "soin": "shopping", "nail": "shopping", "coiffeur": "shopping",
  "wellness": "shopping", "bien-être": "shopping", "massage": "shopping",
  "other": "other", "autre": "other",
}

function normalizeCategory(raw: string | undefined | null): string {
  if (!raw) return "other"
  const lower = raw.trim().toLowerCase()
  if (CATEGORY_NORMALIZE[lower]) return CATEGORY_NORMALIZE[lower]
  for (const [key, val] of Object.entries(CATEGORY_NORMALIZE)) {
    if (lower.includes(key) || key.includes(lower)) return val
  }
  return "other"
}

// ---------------------------------------------------------------------------
// Mapbox Geocoding — reverse + forward
// ---------------------------------------------------------------------------

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  if (!MAPBOX_TOKEN) return null
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&types=place&language=fr&limit=1`,
      { signal: AbortSignal.timeout(5000) }
    )
    const data = await res.json()
    const city = data.features?.[0]?.text
    return city || null
  } catch {
    return null
  }
}

async function geocode(query: string): Promise<{ lat: number; lng: number; place_name: string } | null> {
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
// Google Places : Find Place (API classique textsearch)
// ---------------------------------------------------------------------------

interface GooglePlaceResult {
  name: string | null
  address: string | null
  lat: number | null
  lng: number | null
  types: string[]
  photoUrls: string | null
  editorial: string | null
}

async function findPlaceOnGoogle(
  query: string,
  userLat?: number | null,
  userLng?: number | null
): Promise<GooglePlaceResult | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey || !query) return null

  try {
    // Location bias : si on connaît la position de l'utilisateur, on l'utilise pour biaiser vers sa zone
    const locationBias = userLat != null && userLng != null
      ? `&location=${userLat},${userLng}&radius=15000`
      : ""
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&language=fr${locationBias}&key=${apiKey}`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    const data = await res.json()

    console.log(`[Google textsearch] query="${query}" -> ${data.results?.length ?? 0} results, status=${data.status}`)

    if (!data.results || data.results.length === 0) return null

    const place = data.results[0]

    let photoUrls: string | null = null
    if (place.photos && place.photos.length > 0) {
      const urls: string[] = []
      const maxPhotos = Math.min(3, place.photos.length)
      for (let i = 0; i < maxPhotos; i++) {
        const ref = place.photos[i].photo_reference
        if (ref) {
          urls.push(
            `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${ref}&key=${apiKey}`
          )
        }
      }
      if (urls.length > 0) photoUrls = urls.join(",")
    }

    console.log(`[Google textsearch] Found: "${place.name}" @ ${place.formatted_address}`)

    return {
      name: place.name || null,
      address: place.formatted_address || null,
      lat: place.geometry?.location?.lat ?? null,
      lng: place.geometry?.location?.lng ?? null,
      types: place.types || [],
      photoUrls,
      editorial: null,
    }
  } catch (e) {
    console.error("[Google textsearch error]:", e)
    return null
  }
}

function googleTypesToCategory(types: string[]): string | null {
  const map: Record<string, string> = {
    cafe: "café", coffee_shop: "café", bakery: "café",
    restaurant: "restaurant", meal_delivery: "restaurant", meal_takeaway: "restaurant",
    food: "restaurant",
    bar: "bar", night_club: "bar",
    park: "outdoor", campground: "outdoor", natural_feature: "outdoor",
    museum: "culture", art_gallery: "culture", movie_theater: "culture",
    church: "culture", hindu_temple: "culture", mosque: "culture", synagogue: "culture",
    tourist_attraction: "culture", point_of_interest: "culture",
    shopping_mall: "shopping", clothing_store: "shopping", store: "shopping",
    book_store: "shopping", shoe_store: "shopping",
  }
  for (const t of types) {
    if (map[t]) return map[t]
  }
  // Fallback partiel sur les types Google
  if (types.some(t => t.includes("beauty") || t.includes("hair") || t.includes("spa") || t.includes("nail"))) return "shopping"
  if (types.some(t => t.includes("food") || t.includes("meal"))) return "restaurant"
  if (types.some(t => t.includes("bar") || t.includes("night"))) return "bar"
  return null
}

// ---------------------------------------------------------------------------
// Gemini helpers
// ---------------------------------------------------------------------------

async function callGemini(prompt: string, maxTokens: number = 100): Promise<string | null> {
  if (!process.env.GEMINI_API_KEY) return null
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" })
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: maxTokens },
      })
      return result.response.text().trim()
    } catch (e: any) {
      if (e?.status === 429 || e?.message?.includes("429")) {
        console.warn("[Gemini 429] Fallback Gemma 3 27B")
        const gemma = genAI.getGenerativeModel({ model: "gemma-3-27b-it" })
        const result = await gemma.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: maxTokens },
        })
        return result.response.text().trim()
      }
      throw e
    }
  } catch (e) {
    console.error("[Gemini error]:", e)
    return null
  }
}

interface AiExtraction {
  name: string
  city: string
  address: string | null
  category: string
}

// Guide des catégories injecté dans tous les prompts
const CATEGORY_GUIDE = `Catégories disponibles (choisis la plus précise) :
- cafe : café, boulangerie, pâtisserie, salon de thé, coffee shop, brunch
- restaurant : restaurant, pizzeria, brasserie, gastronomie, sushi, fast-food
- bar : bar, cocktail bar, pub, boîte de nuit, rooftop bar, wine bar
- outdoor : parc, plage, forêt, jardin, randonnée, lac, nature, piscine
- vue : belvédère, panorama, point de vue, terrasse avec vue, rooftop panoramique
- culture : musée, galerie d'art, théâtre, monument, église, exposition, cinéma
- shopping : boutique, magasin, salon de beauté, spa, nail art, coiffeur, institut, friperie, marché
- other : tout ce qui ne rentre dans aucune catégorie ci-dessus`

// ---------------------------------------------------------------------------
// Gemini avec Google Search grounding — reçoit TOUTES les informations
// ---------------------------------------------------------------------------

async function searchPlaceWithGrounding(
  instagramUrl: string,
  username: string | null,
  ogTitle: string | null,
  ogText: string | null,
  userCity: string | null
): Promise<AiExtraction | null> {
  if (!process.env.GEMINI_API_KEY) return null
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      tools: [{ googleSearch: {} }] as any,
    })

    const ctx: string[] = [`URL du post: ${instagramUrl}`]
    if (username) ctx.push(`Compte Instagram: @${username} (nom probable: "${usernameToName(username)}")`)
    if (ogTitle) ctx.push(`Titre extrait: "${ogTitle}"`)
    if (ogText) ctx.push(`Texte extrait: "${ogText.slice(0, 400)}"`)
    if (userCity) ctx.push(`Ville de l'utilisateur (contexte géographique): ${userCity}`)

    const prompt = `Tu es un expert OSINT spécialisé dans l'identification de lieux.

Données du post :
${ctx.join("\n")}

MISSION :
1. Recherche sur Google le compte Instagram "@${username || ""}"${userCity ? ` dans la ville "${userCity}"` : ""}.
2. Identifie l'établissement exact (nom officiel, adresse postale complète, type).
3. Si le compte correspond à un lieu public, retourne ses infos précises.

${CATEGORY_GUIDE}

Réponds UNIQUEMENT avec ce JSON valide (aucun autre texte) :
{"name":"Nom officiel exact","city":"Ville","address":"Numéro rue, Ville, Pays","category":"cafe|restaurant|bar|outdoor|vue|culture|shopping|other"}
Si c'est un compte personnel sans lieu associé : {"name":null}`

    const result = await model.generateContent(prompt)
    const text = result.response.text().trim()
    console.log(`[Gemini grounding] -> "${text.slice(0, 300)}"`)

    const match = text.match(/\{[\s\S]*?\}/)
    if (match) {
      const parsed = JSON.parse(match[0])
      if (parsed.name && parsed.name !== "null") return { address: null, ...parsed }
    }
    return null
  } catch (e) {
    console.error("[Gemini grounding error]:", e)
    return null
  }
}

// ---------------------------------------------------------------------------
// Extraction classique enrichie (quand on a du texte de caption)
// ---------------------------------------------------------------------------

async function extractPlaceInfo(
  instagramUrl: string,
  username: string | null,
  titleHint: string,
  locationHint: string | null,
  rawText: string,
  userCity: string | null
): Promise<AiExtraction | null> {
  const shortText = rawText.length > 500 ? rawText.slice(0, 500) : rawText

  const ctx: string[] = [`URL: ${instagramUrl}`]
  if (username) ctx.push(`Compte: @${username} (nom: "${usernameToName(username)}")`)
  if (titleHint) ctx.push(`Titre du post: "${titleHint}"`)
  if (locationHint) ctx.push(`Localisation mentionnée: "${locationHint}"`)
  if (userCity) ctx.push(`Ville de l'utilisateur: ${userCity}`)
  if (shortText) ctx.push(`Texte du post: "${shortText}"`)

  const prompt = `Tu es un expert en identification de lieux à partir de posts sociaux.

Données :
${ctx.join("\n")}

MISSION : Identifie le lieu exact présenté dans ce post.
- Utilise le contexte géographique de la ville de l'utilisateur.
- Si le titre ou le texte contient un nom de lieu, utilise-le.
- Si une adresse est mentionnée dans le texte, extrait-la.

${CATEGORY_GUIDE}

Réponds UNIQUEMENT avec ce JSON valide :
{"name":"Nom exact","city":"Ville","address":"Adresse complète ou null","category":"cafe|restaurant|bar|outdoor|vue|culture|shopping|other"}`

  const raw = await callGemini(prompt, 150)
  if (!raw) return null
  try {
    const match = raw.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function generateDescription(
  placeName: string,
  category: string,
  address: string
): Promise<string | null> {
  const prompt = `Écris 1 à 2 phrases engageantes pour donner envie de visiter "${placeName}" (${category}) situé ${address}. Pas de hashtag, pas d'adresse dans la réponse. Ton dynamique.`
  return callGemini(prompt, 100)
}

// ---------------------------------------------------------------------------
// API Route
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
    // ------------------------------------------------------------------
    // 0. Ville de l'utilisateur (GPS passé depuis le frontend)
    // ------------------------------------------------------------------
    let userCity: string | null = null
    if (userLatParam && userLngParam) {
      const lat = parseFloat(userLatParam)
      const lng = parseFloat(userLngParam)
      if (!isNaN(lat) && !isNaN(lng)) {
        userCity = await reverseGeocode(lat, lng)
        console.log(`[User city] lat=${lat} lng=${lng} -> "${userCity}"`)
      }
    }

    // ------------------------------------------------------------------
    // 1. Scraping OG tags
    // ------------------------------------------------------------------
    let ogTitle: string | null = null
    let ogDescription: string | null = null

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
        if (og.title) ogTitle = decodeHTML(og.title)
        if (og.description) ogDescription = decodeHTML(og.description)
      }
    } catch { /* Instagram bloqué */ }

    // ------------------------------------------------------------------
    // 2. Nettoyage
    // ------------------------------------------------------------------
    const cleaned = cleanOGData(ogTitle, ogDescription)
    const usernameAsName = cleaned.username ? usernameToName(cleaned.username) : null

    console.log(`[OG] title="${cleaned.title}" location="${cleaned.location}" username="${cleaned.username}"`)

    // ------------------------------------------------------------------
    // 3. Extraction AI du lieu
    //    - Si le titre est vide (Instagram a tout bloqué) → Gemini grounding
    //    - Sinon → extraction classique avec la caption
    // ------------------------------------------------------------------
    let aiData: AiExtraction | null = null
    const hasContext = cleaned.title.length > 0 || cleaned.rawText.length > 10

    if (!hasContext && cleaned.username) {
      // Instagram a bloqué → Gemini grounding avec toutes les infos disponibles
      console.log(`[Step 3] No OG context, using Gemini grounding for "@${cleaned.username}"`)
      aiData = await searchPlaceWithGrounding(url, cleaned.username, ogTitle, cleaned.rawText, userCity)
    } else {
      // Caption disponible → extraction classique enrichie
      const effectiveTitleHint = cleaned.title || usernameAsName || ""
      const effectiveLocationHint = cleaned.location || userCity
      aiData = await extractPlaceInfo(url, cleaned.username, effectiveTitleHint, effectiveLocationHint, cleaned.rawText, userCity)

      // Si la ville est manquante mais qu'on a userCity, on l'injecte
      if (aiData && !aiData.city && userCity) {
        aiData = { ...aiData, city: userCity }
      }
    }

    // Nom final du lieu
    const placeName = (aiData?.name && aiData.name.length <= 60 && aiData.name !== "Nouveau Spot")
      ? aiData.name
      : (usernameAsName || cleaned.title || "Nouveau Spot")

    // Ville finale : Gemini > userCity > null
    const placeCity = aiData?.city || userCity || null
    let finalCategory = normalizeCategory(aiData?.category)

    console.log(`[Step 3] AI: name="${aiData?.name}" city="${placeCity}" cat="${finalCategory}" -> placeName="${placeName}"`)

    // ------------------------------------------------------------------
    // 4. Google Maps textsearch : trouver le lieu EXACT
    //    Les coordonnées GPS servent de biais de localisation sur chaque requête
    // ------------------------------------------------------------------
    let googlePlace: GooglePlaceResult | null = null
    const userLatN = userLatParam ? parseFloat(userLatParam) : null
    const userLngN = userLngParam ? parseFloat(userLngParam) : null

    // Si Gemini a retourné une adresse directement, on l'utilise en priorité pour la recherche Google
    const aiAddress = aiData?.address || null

    // T1: adresse exacte retournée par Gemini (ex: "15 rue de Rivoli, Paris")
    if (aiAddress) {
      googlePlace = await findPlaceOnGoogle(aiAddress, userLatN, userLngN)
    }

    // T2: nom AI + ville (ex: "Andia Paris")
    if (!googlePlace && aiData?.name && placeCity) {
      googlePlace = await findPlaceOnGoogle(`${aiData.name} ${placeCity}`, userLatN, userLngN)
    }

    // T3: username converti + ville (ex: "Le Couteau Paris")
    if (!googlePlace && usernameAsName && placeCity && usernameAsName !== aiData?.name) {
      googlePlace = await findPlaceOnGoogle(`${usernameAsName} ${placeCity}`, userLatN, userLngN)
    }

    // T4: nom AI seul (avec biais GPS)
    if (!googlePlace && aiData?.name) {
      googlePlace = await findPlaceOnGoogle(aiData.name, userLatN, userLngN)
    }

    // T5: username converti seul
    if (!googlePlace && usernameAsName) {
      googlePlace = await findPlaceOnGoogle(usernameAsName, userLatN, userLngN)
    }

    // T6: avec le lieu OG brut
    if (!googlePlace && cleaned.location) {
      googlePlace = await findPlaceOnGoogle(`${placeName} ${cleaned.location}`, userLatN, userLngN)
    }

    let coordinates: { lat: number; lng: number } | null = null
    let resolvedAddress: string | null = null
    let photosUrl: string | null = null

    if (googlePlace) {
      resolvedAddress = googlePlace.address
      if (googlePlace.lat != null && googlePlace.lng != null) {
        coordinates = { lat: googlePlace.lat, lng: googlePlace.lng }
      }
      photosUrl = googlePlace.photoUrls

      // Catégorie Google en renfort si Gemini a dit "other"
      if (finalCategory === "other") {
        const googleCat = googleTypesToCategory(googlePlace.types)
        if (googleCat) finalCategory = googleCat
      }
    }

    // Fallback Mapbox si Google n'a rien trouvé
    if (!coordinates) {
      const fallbackQuery = aiAddress || (placeCity ? `${placeName}, ${placeCity}` : placeName)
      const geo = await geocode(fallbackQuery)
      if (geo) {
        coordinates = { lat: geo.lat, lng: geo.lng }
        if (!resolvedAddress) resolvedAddress = geo.place_name
      }
    }

    // ------------------------------------------------------------------
    // 5. Gemini : description engageante
    // ------------------------------------------------------------------
    let description = ""
    if (resolvedAddress && placeName && placeName !== "Nouveau Spot") {
      const aiDesc = await generateDescription(placeName, finalCategory, resolvedAddress)
      if (aiDesc) description = aiDesc
    }

    return NextResponse.json({
      title: placeName,
      description: description || `Découvrez ${placeName}, un lieu à ne pas manquer !`,
      location: resolvedAddress,
      category: finalCategory,
      image_url: photosUrl,
      coordinates,
    })
  } catch {
    return NextResponse.json({ error: "Erreur lors de la récupération" }, { status: 500 })
  }
}
