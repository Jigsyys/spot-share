/**
 * test-pipeline.mjs
 * Lance le pipeline identifyPlace() directement, sans serveur Next.js.
 * Usage : node test-pipeline.mjs
 */

import { readFileSync } from "fs"
import { createRequire } from "module"

// ── Charger le .env.local manuellement ──────────────────────────────────────
try {
  const env = readFileSync(".env.local", "utf8")
  for (const line of env.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const idx = trimmed.indexOf("=")
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[key]) process.env[key] = val
  }
  console.log("✓ .env.local chargé")
} catch {
  console.warn("⚠ Pas de .env.local trouvé — les clés doivent être dans l'environnement")
}

// ── Vérifier les clés présentes ──────────────────────────────────────────────
console.log("\n=== CLÉS API ===")
console.log("GEMINI_API_KEY     :", process.env.GEMINI_API_KEY     ? "✓ présente" : "✗ MANQUANTE")
console.log("GOOGLE_MAPS_API_KEY:", process.env.GOOGLE_MAPS_API_KEY ? "✓ présente" : "✗ MANQUANTE")
console.log("")

if (!process.env.GEMINI_API_KEY || !process.env.GOOGLE_MAPS_API_KEY) {
  console.error("❌ Une ou plusieurs clés API sont manquantes. Arrêt des tests.")
  process.exit(1)
}

// ── Jeux de test ─────────────────────────────────────────────────────────────
const TEST_CASES = [
  {
    label: "Test 1 — 📍 adresse numérique (19 Rue...) — était rejeté avant le fix",
    meta: {
      title: "Mini pizzas incroyables 🍕 #paris",
      description: "Mini pizzas à volonté pour 29€ ! #pizza #paris #restaurant",
      hashtags: ["pizza", "paris", "restaurant"],
      author: "foodparis",
      locationHint: "19 Rue Soufflot, 75005 Paris",  // commence par un chiffre
    },
  },
  {
    label: "Test 2 — 📍 nom + adresse dans le même hint",
    meta: {
      title: "Le meilleur café de Paris ☕",
      description: "Ambiance incroyable ce matin #paris #cafe",
      hashtags: ["cafeparis", "paris", "saintgermain"],
      author: "pariscafe",
      locationHint: "Café de Flore, 172 Boulevard Saint-Germain, Paris",
    },
  },
  {
    label: "Test 3 — Adresse dans description seulement (sans locationHint)",
    meta: {
      title: "Atelier des Lumières - Van Gogh",
      description: `Incroyable expérience immersive !
Adresse : 38 Rue Saint-Maur, 75011 Paris
Keywords: expo paris art numerique vangogh projection lumières`,
      hashtags: ["vangogh", "paris", "art"],
      author: "visiter_paris",
    },
  },
  {
    label: "Test 4 — Lieu introuvable (doit retourner erreur propre)",
    meta: {
      title: "Mon dîner",
      description: "Super soirée ce soir !",
      hashtags: [],
      author: "jean_dupont",
    },
  },
]

// ── Runner ────────────────────────────────────────────────────────────────────
async function runTests() {
  // Import dynamique avec patch du résolveur de module pour @/lib
  const { GoogleGenerativeAI } = await import("@google/generative-ai")

  // Patch temporaire : réexporter identifyPlace en remplaçant l'alias @/lib
  // On importe directement le fichier compilé via tsx (appelé depuis package.json)
  const { identifyPlace } = await import("./lib/identify-place.ts")

  let passed = 0
  let failed = 0

  for (const tc of TEST_CASES) {
    console.log(`\n${"─".repeat(60)}`)
    console.log(`🧪 ${tc.label}`)
    console.log(`   Titre    : ${tc.meta.title}`)
    console.log(`   Auteur   : ${tc.meta.author}`)
    const startMs = Date.now()

    try {
      const result = await identifyPlace(tc.meta)
      const ms = Date.now() - startMs

      if ("erreur" in result) {
        console.log(`   ⚠  ERREUR (${ms}ms) : ${result.erreur}`)
        // Le test 4 est censé échouer proprement
        if (tc.label.includes("introuvable")) {
          console.log("   ✓ Comportement attendu (erreur propre sans crash)")
          passed++
        } else {
          console.log("   ✗ Échec inattendu")
          failed++
        }
      } else {
        console.log(`   ✓ OK (${ms}ms)`)
        console.log(`   titre            : ${result.titre}`)
        console.log(`   nom_officiel     : ${result.nom_officiel_google}`)
        console.log(`   adresse          : ${result.adresse}`)
        console.log(`   coordonnées      : ${result.coordonnees.lat}, ${result.coordonnees.lng}`)
        console.log(`   catégorie        : ${result.categorie}`)
        console.log(`   description      : ${result.description?.slice(0, 100)}...`)
        console.log(`   photos (${result.photos.length})       : ${result.photos[0]?.slice(0, 70) ?? "aucune"}`)
        passed++
      }
    } catch (e) {
      const ms = Date.now() - startMs
      console.log(`   ✗ CRASH inattendu (${ms}ms) :`, e.message)
      failed++
    }
  }

  console.log(`\n${"═".repeat(60)}`)
  console.log(`RÉSULTAT : ${passed} ✓ passés — ${failed} ✗ échoués sur ${TEST_CASES.length} tests`)
  console.log(`${"═".repeat(60)}\n`)
}

runTests().catch(e => {
  console.error("Erreur fatale du runner :", e)
  process.exit(1)
})
