"use client"

import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, Search, LocateFixed, Shuffle } from "lucide-react"
import type { Spot } from "@/lib/types"
import { cn } from "@/lib/utils"

// ─── Haversine distance ────────────────────────────────────────────────────
function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function fmtDist(km: number) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`
}

// ─── Types ─────────────────────────────────────────────────────────────────
interface ExploreModalProps {
  isOpen: boolean
  onClose: () => void
  spots: Spot[]
  userLocation: { lat: number; lng: number } | null
  onSelectSpot: (spot: Spot) => void
}

// ─── Constants ─────────────────────────────────────────────────────────────
const CATEGORIES = [
  { key: "all",        label: "Tous",      emoji: "🌎" },
  { key: "café",       label: "Café",      emoji: "☕" },
  { key: "restaurant", label: "Resto",     emoji: "🍽️" },
  { key: "bar",        label: "Bar",       emoji: "🍸" },
  { key: "outdoor",    label: "Nature",    emoji: "🌿" },
  { key: "vue",        label: "Vue",       emoji: "🌅" },
  { key: "culture",    label: "Culture",   emoji: "🎭" },
  { key: "shopping",   label: "Shopping",  emoji: "🛍️" },
  { key: "other",      label: "Autre",     emoji: "📍" },
]

const CATEGORY_EMOJIS: Record<string, string> = {
  café: "☕", restaurant: "🍽️", bar: "🍸", outdoor: "🌿",
  vue: "🌅", culture: "🎭", shopping: "🛍️", other: "📍",
}

// ─── SpotRow ───────────────────────────────────────────────────────────────
function SpotRow({
  spot,
  distance,
  onSelect,
}: {
  spot: Spot
  distance?: number
  onSelect: () => void
}) {
  const imageUrl = spot.image_url?.split(",")[0]?.trim() || null
  const emoji = CATEGORY_EMOJIS[spot.category ?? "other"] ?? "📍"

  return (
    <button
      onClick={onSelect}
      className="flex w-full items-center gap-3 rounded-2xl border border-gray-200 dark:border-white/5 bg-white dark:bg-zinc-900/60 p-3 text-left transition-all active:scale-[0.98] hover:bg-gray-50 dark:hover:bg-zinc-800/60"
    >
      <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl bg-gray-100 dark:bg-zinc-800">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={spot.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-2xl">{emoji}</div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">
          {spot.title}
        </p>
        {spot.address && (
          <p className="mt-0.5 truncate text-xs text-gray-400 dark:text-zinc-500">
            {spot.address}
          </p>
        )}
        <div className="mt-1 flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-zinc-400">
            {emoji} {CATEGORIES.find(c => c.key === spot.category)?.label ?? "Autre"}
          </span>
          {distance !== undefined && (
            <span className="rounded-full bg-blue-50 dark:bg-indigo-500/15 px-2 py-0.5 text-[10px] font-bold text-blue-600 dark:text-indigo-400">
              📍 {fmtDist(distance)}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

// ─── ExploreModal ──────────────────────────────────────────────────────────
export default function ExploreModal({
  isOpen,
  onClose,
  spots,
  userLocation,
  onSelectSpot,
}: ExploreModalProps) {
  const [searchQuery, setSearchQuery]     = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [activeCategory, setActiveCategory] = useState("all")
  const [nearbyMode, setNearbyMode]       = useState(false)
  const [surpriseLoading, setSurpriseLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastPickedIdRef = useRef<string | null>(null)
  const displayedSpotsRef = useRef<typeof displayedSpots>([])

  // Debounce 300ms
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 300)
    return () => clearTimeout(t)
  }, [searchQuery])

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery(""); setDebouncedQuery(""); setActiveCategory("all")
      setNearbyMode(false); setSurpriseLoading(false)
    } else {
      setTimeout(() => inputRef.current?.focus(), 200)
    }
  }, [isOpen])

  // Spots with optional distance, filtered + sorted
  const { displayedSpots, nearbyCount } = useMemo(() => {
    // Attach distance
    const withDist = spots.map((s) => ({
      spot: s,
      distance: userLocation
        ? distanceKm(userLocation.lat, userLocation.lng, s.lat, s.lng)
        : undefined,
    }))

    // Count nearby (< 2km)
    const nearbyCount = userLocation
      ? withDist.filter(({ distance }) => distance !== undefined && distance < 2).length
      : 0

    // Category filter
    let list = activeCategory === "all"
      ? withDist
      : withDist.filter(({ spot }) => spot.category === activeCategory)

    // Text filter
    if (debouncedQuery.trim()) {
      const q = debouncedQuery.trim().toLowerCase()
      list = list.filter(
        ({ spot }) =>
          spot.title.toLowerCase().includes(q) ||
          (spot.address ?? "").toLowerCase().includes(q) ||
          (spot.description ?? "").toLowerCase().includes(q)
      )
    }

    // Sort
    if (nearbyMode && userLocation) {
      list = [...list].sort((a, b) => (a.distance ?? 99999) - (b.distance ?? 99999))
    } else {
      list = [...list].sort(
        (a, b) =>
          new Date(b.spot.created_at).getTime() - new Date(a.spot.created_at).getTime()
      )
    }

    return { displayedSpots: list, nearbyCount }
  }, [spots, activeCategory, debouncedQuery, nearbyMode, userLocation])

  // Garde le ref à jour pour éviter les closures périmées dans le setTimeout
  useEffect(() => { displayedSpotsRef.current = displayedSpots }, [displayedSpots])

  // Surprise : pioche un spot aléatoire différent du dernier
  const handleSurprise = useCallback(() => {
    if (surpriseLoading) return
    const current = displayedSpotsRef.current
    if (current.length === 0) return
    setSurpriseLoading(true)
    setTimeout(() => {
      // Pool = spots proches si dispo, sinon tous
      let pool = [...current]
      if (userLocation) {
        const nearby = current.filter(
          ({ distance }) => distance !== undefined && distance < 10
        )
        if (nearby.length > 0) pool = nearby
      }
      // Exclut le dernier spot pioché pour éviter les répétitions
      if (pool.length > 1 && lastPickedIdRef.current) {
        const filtered = pool.filter(({ spot }) => spot.id !== lastPickedIdRef.current)
        if (filtered.length > 0) pool = filtered
      }
      // Sélection vraiment aléatoire
      const idx = Math.floor(Math.random() * pool.length)
      const picked = pool[idx]
      lastPickedIdRef.current = picked.spot.id
      setSurpriseLoading(false)
      onSelectSpot(picked.spot)
    }, 600)
  }, [surpriseLoading, userLocation, onSelectSpot])

  if (!isOpen) return null

  const hasLocation = userLocation !== null

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm"
          />

          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, y: 100, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 120, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.05, bottom: 0.4 }}
            dragMomentum={false}
            onDragEnd={(_e, { offset, velocity }) => {
              if (offset.y > 120 || velocity.y > 400) onClose()
            }}
            className="fixed inset-x-0 bottom-0 z-[80] sm:inset-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2"
          >
            <div className="flex h-[92vh] flex-col overflow-hidden rounded-t-[2.5rem] border border-gray-200 dark:border-white/10 bg-white dark:bg-zinc-950 text-gray-900 dark:text-white shadow-2xl sm:h-auto sm:max-h-[90vh] sm:rounded-3xl sm:bg-gray-50 dark:sm:bg-zinc-900">

              {/* Drag handle */}
              <div className="mx-auto mt-4 mb-1 h-1.5 w-12 flex-shrink-0 rounded-full bg-gray-300 dark:bg-zinc-700/50 sm:hidden" />

              {/* Header */}
              <div className="flex flex-shrink-0 items-center justify-between px-5 pt-3 pb-3 sm:pt-5">
                <h2 className="flex items-center gap-2 text-lg font-bold">
                  <Search size={18} className="text-blue-600 dark:text-indigo-400" />
                  Explorer
                </h2>
                <button
                  onClick={onClose}
                  className="rounded-xl p-2 text-gray-500 dark:text-zinc-400 transition-colors hover:bg-gray-100 dark:hover:bg-white/10"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Search bar */}
              <div className="flex-shrink-0 px-5 pb-3">
                <div className="flex items-center gap-3 rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-100 dark:bg-zinc-800/80 px-4 py-3">
                  <Search size={16} className="flex-shrink-0 text-gray-400 dark:text-zinc-500" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Cherche un spot, une adresse..."
                    className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white outline-none placeholder:text-gray-400 dark:placeholder:text-zinc-500"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => { setSearchQuery(""); setDebouncedQuery("") }}
                      className="text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* Action cards */}
              <div className="flex-shrink-0 grid grid-cols-2 gap-3 px-5 pb-4">

                {/* Autour de moi */}
                <button
                  onClick={() => hasLocation && setNearbyMode((v) => !v)}
                  disabled={!hasLocation}
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-2xl border p-3.5 text-left transition-all",
                    nearbyMode
                      ? "border-blue-500/40 bg-blue-50 dark:bg-indigo-500/15 dark:border-indigo-500/40"
                      : hasLocation
                        ? "border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-zinc-800/60 hover:border-blue-300 dark:hover:border-indigo-500/30"
                        : "border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-zinc-800/30 opacity-50 cursor-not-allowed"
                  )}
                >
                  <div className="flex w-full items-center justify-between">
                    <LocateFixed
                      size={18}
                      className={cn(
                        nearbyMode
                          ? "text-blue-600 dark:text-indigo-400"
                          : "text-gray-500 dark:text-zinc-400"
                      )}
                    />
                    {nearbyMode && (
                      <span className="h-2 w-2 rounded-full bg-blue-500 dark:bg-indigo-400 animate-pulse" />
                    )}
                  </div>
                  <p className={cn(
                    "text-sm font-semibold",
                    nearbyMode ? "text-blue-700 dark:text-indigo-300" : "text-gray-800 dark:text-zinc-200"
                  )}>
                    Autour de moi
                  </p>
                  <p className="text-[11px] text-gray-400 dark:text-zinc-500 leading-tight">
                    {!hasLocation
                      ? "Localisation off"
                      : nearbyMode
                        ? "Trié par distance"
                        : nearbyCount > 0
                          ? `${nearbyCount} spot${nearbyCount > 1 ? "s" : ""} < 2 km`
                          : "Trier par distance"}
                  </p>
                </button>

                {/* Surprends-moi */}
                <button
                  onClick={handleSurprise}
                  disabled={surpriseLoading || displayedSpots.length === 0}
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-2xl border p-3.5 text-left transition-all",
                    "border-purple-200 dark:border-purple-500/20 bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-500/10 dark:to-pink-500/10",
                    "hover:from-purple-100 hover:to-pink-100 dark:hover:from-purple-500/20 dark:hover:to-pink-500/20",
                    "disabled:opacity-40 disabled:cursor-not-allowed"
                  )}
                >
                  <motion.div
                    animate={surpriseLoading ? { rotate: 360 } : { rotate: 0 }}
                    transition={surpriseLoading ? { duration: 0.5, ease: "linear", repeat: Infinity } : {}}
                  >
                    <Shuffle size={18} className="text-purple-500 dark:text-purple-400" />
                  </motion.div>
                  <p className="text-sm font-semibold text-purple-700 dark:text-purple-300">
                    {surpriseLoading ? "Choix en cours..." : "Surprends-moi"}
                  </p>
                  <p className="text-[11px] text-purple-400 dark:text-purple-500 leading-tight">
                    {userLocation ? "Spot aléatoire proche" : "Spot au hasard"}
                  </p>
                </button>
              </div>

              {/* Category filters */}
              <div className="no-scrollbar flex flex-shrink-0 gap-2 overflow-x-auto px-5 pb-4">
                {CATEGORIES.map(({ key, label, emoji }) => (
                  <button
                    key={key}
                    onClick={() => setActiveCategory(key)}
                    className={cn(
                      "flex flex-shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                      activeCategory === key
                        ? "bg-blue-600 dark:bg-indigo-500 text-white"
                        : "border border-gray-200 dark:border-white/10 bg-white dark:bg-zinc-800/60 text-gray-600 dark:text-zinc-300 hover:border-gray-300 dark:hover:border-white/20"
                    )}
                  >
                    {emoji} {label}
                  </button>
                ))}
              </div>

              {/* Spot list */}
              <div className="flex-1 overflow-y-auto px-5 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-5">
                {displayedSpots.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-16 text-center">
                    <Search size={40} className="text-gray-300 dark:text-zinc-700" />
                    <p className="text-sm font-semibold text-gray-500 dark:text-zinc-400">
                      Aucun spot trouvé
                    </p>
                    <p className="text-xs text-gray-400 dark:text-zinc-600">
                      {activeCategory !== "all"
                        ? "Essaie une autre catégorie"
                        : "Essaie un autre mot-clé"}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="mb-3 flex items-center gap-2">
                      <p className="text-xs font-medium text-gray-400 dark:text-zinc-500">
                        {displayedSpots.length} spot{displayedSpots.length > 1 ? "s" : ""}
                      </p>
                      {nearbyMode && (
                        <span className="text-[10px] text-blue-500 dark:text-indigo-400 font-medium">
                          · trié par distance
                        </span>
                      )}
                    </div>
                    {displayedSpots.map(({ spot, distance }) => (
                      <SpotRow
                        key={spot.id}
                        spot={spot}
                        distance={nearbyMode ? distance : undefined}
                        onSelect={() => onSelectSpot(spot)}
                      />
                    ))}
                  </div>
                )}
              </div>

            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
