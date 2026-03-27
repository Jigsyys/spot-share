"use client"

import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, Search, LocateFixed, Shuffle, Clock } from "lucide-react"
import type { Spot } from "@/lib/types"
import { cn } from "@/lib/utils"
import { CATEGORY_EMOJIS } from "@/lib/categories"

// ─── Helpers ───────────────────────────────────────────────────────────────

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

function isNew(createdAt: string) {
  return Date.now() - new Date(createdAt).getTime() < 48 * 3600_000
}

function timeSince(date: string): string {
  const diff = Date.now() - new Date(date).getTime()
  const h = Math.floor(diff / 3_600_000)
  const d = Math.floor(h / 24)
  if (h < 1) return "à l'instant"
  if (h < 24) return `il y a ${h}h`
  return `il y a ${d}j`
}

/** Retourne true=ouvert, false=fermé, null=inconnu */
function isOpenNow(weekdayDescriptions: string[] | null): boolean | null {
  if (!weekdayDescriptions?.length) return null
  const now = new Date()
  const jsDay = now.getDay() // 0=dim
  const googleIdx = jsDay === 0 ? 6 : jsDay - 1 // google: 0=lun, 6=dim
  const line = weekdayDescriptions[googleIdx]
  if (!line) return null
  const lower = line.toLowerCase()
  if (lower.includes("fermé") || lower.includes("closed")) return false
  if (lower.includes("24h") || lower.includes("open 24")) return true
  const nowMins = now.getHours() * 60 + now.getMinutes()
  const ranges = [...line.matchAll(/(\d{1,2}):(\d{2})\s*[–\-]\s*(\d{1,2}):(\d{2})/g)]
  if (!ranges.length) return null
  for (const m of ranges) {
    const openMins = parseInt(m[1]) * 60 + parseInt(m[2])
    let closeMins = parseInt(m[3]) * 60 + parseInt(m[4])
    if (closeMins < openMins) closeMins += 24 * 60
    if (nowMins >= openMins && nowMins <= closeMins) return true
  }
  return false
}

// ─── Constants ─────────────────────────────────────────────────────────────

const CATEGORIES = [
  { key: "all",        label: "Tous",     emoji: "🌎" },
  { key: "café",       label: "Café",     emoji: "☕" },
  { key: "restaurant", label: "Resto",    emoji: "🍽️" },
  { key: "bar",        label: "Bar",      emoji: "🍸" },
  { key: "outdoor",    label: "Nature",   emoji: "🌿" },
  { key: "vue",        label: "Vue",      emoji: "🌅" },
  { key: "culture",    label: "Culture",  emoji: "🎭" },
  { key: "shopping",   label: "Shopping", emoji: "🛍️" },
  { key: "other",      label: "Autre",    emoji: "📍" },
]

const COLLECTIONS = [
  { id: "morning", label: "☀️ Ce matin",    desc: "Café & brunch",      categories: ["café"] },
  { id: "evening", label: "🌙 Ce soir",     desc: "Bars & restos",      categories: ["bar", "restaurant"] },
  { id: "outdoor", label: "🌿 Plein air",   desc: "Nature & panoramas", categories: ["outdoor", "vue"] },
  { id: "culture", label: "🎭 À découvrir", desc: "Culture & shopping", categories: ["culture", "shopping"] },
] as const

// ─── Sub-components ────────────────────────────────────────────────────────

