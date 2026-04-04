"use client"

import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, Search, Shuffle, MapPin, LoaderCircle } from "lucide-react"
import type { Spot } from "@/lib/types"
import { cn } from "@/lib/utils"
import { CATEGORY_EMOJIS, CATEGORIES } from "@/lib/categories"
import { useSwipeToClose } from "@/hooks/useSwipeToClose"

// ─── Helpers ────────────────────────────────────────────────────────────────

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

/** Returns a human-readable countdown badge string, or null if not ephemeral */
function expiresIn(expiresAt: string | null | undefined): string | null {
  if (!expiresAt) return null
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (ms <= 0) return null
  const days = Math.ceil(ms / 86_400_000)
  if (days <= 1) return "⏳ Expire demain"
  if (days <= 7) return `⏳ ${days}j restants`
  return null
}

function isOpenNow(weekdayDescriptions: string[] | null): boolean | null {
  if (!weekdayDescriptions?.length) return null
  const now = new Date()
  const jsDay = now.getDay()
  const googleIdx = jsDay === 0 ? 6 : jsDay - 1
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

// ─── CategoryGrid ────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  "café":       "linear-gradient(135deg, #3d1a00, #d97706)",
  "restaurant": "linear-gradient(135deg, #7f1d1d, #ef4444)",
  "extérieur":  "linear-gradient(135deg, #14532d, #16a34a)",
  "bar":        "linear-gradient(135deg, #2e1065, #9333ea)",
  "vue":        "linear-gradient(135deg, #0c2d5e, #2563eb)",
  "culture":    "linear-gradient(135deg, #4a0e2e, #db2777)",
  "sport":      "linear-gradient(135deg, #431407, #ea580c)",
  "événement":  "linear-gradient(135deg, #1e1b4b, #4f46e5)",
}

function CategoryGrid({
  value,
  onChange,
}: {
  value: string | null
  onChange: (v: string | null) => void
}) {
  const hasSelection = value !== null
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {CATEGORIES.map(c => {
        const isSelected = value === c.key
        return (
          <button
            key={c.key}
            onClick={() => onChange(isSelected ? null : c.key)}
            style={{ background: CATEGORY_COLORS[c.key] ?? "#1e1e1e" }}
            className={cn(
              "flex flex-col items-center gap-1 rounded-[14px] py-2.5 px-1 border-[2.5px] transition-all active:scale-95",
              isSelected
                ? "border-white opacity-100 shadow-[0_0_0_1px_rgba(255,255,255,0.2)]"
                : cn("border-transparent", hasSelection ? "opacity-35" : "opacity-80")
            )}
          >
            <span className="text-[20px] leading-none">{c.emoji}</span>
            <span className="text-[8px] font-bold text-white text-center leading-tight">{c.label}</span>
          </button>
        )
      })}
    </div>
  )
}


// ─── Spot cards ──────────────────────────────────────────────────────────────

/** Grille 2 colonnes — mode Moi */
function SpotGridCard({ spot, onSelect }: { spot: Spot; onSelect: () => void }) {
  const imageUrl = spot.image_url?.split(",")[0]?.trim() || null
  const emoji = CATEGORY_EMOJIS[spot.category ?? "other"] ?? "📍"
  const novel = isNew(spot.created_at)
  const countdown = expiresIn(spot.expires_at)

  return (
    <button
      onClick={onSelect}
      className="group relative aspect-square w-full overflow-hidden rounded-2xl bg-gray-100 active:scale-[0.97] transition-transform"
    >
      {imageUrl
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={imageUrl} alt={spot.title} className="h-full w-full object-cover" />
        : <div className="flex h-full w-full items-center justify-center text-4xl">{emoji}</div>
      }
      <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent" />
      {novel && !countdown && (
        <span className="absolute top-2 left-2 rounded-full bg-rose-500 px-2 py-0.5 text-[9px] font-bold text-white">
          NEW
        </span>
      )}
      {countdown && (
        <span className="absolute top-2 left-2 rounded-full bg-amber-500 px-2 py-0.5 text-[9px] font-bold text-white">
          {countdown}
        </span>
      )}
      <div className="absolute bottom-0 left-0 right-0 p-2.5">
        <p className="line-clamp-2 text-[12px] font-bold leading-tight text-white">{spot.title}</p>
        {spot.address && (
          <p className="mt-0.5 truncate text-[10px] text-white/60">{spot.address}</p>
        )}
      </div>
    </button>
  )
}

