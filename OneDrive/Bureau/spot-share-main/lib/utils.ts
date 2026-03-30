import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Parse les horaires Google Places (format "Lundi: 09:00 – 23:00")
 * Index Google : 0 = Lundi … 6 = Dimanche
 */
export function getGoogleOpeningStatus(weekdays: string[]) {
  if (!weekdays?.length) return null

  // JS getDay() : 0=Dim, 1=Lun … → Google index 0=Lun : (getDay()+6)%7
  const todayIdx = (new Date().getDay() + 6) % 7
  const todayEntry = weekdays[todayIdx]
  if (!todayEntry) return null

  // Partie après le premier ":" → ex: " 09:00 – 23:00"
  const colonIdx = todayEntry.indexOf(":")
  const timePart = colonIdx >= 0 ? todayEntry.slice(colonIdx + 1).trim() : todayEntry
  const lower = timePart.toLowerCase()

  if (lower.includes("fermé") || lower.includes("closed")) {
    return { isOpen: false, text: "Fermé aujourd'hui", color: "bg-red-500" }
  }
  if (lower.includes("continu") || lower.includes("24h") || lower.includes("24/7")) {
    return { isOpen: true, text: "Ouvert 24h/24", color: "bg-emerald-500" }
  }

  // Parse "HH:mm – HH:mm" (en-dash U+2013 ou tiret standard)
  const rangeMatch = timePart.match(/(\d{1,2}:\d{2})\s*[–\-]\s*(\d{1,2}:\d{2})/)
  if (!rangeMatch) return { isOpen: null, text: timePart, color: "bg-zinc-500" }

  const parseMin = (t: string) => {
    const [h, m] = t.split(":").map(Number)
    return h * 60 + (m || 0)
  }
  const openMin = parseMin(rangeMatch[1])
  let closeMin = parseMin(rangeMatch[2])
  if (closeMin <= openMin) closeMin += 24 * 60

  const now = new Date()
  let cur = now.getHours() * 60 + now.getMinutes()
  if (cur < openMin && closeMin > 24 * 60) cur += 24 * 60

  const isOpen = cur >= openMin && cur < closeMin
  if (!isOpen) return { isOpen: false, text: `Fermé · Ouvre à ${rangeMatch[1]}`, color: "bg-red-500" }

  const remaining = closeMin - cur
  if (remaining <= 60) return { isOpen: true, text: `Ferme bientôt · ${rangeMatch[2]}`, color: "bg-orange-500" }
  return { isOpen: true, text: `Ouvert · Ferme à ${rangeMatch[2]}`, color: "bg-emerald-500" }
}

export function getOpeningStatus(
  openingHours: Record<string, string> | null | undefined
) {
  if (!openingHours) return null

  const now = new Date()
  const days = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ]
  const currentDay = days[now.getDay()]
  const todayHours = openingHours[currentDay]

  if (
    !todayHours ||
    todayHours.toLowerCase() === "closed" ||
    todayHours.toLowerCase() === "fermé"
  ) {
    return { isOpen: false, text: "Fermé aujourd'hui", color: "bg-red-500" }
  }

  const parts = todayHours.split("-")
  if (parts.length !== 2) return null

  const [openStr, closeStr] = parts.map((s) => s.trim())
  const currentMinutes = now.getHours() * 60 + now.getMinutes()

  const parseTime = (timeStr: string) => {
    const [h, m] = timeStr.split(":").map(Number)
    return (h || 0) * 60 + (m || 0)
  }

  const openMinutes = parseTime(openStr)
  let closeMinutes = parseTime(closeStr)

  if (closeMinutes <= openMinutes) {
    closeMinutes += 24 * 60
  }

  let adjustedCurrent = currentMinutes
  // Si on est le matin tôt et que l'endroit a fermé "après minuit", on compare avec l'heure d'hier
  if (currentMinutes < openMinutes && closeMinutes > 24 * 60) {
    adjustedCurrent += 24 * 60
  }

  const isOpen =
    adjustedCurrent >= openMinutes && adjustedCurrent < closeMinutes

  if (!isOpen) {
    return {
      isOpen: false,
      text: `Fermé · Ouvre à ${openStr}`,
      color: "bg-red-500",
    }
  }

  const minsUntilClose = closeMinutes - adjustedCurrent

  if (minsUntilClose <= 60) {
    return {
      isOpen: true,
      text: `Ferme bientôt (${minsUntilClose} min)`,
      color: "bg-orange-500",
    }
  }

  const hoursUntilClose = Math.floor(minsUntilClose / 60)
  return {
    isOpen: true,
    text: `Ouvert · Ferme à ${closeStr} (${hoursUntilClose}h restants)`,
    color: "bg-emerald-500",
  }
}
