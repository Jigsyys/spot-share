"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, Search } from "lucide-react"
import type { Spot } from "@/lib/types"
import { cn } from "@/lib/utils"

interface ExploreModalProps {
  isOpen: boolean
  onClose: () => void
  spots: Spot[]
  userLocation: { lat: number; lng: number } | null
  onSelectSpot: (spot: Spot) => void
}

const CATEGORIES = [
  { key: "all", label: "Tous", emoji: "🌎" },
  { key: "café", label: "Café", emoji: "☕" },
  { key: "restaurant", label: "Restaurant", emoji: "🍽️" },
  { key: "bar", label: "Bar", emoji: "🍸" },
  { key: "outdoor", label: "Outdoor", emoji: "🌿" },
  { key: "vue", label: "Vue", emoji: "🌅" },
  { key: "culture", label: "Culture", emoji: "🎭" },
  { key: "shopping", label: "Shopping", emoji: "🛍️" },
  { key: "other", label: "Autre", emoji: "📍" },
]

const CATEGORY_EMOJIS: Record<string, string> = {
  café: "☕", restaurant: "🍽️", bar: "🍸", outdoor: "🌿",
  vue: "🌅", culture: "🎭", shopping: "🛍️", other: "📍",
}

function SpotRow({ spot, onSelect }: { spot: Spot; onSelect: () => void }) {
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
        <p className="mt-1 text-xs text-gray-500 dark:text-zinc-400">
          {emoji} {spot.category ?? "autre"}
        </p>
      </div>
    </button>
  )
}

export default function ExploreModal({
  isOpen,
  onClose,
  spots,
  onSelectSpot,
}: ExploreModalProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [activeCategory, setActiveCategory] = useState("all")
  const inputRef = useRef<HTMLInputElement>(null)

  // Debounce 300 ms
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Reset à la fermeture
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery("")
      setDebouncedQuery("")
      setActiveCategory("all")
    } else {
      setTimeout(() => inputRef.current?.focus(), 200)
    }
  }, [isOpen])

  const displayedSpots = useMemo(() => {
    // Base : tous les spots triés du plus récent au plus ancien
    let list = [...spots].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )

    // Filtre catégorie
    if (activeCategory !== "all") {
      list = list.filter((s) => s.category === activeCategory)
    }

    // Filtre texte (debounced)
    if (debouncedQuery.trim()) {
      const q = debouncedQuery.trim().toLowerCase()
      list = list.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          (s.address ?? "").toLowerCase().includes(q) ||
          (s.description ?? "").toLowerCase().includes(q)
      )
    }

    return list
  }, [spots, activeCategory, debouncedQuery])

  if (!isOpen) return null

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm"
          />

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
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Nom, adresse..."
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
                      Essaie un autre mot-clé ou catégorie
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="mb-3 text-xs font-medium text-gray-400 dark:text-zinc-500">
                      {displayedSpots.length} spot{displayedSpots.length > 1 ? "s" : ""}
                    </p>
                    {displayedSpots.map((spot) => (
                      <SpotRow
                        key={spot.id}
                        spot={spot}
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