/** Card horizontale — carrousels */
function SpotHCard({
  spot, distance, onSelect, onSelectUser,
}: {
  spot: Spot
  distance?: number
  onSelect: () => void
  onSelectUser?: (id: string) => void
}) {
  const imageUrl = spot.image_url?.split(",")[0]?.trim() || null
  const emoji = CATEGORY_EMOJIS[spot.category ?? "other"] ?? "📍"
  const novel = isNew(spot.created_at)
  const countdown = expiresIn(spot.expires_at)
  const username = spot.profiles?.username ?? null
  const avatar = spot.profiles?.avatar_url ?? null

  return (
    <button
      onClick={onSelect}
      className="flex-shrink-0 w-38 overflow-hidden rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-zinc-900 text-left active:scale-[0.97] transition-transform"
      style={{ width: "9.5rem" }}
    >
      <div className="relative h-28 w-full overflow-hidden bg-gray-100">
        {imageUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={imageUrl} alt={spot.title} className="h-full w-full object-cover" />
          : <div className="flex h-full w-full items-center justify-center text-4xl">{emoji}</div>
        }
        {novel && !countdown && (
          <span className="absolute top-1.5 left-1.5 rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] font-bold text-white">
            NEW
          </span>
        )}
        {countdown && (
          <span className="absolute top-1.5 left-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold text-white">
            {countdown}
          </span>
        )}
        {distance !== undefined && (
          <span className="absolute bottom-1.5 right-1.5 flex items-center gap-0.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm">
            <MapPin size={8} /> {fmtDist(distance)}
          </span>
        )}
      </div>
      <div className="p-2.5">
        <p className="line-clamp-2 text-xs font-semibold leading-tight text-gray-900 dark:text-white">{spot.title}</p>
        {username && (
          <button
            onClick={e => { e.stopPropagation(); onSelectUser?.(spot.user_id) }}
            className="mt-1 flex items-center gap-1 hover:opacity-70 transition-opacity"
          >
            {avatar
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={avatar} alt="" className="h-3.5 w-3.5 rounded-full object-cover" />
              : <div className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-indigo-400 text-[7px] font-bold text-white">{username[0]?.toUpperCase()}</div>
            }
            <span className="truncate text-[10px] text-gray-400">{username}</span>
          </button>
        )}
      </div>
    </button>
  )
}

