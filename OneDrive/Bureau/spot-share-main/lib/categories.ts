// lib/categories.ts — Source unique de vérité pour les catégories de spots.
// Importer depuis ce fichier partout ; ne pas redéfinir localement.

export const CATEGORIES = [
  { key: "café",       label: "Café",      emoji: "☕"  },
  { key: "restaurant", label: "Restaurant", emoji: "🍽️" },
  { key: "bar",        label: "Bar",        emoji: "🍸" },
  { key: "outdoor",    label: "Outdoor",    emoji: "🌿" },
  { key: "vue",        label: "Vue",        emoji: "🌅" },
  { key: "culture",    label: "Culture",    emoji: "🎭" },
  { key: "shopping",   label: "Shopping",   emoji: "🛍️" },
  { key: "other",      label: "Autre",      emoji: "📍" },
] as const

export type CategoryKey = typeof CATEGORIES[number]["key"]

/** Map key → emoji, ex: "café" → "☕" */
export const CATEGORY_EMOJIS: Record<string, string> = Object.fromEntries(
  CATEGORIES.map(c => [c.key, c.emoji])
)

/** Map key → label, ex: "café" → "Café" */
export const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  CATEGORIES.map(c => [c.key, c.label])
)
