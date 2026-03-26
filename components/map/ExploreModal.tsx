"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, Search, MapPin, Clock, Flame, Sparkles } from "lucide-react"
import type { Spot } from "@/lib/types"
import { cn } from "@/lib/utils"

interface ExploreModalProps {
  isOpen: boolean
  onClose: () => void
  spots: Spot[]
  userLocation: { lat: number; lng: number } | null
  onSelectSpot: (spot: Spot) => void
}

type QuickFilter = "nearby" | "recent" | "popular" | null

const CATEGORY_EMOJIS: Record<string, string> = {
  café: "☕", restaurant: "🍽️", bar: "🍸", outdoor: "🌿",
  vue: "🌅", culture: "🎭", shopping: "🛍️", other: "📍",
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
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

function formatDistance(km: number) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`
}

// ─── Carte spot en mode liste (résultats de recherche) ─────────────────────
function SpotRow({
  spot,
  onSelect,
  distance,
}: {
  spot: Spot
  onSelect: () => void
  distance?: number | null
}) {
  const imageUrl = spot.image_url?.split(",")[0]?.trim() || null
  const emoji = CATEGORY_EMOJIS[spot.category ?? "other"] ?? "📍"

  return (
    <button
      onClick={onSelect}
      className="flex w-full items-center gap-3 rounded-2xl border border-gray-200 dark:border-white/5 bg-white dark:bg-zinc-900/60 p-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-zinc-800/60"
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
        <div className="mt-1 flex items-center gap-1.5">
          <span className="text-xs capitalize text-gray-500 dark:text-zinc-400">
            {emoji} {spot.category ?? "autre"}
          </span>
          {distance != null && (
            <span className="text-xs text-gray-400 dark:text-zinc-500">
              · {formatDistance(distance)}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

// ─── Carte spot en mode carrousel horizontal ────────────────────────────────
function SpotCard({
  spot,
  onSelect,
  distance,
}: {
  spot: Spot
  onSelect: () => void
  distance?: number | null
}) {
  const imageUrl = spot.image_url?.split(",")[0]?.trim() || null
  const emoji = CATEGORY_EMOJIS[spot.category ?? "other"] ?? "📍"

  return (
    <button
      onClick={onSelect}
      className="w-36 flex-shrink-0 overflow-hidden rounded-2xl border border-gray-200 dark:border-white/5 bg-white dark:bg-zinc-900/60 text-left transition-colors hover:bg-gray-50 dark:hover:bg-zinc-800/60"
    >
      <div className="h-24 w-full overflow-hidden bg-gray-100 dark:bg-zinc-800">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={spot.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-3xl">{emoji}</div>
        )}
      </div>
      <div className="p-2.5">
        <p className="line-clamp-2 text-xs font-semibold leading-tight text-gray-900 dark:text-white">
          {spot.title}
        </p>
        {distance != null && (
          <p className="mt-1 text-[10px] text-gray-400 dark:text-zinc-500">
            {formatDistance(distance)}
          </p>
        )}
      </div>
    </button>
  )
}

// ─── Carrousel horizontal avec titre ────────────────────────────────────────
function SmartList({
  icon,
  title,
  spots,
  onSelect,
  userLocation,
}: {
  icon: React.ReactNode
  title: string
  spots: Spot[]
  onSelect: (s: Spot) => void
  userLocation: { lat: number; lng: number } | null
}) {
  if (spots.length === 0) return null
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-gray-400 dark:text-zinc-500">{icon}</span>
        <h3 className="text-sm font-bold text-gray-900 dark:text-white">{title}</h3>
      </div>
      <div className="no-scrollbar flex gap-3 overflow-x-auto pb-1">
        {spots.slice(0, 10).map((spot) => {
          const dist =
            userLocation
              ? haversineKm(userLocation.lat, userLocation.lng, spot.lat, spot.lng)
              : null
          return (
            <SpotCard
              key={spot.id}
              spot={spot}
              onSelect={() => onSelect(spot)}
              distance={dist}
            />
          )
        })}
      </div>
    </div>
  )
}

// ─── Composant principal ─────────────────────────────────────────────────────
export default function ExploreModal({
  isOpen,
  onClose,
  spots,
  userLocation,
  onSelectSpot,
}: ExploreModalProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Debounce 300 ms
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Reset quand on ferme
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery("")
      setDebouncedQuery("")
      setQuickFilter(null)
    } else {
      setTimeout(() => inputRef.current?.focus(), 200)
    }
  }, [isOpen])

  const isSearching = debouncedQuery.trim().length > 0 || quickFilter !== null

  // ── Résultats de recherche ────────────────────────────────────────────────
  const searchResults = useMemo(() => {
    let list = [...spots]

    if (debouncedQuery.trim()) {
      const q = debouncedQuery.trim().toLowerCase()
      list = list.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          (s.address ?? "").toLowerCase().includes(q) ||
          (s.category ?? "").toLowerCase().includes(q) ||
          (s.description ?? "").toLowerCase().includes(q)
      )
    }

    if (quickFilter === "nearby" && userLocation) {
      list = list
        .map((s) => ({ s, d: haversineKm(userLocation.lat, userLocation.lng, s.lat, s.lng) }))
        .sort((a, b) => a.d - b.d)
        .map(({ s }) => s)
    } else if (quickFilter === "recent") {
      list = list.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
    } else if (quickFilter === "popular") {
      // Heuristique : spots avec description et image = spots soignés
      list = list.sort((a, b) => {
        const score = (s: Spot) =>
          (s.description ? 1 : 0) + (s.image_url ? 1 : 0) + (s.address ? 1 : 0)
        return score(b) - score(a)
      })
    }

    return list
  }, [spots, debouncedQuery, quickFilter, userLocation])

  // ── Listes intelligentes (état par défaut) ────────────────────────────────
  const nearbySpots = useMemo(() => {
    if (!userLocation) return []
    return [...spots]
      .map((s) => ({ s, d: haversineKm(userLocation.lat, userLocation.lng, s.lat, s.lng) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 10)
      .map(({ s }) => s)
  }, [spots, userLocation])

  const recentSpots = useMemo(
    () =>
      [...spots]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 10),
    [spots]
  )

  const hiddenGems = useMemo(() => {
    // Spots avec description + image = lieux soignés mais peut-être peu connus
    return spots
      .filter((s) => s.description && s.image_url)
      .sort(() => Math.random() - 0.5)
      .slice(0, 10)
  }, [spots]) // eslint-disable-line react-hooks/exhaustive-deps

  const QUICK_FILTERS: { key: QuickFilter; label: string; icon: React.ReactNode }[] = [
    { key: "nearby", label: "Autour de moi", icon: <MapPin size={12} /> },
    { key: "recent", label: "Nouveautés", icon: <Clock size={12} /> },
    { key: "popular", label: "Populaire", icon: <Flame size={12} /> },
  ]

  if (!isOpen) return null

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm"
          />

          {/* Sheet */}
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
              <div className="flex flex-shrink-0 items-center justify-between px-5 pt-3 pb-4 sm:pt-5">
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
                    onChange={(e) => {
                      setSearchQuery(e.target.value)
                      if (e.target.value) setQuickFilter(null)
                    }}
                    placeholder="Nom, adresse, catégorie..."
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

              {/* Quick filters */}
              <div className="no-scrollbar flex flex-shrink-0 gap-2 overflow-x-auto px-5 pb-4">
                {QUICK_FILTERS.map(({ key, label, icon }) => (
                  <button
                    key={key}
                    onClick={() => {
                      setQuickFilter(quickFilter === key ? null : key)
                      setSearchQuery("")
                      setDebouncedQuery("")
                    }}
                    className={cn(
                      "flex flex-shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                      quickFilter === key
                        ? "bg-blue-600 dark:bg-indigo-500 text-white"
                        : "border border-gray-200 dark:border-white/10 bg-white dark:bg-zinc-800/60 text-gray-600 dark:text-zinc-300 hover:border-gray-300 dark:hover:border-white/20"
                    )}
                  >
                    {icon} {label}
                  </button>
                ))}
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto px-5 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-5">
                <AnimatePresence mode="wait">
                  {isSearching ? (
                    /* ── Résultats de recherche ── */
                    <motion.div
                      key="results"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="space-y-2"
                    >
                      {searchResults.length === 0 ? (
                        <div className="flex flex-col items-center gap-3 py-16 text-center">
                          <Search size={40} className="text-gray-300 dark:text-zinc-700" />
                          <p className="text-sm font-semibold text-gray-500 dark:text-zinc-400">
                            Aucun spot trouvé
                          </p>
                          <p className="text-xs text-gray-400 dark:text-zinc-600">
                            Essaie un autre mot-clé ou filtre
                          </p>
                        </div>
                      ) : (
                        <>
                          <p className="mb-3 text-xs font-medium text-gray-400 dark:text-zinc-500">
                            {searchResults.length} résultat{searchResults.length > 1 ? "s" : ""}
                          </p>
                          {searchResults.map((spot) => {
                            const dist = userLocation
                              ? haversineKm(userLocation.lat, userLocation.lng, spot.lat, spot.lng)
                              : null
                            return (
                              <SpotRow
                                key={spot.id}
                                spot={spot}
                                onSelect={() => onSelectSpot(spot)}
                                distance={dist}
                              />
                            )
                          })}
                        </>
                      )}
                    </motion.div>
                  ) : (
                    /* ── Listes intelligentes ── */
                    <motion.div
                      key="smart-lists"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="space-y-7"
                    >
                      {nearbySpots.length > 0 && (
                        <SmartList
                          icon={<MapPin size={15} />}
                          title="Près de chez vous"
                          spots={nearbySpots}
                          onSelect={onSelectSpot}
                          userLocation={userLocation}
                        />
                      )}
                      <SmartList
                        icon={<Clock size={15} />}
                        title="Ajoutés récemment"
                        spots={recentSpots}
                        onSelect={onSelectSpot}
                        userLocation={userLocation}
                      />
                      {hiddenGems.length > 0 && (
                        <SmartList
                          icon={<Sparkles size={15} />}
                          title="Pépites cachées"
                          spots={hiddenGems}
                          onSelect={onSelectSpot}
                          userLocation={userLocation}
                        />
                      )}
                      {spots.length === 0 && (
                        <div className="flex flex-col items-center gap-3 py-16 text-center">
                          <Sparkles size={40} className="text-gray-300 dark:text-zinc-700" />
                          <p className="text-sm font-semibold text-gray-500 dark:text-zinc-400">
                            Aucun spot disponible
                          </p>
                          <p className="text-xs text-gray-400 dark:text-zinc-600">
                            Ajoute des spots ou suis des amis pour voir leurs lieux
                          </p>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
