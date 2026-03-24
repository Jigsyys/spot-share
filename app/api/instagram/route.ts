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
// Catégorie auto
// ---------------------------------------------------------------------------

// Ordre de priorité : shopping avant bar pour éviter les faux positifs
const CATEGORY_KEYWORDS: [string, string[]][] = [
  ["shopping", ["shopping", "shop", "boutique", "friperie", "vintage", "store", "magasin", "marché", "thrift"]],
  ["café", ["café", "cafe", "coffee", "coffeeshop", "barista", "latte"]],
  ["restaurant", ["restaurant", "resto", "gastronomie", "foodie", "brunch", "bistro", "brasserie", "sushi", "pizza", "burger"]],
  ["bar", ["cocktail", "pub", "rooftop", "apéro", "speakeasy"]],
  ["outdoor", ["outdoor", "randonnée", "rando", "hiking", "nature", "plage", "beach", "parc", "park", "jardin", "montagne"]],
  ["vue", ["panorama", "skyline", "sunset", "sunrise"]],
  ["culture", ["musée", "museum", "expo", "galerie", "gallery", "théâtre", "concert", "festival"]],
]

function detectCategory(text: string): string {
  const lower = text.toLowerCase()
  for (const [cat, kws] of CATEGORY_KEYWORDS) {
    for (const kw of kws) {
      // Utiliser des word boundaries pour éviter "bar" dans "embarquer"
      const regex = new RegExp(`(?:^|[\\s#,.;:!?()"'])${kw}(?:$|[\\s#,.;:!?()"'])`, "i")
      if (regex.test(lower)) return cat
    }
  }
  return "other"
}

// ---------------------------------------------------------------------------
// Nettoyage OG brut Instagram
// ---------------------------------------------------------------------------

