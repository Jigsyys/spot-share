"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, MapPin, Users, LoaderCircle, Heart, UserPlus, UserCheck } from "lucide-react"
import { createClient } from "@/lib/supabase/client"

interface Spot {
  id: string
  title: string
  category?: string
  address?: string | null
  image_url?: string | null
  lat: number
  lng: number
}

interface PublicProfileModalProps {
  isOpen: boolean
  onClose: () => void
  userId: string | null
  currentUserId?: string | null
  followingIds?: string[]
  onFollowChange?: (targetId: string, nowFollowing: boolean) => void
  onLocateSpot?: (id: string, lat: number, lng: number) => void
}

const CATEGORY_EMOJIS: Record<string, string> = {
  café: "☕", restaurant: "🍽️", bar: "🍸", outdoor: "🌿",
  vue: "🌅", culture: "🎭", shopping: "🛍️", other: "📍",
}

const CATEGORY_GRADIENTS: Record<string, string> = {
  café: "from-amber-400 to-orange-500",
  restaurant: "from-rose-400 to-pink-500",
  bar: "from-purple-500 to-indigo-600",
  outdoor: "from-emerald-400 to-green-600",
  vue: "from-sky-400 to-blue-600",
  culture: "from-violet-500 to-purple-600",
  shopping: "from-pink-400 to-rose-500",
  other: "from-slate-400 to-gray-500",
}

