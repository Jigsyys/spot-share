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
  return { title: get("og:title"), description: get("og:description"), image: get("og:image") }
}

/** Détecte si une chaîne ressemble à une adresse postale plutôt qu'à un nom commercial */
function looksLikeAddress(str: string): boolean {
  return /^\d+[\s,]+(?:rue|avenue|boulevard|place|impasse|allée|passage|cour|villa|chemin|voie|quai|square|résidence)\b/i.test(str.trim())
}

/** Supprime les emojis et caractères spéciaux d'un texte */
function stripEmojis(s: string): string {
  return s
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2700}-\u{27BF}\u{FE00}-\u{FEFF}\u{1F900}-\u{1F9FF}]/gu, "")
    .replace(/[0-9]+[️⃣]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
}

/**
 * Extrait un nom de lieu à partir d'un texte brut après 📍 ou 📌.
 * S'arrête dès qu'un autre emoji, une date, un prix ou un mot de description est rencontré.
 */
function extractPlaceName(raw: string): string | null {
  // Retire le marqueur emoji en tête
  const withoutMarker = raw.replace(/^[📍📌]\s*/u, "").trim()
  // Supprime tout ce qui est après le premier emoji non-lettre (🅿️, 🗓, etc.)
  const nameOnly = withoutMarker.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2700}-\u{27BF}].*/gu, "").trim()
  const cleaned = nameOnly.replace(/\s+/g, " ").trim().slice(0, 70)
  if (cleaned.length < 3) return null
  // Rejette si commence par un chiffre ou ressemble à une description
  if (/^\d/.test(cleaned)) return null
  const descWords = ["floraison","prévue","environ","bouquet","prévoyez","venez","respectez","disponible","gps","point","toutes","infos","conseils","seulement","quelques","semaine"]
  if (descWords.some(w => cleaned.toLowerCase().includes(w))) return null
  return cleaned
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

  // Cherche 📍 ou 📌, valide que c'est un nom de lieu (pas une description)
  const pinMatches = [...full.matchAll(/[📍📌]\s*[^\n#]{3,80}/gu)]
  let location: string | null = null
  for (const m of pinMatches) {
    const candidate = extractPlaceName(m[0])
    if (candidate) { location = candidate; break }
  }

  let title = ""
  if (rawTitle) {
    // TikTok OG: "username (@handle) on TikTok: <caption>"
    const tiktokMatch = rawTitle.match(/on TikTok\s*:\s*(.+)/i)
    if (tiktokMatch) {
      title = tiktokMatch[1].replace(/📍\s*/g, "").replace(/#\w+/g, "").trim().slice(0, 80)
    }
    const quoteMatch = !title && rawTitle.match(/(?:sur|on) Instagram\s*:\s*"(.+?)"/i)
    if (quoteMatch) {
      const extracted = quoteMatch[1].replace(/📍\s*/g, "").replace(/#\w+/g, "").trim()
      title = extracted.split(",")[0].trim()
      if (!location && extracted.includes(",")) location = extracted.trim()
    } else if (!title) {
      title = rawTitle.replace(/\s*(on|sur)\s*(Instagram|TikTok).*$/i, "").replace(/📍\s*/g, "").replace(/#\w+/g, "").trim()
    }
    title = title.replace(/^[A-Za-zÀ-ÿ\s]+\(@[\w.]+\)\s*$/i, "").trim()
    if (!title || title.toLowerCase().includes("instagram") || title.toLowerCase().includes("tiktok") || title.length < 2 || title.length > 80) title = ""
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
  ogImage: string | null       // og:image extrait du scraping HTML
  locationHint: string | null  // nom de lieu explicite extrait du 📍/📌
  titleHint: string | null     // premier segment du titre avant " - " (ex: "A Braccetto")
}

/** Extrait @username directement depuis l'URL (sans API) */
function extractUsernameFromUrl(url: string): string | null {
  // TikTok: tiktok.com/@username/video/...
  const tiktok = url.match(/tiktok\.com\/@([\w.]+)/)?.[1]
  // Instagram: instagram.com/username/reel/... OU instagram.com/username/p/...
  const igFromPath = url.match(/instagram\.com\/([\w.]+)\/(?:p|reel|tv)\//)?.[1]
  const handle = tiktok || igFromPath || null
  if (handle && /^(reel|p|tv|explore|accounts|stories|direct|share)$/i.test(handle)) return null
  return handle
}

/** Instagram — scraping de la page embed (moins bloquée que la page principale) */
async function tryInstagramEmbed(url: string): Promise<{ title: string; username: string | null; thumbnail: string | null } | null> {
  if (!url.includes("instagram.com")) return null
  try {
    // Construire l'URL embed depuis le shortcode
    const shortcodeMatch = url.match(/instagram\.com\/(?:p|reel|tv)\/([\w-]+)/)
    if (!shortcodeMatch) return null
    const shortcode = shortcodeMatch[1]
    const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/`

    const res = await fetch(embedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9",
      },
      signal: AbortSignal.timeout(7000),
    })
    if (!res.ok) return null
    const html = await res.text()

    // Extraire le caption depuis les données JSON embarquées dans la page embed
    const captionMatch = html.match(/"caption"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1]
    const caption = captionMatch ? captionMatch.replace(/\\n/g, " ").replace(/\\u[\dA-Fa-f]{4}/g, "").replace(/\\(.)/g, "$1").trim() : null

    // Extraire le username
    const usernameMatch = html.match(/"username"\s*:\s*"([\w.]+)"/) ?? html.match(/instagram\.com\/([\w.]+)/)
    const username = usernameMatch?.[1] || extractUsernameFromUrl(url)

    // Thumbnail depuis og:image dans le HTML embed
    const og = extractOG(html)
    const thumbnail = og.image ? decodeHTML(og.image) : null

    if (!caption && !og.title) return null
    const title = caption || og.title || ""
    console.log(`[Instagram embed] title="${title.slice(0, 80)}" username="${username}"`)
    return { title, username: username || null, thumbnail }
  } catch (e) {
    console.warn("[Instagram embed] failed:", (e as Error).message?.slice(0, 60))
    return null
  }
}

/** Extrait la description COMPLÈTE d'une page TikTok depuis le JSON embarqué */
async function tryTikTokFullDescription(url: string): Promise<string | null> {
  if (!url.includes("tiktok.com")) return null
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const html = await res.text()

    // TikTok embarque les données dans __UNIVERSAL_DATA_FOR_REHYDRATION__ ou SIGI_STATE
    // Cherche le champ "desc" dans le JSON de la page
    const descPatterns = [
      /"desc"\s*:\s*"((?:[^"\\]|\\.)*)"/,
      /"description"\s*:\s*"((?:[^"\\]|\\.)*)"/,
      /<meta\s+(?:name|property)="description"\s+content="([^"]{20,})"/i,
    ]
    for (const pattern of descPatterns) {
      const match = html.match(pattern)?.[1]
      if (match && match.length > 20) {
        const decoded = match
          .replace(/\\n/g, "\n")
          .replace(/\\u([\dA-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
          .replace(/\\(.)/g, "$1")
          .trim()
        if (decoded.length > 20) {
          console.log(`[TikTok HTML] description: "${decoded.slice(0, 120)}"`)
          return decoded
        }
      }
    }
  } catch (e) {
    console.warn("[TikTok HTML] failed:", (e as Error).message?.slice(0, 60))
  }
  return null
}

/** TikTok oEmbed — retourne le titre partiel + thumbnail + username */
async function tryTikTokOEmbed(url: string): Promise<{ title: string; username: string | null; thumbnail: string | null } | null> {
  if (!url.includes("tiktok.com")) return null
  try {
    const res = await fetch(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
      {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36" },
        signal: AbortSignal.timeout(6000),
      }
    )
    if (!res.ok) return null
    const data = await res.json()
    if (!data?.title) return null
    const username = data.author_url?.match(/tiktok\.com\/@([\w.]+)/)?.[1] || null
    console.log(`[TikTok oEmbed] title="${data.title.slice(0, 80)}" username="${username}"`)
    return { title: data.title || "", username, thumbnail: data.thumbnail_url || null }
  } catch (e) {
    console.warn("[TikTok oEmbed] failed:", (e as Error).message?.slice(0, 60))
    return null
  }
}

/** Construit un VideoMeta à partir d'un titre/caption + username + thumbnail */
function buildMetaFromCaption(
  caption: string,
  username: string | null,
  thumbnail: string | null,
  source: string,
): VideoMeta {
  const pinMatches = [...caption.matchAll(/[📍📌]\s*[^\n#]{3,80}/gu)]
  let locationHint: string | null = null
  for (const m of pinMatches) {
    const candidate = extractPlaceName(m[0])
    if (candidate) { locationHint = candidate; break }
  }
  let titleHint: string | null = null
  if (!locationHint) {
    const dashParts = caption.split(/\s+[-–]\s+/)
    if (dashParts.length >= 2) {
      const candidate = stripEmojis(dashParts[0]).trim()
      if (candidate.length >= 3 && candidate.length <= 50 && !/^\d/.test(candidate)) {
        titleHint = candidate
        console.log(`[${source}] titleHint:`, titleHint)
      }
    }
  }
  return {
    title: caption,
    description: caption,
    tags: [],
    uploader: username ? usernameToName(username) : null,
    username,
    ogImage: thumbnail,
    locationHint,
    titleHint,
  }
}

async function extractMetadata(url: string): Promise<VideoMeta> {
  // Extraction immédiate du username depuis l'URL (fiable, sans API)
  const urlUsername = extractUsernameFromUrl(url)

  // ── TikTok : oEmbed (titre partiel) + scraping HTML (description complète) ──
  if (url.includes("tiktok.com")) {
    // Les deux en parallèle pour ne pas perdre de temps
    const [oembed, fullDesc] = await Promise.all([
      tryTikTokOEmbed(url),
      tryTikTokFullDescription(url),
    ])
    // Description complète prioritaire sur le titre oEmbed (qui peut être tronqué)
    const caption = fullDesc || oembed?.title
    if (caption) {
      const username = oembed?.username || urlUsername
      const thumbnail = oembed?.thumbnail || null
      return buildMetaFromCaption(caption, username, thumbnail, "TikTok")
    }
  }

  // ── Instagram embed (page /embed/ moins bloquée que la principale) ─────
  if (url.includes("instagram.com")) {
    const igEmbed = await tryInstagramEmbed(url)
    if (igEmbed?.title) {
      return buildMetaFromCaption(igEmbed.title, igEmbed.username || urlUsername, igEmbed.thumbnail, "Instagram embed")
    }
  }

  // ── yt-dlp ─────────────────────────────────────────────────────────────
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
      // Extraire le nom de lieu depuis 📍 ou 📌 dans la description yt-dlp
      const desc = info.description || ""
      const ytPinMatches = [...desc.matchAll(/[📍📌]\s*[^\n#]{3,80}/gu)]
      let locationHint: string | null = null
      for (const m of ytPinMatches) {
        const candidate = extractPlaceName(m[0])
        if (candidate) { locationHint = candidate; break }
      }
      if (locationHint) console.log("[yt-dlp] 📍/📌 locationHint:", locationHint)

      // TikTok/Insta : souvent "NOM DU LIEU - description..." dans le titre
      // Si pas de locationHint, extraire la partie avant " - " comme hint candidat
      let titleHint: string | null = null
      if (!locationHint && info.title) {
        const dashParts = info.title.split(/\s+[-–]\s+/)
        if (dashParts.length >= 2) {
          const candidate = stripEmojis(dashParts[0]).trim()
          if (candidate.length >= 3 && candidate.length <= 50 && !/^\d/.test(candidate)) {
            titleHint = candidate
            console.log("[yt-dlp] titleHint depuis titre:", titleHint)
          }
        }
      }

      return {
        title: info.title || "",
        description: desc,
        tags: info.tags || [],
        uploader: info.uploader || null,
        username: username || urlUsername,  // fallback sur username de l'URL
        ogImage: null,
        locationHint,
        titleHint,
      }
    }
  } catch (e) {
    console.warn("[yt-dlp] failed:", (e as Error).message?.slice(0, 100))
  }

  // Fallback : scraping OG tags avec User-Agent navigateur réel
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
      },
      signal: AbortSignal.timeout(8000),
    })
    if (res.ok) {
      const html = await res.text()
      const og = extractOG(html)
      const ogTitle = og.title ? decodeHTML(og.title) : null
      const ogDesc = og.description ? decodeHTML(og.description) : null
      const parsed = parseOGData(ogTitle, ogDesc)
      const finalUsername = parsed.username || urlUsername
      // titleHint depuis OG title aussi
      let ogTitleHint: string | null = null
      const ogRawTitle = parsed.title || ogTitle || ""
      if (!parsed.location && ogRawTitle) {
        const dashParts = ogRawTitle.split(/\s+[-–]\s+/)
        if (dashParts.length >= 2) {
          const candidate = stripEmojis(dashParts[0]).trim()
          if (candidate.length >= 3 && candidate.length <= 50 && !/^\d/.test(candidate)) {
            ogTitleHint = candidate
            console.log("[OG] titleHint:", ogTitleHint)
          }
        }
      }
      return {
        title: ogRawTitle,
        description: parsed.rawText,
        tags: [],
        uploader: finalUsername ? usernameToName(finalUsername) : null,
        username: finalUsername,
        ogImage: og.image ? decodeHTML(og.image) : null,
        locationHint: parsed.location,
        titleHint: ogTitleHint,
      }
    }
  } catch { /* bloqué */ }

  // Dernier recours : on a au moins le username depuis l'URL
  return {
    title: "", description: "", tags: [], uploader: null,
    username: urlUsername,
    ogImage: null, locationHint: null, titleHint: null,
  }
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

// ---------------------------------------------------------------------------
// Extraction de signaux faibles (hashtags, emojis, patterns implicites)
// ---------------------------------------------------------------------------

interface WeakSignals {
  cityHints: string[]       // #paris, #lyon, noms de villes détectés
  categoryHints: string[]   // #restaurant, #café, keywords ambiance
  nameHints: string[]       // #lecouteau, @handle, noms entre guillemets
  addressHints: string[]    // 📍, "rue", "avenue", codes postaux
}

const CITY_KEYWORDS = [
  "paris","lyon","marseille","bordeaux","nantes","toulouse","lille","nice","strasbourg",
  "montpellier","rennes","grenoble","rouen","toulon","nancy","metz","reims","brest",
  "cannes","antibes","annecy","aix","avignon","nimes","arles","perpignan","pau","bayonne",
  "biarritz","angouleme","poitiers","limoges","caen","tours","orleans","dijon","besancon",
  "london","barcelona","madrid","rome","berlin","amsterdam","brussels","geneva","zurich",
  // régions et départements FR
  "provence","vaucluse","alsace","bretagne","normandie","occitanie","languedoc",
  "dordogne","perigord","bourgogne","auvergne","savoie","vendee","charente",
]
const CATEGORY_KEYWORDS: Record<string, string> = {
  restaurant: "restaurant", resto: "restaurant", food: "restaurant", sushi: "restaurant",
  pizza: "restaurant", burger: "restaurant", brunch: "restaurant", gastronomie: "restaurant",
  cafe: "café", café: "café", coffee: "café", breakfast: "café", petitdej: "café",
  boulangerie: "café", patisserie: "café",
  bar: "bar", cocktail: "bar", apero: "bar", aperitif: "bar", rooftop: "bar",
  pub: "bar", wine: "bar",
  parc: "outdoor", plage: "outdoor", nature: "outdoor", randonnee: "outdoor",
  outdoor: "outdoor", camping: "outdoor",
  vue: "vue", panorama: "vue", belvedere: "vue", paysage: "vue",
  musee: "culture", museum: "culture", galerie: "culture", expo: "culture",
  culture: "culture", theatre: "culture",
  shopping: "shopping", boutique: "shopping", spa: "shopping", beaute: "shopping",
  beauty: "shopping", salon: "shopping", nail: "shopping",
}

function extractWeakSignals(meta: VideoMeta): WeakSignals {
  const allText = [meta.title, meta.description, meta.tags.join(" "), meta.uploader || ""]
    .join(" ").toLowerCase()

  // Hashtags bruts
  const hashtags = allText.match(/#[\w]+/g)?.map(h => h.slice(1)) || []

  // Villes
  const cityHints = CITY_KEYWORDS.filter(c =>
    allText.includes(c) || hashtags.some(h => h.toLowerCase() === c)
  )
  // Codes postaux (75001, 69001...)
  const postalMatches = allText.match(/\b(?:7[0-9]|6[0-9]|3[0-9]|1[0-9])\d{3}\b/g) || []
  cityHints.push(...postalMatches)

  // Catégories depuis hashtags et texte
  const categoryHints: string[] = []
  for (const [kw, cat] of Object.entries(CATEGORY_KEYWORDS)) {
    if (allText.includes(kw) || hashtags.some(h => h.includes(kw))) {
      if (!categoryHints.includes(cat)) categoryHints.push(cat)
    }
  }

  // Noms de lieux depuis hashtags (#lecouteau → "le couteau")
  const nameHints: string[] = hashtags
    .filter(h => h.length > 3 && !CITY_KEYWORDS.includes(h) && !CATEGORY_KEYWORDS[h])
    .map(h => h.replace(/_/g, " ").replace(/-/g, " "))
    .slice(0, 5)

  // Adresses et 📍/📌 (dans le texte brut non lowercasé)
  const addressHints: string[] = []
  const rawFull = [meta.title, meta.description].join(" ")
  const pinMatches2 = [...rawFull.matchAll(/[📍📌]\s*[^\n#]{3,80}/gu)]
  for (const m of pinMatches2) {
    const val = extractPlaceName(m[0])
    if (!val) continue
    if (/^\d/.test(val)) {
      addressHints.push(val)
    } else if (!nameHints.includes(val)) {
      nameHints.unshift(val)
    }
  }
  // locationHint (📍/📌) → priorité absolue
  if (meta.locationHint) {
    if (/^\d/.test(meta.locationHint)) {
      if (!addressHints.includes(meta.locationHint)) addressHints.unshift(meta.locationHint)
    } else {
      if (!nameHints.includes(meta.locationHint)) nameHints.unshift(meta.locationHint)
    }
  }
  // titleHint (premier segment du titre avant " - ") → deuxième priorité
  if (meta.titleHint && !nameHints.includes(meta.titleHint) && meta.titleHint !== meta.locationHint) {
    nameHints.splice(meta.locationHint ? 1 : 0, 0, meta.titleHint)
  }

  const streetMatch = rawFull.match(/\d+[\s,]+(?:rue|avenue|boulevard|place|impasse|allée)\s+[^\n#,]{3,40}/gi)
  if (streetMatch) addressHints.push(...streetMatch.slice(0, 2))

  // @mentions dans la description = souvent le compte du business tagué
  const mentionMatches = (meta.description || "").match(/@([\w.]+)/g) || []
  for (const m of mentionMatches.slice(0, 3)) {
    const handle = m.slice(1)
    if (handle === meta.username || handle.length < 4) continue
    const name = usernameToName(handle)
    if (name && !nameHints.includes(name)) nameHints.push(name)
  }

  return { cityHints, categoryHints, nameHints, addressHints }
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
  // Extraction des signaux faibles depuis tout le texte disponible
  const signals = extractWeakSignals(meta)

  // Ville la plus probable : GPS > hashtag ville > postal
  const bestCity = userCity || signals.cityHints[0] || null

  // Catégorie implicite depuis hashtags (si trouvée, on la donne en indice)
  const impliedCategory = signals.categoryHints[0] || null

  const noContext = !meta.title && !meta.description && !meta.tags.length
  const weakContext = meta.title.length < 5 && meta.description.length < 20

  // Grounding uniquement si contexte faible ET le compte ressemble à un établissement (pas un food blog)
  const isFoodBlogger = /food|eat|local|resto|bonne|adresse|paris|plan|spot|secret|hidden|guide|foodies?|gourmand|cuisine|table|chef|meal|bite|yum|tasty/i.test(meta.username || "")
  if ((noContext || weakContext) && meta.username && !isFoodBlogger) {
    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", tools: [{ googleSearch: {} }] as any })

      const ctx = [
        `URL du post: ${postUrl}`,
        `Compte: @${meta.username} (nom probable: "${usernameToName(meta.username)}")`,
        meta.title ? `Titre visible: "${meta.title}"` : "",
        meta.description ? `Texte visible: "${meta.description.slice(0, 300)}"` : "",
        signals.addressHints.length ? `Adresses détectées: ${signals.addressHints.join(" | ")}` : "",
        bestCity ? `Ville probable: ${bestCity}` : "",
        impliedCategory ? `Catégorie probable (depuis hashtags): ${impliedCategory}` : "",
        signals.nameHints.length ? `Noms détectés dans les hashtags: ${signals.nameHints.join(", ")}` : "",
      ].filter(Boolean).join("\n")

      const prompt = `Tu es un expert OSINT spécialisé dans l'identification de lieux.

${ctx}

STRATÉGIE DE RECHERCHE (applique-les dans l'ordre) :
1. Recherche "@${meta.username}" sur Google → est-ce un établissement ou un lieu ?
2. Recherche "${usernameToName(meta.username)}${bestCity ? " " + bestCity : ""}" sur Google Maps.
3. Si non trouvé, recherche les noms détectés dans les hashtags avec la ville.
4. Analyse les signaux indirects : hashtags de lieu, codes postaux, noms mentionnés.

${CATEGORY_GUIDE}

RÈGLE ABSOLUE : "name" = NOM COMMERCIAL uniquement (ex: "Café de Flore", "Le Meurice", "Baieta").
Si tu n'as QUE l'adresse (ex: "161 Rue Montmartre") sans nom d'établissement → mets name:null et l'adresse dans "address".

Réponds UNIQUEMENT avec ce JSON valide (aucun autre texte) :
{"name":"Nom commercial ou null","city":"Ville, Pays (ex: Paris, France)","address":"Numéro rue, Ville","category":"..."}
Si compte personnel sans lieu : {"name":null}`

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
    // Si grounding échoue, on retourne quand même ce qu'on a déduit des signaux
    if (signals.nameHints.length || meta.username) {
      return {
        name: usernameToName(meta.username || signals.nameHints[0] || ""),
        city: bestCity || "",
        address: signals.addressHints[0] || null,
        category: impliedCategory || "other",
      }
    }
    return null
  }

  // Contexte disponible → LLM classique enrichi des signaux faibles
  const ctx = [
    // ⚠️ locationHint en premier avec label explicite — info la plus fiable
    meta.locationHint ? `⚠️ LIEU EXPLICITEMENT MENTIONNÉ (📍 dans la légende): "${meta.locationHint}" — utilise ce nom en priorité absolue` : "",
    (!meta.locationHint && meta.titleHint) ? `⚠️ NOM PROBABLE (extrait du titre de la vidéo): "${meta.titleHint}" — très probablement le nom du lieu` : "",
    `URL: ${postUrl}`,
    meta.username ? `Compte: @${meta.username} (nom: "${usernameToName(meta.username)}")` : "",
    meta.title ? `Titre: "${meta.title}"` : "",
    meta.description ? `Description: "${meta.description.slice(0, 500)}"` : "",
    meta.tags.length ? `Hashtags: ${meta.tags.slice(0, 15).join(" ")}` : "",
    signals.addressHints.length ? `📍 Adresses détectées: ${signals.addressHints.join(" | ")}` : "",
    signals.nameHints.filter(n => n !== meta.locationHint).length
      ? `Autres noms détectés: ${signals.nameHints.filter(n => n !== meta.locationHint).join(", ")}` : "",
    bestCity ? `Ville (GPS/hashtags): ${bestCity}` : "",
    impliedCategory ? `Catégorie implicite (hashtags): ${impliedCategory}` : "",
  ].filter(Boolean).join("\n")

  const prompt = `Tu es un expert en identification de lieux à partir de vidéos sociales.

Données de la vidéo :
${ctx}

MISSION : Identifie le lieu exact présenté dans cette vidéo.
- Si un "LIEU EXPLICITEMENT MENTIONNÉ (📍)" est indiqué ci-dessus, c'est le nom du lieu — utilise-le directement comme "name".
- Sinon, déduis-le depuis le compte, les hashtags ou les noms détectés.
- Si l'adresse n'est pas explicite, utilise la ville (GPS ou hashtag) comme indice.
- La catégorie implicite (hashtags) est un indice fort, utilise-la.

${CATEGORY_GUIDE}

RÈGLE ABSOLUE : "name" = NOM COMMERCIAL uniquement (ex: "Café de Flore", "Baieta").
Si tu n'as QUE l'adresse sans nom d'établissement → mets name:null et l'adresse dans "address".

Réponds UNIQUEMENT avec ce JSON valide :
{"name":"Nom commercial ou null","city":"Ville, Pays (ex: Paris, France)","address":"Adresse ou null","category":"..."}`

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

// Mots vides français/anglais ignorés lors du calcul de similarité
const STOP_WORDS = new Set(["de","du","la","le","les","des","l","d","à","a","en","et","un","une","the","of","in","at","du","au","aux"])

/** Ratio de mots significatifs communs entre deux chaînes (0..1) */
function wordOverlap(a: string, b: string): number {
  const words = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .split(/[\s\-'']+/).filter(w => w.length > 1 && !STOP_WORDS.has(w))
  const wa = words(a)
  const wb = words(b)
  if (!wa.length) return 0
  const matches = wa.filter(w => wb.some(v => v.includes(w) || w.includes(v)))
  return matches.length / wa.length
}

async function searchGooglePlace(
  query: string,
  userLat: number | null,
  userLng: number | null
): Promise<PlaceSearchResult[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey || !query) return []
  const locationBias = userLat != null && userLng != null
    ? `&location=${userLat},${userLng}&radius=15000` : ""
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&language=fr${locationBias}&key=${apiKey}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (res.status === 429) {
      console.warn("[Google Places 429] waiting 1s...")
      await new Promise((r) => setTimeout(r, 1000))
      const retry = await fetch(url, { signal: AbortSignal.timeout(8000) })
      if (!retry.ok) return []
      const d = await retry.json()
      return (d.results ?? []).slice(0, 5).map(mapPlaceResult)
    }
    const data = await res.json()
    console.log(`[Google textsearch] "${query}" → ${data.results?.length ?? 0} résultats (${data.status})`)
    return (data.results ?? []).slice(0, 5).map(mapPlaceResult)
  } catch (e) {
    console.error("[Google textsearch error]:", e)
    return []
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
  weekdayDescriptions: string[]
}

async function getPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey || !placeId) return null
  const fields = "name,formatted_address,geometry,types,photos,url,opening_hours"
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&language=fr&key=${apiKey}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    const data = await res.json()
    if (data.status !== "OK" || !data.result) return null
    const r = data.result

    // Résoudre les redirects côté serveur → URLs directes lh3.googleusercontent.com
    // (évite d'exposer la clé API dans le HTML client)
    const photoUrls: string[] = []
    for (const p of (r.photos || []).slice(0, 3)) {
      const redirectUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${p.photo_reference}&key=${apiKey}`
      try {
        const photoRes = await fetch(redirectUrl, {
          redirect: "manual",
          signal: AbortSignal.timeout(5000),
        })
        const directUrl = photoRes.headers.get("location")
        photoUrls.push(directUrl || redirectUrl)
      } catch {
        photoUrls.push(redirectUrl)
      }
    }

    const weekdayDescriptions: string[] = r.opening_hours?.weekday_text || []

    console.log(`[Place Details] "${r.name}" → ${r.formatted_address} (${weekdayDescriptions.length} horaires)`)
    return {
      name: r.name || "",
      address: r.formatted_address || "",
      lat: r.geometry?.location?.lat ?? 0,
      lng: r.geometry?.location?.lng ?? 0,
      types: r.types || [],
      mapsUrl: r.url || null,
      photoUrls,
      weekdayDescriptions,
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

  const videoInfo = videoCtx
    ? `Contexte de la vidéo : "${videoCtx}"`
    : `Aucun contexte vidéo disponible — base-toi uniquement sur les données Google Maps ci-dessous.`

  const prompt = `Tu es un curateur local expert. Rédige une description courte et factuelle du lieu suivant.

${videoInfo}
Données Google Maps :
- Nom officiel : ${placeDetails.name}
- Adresse : ${placeDetails.address}
- Types Google : ${placeDetails.types.join(", ")}

Règles ABSOLUES :
1. Si tu as le contexte vidéo : utilise-le pour une description concrète (ex: "Pizzas à volonté à 29€, formule all-you-can-eat en Paris 5e.").
   Si tu n'as PAS de contexte : décris le lieu factuellemement d'après son nom et ses types Google (ex: "Boulangerie artisanale spécialisée dans le Kouign Amann.").
2. 1-2 phrases max. Pas de style commercial. Pas de "incontournable".
3. INTERDIT : "Instagram", "TikTok", "publication", "post", "selon", "d'après", "Veuillez", ni l'adresse postale.
4. Choisis UNE catégorie parmi : cafe, restaurant, bar, outdoor, vue, culture, shopping, other.
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

// Correspondance ville → code pays ISO pour restreindre Mapbox
const CITY_TO_COUNTRY: Record<string, string> = {
  paris: "fr", lyon: "fr", marseille: "fr", bordeaux: "fr", nantes: "fr",
  toulouse: "fr", nice: "fr", lille: "fr", strasbourg: "fr", rennes: "fr",
  grenoble: "fr", montpellier: "fr", tours: "fr", dijon: "fr",
  london: "gb", berlin: "de", barcelona: "es", madrid: "es",
  rome: "it", amsterdam: "nl", bruxelles: "be", geneve: "ch", zurich: "ch",
  montreal: "ca", toronto: "ca", dubai: "ae", lisbon: "pt",
}

// Coordonnées approximatives des villes pour le bias Google Places sans GPS
const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  paris: { lat: 48.8566, lng: 2.3522 },
  lyon: { lat: 45.7640, lng: 4.8357 },
  marseille: { lat: 43.2965, lng: 5.3698 },
  bordeaux: { lat: 44.8378, lng: -0.5792 },
  toulouse: { lat: 43.6047, lng: 1.4442 },
  nice: { lat: 43.7102, lng: 7.2620 },
  lille: { lat: 50.6292, lng: 3.0573 },
  london: { lat: 51.5074, lng: -0.1278 },
  berlin: { lat: 52.5200, lng: 13.4050 },
  barcelona: { lat: 41.3851, lng: 2.1734 },
}

async function geocodeFallback(query: string, countryCode?: string): Promise<{ lat: number; lng: number; place_name: string } | null> {
  if (!MAPBOX_TOKEN || !query) return null
  try {
    const countryParam = countryCode ? `&country=${countryCode}` : ""
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&limit=1&language=fr${countryParam}`,
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

/** Retourne true si le résultat Mapbox est trop générique (juste la ville/pays) */
function isGenericGeoResult(query: string, place_name: string): boolean {
  const STOP_GEO = new Set(["france","paris","lyon","marseille","bordeaux","nantes","toulouse","nice","lille","london","berlin","barcelona","rome","amsterdam","bruxelles","geneve","zurich","montreal","dubai","strasbourg","rennes","grenoble","montpellier"])
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  const qWords = norm(query).split(/[\s,\-'']+/).filter(w => w.length > 2 && !STOP_GEO.has(w))
  if (qWords.length === 0) return false
  const rNorm = norm(place_name)
  return !qWords.some(w => rNorm.includes(w))
}

// ---------------------------------------------------------------------------
// ÉTAPE 2b : Confirmation Gemini+grounding AVANT Google Places
// Analyse toutes les données de la vidéo et fait une vraie recherche web
// pour identifier le lieu avec certitude.
// ---------------------------------------------------------------------------

interface PlaceConfirmation {
  name: string | null
  city: string | null
  address: string | null
  confidence: "high" | "medium" | "low"
}

async function confirmPlaceWithGrounding(
  meta: VideoMeta,
  signals: WeakSignals,
  bestCity: string | null,
  isFoodBlogger: boolean,
): Promise<PlaceConfirmation> {
  if (!process.env.GEMINI_API_KEY) return { name: null, city: null, address: null, confidence: "low" }
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", tools: [{ googleSearch: {} }] as any })

    const ctx = [
      meta.locationHint
        ? `⚠️ LIEU MENTIONNÉ EXPLICITEMENT DANS LA VIDÉO (📍/📌): "${meta.locationHint}" — indice le plus fiable`
        : "",
      (!meta.locationHint && meta.titleHint)
        ? `Nom probable extrait du titre: "${meta.titleHint}"`
        : "",
      meta.title ? `Titre/légende de la vidéo: "${meta.title.slice(0, 200)}"` : "",
      meta.description ? `Description: "${meta.description.slice(0, 400)}"` : "",
      meta.tags.length ? `Hashtags: ${meta.tags.slice(0, 12).join(" ")}` : "",
      meta.username
        ? `Compte source: @${meta.username}${isFoodBlogger ? " (blog culinaire/découverte — poste des lieux visités, pas son propre établissement)" : ""}`
        : "",
      bestCity ? `Ville attendue (GPS ou contexte): ${bestCity}` : "",
      signals.addressHints.length ? `Adresses détectées dans le texte: ${signals.addressHints.join(" | ")}` : "",
      signals.nameHints.filter(n => n !== meta.locationHint && n !== meta.titleHint).length
        ? `Autres noms détectés: ${signals.nameHints.filter(n => n !== meta.locationHint && n !== meta.titleHint).slice(0, 3).join(", ")}`
        : "",
    ].filter(Boolean).join("\n")

    // Nom le plus probable à rechercher
    const searchName = meta.locationHint || meta.titleHint || signals.nameHints[0] || (meta.title ? meta.title.split(/\s+[-–]\s+/)[0].slice(0, 50).trim() : null)
    const searchQuery = searchName ? `"${searchName}" ${bestCity || ""} adresse` : null

    const prompt = `Tu es un expert OSINT. Identifie le lieu exact dans cette vidéo et trouve son adresse.

Données :
${ctx}

${searchQuery ? `RECHERCHE OBLIGATOIRE : Fais une recherche Google pour : ${searchQuery}
Tu DOIS trouver l'adresse exacte avec numéro de rue et code postal.` : ""}

Règles :
- "name" = nom commercial uniquement (ex: "A Braccetto"), jamais une adresse
- "address" = adresse complète obligatoire : numéro + rue + code postal + ville (ex: "19 Rue Soufflot, 75005 Paris, France")
- Si impossible à identifier → name:null

Réponds UNIQUEMENT avec ce JSON :
{"name":"Nom ou null","city":"Ville, Pays","address":"Adresse complète ou null","confidence":"high|medium|low"}`

    const result = await model.generateContent(prompt)
    const text = result.response.text().trim()
    console.log(`[Step 2b] Gemini grounding raw: ${text.slice(0, 200)}`)
    const match = text.match(/\{[\s\S]*?\}/)
    if (match) {
      const parsed = JSON.parse(match[0])
      console.log(`[Step 2b] Confirmed: name="${parsed.name}" city="${parsed.city}" address="${parsed.address}" confidence=${parsed.confidence}`)
      return {
        name: parsed.name && parsed.name !== "null" ? parsed.name : null,
        city: parsed.city || null,
        address: parsed.address && parsed.address !== "null" ? parsed.address : null,
        confidence: parsed.confidence || "medium",
      }
    }
  } catch (e) {
    console.warn("[Step 2b] Gemini grounding error:", (e as Error).message?.slice(0, 80))
  }
  return { name: null, city: null, address: null, confidence: "low" }
}

// ---------------------------------------------------------------------------
// Vérification Gemini : le résultat Google Places est-il le bon lieu ?
// ---------------------------------------------------------------------------

async function verifyPlaceMatch(
  foundName: string,
  foundAddress: string,
  expectedName: string,
  videoContext: string,
  accountHint?: string,   // ex: "@localfoodparis → compte parisien"
  expectedCity?: string,  // ville attendue pour détecter les erreurs géographiques
): Promise<boolean> {
  if (!process.env.GEMINI_API_KEY) return true
  const geoWarning = expectedCity
    ? `\nATTENTION : La vidéo est liée à la ville "${expectedCity}". Si l'adresse trouvée est dans une autre ville/région, c'est probablement un mauvais résultat.`
    : ""
  const accountLine = accountHint ? `\nCompte source : ${accountHint}` : ""
  const prompt = `Contexte vidéo : "${videoContext.slice(0, 300)}"${accountLine}
Nom recherché : "${expectedName}"
Lieu trouvé sur Google Maps : "${foundName}" — ${foundAddress}${geoWarning}

Est-ce que "${foundName}" à cette adresse correspond VRAIMENT au lieu montré dans la vidéo ?
Tiens compte de la ville attendue et du contexte du compte.
Réponds UNIQUEMENT par OUI ou NON.`
  try {
    const raw = await callGemini(prompt, 10)
    const answer = raw?.trim().toUpperCase() || ""
    console.log(`[Verify] "${foundName}" (${foundAddress}) vs "${expectedName}" → ${answer}`)
    return answer.startsWith("OUI")
  } catch { return true }
}

// ---------------------------------------------------------------------------
// Recherche Gemini+grounding : trouver l'adresse exacte d'un lieu par son nom
// ---------------------------------------------------------------------------

async function findAddressWithGrounding(name: string, city: string | null): Promise<string | null> {
  if (!process.env.GEMINI_API_KEY) return null
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", tools: [{ googleSearch: {} }] as any })
    const q = city ? `"${name}" ${city}` : `"${name}"`
    const prompt = `Recherche Google : ${q}
Trouve l'adresse postale exacte du lieu nommé "${name}"${city ? ` à ${city}` : ""}.
Réponds UNIQUEMENT avec ce JSON (ou null si non trouvé) :
{"name":"Nom exact","address":"Adresse complète avec code postal et ville"}`
    const result = await model.generateContent(prompt)
    const text = result.response.text().trim()
    const match = text.match(/\{[\s\S]*?\}/)
    if (match) {
      const parsed = JSON.parse(match[0])
      if (parsed.address) {
        console.log(`[Grounding] "${name}" → "${parsed.address}"`)
        return parsed.address
      }
    }
  } catch (e) {
    console.warn("[Grounding place search error]:", (e as Error).message?.slice(0, 80))
  }
  return null
}

// ---------------------------------------------------------------------------
// API Route principale — Pipeline 4 étapes
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const url = searchParams.get("url")

  if (!url || (!url.includes("instagram.com") && !url.includes("tiktok.com"))) {
    return NextResponse.json({ error: "URL invalide. Seuls Instagram et TikTok sont acceptés." }, { status: 400 })
  }

  try {
    // ── Étape 1 : Extraction des métadonnées textuelles de la vidéo ──────
    console.log("[Step 1] Extracting metadata from:", url)
    const meta = await extractMetadata(url)
    console.log(`[Step 1] title="${meta.title.slice(0, 60)}" desc=${meta.description.length}chars`)

    // ── Étape 2 : Identification du lieu via le pipeline Single-Pass ─────
    const { identifyPlace } = await import("@/lib/identify-place")
    const result = await identifyPlace({
      title:       meta.title       || null,
      description: meta.description || null,
      hashtags:    meta.tags?.length ? meta.tags : null,
      author:      meta.username    || null,
    })

    // Lieu introuvable → 404 propre
    if ("erreur" in result) {
      return NextResponse.json({ error: result.erreur }, { status: 404 })
    }

    // ── Étape 3 : Réponse finale ─────────────────────────────────────────
    return NextResponse.json({
      title:                result.titre,
      nom_officiel:         result.nom_officiel_google,
      description:          result.description,
      location:             result.adresse,
      category:             result.categorie,
      photos:               result.photos,
      image_url:            result.photos[0] ?? null,
      coordinates:          result.coordonnees,
      weekday_descriptions: result.horaires.length > 0 ? result.horaires : null,
    })
  } catch (e) {
    console.error("[Pipeline error]:", e)
    return NextResponse.json({ error: "Erreur lors de la récupération" }, { status: 500 })
  }
}