function cleanOGData(rawTitle: string | null, rawDescription: string | null) {
  let title = ""
  let location: string | null = null
  const fullText = `${rawTitle || ""} ${rawDescription || ""}`

  // Extraction lieu depuis 📍
  const locMatch = fullText.match(/📍\s*([^"#\n]+)/i)
  if (locMatch) {
    location = locMatch[1].replace(/["\s]+$/, "").replace(/#\w+/g, "").trim()
  }

  // Nettoyage titre
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

  if (!title || title.toLowerCase() === "instagram" || title.toLowerCase().includes("login")) {
    title = location ? location.split(",")[0].trim() : "Nouveau Spot"
  }

  // Si le titre est vraiment très long (capture le texte entier du reel), on tronque
  if (title.length > 50) {
    title = "Nouveau Spot"
  }

  const category = detectCategory(fullText)

  // Nettoyage brut du texte pour extraire les vraies infos du post
  const cleanRawText = fullText
    .replace(/^[\d,.]+ likes?,?\s*[\d,.]+ comments?\s*-\s*\w+\s*(le|on)?\s*[\w\s,.]+\.\s*/i, "")
    .replace(/\s*(on|sur)\s*Instagram.*$/i, "")
    .replace(/["']+/g, " ")
    .replace(/📍\s*[^#\n]+/i, "")
    .trim()

  return { title, location, category, rawText: cleanRawText }
}

// ---------------------------------------------------------------------------
// Mapbox Geocoding
// ---------------------------------------------------------------------------

async function geocode(address: string, titleHint?: string): Promise<{ lat: number; lng: number; place_name: string } | null> {
  if (!MAPBOX_TOKEN || !address) return null
  // Ajouter le nom du lieu à la recherche pour plus de précision
  const query = titleHint ? `${titleHint}, ${address}` : address
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
// Google Places API (Details + Photos via Text Search)
// ---------------------------------------------------------------------------

const GOOGLE_TYPE_TO_CATEGORY: Record<string, string> = {
  // Café
  cafe: "café", coffee_shop: "café", bakery: "café", tea_house: "café",
  // Restaurant
  restaurant: "restaurant", meal_delivery: "restaurant", meal_takeaway: "restaurant",
  fast_food_restaurant: "restaurant", fine_dining_restaurant: "restaurant",
  pizza_restaurant: "restaurant", sushi_restaurant: "restaurant",
  brunch_restaurant: "restaurant", bistro: "restaurant",
  // Bar
  bar: "bar", night_club: "bar", wine_bar: "bar", cocktail_bar: "bar",
  pub: "bar", brewery: "bar",
  // Outdoor
  park: "outdoor", campground: "outdoor", hiking_area: "outdoor",
  national_park: "outdoor", garden: "outdoor", beach: "outdoor",
  dog_park: "outdoor", marina: "outdoor",
  // Vue
  observation_deck: "vue", scenic_spot: "vue", lookout: "vue",
  // Culture
  museum: "culture", art_gallery: "culture", performing_arts_theater: "culture",
  movie_theater: "culture", library: "culture", cultural_center: "culture",
  concert_hall: "culture", monument: "culture", historical_landmark: "culture",
  // Shopping
  shopping_mall: "shopping", clothing_store: "shopping", book_store: "shopping",
  gift_shop: "shopping", market: "shopping", flea_market: "shopping",
  department_store: "shopping", jewelry_store: "shopping",
  shoe_store: "shopping", furniture_store: "shopping",
}

interface GooglePlaceResult {
  title: string | null
  address: string | null
  category: string | null
  lat: number | null
  lng: number | null
  description: string | null
  photoUrls: string | null
}

async function fetchGooglePlaceDetails(
  title: string,
  location: string | null
): Promise<GooglePlaceResult | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return null

  try {
    const query = `${title} ${location || ""}`.trim()

    const searchRes = await fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "places.displayName,places.formattedAddress,places.primaryType,places.types,places.location,places.editorialSummary,places.photos",
        },
        body: JSON.stringify({ textQuery: query, languageCode: "fr" }),
      }
    )

    const searchData = await searchRes.json()
    const place = searchData.places?.[0]
    if (!place) return null

    // --- Catégorie ---
    let category: string | null = null
    if (place.primaryType && GOOGLE_TYPE_TO_CATEGORY[place.primaryType]) {
      category = GOOGLE_TYPE_TO_CATEGORY[place.primaryType]
    }
    // Fallback: parcourir tous les types
    if (!category && place.types) {
      for (const t of place.types) {
        if (GOOGLE_TYPE_TO_CATEGORY[t]) {
          category = GOOGLE_TYPE_TO_CATEGORY[t]
          break
        }
      }
    }

    // --- Photos ---
    let photoUrls: string | null = null
    if (place.photos && place.photos.length > 0) {
      const urls: string[] = []
      const maxPhotos = Math.min(3, place.photos.length)
      for (let i = 0; i < maxPhotos; i++) {
        const photoName = place.photos[i].name
        const photoUrl = `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=800&maxWidthPx=800&key=${apiKey}&skipHttpRedirect=true`
        try {
          const res = await fetch(photoUrl)
          if (res.ok) {
            const data = await res.json()
            if (data.photoUri) urls.push(data.photoUri)
          }
        } catch { /* skip photo */ }
      }
      if (urls.length > 0) photoUrls = urls.join(",")
    }

    console.log(`[Google Places] Found: "${place.displayName?.text}" @ ${place.formattedAddress} (type=${place.primaryType})`)

    return {
      title: place.displayName?.text || null,
      address: place.formattedAddress || null,
      category,
      lat: place.location?.latitude ?? null,
      lng: place.location?.longitude ?? null,
      description: place.editorialSummary?.text || null,
      photoUrls,
    }
  } catch (e) {
    console.error("Google Places Error:", e)
    return null
  }
}

// ---------------------------------------------------------------------------
// Gemini : Extraction du nom du lieu UNIQUEMENT (prompt minimal)
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

async function extractPlaceName(
  titleHint: string,
  locationHint: string | null,
  rawText: string
): Promise<string | null> {
  // Tronquer le texte brut à 300 caractères max pour éviter de surcharger l'IA
  const shortText = rawText.length > 300 ? rawText.slice(0, 300) : rawText

  const prompt = `Quel est le nom exact de l'établissement ou du lieu mentionné dans ce post ?
Indices : titre="${titleHint}", lieu="${locationHint || ""}"
Texte : "${shortText}"
Réponds UNIQUEMENT avec le nom du lieu, rien d'autre. Ex: Pâtisserie Melilot`

  return callGemini(prompt, 50)
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

  if (!url || (!url.includes("instagram.com") && !url.includes("tiktok.com"))) {
    return NextResponse.json({ error: "URL invalide. Seuls Instagram et TikTok sont acceptés." }, { status: 400 })
  }

  try {
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
    // 2. Nettoyage intelligent
    // ------------------------------------------------------------------
    const cleaned = cleanOGData(ogTitle, ogDescription)

    // ------------------------------------------------------------------
    // 3. Gemini : extraire le nom du lieu (prompt minimal)
    // ------------------------------------------------------------------
    const aiPlaceName = await extractPlaceName(cleaned.title, cleaned.location, cleaned.rawText)
    const finalTitle = aiPlaceName && aiPlaceName.length <= 60 ? aiPlaceName : cleaned.title
    console.log(`[Step 3] AI place name: "${aiPlaceName}" -> finalTitle: "${finalTitle}"`)

    // ------------------------------------------------------------------
    // 4. Google Places : adresse, catégorie, coords, photos (source de vérité)
    // ------------------------------------------------------------------
    let finalCategory = cleaned.category
    let coordinates: { lat: number; lng: number } | null = null
    let resolvedLocation: string | null = null
    let photosUrl: string | null = null
    let googleDescription: string | null = null

    const googlePlace = await fetchGooglePlaceDetails(finalTitle, cleaned.location)

    if (googlePlace) {
      if (googlePlace.address) resolvedLocation = googlePlace.address
      if (googlePlace.lat != null && googlePlace.lng != null) {
        coordinates = { lat: googlePlace.lat, lng: googlePlace.lng }
      }
      if (googlePlace.category) finalCategory = googlePlace.category
      googleDescription = googlePlace.description
      photosUrl = googlePlace.photoUrls
    }

    // Fallback Mapbox si Google n'a pas trouvé de coordonnées
    if (!coordinates && (cleaned.location || finalTitle)) {
      const geo = await geocode(cleaned.location || finalTitle, finalTitle)
      if (geo) {
        coordinates = { lat: geo.lat, lng: geo.lng }
        if (!resolvedLocation) resolvedLocation = geo.place_name
      }
    }

    // ------------------------------------------------------------------
    // 5. Gemini : description engageante (prompt minimal)
    // ------------------------------------------------------------------
    let description = googleDescription || ""
    if (resolvedLocation && finalTitle) {
      const aiDesc = await generateDescription(finalTitle, finalCategory, resolvedLocation)
      if (aiDesc) description = aiDesc
    }

    return NextResponse.json({
      title: finalTitle,
      description: description || `Découvrez ${finalTitle}, un lieu à ne pas manquer !`,
      location: resolvedLocation,
      category: finalCategory,
      image_url: photosUrl,
      coordinates,
    })
  } catch {
    return NextResponse.json({ error: "Erreur lors de la récupération" }, { status: 500 })
  }
}
