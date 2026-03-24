import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
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