/** Ligne liste — vue détaillée */
function SpotListRow({
  spot, distance, showAuthor, onSelect, onSelectUser,
}: {
  spot: Spot
  distance?: number
  showAuthor?: boolean
  onSelect: () => void
  onSelectUser?: (id: string) => void
}) {
  const imageUrl = spot.image_url?.split(",")[0]?.trim() || null
  const emoji = CATEGORY_EMOJIS[spot.category ?? "other"] ?? "📍"
  const open = isOpenNow(spot.weekday_descriptions ?? null)
  const countdown = expiresIn(spot.expires_at)
  const username = spot.profiles?.username ?? null
  const avatar = spot.profiles?.avatar_url ?? null

  return (
    <button
      onClick={onSelect}
      className="flex w-full items-center gap-3 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-zinc-900 p-3 text-left active:scale-[0.98] hover:bg-gray-50 dark:hover:bg-zinc-800 transition-all"
    >
      <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-xl bg-gray-100">
        {imageUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={imageUrl} alt={spot.title} className="h-full w-full object-cover" />
          : <div className="flex h-full w-full items-center justify-center text-2xl">{emoji}</div>
        }
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{spot.title}</p>
        {spot.address && (
          <p className="mt-0.5 truncate text-xs text-gray-400 dark:text-zinc-500">{spot.address}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {countdown && (
            <span className="rounded-full bg-amber-100 dark:bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
              {countdown}
            </span>
          )}
          {distance !== undefined && (
            <span className="flex items-center gap-0.5 text-[11px] font-semibold text-blue-600">
              <MapPin size={9} /> {fmtDist(distance)}
            </span>
          )}
          {open === true && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Ouvert
            </span>
          )}
          {open === false && (
            <span className="text-[11px] text-red-400">Fermé</span>
          )}
          {showAuthor && username && (
            <button
              onClick={e => { e.stopPropagation(); onSelectUser?.(spot.user_id) }}
              className="flex items-center gap-1 hover:opacity-70 transition-opacity"
            >
              {avatar
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={avatar} alt="" className="h-3.5 w-3.5 rounded-full object-cover" />
                : <div className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-indigo-400 text-[7px] font-bold text-white">{username[0]?.toUpperCase()}</div>
              }
              <span className="text-[11px] text-gray-400">{username} · {timeSince(spot.created_at)}</span>
            </button>
          )}
        </div>
      </div>
    </button>
  )
}

type DistSpot = { spot: Spot; distance: number | undefined }
type FriendProfile = { id: string; username: string | null; avatar_url: string | null }

// ─── Props ───────────────────────────────────────────────────────────────────

interface ExploreModalProps {
  isOpen: boolean
  onClose: () => void
  spots: Spot[]
  allSpots?: Spot[]
  userLocation: { lat: number; lng: number } | null
  onSelectSpot: (spot: Spot) => void
  currentUserId?: string | null
  followingIds?: string[]
  followingProfiles?: { id: string; username: string | null; avatar_url: string | null }[]
  surprisePin?: { spot: Spot } | null
  savedSpotIds?: Set<string>
  likeCountsBySpotId?: Record<string, number>
  onSelectUser?: (userId: string) => void
  onSurprise?: (spot: Spot) => void
  spotsLoaded?: boolean
  onAddSpot?: () => void
  onOpenFriends?: () => void
}

type RankEntry = { userId: string; username: string | null; avatar_url: string | null; count: number }

// ─── ExploreModal ─────────────────────────────────────────────────────────────

type Mode = "general" | "mine" | "friends"

export default function ExploreModal({
  isOpen, onClose, spots, allSpots, userLocation, onSelectSpot, currentUserId, followingIds = [], followingProfiles = [], surprisePin, likeCountsBySpotId, onSelectUser, onSurprise,
  spotsLoaded = true, onAddSpot, onOpenFriends,
}: ExploreModalProps) {
  const [mode, setMode]                   = useState<Mode>("general")
  const [searchQuery, setSearchQuery]     = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [friendFilter, setFriendFilter] = useState<string | null>(null)
  const [surpriseLoading, setSurpriseLoading] = useState(false)
  const [surpriseRadius, setSurpriseRadius] = useState<number>(10)
  const inputRef        = useRef<HTMLInputElement>(null)
  const lastPickedIdRef = useRef<string | null>(null)
  const swipe = useSwipeToClose(onClose)

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 300)
    return () => clearTimeout(t)
  }, [searchQuery])

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery(""); setDebouncedQuery("")
      setMode("general"); setCategoryFilter(null); setFriendFilter(null)
      setSurpriseLoading(false)
    } else {
      setTimeout(() => inputRef.current?.focus(), 200)
    }
  }, [isOpen])

  const handleTab = (tab: Mode) => {
    setMode(tab)
    setFriendFilter(null)
    setCategoryFilter(tab === "friends" ? "café" : null)
  }

  // ─── Data derivations ──────────────────────────────────────────────────────

  // Use enriched profiles from MapView; fall back to spot data for friends not yet in the map
  const friendProfiles = useMemo(() => {
    if (followingProfiles.length > 0) return followingProfiles
    const friendSet = new Set(followingIds)
    const seen = new Set<string>()
    const result: FriendProfile[] = []
    for (const s of spots) {
      if (friendSet.has(s.user_id) && !seen.has(s.user_id)) {
        seen.add(s.user_id)
        result.push({
          id: s.user_id,
          username: s.profiles?.username ?? null,
          avatar_url: s.profiles?.avatar_url ?? null,
        })
      }
    }
    return result
  }, [followingProfiles, spots, followingIds])


  // Filter expired spots
  const now = useMemo(() => Date.now(), [])

  // Base pool for the current mode
  const basePool = useMemo(() => {
    const notExpired = (s: Spot) => !s.expires_at || new Date(s.expires_at).getTime() > now
    if (mode === "mine") return spots.filter((s: Spot) => s.user_id === currentUserId && notExpired(s))
    if (mode === "friends") {
      const friendSet = new Set(followingIds)
      return spots.filter((s: Spot) => friendSet.has(s.user_id) && notExpired(s))
    }
    return (allSpots ?? spots).filter(notExpired)
  }, [mode, spots, allSpots, currentUserId, followingIds, now])

  // Apply category + friend + search filters
  const filteredPool = useMemo(() => {
    let list: Spot[] = basePool
    if (categoryFilter) list = list.filter((s: Spot) => s.category === categoryFilter)
    if (friendFilter) list = list.filter((s: Spot) => s.user_id === friendFilter)
    if (debouncedQuery.trim()) {
      const q = debouncedQuery.toLowerCase()
      list = list.filter((s: Spot) =>
        s.title.toLowerCase().includes(q) ||
        (s.address ?? "").toLowerCase().includes(q) ||
        (s.description ?? "").toLowerCase().includes(q) ||
        (s.profiles?.username ?? "").toLowerCase().includes(q)
      )
    }
    return list
  }, [basePool, categoryFilter, friendFilter, debouncedQuery])

  // With distances
  const withDist = useMemo(() => filteredPool.map((s: Spot): DistSpot => ({
    spot: s,
    distance: userLocation ? distanceKm(userLocation.lat, userLocation.lng, s.lat, s.lng) : undefined,
  })), [filteredPool, userLocation])

  // Explorer sections
  const nearbySpots = useMemo(() => {
    if (!userLocation) return []
    return [...withDist]
      .filter(({ distance }) => distance !== undefined && distance < 15)
      .sort((a, b) => (a.distance ?? 99999) - (b.distance ?? 99999))
      .slice(0, 12)
  }, [withDist, userLocation])

  const recentSpots = useMemo(() =>
    [...withDist].sort((a, b) => {
      // In explorer mode with location: sort by distance first
      if (mode === "general" && userLocation) {
        if (a.distance !== undefined && b.distance !== undefined) return a.distance - b.distance
        if (a.distance !== undefined) return -1
        if (b.distance !== undefined) return 1
      }
      return new Date(b.spot.created_at).getTime() - new Date(a.spot.created_at).getTime()
    }),
  [withDist, mode, userLocation])

  // Amis — cette semaine
  const friendsThisWeek = useMemo(() => {
    if (mode !== "friends") return []
    const weekAgo = Date.now() - 7 * 24 * 3600_000
    return filteredPool
      .filter((s: Spot) => new Date(s.created_at).getTime() > weekAgo)
      .sort((a: Spot, b: Spot) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 10)
  }, [filteredPool, mode])

  // Classement du mois — amis uniquement, top 3
  const monthlyRanking = useMemo<RankEntry[]>(() => {
    if (!followingIds.length) return []
    const friendSet = new Set(followingIds)
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const counts: Record<string, { username: string | null; avatar_url: string | null; count: number }> = {}
    const pool = allSpots ?? spots
    pool.forEach((s: Spot) => {
      if (!friendSet.has(s.user_id)) return
      if (new Date(s.created_at) < startOfMonth) return
      if (!counts[s.user_id]) counts[s.user_id] = { username: s.profiles?.username ?? null, avatar_url: s.profiles?.avatar_url ?? null, count: 0 }
      counts[s.user_id].count++
    })
    return Object.entries(counts)
      .map(([userId, v]) => ({ userId, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
  }, [allSpots, spots, followingIds])

  // Top 3 likes reçus — amis uniquement
  const likesRanking = useMemo<RankEntry[]>(() => {
    if (!followingIds.length || !likeCountsBySpotId) return []
    const friendSet = new Set(followingIds)
    const totals: Record<string, { username: string | null; avatar_url: string | null; count: number }> = {}
    const pool = allSpots ?? spots
    pool.forEach((s: Spot) => {
      if (!friendSet.has(s.user_id)) return
      const likes = likeCountsBySpotId[s.id] ?? 0
      if (!totals[s.user_id]) totals[s.user_id] = { username: s.profiles?.username ?? null, avatar_url: s.profiles?.avatar_url ?? null, count: 0 }
      totals[s.user_id].count += likes
    })
    return Object.entries(totals)
      .filter(([, v]) => v.count > 0)
      .map(([userId, v]) => ({ userId, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
  }, [allSpots, spots, followingIds, likeCountsBySpotId])

  // Surprise — picks from friends' spots only, switches to Amis tab
  const handleSurprise = useCallback(() => {
    if (surpriseLoading) return
    const friendSet = new Set(followingIds)
    const friendSpots = (allSpots ?? spots).filter((s: Spot) =>
      friendSet.has(s.user_id) && (!s.expires_at || new Date(s.expires_at).getTime() > Date.now())
    )
    if (!friendSpots.length) return
    setSurpriseLoading(true)
    setTimeout(() => {
      // Rayon configurable — fallback à tous les spots amis si rien dans le rayon
      let pool = friendSpots
      if (userLocation) {
        const nearby = friendSpots.filter((s: Spot) => distanceKm(userLocation.lat, userLocation.lng, s.lat, s.lng) <= surpriseRadius)
        if (nearby.length > 0) pool = nearby
      }
      // Avoid picking the same spot twice in a row
      if (pool.length > 1 && lastPickedIdRef.current) {
        const filtered = pool.filter((s: Spot) => s.id !== lastPickedIdRef.current)
        if (filtered.length > 0) pool = filtered
      }
      const picked = pool[Math.floor(Math.random() * pool.length)]
      lastPickedIdRef.current = picked.id
      setSurpriseLoading(false)
      onSurprise?.(picked)
    }, 600)
  }, [surpriseLoading, followingIds, userLocation, onSurprise, allSpots, spots, surpriseRadius])

  // ─── Helpers ───────────────────────────────────────────────────────────────

  const hasFilters = !!(categoryFilter || friendFilter || debouncedQuery.trim())

  if (!isOpen) return null

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-x-0 top-0 bottom-16 z-[70] sm:inset-0 bg-black/50 backdrop-blur-sm"
          />

          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, y: 80 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            transition={{ type: "spring", stiffness: 400, damping: 35 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.05, bottom: 0.4 }}
            dragMomentum={false}
            onDragEnd={(_e: unknown, { offset, velocity }: { offset: { y: number }; velocity: { y: number } }) => {
              if (offset.y > 120 || velocity.y > 400) onClose()
            }}
            className="fixed inset-x-0 bottom-16 z-[80] sm:inset-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2"
          >
            <div className="flex h-[calc(92vh-4rem)] flex-col overflow-hidden rounded-t-[2rem] bg-gray-50 dark:bg-zinc-950 shadow-2xl sm:h-auto sm:max-h-[90vh] sm:rounded-3xl">

              {/* Drag handle */}
              <div className="mx-auto mt-3 mb-1 h-1 w-10 flex-shrink-0 rounded-full bg-gray-300 dark:bg-zinc-700 sm:hidden" />

              {/* ── Header ── */}
              <div className="flex-shrink-0 px-5 pt-3 pb-4">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">Explorer</h2>
                  <button
                    onClick={onClose}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 dark:bg-white/10 text-gray-500 dark:text-zinc-400 hover:bg-gray-300 dark:hover:bg-white/20 transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* ── Tabs ── */}
                <div className="flex flex-col gap-1.5 mb-4">
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleTab("mine")}
                      className={cn(
                        "flex-1 rounded-xl py-2.5 text-sm font-semibold transition-all",
                        mode === "mine"
                          ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900 shadow-sm"
                          : "bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 text-gray-500 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-800"
                      )}
                    >
                      Mes spots
                    </button>
                    <button
                      onClick={() => handleTab("friends")}
                      className={cn(
                        "flex-1 rounded-xl py-2.5 text-sm font-semibold transition-all",
                        mode === "friends"
                          ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900 shadow-sm"
                          : "bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 text-gray-500 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-800"
                      )}
                    >
                      Amis
                    </button>
                  </div>
                  <button
                    onClick={() => handleTab("general")}
                    className={cn(
                      "w-full rounded-xl py-2.5 text-sm font-semibold transition-all",
                      mode === "general"
                        ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900 shadow-sm"
                        : "bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 text-gray-500 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-800"
                    )}
                  >
                    Général
                  </button>
                </div>

                {/* ── Search ── */}
                <div className="flex items-center gap-2 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-zinc-900 px-4 py-3 mb-3">
                  <Search size={15} className="flex-shrink-0 text-gray-400 dark:text-zinc-500" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Spot, adresse ou @ami..."
                    className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white outline-none placeholder:text-gray-400 dark:placeholder:text-zinc-600"
                  />
                  {searchQuery && searchQuery !== debouncedQuery && (
                    <LoaderCircle size={14} className="animate-spin text-gray-300 dark:text-zinc-600 flex-shrink-0" />
                  )}
                  {searchQuery && (
                    <button
                      onClick={() => { setSearchQuery(""); setDebouncedQuery("") }}
                      className="text-gray-300 dark:text-zinc-600 hover:text-gray-500 dark:hover:text-zinc-400 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

              </div>

              {/* ── Contenu scrollable ── */}
              <div ref={swipe.ref} onTouchStart={swipe.onTouchStart} onTouchEnd={swipe.onTouchEnd} className="flex-1 overflow-y-auto px-5 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-6">

                {/* ════ MODE GÉNÉRAL ════ */}
                {mode === "general" && (
                  <div className="space-y-5">

                    {/* Surprise CTA */}
                    <div className="space-y-2">
                      <button
                        onClick={handleSurprise}
                        disabled={surpriseLoading}
                        className="group relative w-full overflow-hidden rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 p-5 text-left transition-all active:scale-[0.98] disabled:opacity-60"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-lg font-bold text-white">🎲 Surprends-moi</p>
                            <p className="mt-0.5 text-sm text-white/70">Dans un rayon de {surpriseRadius} km</p>
                          </div>
                          <motion.div
                            animate={surpriseLoading ? { rotate: 360 } : { rotate: 0 }}
                            transition={surpriseLoading ? { duration: 0.6, ease: "linear", repeat: Infinity } : {}}
                            className="flex h-12 w-12 items-center justify-center rounded-full bg-white/20"
                          >
                            <Shuffle size={22} className="text-white" />
                          </motion.div>
                        </div>
                      </button>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-gray-400 dark:text-zinc-500 flex-shrink-0">Rayon :</span>
                        <div className="flex gap-1 flex-wrap">
                          {[2, 5, 10, 20, 50].map(km => (
                            <button
                              key={km}
                              onClick={() => setSurpriseRadius(km)}
                              className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${
                                surpriseRadius === km
                                  ? "bg-violet-500 text-white"
                                  : "bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400 hover:bg-gray-200 dark:hover:bg-zinc-700"
                              }`}
                            >
                              {km} km
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Grille catégories */}
                    <CategoryGrid value={categoryFilter} onChange={setCategoryFilter} />

                    {/* Près de toi */}
                    {nearbySpots.length > 0 && !debouncedQuery && (
                      <div>
                        <p className="mb-3 text-sm font-bold text-gray-900 dark:text-white">📍 Près de toi</p>
                        <div className="no-scrollbar -mx-5 flex gap-3 overflow-x-auto px-5 pb-1">
                          {nearbySpots.map(({ spot, distance }: DistSpot) => (
                            <SpotHCard
                              key={spot.id}
                              spot={spot}
                              distance={distance}
                              onSelect={() => onSelectSpot(spot)}
                              onSelectUser={onSelectUser}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Liste spots */}
                    <div>
                      {!hasFilters && (
                        <p className="mb-3 text-sm font-bold text-gray-900 dark:text-white">
                          {userLocation ? "📍 Par distance" : "🆕 Récemment ajoutés"}
                        </p>
                      )}
                      {!spotsLoaded ? (
                        <div className="py-2">
                          {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
                        </div>
                      ) : recentSpots.length === 0 ? (
                        <EmptyState mode="general" hasQuery={!!debouncedQuery} onAddSpot={onAddSpot} onOpenFriends={onOpenFriends} />
                      ) : (
                        <div className="space-y-2">
                          {hasFilters && (
                            <p className="mb-2 text-xs text-gray-400">
                              {recentSpots.length} résultat{recentSpots.length > 1 ? "s" : ""}
                            </p>
                          )}
                          {recentSpots.map(({ spot, distance }: DistSpot) => (
                            <SpotListRow
                              key={spot.id}
                              spot={spot}
                              distance={nearbySpots.some((n: DistSpot) => n.spot.id === spot.id) ? distance : undefined}
                              showAuthor
                              onSelect={() => onSelectSpot(spot)}
                              onSelectUser={onSelectUser}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ════ MODE MES SPOTS ════ */}
                {mode === "mine" && (
                  <div className="space-y-4">
                    <CategoryGrid value={categoryFilter} onChange={setCategoryFilter} />
                    {!spotsLoaded ? (
                      <div className="py-2">
                        {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
                      </div>
                    ) : filteredPool.length === 0 ? (
                      <EmptyState mode="mine" hasQuery={!!debouncedQuery} onAddSpot={onAddSpot} onOpenFriends={onOpenFriends} />
                    ) : (
                      <>
                        <p className="text-xs text-gray-400 dark:text-zinc-600">
                          {filteredPool.length} spot{filteredPool.length > 1 ? "s" : ""}
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          {filteredPool.map((spot: Spot) => (
                            <SpotGridCard
                              key={spot.id}
                              spot={spot}
                              onSelect={() => onSelectSpot(spot)}
                            />
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* ════ MODE AMIS ════ */}
                {mode === "friends" && (
                  <div className="space-y-4">

                    {/* Surprise pin active banner */}
                    {surprisePin && (
                      <button
                        onClick={() => onSelectSpot(surprisePin.spot)}
                        className="w-full flex items-center gap-3 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-3 text-left"
                      >
                        <span className="text-2xl animate-pulse">🎲</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold text-white">{surprisePin.spot.title}</p>
                          <p className="text-xs text-white/70">Spot surprise — clique pour y aller</p>
                        </div>
                        <MapPin size={16} className="flex-shrink-0 text-white/80" />
                      </button>
                    )}

                    {/* Avatars amis */}
                    {friendProfiles.length > 0 && (
                      <div className="no-scrollbar -mx-5 flex gap-3 overflow-x-auto px-5 pb-1">
                        {friendProfiles.map((f: FriendProfile) => {
                          const isSelected = friendFilter === f.id
                          return (
                            <button
                              key={f.id}
                              onClick={() => setFriendFilter(isSelected ? null : f.id)}
                              className="flex flex-shrink-0 flex-col items-center gap-1.5"
                            >
                              <div className={cn(
                                "h-14 w-14 overflow-hidden rounded-full shadow-md bg-gradient-to-br from-indigo-400 to-purple-500 transition-all",
                                isSelected
                                  ? "border-[3px] border-blue-500 scale-105"
                                  : "border-2 border-white dark:border-zinc-800"
                              )}>
                                {f.avatar_url
                                  // eslint-disable-next-line @next/next/no-img-element
                                  ? <img src={f.avatar_url} alt="" className="h-full w-full object-cover" />
                                  : <div className="flex h-full w-full items-center justify-center text-lg font-bold text-white">
                                      {(f.username ?? "?")[0]?.toUpperCase()}
                                    </div>
                                }
                              </div>
                              <span className={cn(
                                "max-w-[3.5rem] truncate text-[10px]",
                                isSelected ? "font-bold text-blue-600 dark:text-blue-400" : "text-gray-500 dark:text-zinc-500"
                              )}>
                                {f.username ?? "ami"}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    )}

                    {/* Cette semaine — masquée si aucun spot cette semaine */}
                    {friendsThisWeek.length > 0 && (
                      <div>
                        <p className="mb-3 text-sm font-bold text-gray-900 dark:text-white">🆕 Cette semaine</p>
                        <div className="no-scrollbar -mx-5 flex gap-3 overflow-x-auto px-5 pb-1">
                          {friendsThisWeek.map((spot: Spot) => (
                            <SpotHCard
                              key={spot.id}
                              spot={spot}
                              onSelect={() => onSelectSpot(spot)}
                              onSelectUser={onSelectUser}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Séparateur */}
                    <div className="h-px bg-gray-200 dark:bg-white/10" />

                    {/* Grille catégories */}
                    <CategoryGrid value={categoryFilter} onChange={setCategoryFilter} />

                    {/* Spots filtrés */}
                    {!spotsLoaded ? (
                      <div className="py-2">
                        {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
                      </div>
                    ) : filteredPool.length === 0 ? (
                      <EmptyState mode="friends" hasQuery={!!debouncedQuery} onAddSpot={onAddSpot} onOpenFriends={onOpenFriends} />
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs text-gray-400 dark:text-zinc-600">
                          {filteredPool.length} spot{filteredPool.length > 1 ? "s" : ""}
                        </p>
                        {recentSpots.map(({ spot }: DistSpot) => (
                          <SpotListRow
                            key={spot.id}
                            spot={spot}
                            showAuthor
                            onSelect={() => onSelectSpot(spot)}
                            onSelectUser={onSelectUser}
                          />
                        ))}
                      </div>
                    )}
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

// ─── Skeleton ────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 animate-pulse">
      <div className="h-14 w-14 flex-shrink-0 rounded-xl bg-gray-200 dark:bg-zinc-700" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-3/4 rounded-full bg-gray-200 dark:bg-zinc-700" />
        <div className="h-3 w-1/2 rounded-full bg-gray-200 dark:bg-zinc-700" />
      </div>
    </div>
  )
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({
  mode, hasQuery, onAddSpot, onOpenFriends,
}: {
  mode: Mode
  hasQuery: boolean
  onAddSpot?: () => void
  onOpenFriends?: () => void
}) {
  const messages: Record<Mode, { icon: string; title: string; sub: string; cta?: { label: string; action?: () => void } }> = {
    general: {
      icon: "🌍",
      title: "Aucun spot trouvé",
      sub: hasQuery ? "Essaie un autre mot-clé" : "Sois le premier à ajouter un spot !",
      cta: hasQuery ? undefined : { label: "Ajouter un spot", action: onAddSpot },
    },
    mine: {
      icon: "📍",
      title: "Aucun spot",
      sub: hasQuery ? "Essaie un autre mot-clé" : "Commence par ajouter ton premier lieu.",
      cta: hasQuery ? undefined : { label: "Ajouter un spot", action: onAddSpot },
    },
    friends: {
      icon: "👥",
      title: "Rien pour l'instant",
      sub: hasQuery ? "Essaie un autre mot-clé" : "Invite des amis pour voir leurs spots.",
      cta: hasQuery ? undefined : { label: "Inviter des amis", action: onOpenFriends },
    },
  }
  const m = messages[mode]
  return (
    <div className="flex flex-col items-center gap-3 py-14 text-center">
      <span className="text-4xl">{m.icon}</span>
      <p className="text-sm font-semibold text-gray-600 dark:text-zinc-400">{m.title}</p>
      <p className="text-xs text-gray-400 dark:text-zinc-600">{m.sub}</p>
      {m.cta?.action && (
        <button
          onClick={m.cta.action}
          className="mt-2 rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
        >
          {m.cta.label}
        </button>
      )}
    </div>
  )
}