function SpotRow({
  spot, distance, onSelect,
}: { spot: Spot; distance?: number; onSelect: () => void }) {
  const imageUrl = spot.image_url?.split(",")[0]?.trim() || null
  const emoji    = CATEGORY_EMOJIS[spot.category ?? "other"] ?? "📍"
  const open     = isOpenNow(spot.weekday_descriptions ?? null)
  const novel    = isNew(spot.created_at)

  return (
    <button
      onClick={onSelect}
      className="flex w-full items-center gap-3 rounded-2xl border border-gray-200 dark:border-white/5 bg-white dark:bg-zinc-900/60 p-3 text-left transition-all active:scale-[0.98] hover:bg-gray-50 dark:hover:bg-zinc-800/60"
    >
      <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl bg-gray-100 dark:bg-zinc-800">
        {imageUrl
          ? <img src={imageUrl} alt={spot.title} className="h-full w-full object-cover" /> // eslint-disable-line @next/next/no-img-element
          : <div className="flex h-full w-full items-center justify-center text-2xl">{emoji}</div>}
        {novel && (
          <span className="absolute top-1 left-1 rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] font-bold text-white leading-none">
            NEW
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">
            {spot.title}
          </p>
        </div>
        {spot.address && (
          <p className="mt-0.5 truncate text-xs text-gray-400 dark:text-zinc-500">
            {spot.address}
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-gray-500 dark:text-zinc-400">
            {emoji} {CATEGORIES.find(c => c.key === spot.category)?.label ?? "Autre"}
          </span>
          {open === true && (
            <span className="rounded-full bg-emerald-50 dark:bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
              ● Ouvert
            </span>
          )}
          {open === false && (
            <span className="rounded-full bg-red-50 dark:bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-red-400 dark:text-red-400">
              Fermé
            </span>
          )}
          {distance !== undefined && (
            <span className="rounded-full bg-blue-50 dark:bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-bold text-blue-600 dark:text-indigo-400">
              📍 {fmtDist(distance)}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

// ─── Types ─────────────────────────────────────────────────────────────────

interface ExploreModalProps {
  isOpen: boolean
  onClose: () => void
  spots: Spot[]
  allSpots?: Spot[]
  userLocation: { lat: number; lng: number } | null
  onSelectSpot: (spot: Spot) => void
  currentUserId?: string | null
  savedSpotIds?: Set<string>
  onSelectUser?: (userId: string) => void
}

// ─── ExploreModal ──────────────────────────────────────────────────────────

export default function ExploreModal({
  isOpen, onClose, spots, allSpots, userLocation, onSelectSpot, currentUserId, savedSpotIds, onSelectUser,
}: ExploreModalProps) {
  const [searchQuery, setSearchQuery]         = useState("")
  const [debouncedQuery, setDebouncedQuery]   = useState("")
  const [activeCategory, setActiveCategory]   = useState("all")
  const [nearbyMode, setNearbyMode]           = useState(false)
  const [openNowFilter, setOpenNowFilter]     = useState(false)
  const [activeCollection, setActiveCollection] = useState<string | null>(null)
  const [surpriseLoading, setSurpriseLoading] = useState(false)
  const [filterFriendId, setFilterFriendId]   = useState<string | null>(null)
  const inputRef           = useRef<HTMLInputElement>(null)
  const lastPickedIdRef    = useRef<string | null>(null)
  const displayedSpotsRef  = useRef<{ spot: Spot; distance?: number }[]>([])

  // Debounce 300ms
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 300)
    return () => clearTimeout(t)
  }, [searchQuery])

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery(""); setDebouncedQuery(""); setActiveCategory("all")
      setNearbyMode(false); setOpenNowFilter(false); setActiveCollection(null)
      setSurpriseLoading(false); setFilterFriendId(null)
    } else {
      setTimeout(() => inputRef.current?.focus(), 200)
    }
  }, [isOpen])

  // Profils amis dérivés des spots
  const friendProfiles = useMemo(() => {
    const seen = new Set<string>()
    const result: { id: string; username: string | null; avatar_url: string | null }[] = []
    for (const s of spots) {
      if (s.user_id !== currentUserId && !seen.has(s.user_id)) {
        seen.add(s.user_id)
        result.push({ id: s.user_id, username: s.profiles?.username ?? null, avatar_url: s.profiles?.avatar_url ?? null })
      }
    }
    return result
  }, [spots, currentUserId])

  // "Mes envies" — spots enregistrés par l'utilisateur
  const savedSpots = useMemo(() => {
    if (!savedSpotIds || savedSpotIds.size === 0) return []
    return spots.filter(s => savedSpotIds.has(s.id))
  }, [spots, savedSpotIds])

  // "Amis cette semaine" — spots d'amis ajoutés dans les 7 derniers jours
  const friendsThisWeek = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 3600_000
    return spots
      .filter(s => s.user_id !== currentUserId && new Date(s.created_at).getTime() > weekAgo)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 10)
  }, [spots, currentUserId])

  // Collections — comptage par catégories
  const collectionCounts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const col of COLLECTIONS) {
      map[col.id] = spots.filter(s => (col.categories as readonly string[]).includes(s.category)).length
    }
    return map
  }, [spots])

  // Liste principale avec filtres
  const { displayedSpots, nearbyCount } = useMemo(() => {
    const withDist = spots.map(s => ({
      spot: s,
      distance: userLocation
        ? distanceKm(userLocation.lat, userLocation.lng, s.lat, s.lng)
        : undefined,
    }))

    const nearbyCount = userLocation
      ? withDist.filter(({ distance }) => distance !== undefined && distance < 2).length
      : 0

    let list = withDist

    // Filtre collection active
    if (activeCollection) {
      const col = COLLECTIONS.find(c => c.id === activeCollection)
      if (col) list = list.filter(({ spot }) => (col.categories as readonly string[]).includes(spot.category))
    }

    // Filtre catégorie (si pas de collection active)
    if (!activeCollection && activeCategory !== "all") {
      list = list.filter(({ spot }) => spot.category === activeCategory)
    }

    // Filtre "Ouvert maintenant"
    if (openNowFilter) {
      list = list.filter(({ spot }) => isOpenNow(spot.weekday_descriptions ?? null) !== false)
    }

    // Filtre par ami
    if (filterFriendId) {
      list = list.filter(({ spot }) => spot.user_id === filterFriendId)
    }

    // Filtre texte
    if (debouncedQuery.trim()) {
      const q = debouncedQuery.trim().toLowerCase()
      list = list.filter(({ spot }) =>
        spot.title.toLowerCase().includes(q) ||
        (spot.address ?? "").toLowerCase().includes(q) ||
        (spot.description ?? "").toLowerCase().includes(q)
      )
    }

    // Tri
    if (nearbyMode && userLocation) {
      list = [...list].sort((a, b) => (a.distance ?? 99999) - (b.distance ?? 99999))
    } else {
      list = [...list].sort((a, b) =>
        new Date(b.spot.created_at).getTime() - new Date(a.spot.created_at).getTime()
      )
    }

    return { displayedSpots: list, nearbyCount }
  }, [spots, activeCategory, activeCollection, debouncedQuery, openNowFilter, nearbyMode, userLocation, filterFriendId])

  // Sync ref for surprise
  useEffect(() => { displayedSpotsRef.current = displayedSpots }, [displayedSpots])

  // Surprise button — pioche dans TOUS les spots dans un rayon de 50km
  const handleSurprise = useCallback(() => {
    if (surpriseLoading) return
    const base = allSpots ?? spots
    if (!base.length) return
    setSurpriseLoading(true)
    setTimeout(() => {
      let pool = base.map(s => ({
        spot: s,
        distance: userLocation
          ? distanceKm(userLocation.lat, userLocation.lng, s.lat, s.lng)
          : undefined,
      }))
      if (userLocation) {
        const nearby = pool.filter(({ distance }) => distance !== undefined && distance < 50)
        if (nearby.length > 0) pool = nearby
      }
      if (pool.length > 1 && lastPickedIdRef.current) {
        const filtered = pool.filter(({ spot }) => spot.id !== lastPickedIdRef.current)
        if (filtered.length > 0) pool = filtered
      }
      const picked = pool[Math.floor(Math.random() * pool.length)]
      lastPickedIdRef.current = picked.spot.id
      setSurpriseLoading(false)
      onSelectSpot(picked.spot)
    }, 600)
  }, [surpriseLoading, userLocation, onSelectSpot, allSpots, spots])

  if (!isOpen) return null

  const hasLocation    = userLocation !== null
  const isFiltered     = debouncedQuery.trim() || activeCategory !== "all" || openNowFilter || activeCollection
  const showDiscovery  = !isFiltered

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
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

              <div className="mx-auto mt-4 mb-1 h-1.5 w-12 flex-shrink-0 rounded-full bg-gray-300 dark:bg-zinc-700/50 sm:hidden" />

              {/* Header */}
              <div className="flex flex-shrink-0 items-center justify-between px-5 pt-3 pb-3 sm:pt-5">
                <h2 className="flex items-center gap-2 text-lg font-bold">
                  <Search size={18} className="text-blue-600 dark:text-indigo-400" />
                  Explorer
                </h2>
                <button onClick={onClose} className="rounded-xl p-2 text-gray-500 dark:text-zinc-400 transition-colors hover:bg-gray-100 dark:hover:bg-white/10">
                  <X size={18} />
                </button>
              </div>

              {/* Search */}
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
                    <button onClick={() => { setSearchQuery(""); setDebouncedQuery("") }} className="text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300">
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* Action cards */}
              <div className="flex-shrink-0 grid grid-cols-2 gap-3 px-5 pb-4">
                {/* Autour de moi */}
                <button
                  onClick={() => hasLocation && setNearbyMode(v => !v)}
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
                    <LocateFixed size={18} className={nearbyMode ? "text-blue-600 dark:text-indigo-400" : "text-gray-500 dark:text-zinc-400"} />
                    {nearbyMode && <span className="h-2 w-2 rounded-full bg-blue-500 dark:bg-indigo-400 animate-pulse" />}
                  </div>
                  <p className={cn("text-sm font-semibold", nearbyMode ? "text-blue-700 dark:text-indigo-300" : "text-gray-800 dark:text-zinc-200")}>
                    Autour de moi
                  </p>
                  <p className="text-[11px] text-gray-400 dark:text-zinc-500 leading-tight">
                    {!hasLocation ? "Localisation off" : nearbyMode ? "Trié par distance" : nearbyCount > 0 ? `${nearbyCount} spot${nearbyCount > 1 ? "s" : ""} < 2 km` : "Trier par distance"}
                  </p>
                </button>

                {/* Surprends-moi */}
                <button
                  onClick={handleSurprise}
                  disabled={surpriseLoading || displayedSpots.length === 0}
                  className="flex flex-col items-start gap-1 rounded-2xl border border-purple-200 dark:border-purple-500/20 bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-500/10 dark:to-pink-500/10 p-3.5 text-left transition-all hover:from-purple-100 hover:to-pink-100 dark:hover:from-purple-500/20 dark:hover:to-pink-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <motion.div animate={surpriseLoading ? { rotate: 360 } : { rotate: 0 }} transition={surpriseLoading ? { duration: 0.5, ease: "linear", repeat: Infinity } : {}}>
                    <Shuffle size={18} className="text-purple-500 dark:text-purple-400" />
                  </motion.div>
                  <p className="text-sm font-semibold text-purple-700 dark:text-purple-300">
                    {surpriseLoading ? "Choix..." : "Surprends-moi"}
                  </p>
                  <p className="text-[11px] text-purple-400 dark:text-purple-500 leading-tight">
                    {userLocation ? "Spot aléatoire proche" : "Spot au hasard"}
                  </p>
                </button>
              </div>

              {/* Filtres : catégories + Ouvert maintenant */}
              <div className="no-scrollbar flex flex-shrink-0 items-center gap-2 overflow-x-auto px-5 pb-4">
                {CATEGORIES.map(({ key, label, emoji }) => (
                  <button
                    key={key}
                    onClick={() => { setActiveCategory(key); setActiveCollection(null) }}
                    className={cn(
                      "flex flex-shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                      activeCategory === key && !activeCollection
                        ? "bg-blue-600 dark:bg-indigo-500 text-white"
                        : "border border-gray-200 dark:border-white/10 bg-white dark:bg-zinc-800/60 text-gray-600 dark:text-zinc-300 hover:border-gray-300 dark:hover:border-white/20"
                    )}
                  >
                    {emoji} {label}
                  </button>
                ))}
                {/* Séparateur */}
                <div className="h-5 w-px flex-shrink-0 bg-gray-200 dark:bg-white/10" />
                {/* Ouvert maintenant */}
                <button
                  onClick={() => setOpenNowFilter(v => !v)}
                  className={cn(
                    "flex flex-shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                    openNowFilter
                      ? "bg-emerald-500 text-white"
                      : "border border-gray-200 dark:border-white/10 bg-white dark:bg-zinc-800/60 text-gray-600 dark:text-zinc-300 hover:border-emerald-300 dark:hover:border-emerald-500/30"
                  )}
                >
                  <Clock size={12} /> Ouvert
                </button>
              </div>

              {/* Filtre par ami */}
              {friendProfiles.length > 0 && (
                <div className="no-scrollbar flex flex-shrink-0 items-center gap-2 overflow-x-auto px-5 pb-4">
                  <span className="flex-shrink-0 text-xs font-semibold text-gray-400 dark:text-zinc-500">Par ami :</span>
                  {friendProfiles.map((fp) => (
                    <button
                      key={fp.id}
                      onClick={() => setFilterFriendId(fp.id === filterFriendId ? null : fp.id)}
                      className={cn(
                        "flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold transition-colors",
                        filterFriendId === fp.id
                          ? "bg-blue-600 dark:bg-indigo-500 text-white"
                          : "border border-gray-200 dark:border-white/10 bg-white dark:bg-zinc-800/60 text-gray-600 dark:text-zinc-300 hover:border-gray-300 dark:hover:border-white/20"
                      )}
                    >
                      {fp.avatar_url ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={fp.avatar_url} alt="" className="h-4 w-4 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-[8px] font-bold text-white">
                          {(fp.username ?? "?")[0].toUpperCase()}
                        </div>
                      )}
                      @{fp.username ?? "ami"}
                    </button>
                  ))}
                </div>
              )}

              {/* Zone scrollable */}
              <div className="flex-1 overflow-y-auto px-5 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-5">

                {/* ── Sections de découverte (masquées si filtre actif) ── */}
                {showDiscovery && (
                  <>
                    {/* Mes envies */}
                    {savedSpots.length > 0 && (
                      <div className="mb-5">
                        <p className="mb-2.5 text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase tracking-wide">
                          🔖 Mes envies
                        </p>
                        <div className="no-scrollbar flex gap-3 overflow-x-auto pb-1">
                          {savedSpots.map(spot => {
                            const img   = spot.image_url?.split(",")[0]?.trim() || null
                            const emoji = CATEGORY_EMOJIS[spot.category ?? "other"] ?? "📍"
                            return (
                              <button
                                key={spot.id}
                                onClick={() => onSelectSpot(spot)}
                                className="flex-shrink-0 w-40 overflow-hidden rounded-2xl border border-gray-200 dark:border-white/5 bg-white dark:bg-zinc-900/60 text-left transition-all active:scale-[0.97] hover:bg-gray-50 dark:hover:bg-zinc-800/60"
                              >
                                <div className="relative h-24 w-full bg-gray-100 dark:bg-zinc-800">
                                  {img
                                    ? <img src={img} alt={spot.title} className="h-full w-full object-cover" /> // eslint-disable-line @next/next/no-img-element
                                    : <div className="flex h-full w-full items-center justify-center text-3xl">{emoji}</div>}
                                  <span className="absolute bottom-1.5 right-1.5 text-sm">🔖</span>
                                </div>
                                <div className="p-2.5">
                                  <p className="truncate text-xs font-semibold text-gray-900 dark:text-white">{spot.title}</p>
                                  {spot.address && (
                                    <p className="mt-0.5 truncate text-[10px] text-gray-400 dark:text-zinc-500">{spot.address}</p>
                                  )}
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Amis cette semaine */}
                    {friendsThisWeek.length > 0 && (
                      <div className="mb-5">
                        <p className="mb-2.5 text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase tracking-wide">
                          🆕 Ajoutés cette semaine
                        </p>
                        <div className="no-scrollbar flex gap-3 overflow-x-auto pb-1">
                          {friendsThisWeek.map(spot => {
                            const img = spot.image_url?.split(",")[0]?.trim() || null
                            const emoji = CATEGORY_EMOJIS[spot.category ?? "other"] ?? "📍"
                            const avatar = spot.profiles?.avatar_url
                            const username = spot.profiles?.username ?? "Ami"
                            return (
                              <button
                                key={spot.id}
                                onClick={() => onSelectSpot(spot)}
                                className="flex-shrink-0 w-40 overflow-hidden rounded-2xl border border-gray-200 dark:border-white/5 bg-white dark:bg-zinc-900/60 text-left transition-all active:scale-[0.97] hover:bg-gray-50 dark:hover:bg-zinc-800/60"
                              >
                                <div className="relative h-24 w-full bg-gray-100 dark:bg-zinc-800">
                                  {img
                                    ? <img src={img} alt={spot.title} className="h-full w-full object-cover" /> // eslint-disable-line @next/next/no-img-element
                                    : <div className="flex h-full w-full items-center justify-center text-3xl">{emoji}</div>}
                                  <span className="absolute top-1.5 right-1.5 rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] font-bold text-white">NEW</span>
                                </div>
                                <div className="p-2.5">
                                  <p className="truncate text-xs font-semibold text-gray-900 dark:text-white">{spot.title}</p>
                                  <div
                                    className={cn("mt-1 flex items-center gap-1.5", onSelectUser && "cursor-pointer hover:opacity-80")}
                                    onClick={(e) => { e.stopPropagation(); onSelectUser?.(spot.user_id) }}
                                  >
                                    {avatar
                                      ? <img src={avatar} alt={username} className="h-4 w-4 rounded-full object-cover" /> // eslint-disable-line @next/next/no-img-element
                                      : <div className="flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500 text-[8px] font-bold text-white">{username[0]?.toUpperCase()}</div>}
                                    <span className="truncate text-[10px] text-gray-400 dark:text-zinc-500">@{username} · {timeSince(spot.created_at)}</span>
                                  </div>
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Collections thématiques */}
                    <div className="mb-5">
                      <p className="mb-2.5 text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase tracking-wide">
                        Collections
                      </p>
                      <div className="no-scrollbar flex gap-3 overflow-x-auto pb-1">
                        {COLLECTIONS.map(col => {
                          const count = collectionCounts[col.id] ?? 0
                          const isActive = activeCollection === col.id
                          // Prendre l'image du premier spot de la collection
                          const preview = spots.find(s =>
                            (col.categories as readonly string[]).includes(s.category) && s.image_url
                          )?.image_url?.split(",")[0]?.trim() || null

                          return (
                            <button
                              key={col.id}
                              onClick={() => {
                                setActiveCollection(isActive ? null : col.id)
                                setActiveCategory("all")
                              }}
                              disabled={count === 0}
                              className={cn(
                                "relative flex-shrink-0 w-36 h-24 overflow-hidden rounded-2xl text-left transition-all active:scale-[0.97]",
                                isActive ? "ring-2 ring-indigo-500" : "",
                                count === 0 ? "opacity-40 cursor-not-allowed" : ""
                              )}
                            >
                              {/* Background */}
                              <div className="absolute inset-0 bg-gradient-to-br from-zinc-700 to-zinc-900">
                                {preview && (
                                  <img src={preview} alt="" className="h-full w-full object-cover opacity-60" /> // eslint-disable-line @next/next/no-img-element
                                )}
                              </div>
                              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                              <div className="absolute inset-0 flex flex-col justify-end p-2.5">
                                <p className="text-sm font-bold text-white leading-tight">{col.label}</p>
                                <p className="text-[10px] text-white/70">{count} spot{count > 1 ? "s" : ""}</p>
                              </div>
                              {isActive && (
                                <div className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500">
                                  <X size={10} className="text-white" />
                                </div>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </>
                )}

                {/* ── Liste des spots ── */}
                {displayedSpots.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-12 text-center">
                    <Search size={40} className="text-gray-300 dark:text-zinc-700" />
                    <p className="text-sm font-semibold text-gray-500 dark:text-zinc-400">Aucun spot trouvé</p>
                    <p className="text-xs text-gray-400 dark:text-zinc-600">
                      {openNowFilter ? "Essaie de désactiver le filtre «Ouvert»" : activeCategory !== "all" || activeCollection ? "Essaie une autre catégorie" : "Essaie un autre mot-clé"}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="mb-3 flex items-center gap-2">
                      <p className="text-xs font-medium text-gray-400 dark:text-zinc-500">
                        {displayedSpots.length} spot{displayedSpots.length > 1 ? "s" : ""}
                      </p>
                      {nearbyMode && <span className="text-[10px] text-blue-500 dark:text-indigo-400 font-medium">· par distance</span>}
                      {openNowFilter && <span className="text-[10px] text-emerald-500 font-medium">· ouverts</span>}
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