export default function PublicProfileModal({
  isOpen,
  onClose,
  userId,
  currentUserId,
  followingIds = [],
  onFollowChange,
  onLocateSpot,
}: PublicProfileModalProps) {
  const [profile, setProfile] = useState<{ username: string; avatar_url: string | null; last_active_at: string | null } | null>(null)
  const [spots, setSpots] = useState<Spot[]>([])
  const [followers, setFollowers] = useState(0)
  const [totalLikes, setTotalLikes] = useState(0)
  const [loading, setLoading] = useState(false)
  const [followLoading, setFollowLoading] = useState(false)
  const supabaseRef = useRef(createClient())

  const isFollowing = userId ? followingIds.includes(userId) : false
  const isSelf = userId === currentUserId

  const handleToggleFollow = async () => {
    if (!currentUserId || !userId || followLoading) return
    setFollowLoading(true)
    try {
      if (isFollowing) {
        await supabaseRef.current.from("followers").delete()
          .eq("follower_id", currentUserId).eq("following_id", userId)
        setFollowers(f => Math.max(0, f - 1))
        onFollowChange?.(userId, false)
      } else {
        await supabaseRef.current.from("followers").insert({ follower_id: currentUserId, following_id: userId })
        setFollowers(f => f + 1)
        onFollowChange?.(userId, true)
      }
    } catch { /* ignore */ } finally {
      setFollowLoading(false)
    }
  }

  const loadData = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    try {
      const { data: pData } = await supabaseRef.current
        .from("profiles")
        .select("username, avatar_url, last_active_at")
        .eq("id", userId)
        .single()
      if (pData) setProfile(pData as typeof profile)

      const { data: sData } = await supabaseRef.current
        .from("spots")
        .select("id, title, category, address, image_url, lat, lng")
        .eq("user_id", userId)
      if (sData) setSpots(sData as Spot[])

      const { count } = await supabaseRef.current
        .from("followers")
        .select("*", { count: "exact", head: true })
        .eq("following_id", userId)
      setFollowers(count || 0)

      try {
        const { data: spotIds } = await supabaseRef.current
          .from("spots").select("id").eq("user_id", userId)
        if (spotIds && spotIds.length > 0) {
          const ids = spotIds.map((s: { id: string }) => s.id)
          const { count: likesCount } = await supabaseRef.current
            .from("spot_reactions")
            .select("*", { count: "exact", head: true })
            .in("spot_id", ids)
            .eq("type", "love")
            .neq("user_id", userId)
          setTotalLikes(likesCount ?? 0)
        }
      } catch { /* */ }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    if (isOpen && userId) {
      loadData()
    } else {
      setProfile(null)
      setSpots([])
      setFollowers(0)
      setTotalLikes(0)
    }
  }, [isOpen, userId, loadData])

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
            onDragEnd={(_e: unknown, { offset, velocity }: { offset: { y: number }; velocity: { y: number } }) => {
              if (offset.y > 120 || velocity.y > 400) onClose()
            }}
            className="fixed inset-x-0 bottom-0 z-[80] sm:inset-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2"
          >
            <div className="flex h-[92vh] flex-col overflow-hidden rounded-t-[2rem] border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-zinc-950 text-gray-900 dark:text-white shadow-2xl sm:h-auto sm:max-h-[90vh] sm:rounded-3xl">

              {/* Drag handle */}
              <div className="mx-auto mt-3 mb-1 h-1 w-10 flex-shrink-0 rounded-full bg-gray-300 dark:bg-zinc-700" />

              {/* Header */}
              <div className="flex flex-shrink-0 items-center justify-between px-5 py-4">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">Profil</h2>
                <button
                  onClick={onClose}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 dark:bg-white/10 text-gray-500 dark:text-zinc-400 transition-colors hover:bg-gray-300 dark:hover:bg-white/20"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Scrollable content */}
              <div className="flex flex-col flex-1 overflow-y-auto px-5 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-6">
                {loading ? (
                  <div className="flex flex-1 items-center justify-center py-16">
                    <LoaderCircle size={32} className="animate-spin text-indigo-500" />
                  </div>
                ) : (
                  <div className="space-y-6">

                    {/* Avatar + username */}
                    <div className="flex flex-col items-center gap-3 pt-2">
                      <div className="relative">
                        <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-2 border-indigo-500/40 bg-gradient-to-br from-indigo-500 to-purple-600 text-4xl font-bold text-white shadow-xl shadow-indigo-500/20">
                          {profile?.avatar_url ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <span>{(profile?.username || "?")?.charAt(0).toUpperCase()}</span>
                          )}
                        </div>
                        <div className={`absolute right-1 bottom-1 z-20 h-4 w-4 rounded-full border-[2.5px] border-gray-50 dark:border-zinc-950 ${profile?.last_active_at && Date.now() - new Date(profile.last_active_at).getTime() < 15 * 60000 ? "bg-green-500" : "bg-red-400"}`} />
                      </div>
                      <p className="text-xl font-bold text-gray-900 dark:text-white">@{profile?.username || "utilisateur"}</p>
                      {currentUserId && !isSelf && (
                        <button
                          onClick={handleToggleFollow}
                          disabled={followLoading}
                          className={`flex items-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-semibold transition-all disabled:opacity-50 ${
                            isFollowing
                              ? "bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-500"
                              : "bg-indigo-500 text-white shadow-lg shadow-indigo-500/30 hover:bg-indigo-400"
                          }`}
                        >
                          {followLoading ? (
                            <LoaderCircle size={16} className="animate-spin" />
                          ) : isFollowing ? (
                            <><UserCheck size={16} /> Abonné</>
                          ) : (
                            <><UserPlus size={16} /> Suivre</>
                          )}
                        </button>
                      )}
                    </div>

                    {/* Stats */}
                    <div className="flex gap-3">
                      <div className="flex flex-1 flex-col items-center gap-1 rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 py-4">
                        <MapPin size={14} className="text-indigo-500" />
                        <span className="text-xl font-bold text-gray-900 dark:text-white">{spots.length}</span>
                        <span className="text-xs text-gray-500 dark:text-zinc-400">Lieux</span>
                      </div>
                      <div className="flex flex-1 flex-col items-center gap-1 rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 py-4">
                        <Users size={14} className="text-indigo-500" />
                        <span className="text-xl font-bold text-gray-900 dark:text-white">{followers}</span>
                        <span className="text-xs text-gray-500 dark:text-zinc-400">Abonnés</span>
                      </div>
                      <div className="flex flex-1 flex-col items-center gap-1 rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 py-4">
                        <Heart size={14} className="fill-red-500 text-red-500" />
                        <span className="text-xl font-bold text-gray-900 dark:text-white">{totalLikes}</span>
                        <span className="text-xs text-gray-500 dark:text-zinc-400">Likes</span>
                      </div>
                    </div>

                    {/* Spots section */}
                    <div>
                      <h3 className="mb-3 text-sm font-bold text-gray-900 dark:text-white">
                        Ses Spots ({spots.length})
                      </h3>
                      {spots.length === 0 ? (
                        <p className="py-8 text-center text-sm text-gray-500 dark:text-zinc-500">Aucun spot ajouté.</p>
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          {spots.map((spot) => {
                            const imageUrl = spot.image_url?.split(",")[0]?.trim() || null
                            const gradient = CATEGORY_GRADIENTS[spot.category ?? "other"] ?? "from-slate-400 to-gray-500"
                            const emoji = CATEGORY_EMOJIS[spot.category ?? "other"] ?? "📍"
                            return (
                              <button
                                key={spot.id}
                                onClick={() => onLocateSpot?.(spot.id, spot.lat, spot.lng)}
                                className="relative aspect-square w-full overflow-hidden rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 transition-transform hover:scale-[0.98]"
                              >
                                {imageUrl ? (
                                  /* eslint-disable-next-line @next/next/no-img-element */
                                  <img src={imageUrl} alt={spot.title} className="h-full w-full object-cover" />
                                ) : (
                                  <div className={`h-full w-full bg-gradient-to-br ${gradient} flex items-center justify-center text-4xl`}>{emoji}</div>
                                )}
                                {/* Title overlay */}
                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2.5">
                                  <p className="line-clamp-2 text-left text-xs font-semibold leading-tight text-white">{spot.title}</p>
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      )}
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
