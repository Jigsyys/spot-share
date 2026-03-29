"use client"

import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import { motion, AnimatePresence, useDragControls } from "framer-motion"
import { X, Search, LocateFixed, Shuffle, MapPin, User } from "lucide-react"
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

// ─── SpotRow (liste) ────────────────────────────────────────────────────────

function SpotRow({
  spot, distance, showAuthor, onSelect, onSelectUser,
}: {
  spot: Spot
  distance?: number
  showAuthor?: boolean
  onSelect: () => void
  onSelectUser?: (id: string) => void
}) {
  const imageUrl = spot.image_url?.split(",")[0]?.trim() || null
  const emoji    = CATEGORY_EMOJIS[spot.category ?? "other"] ?? "📍"
  const open     = isOpenNow(spot.weekday_descriptions ?? null)
  const novel    = isNew(spot.created_at)
  const username = spot.profiles?.username ?? null
  const avatar   = spot.profiles?.avatar_url ?? null

  return (
    <button
      onClick={onSelect}
      className="flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-all active:scale-[0.98] hover:bg-gray-50 dark:hover:bg-zinc-800/60"
    >
      <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-xl bg-gray-100 dark:bg-zinc-800">
        {imageUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={imageUrl} alt={spot.title} className="h-full w-full object-cover" />
          : <div className="flex h-full w-full items-center justify-center text-2xl">{emoji}</div>}
        {novel && (
          <span className="absolute top-1 left-1 rounded-full bg-rose-500 px-1.5 py-0.5 text-[8px] font-bold text-white leading-none">
            NEW
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{spot.title}</p>
        {spot.address && (
          <p className="mt-0.5 truncate text-xs text-gray-400 dark:text-zinc-500">{spot.address}</p>
        )}
        <div className="mt-1.5 flex items-center gap-2.5">
          {distance !== undefined && (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 dark:text-indigo-400">
              <LocateFixed size={10} />{fmtDist(distance)}
            </span>
          )}
          {open === true && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Ouvert
            </span>
          )}
          {open === false && (
            <span className="text-[11px] text-red-400">Fermé</span>
          )}
          {showAuthor && username && (
            <button
              className="flex items-center gap-1 text-[11px] text-gray-400 dark:text-zinc-500 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors"
              onClick={(e) => { e.stopPropagation(); onSelectUser?.(spot.user_id) }}
            >
              {avatar
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={avatar} alt="" className="h-3.5 w-3.5 rounded-full object-cover" />
                : <User size={10} />}
              @{username}
            </button>
          )}
        </div>
      </div>
    </button>
  )
}

// ─── SpotCard (grille découverte) ───────────────────────────────────────────

function SpotCard({
  spot, distance, onSelect, onSelectUser,
}: {
  spot: Spot
  distance?: number
  onSelect: () => void
  onSelectUser?: (id: string) => void
}) {
  const imageUrl = spot.image_url?.split(",")[0]?.trim() || null
  const emoji    = CATEGORY_EMOJIS[spot.category ?? "other"] ?? "📍"
  const username = spot.profiles?.username ?? null
  const avatar   = spot.profiles?.avatar_url ?? null
  const novel    = isNew(spot.created_at)

  return (
    <button
      onClick={onSelect}
      className="flex flex-col overflow-hidden rounded-2xl border border-gray-100 dark:border-white/5 bg-white dark:bg-zinc-900/80 text-left transition-all active:scale-[0.97] hover:shadow-md"
    >
      {/* Image */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-gray-100 dark:bg-zinc-800">
        {imageUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={imageUrl} alt={spot.title} className="h-full w-full object-cover" />
          : <div className="flex h-full w-full items-center justify-center text-4xl">{emoji}</div>}
        {novel && (
          <span className="absolute top-2 left-2 rounded-full bg-rose-500 px-2 py-0.5 text-[9px] font-bold text-white shadow-sm">
            NEW
          </span>
        )}
        {distance !== undefined && (
          <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
            <LocateFixed size={9} />{fmtDist(distance)}
          </span>
        )}
      </div>

      {/* Texte */}
      <div className="px-3 py-2.5">
        <p className="line-clamp-1 text-sm font-semibold text-gray-900 dark:text-white">{spot.title}</p>
        {spot.address && (
          <p className="mt-0.5 line-clamp-1 text-[11px] text-gray-400 dark:text-zinc-500">{spot.address}</p>
        )}
        {username && (
          <button
            className="mt-1.5 flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-zinc-500 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors"
            onClick={(e) => { e.stopPropagation(); onSelectUser?.(spot.user_id) }}
          >
            {avatar
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={avatar} alt="" className="h-4 w-4 rounded-full object-cover" />
              : <div className="flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-[8px] font-bold text-white">{username[0]?.toUpperCase()}</div>}
            <span>@{username}</span>
          </button>
        )}
      </div>
    </button>
  )
}

// ─── Props ─────────────────────────────────────────────────────────────────

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
  isOpen, onClose, spots, allSpots, userLocation, onSelectSpot, currentUserId, onSelectUser,
}: ExploreModalProps) {
  const [searchQuery, setSearchQuery]         = useState("")
  const [debouncedQuery, setDebouncedQuery]   = useState("")
  const [friendMode, setFriendMode]           = useState<"mine" | "friends" | "all">("mine")
  const [nearbyMode, setNearbyMode]           = useState(false)
  const [surpriseLoading, setSurpriseLoading] = useState(false)
  const inputRef          = useRef<HTMLInputElement>(null)
  const lastPickedIdRef   = useRef<string | null>(null)
  const displayedSpotsRef = useRef<{ spot: Spot; distance?: number }[]>([])
  const dragControls      = useDragControls()

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 300)
    return () => clearTimeout(t)
  }, [searchQuery])

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery(""); setDebouncedQuery("")
      setNearbyMode(false); setSurpriseLoading(false); setFriendMode("mine")
    } else {
      setTimeout(() => inputRef.current?.focus(), 250)
    }
  }, [isOpen])

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

  const friendsThisWeek = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 3600_000
    return spots
      .filter(s => s.user_id !== currentUserId && new Date(s.created_at).getTime() > weekAgo)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 10)
  }, [spots, currentUserId])

  const { displayedSpots, nearbyCount } = useMemo(() => {
    const withDist = spots.map(s => ({
      spot: s,
      distance: userLocation ? distanceKm(userLocation.lat, userLocation.lng, s.lat, s.lng) : undefined,
    }))

    const nearbyCount = userLocation
      ? withDist.filter(({ distance }) => distance !== undefined && distance < 2).length
      : 0

    let list = withDist

    if (friendMode === "mine") {
      list = list.filter(({ spot }) => spot.user_id === currentUserId)
    } else if (friendMode === "friends") {
      list = list.filter(({ spot }) => spot.user_id !== currentUserId)
    }

    if (debouncedQuery.trim()) {
      const q = debouncedQuery.trim().toLowerCase()
      list = list.filter(({ spot }) =>
        spot.title.toLowerCase().includes(q) ||
        (spot.address ?? "").toLowerCase().includes(q) ||
        (spot.description ?? "").toLowerCase().includes(q)
      )
    }

    if (nearbyMode && userLocation) {
      list = [...list].sort((a, b) => (a.distance ?? 99999) - (b.distance ?? 99999))
    } else {
      list = [...list].sort((a, b) =>
        new Date(b.spot.created_at).getTime() - new Date(a.spot.created_at).getTime()
      )
    }

    return { displayedSpots: list, nearbyCount }
  }, [spots, friendMode, debouncedQuery, nearbyMode, userLocation, currentUserId])

  useEffect(() => { displayedSpotsRef.current = displayedSpots }, [displayedSpots])

  const handleSurprise = useCallback(() => {
    if (surpriseLoading) return
    const base = allSpots ?? spots
    if (!base.length) return
    setSurpriseLoading(true)
    setTimeout(() => {
      let pool = base.map(s => ({
        spot: s,
        distance: userLocation ? distanceKm(userLocation.lat, userLocation.lng, s.lat, s.lng) : undefined,
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
  const hasQuery       = !!debouncedQuery.trim()
  const hasFriends     = friendProfiles.length > 0
  const showFriendsWeek = friendMode === "friends" && !hasQuery && friendsThisWeek.length > 0

  const tabs = [
    { id: "mine" as const,    label: "Moi",       emoji: "👤" },
    ...(hasFriends ? [{ id: "friends" as const, label: "Amis", emoji: "👥" }] : []),
    { id: "all" as const,     label: "Découvrir", emoji: "🌍" },
  ]

  const emptyMessage = hasQuery
    ? { icon: "🔍", title: "Aucun résultat", sub: "Essaie un autre mot-clé" }
    : friendMode === "friends"
      ? { icon: "👥", title: "Aucun spot d'ami", sub: "Tes amis n'ont pas encore ajouté de spots" }
      : friendMode === "all"
        ? { icon: "🌍", title: "Aucun spot", sub: "Aucun spot disponible pour l'instant" }
        : { icon: "📍", title: "Aucun spot", sub: "Ajoute ton premier lieu favori !" }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm"
          />

          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, y: 80 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 80 }}
            transition={{ type: "spring", stiffness: 400, damping: 36 }}
            drag="y"
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.02, bottom: 0.35 }}
            dragMomentum={false}
            onDragEnd={(_e, { offset, velocity }) => {
              if (offset.y > 100 || velocity.y > 400) onClose()
            }}
            className="fixed inset-x-0 bottom-0 z-[80] sm:inset-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2"
          >
            <div className="flex h-[92vh] flex-col overflow-hidden rounded-t-[2rem] bg-gray-50 dark:bg-zinc-950 text-gray-900 dark:text-white shadow-2xl sm:h-auto sm:max-h-[90vh] sm:rounded-3xl">

              {/* ── Handle ── */}
              <div
                className="flex touch-none cursor-grab justify-center pt-3 pb-2 sm:hidden"
                onPointerDown={(e) => dragControls.start(e)}
              >
                <div className="h-1 w-10 rounded-full bg-gray-300 dark:bg-zinc-700" />
              </div>

              {/* ── Search bar ── */}
              <div className="flex-shrink-0 px-4 pb-3 pt-1 sm:pt-4">
                <div className="flex items-center gap-3 rounded-2xl bg-white dark:bg-zinc-900 px-4 py-3 shadow-sm border border-gray-100 dark:border-white/5">
                  <Search size={16} className="flex-shrink-0 text-gray-400 dark:text-zinc-500" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Cherche un spot ou une adresse…"
                    className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white outline-none placeholder:text-gray-400 dark:placeholder:text-zinc-500"
                  />
                  {searchQuery
                    ? <button onClick={() => { setSearchQuery(""); setDebouncedQuery("") }} className="text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-300"><X size={14} /></button>
                    : <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-300"><X size={16} /></button>
                  }
                </div>
              </div>

              {/* ── Tabs ── */}
              <div className="flex flex-shrink-0 items-center gap-1 px-4 pb-3">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setFriendMode(tab.id)}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold transition-all",
                      friendMode === tab.id
                        ? "bg-white dark:bg-zinc-800 text-gray-900 dark:text-white shadow-sm"
                        : "text-gray-400 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300"
                    )}
                  >
                    <span>{tab.emoji}</span>
                    <span>{tab.label}</span>
                  </button>
                ))}
              </div>

              {/* ── Sort row (sous les tabs) ── */}
              {!hasQuery && (
                <div className="flex flex-shrink-0 items-center gap-2 px-4 pb-3">
                  <button
                    onClick={() => hasLocation && setNearbyMode(v => !v)}
                    disabled={!hasLocation}
                    className={cn(
                      "flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors",
                      nearbyMode
                        ? "bg-blue-100 dark:bg-indigo-500/20 text-blue-700 dark:text-indigo-300"
                        : "bg-white dark:bg-zinc-900 text-gray-500 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-white disabled:opacity-40 shadow-sm border border-gray-100 dark:border-white/5"
                    )}
                  >
                    <LocateFixed size={11} />
                    {nearbyMode
                      ? `Proches${nearbyCount > 0 ? ` (${nearbyCount})` : ""}`
                      : "Récents"}
                  </button>

                  <div className="flex-1" />

                  <button
                    onClick={handleSurprise}
                    disabled={surpriseLoading || displayedSpots.length === 0}
                    className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-md shadow-purple-500/25 transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <motion.div
                      animate={surpriseLoading ? { rotate: 360 } : { rotate: 0 }}
                      transition={surpriseLoading ? { duration: 0.5, ease: "linear", repeat: Infinity } : {}}
                    >
                      <Shuffle size={12} />
                    </motion.div>
                    {surpriseLoading ? "…" : "Surprise !"}
                  </button>
                </div>
              )}

              {/* ── Séparateur ── */}
              <div className="mx-4 mb-1 h-px flex-shrink-0 bg-gray-100 dark:bg-white/5" />

              {/* ── Contenu scrollable ── */}
              <div className="flex-1 overflow-y-auto">

                {/* Amis cette semaine (onglet Amis) */}
                {showFriendsWeek && (
                  <div className="px-4 pt-4 pb-2">
                    <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500">
                      Ajoutés cette semaine
                    </p>
                    <div className="no-scrollbar flex gap-2.5 overflow-x-auto pb-1">
                      {friendsThisWeek.map(spot => {
                        const img      = spot.image_url?.split(",")[0]?.trim() || null
                        const emoji    = CATEGORY_EMOJIS[spot.category ?? "other"] ?? "📍"
                        const avatar   = spot.profiles?.avatar_url
                        const username = spot.profiles?.username ?? "Ami"
                        return (
                          <button
                            key={spot.id}
                            onClick={() => onSelectSpot(spot)}
                            className="flex-shrink-0 w-36 overflow-hidden rounded-2xl bg-white dark:bg-zinc-900 shadow-sm border border-gray-100 dark:border-white/5 text-left transition-all active:scale-[0.97]"
                          >
                            <div className="relative h-20 w-full overflow-hidden bg-gray-100 dark:bg-zinc-800">
                              {img
                                // eslint-disable-next-line @next/next/no-img-element
                                ? <img src={img} alt={spot.title} className="h-full w-full object-cover" />
                                : <div className="flex h-full w-full items-center justify-center text-2xl">{emoji}</div>}
                              <span className="absolute top-1.5 right-1.5 rounded-full bg-rose-500 px-1.5 py-0.5 text-[8px] font-bold text-white">NEW</span>
                            </div>
                            <div className="p-2">
                              <p className="truncate text-xs font-semibold text-gray-900 dark:text-white">{spot.title}</p>
                              <div
                                className="mt-1 flex items-center gap-1"
                                onClick={(e) => { e.stopPropagation(); onSelectUser?.(spot.user_id) }}
                              >
                                {avatar
                                  // eslint-disable-next-line @next/next/no-img-element
                                  ? <img src={avatar} alt={username} className="h-3.5 w-3.5 rounded-full object-cover" />
                                  : <div className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-indigo-500 text-[7px] font-bold text-white">{username[0]?.toUpperCase()}</div>}
                                <span className="truncate text-[10px] text-gray-400 dark:text-zinc-500">{timeSince(spot.created_at)}</span>
                              </div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Empty state */}
                {displayedSpots.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
                    <span className="text-5xl">{emptyMessage.icon}</span>
                    <p className="text-sm font-semibold text-gray-700 dark:text-zinc-300">{emptyMessage.title}</p>
                    <p className="text-xs text-gray-400 dark:text-zinc-500">{emptyMessage.sub}</p>
                  </div>
                ) : friendMode === "all" && !hasQuery ? (
                  /* ── Découvrir : grille 2 colonnes ── */
                  <div className="grid grid-cols-2 gap-3 px-4 pt-3 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-5">
                    {displayedSpots.map(({ spot, distance }) => (
                      <SpotCard
                        key={spot.id}
                        spot={spot}
                        distance={nearbyMode ? distance : undefined}
                        onSelect={() => onSelectSpot(spot)}
                        onSelectUser={onSelectUser}
                      />
                    ))}
                  </div>
                ) : (
                  /* ── Moi / Amis : liste ── */
                  <div className="px-4 pt-2 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-5">
                    {displayedSpots.length > 0 && (
                      <p className="mb-1 text-xs text-gray-400 dark:text-zinc-500">
                        {displayedSpots.length} spot{displayedSpots.length > 1 ? "s" : ""}
                      </p>
                    )}
                    <div className="divide-y divide-gray-100 dark:divide-white/5">
                      {displayedSpots.map(({ spot, distance }) => (
                        <SpotRow
                          key={spot.id}
                          spot={spot}
                          distance={nearbyMode ? distance : undefined}
                          showAuthor={friendMode === "friends"}
                          onSelect={() => onSelectSpot(spot)}
                          onSelectUser={onSelectUser}
                        />
                      ))}
                    </div>
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
