"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, User, MapPin, Users, LoaderCircle, Heart } from "lucide-react"
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
  onLocateSpot?: (id: string, lat: number, lng: number) => void
}

const CATEGORY_EMOJIS: Record<string, string> = {
  café: "☕", restaurant: "🍽️", bar: "🍸", outdoor: "🌿",
  vue: "🌅", culture: "🎭", shopping: "🛍️", other: "📍",
}

export default function PublicProfileModal({
  isOpen,
  onClose,
  userId,
  onLocateSpot,
}: PublicProfileModalProps) {
  const [profile, setProfile] = useState<{ username: string; avatar_url: string | null; last_active_at: string | null } | null>(null)
  const [spots, setSpots] = useState<Spot[]>([])
  const [followers, setFollowers] = useState(0)
  const [totalLikes, setTotalLikes] = useState(0)
  const [loading, setLoading] = useState(false)
  const supabaseRef = useRef(createClient())

  const loadData = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    try {
      const [profileRes, spotsRes, followersRes] = await Promise.allSettled([
        supabaseRef.current
          .from("profiles")
          .select("username, avatar_url, last_active_at")
          .eq("id", userId)
          .single(),
        supabaseRef.current
          .from("spots")
          .select("id, title, category, address, image_url, lat, lng")
          .eq("user_id", userId),
        supabaseRef.current
          .from("followers")
          .select("*", { count: "exact", head: true })
          .eq("following_id", userId),
      ])

      if (profileRes.status === "fulfilled" && profileRes.value.data)
        setProfile(profileRes.value.data as typeof profile)

      const resolvedSpots =
        spotsRes.status === "fulfilled" ? (spotsRes.value.data as Spot[] ?? []) : []
      setSpots(resolvedSpots)

      if (followersRes.status === "fulfilled")
        setFollowers(followersRes.value.count ?? 0)

      // Likes count needs spot IDs — only fetch if spots loaded
      if (resolvedSpots.length > 0) {
        try {
          const ids = resolvedSpots.map(s => s.id)
          const { count: likesCount } = await supabaseRef.current
            .from("spot_reactions")
            .select("*", { count: "exact", head: true })
            .in("spot_id", ids)
            .eq("type", "love")
            .neq("user_id", userId)
          setTotalLikes(likesCount ?? 0)
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ } finally {
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
            onDragEnd={(_e, { offset, velocity }) => {
              if (offset.y > 120 || velocity.y > 400) onClose()
            }}
            className="fixed inset-x-0 bottom-0 z-[80] sm:inset-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2"
          >
            <div className="flex h-[90vh] flex-col overflow-hidden rounded-t-[2.5rem] border border-gray-200 dark:border-white/10 bg-white dark:bg-zinc-950 text-gray-900 dark:text-white shadow-2xl sm:h-auto sm:max-h-[90vh] sm:rounded-3xl sm:bg-gray-50 dark:sm:bg-zinc-900">
              <div className="mx-auto mt-4 mb-1 h-1.5 w-12 flex-shrink-0 rounded-full bg-gray-300 dark:bg-zinc-700/50 sm:hidden" />

              <div className="flex flex-shrink-0 items-center justify-between p-5 pt-3 pb-4 sm:pt-5">
                <h2 className="flex items-center gap-2 text-lg font-bold">
                  <User size={18} className="text-indigo-600 dark:text-indigo-400" /> Profil
                </h2>
                <button onClick={onClose} className="rounded-xl p-2 text-gray-500 dark:text-zinc-400 transition-colors hover:bg-gray-100 dark:hover:bg-white/10">
                  <X size={18} />
                </button>
              </div>

              <div className="flex flex-col flex-1 overflow-y-auto px-5 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-5">
                {loading ? (
                  <div className="flex flex-1 items-center justify-center">
                    <LoaderCircle size={32} className="animate-spin text-indigo-500" />
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="flex flex-col items-center gap-3">
                      <div className="relative">
                        <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-2 border-indigo-500/50 bg-gradient-to-br from-indigo-500 to-purple-600 text-4xl font-bold text-white shadow-xl shadow-indigo-500/25">
                          {profile?.avatar_url ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <span>{(profile?.username || "?")?.charAt(0).toUpperCase()}</span>
                          )}
                        </div>
                        <div className={`absolute right-1 bottom-1 z-20 h-4 w-4 rounded-full border-[2.5px] border-white dark:border-zinc-950 ${profile?.last_active_at && Date.now() - new Date(profile.last_active_at).getTime() < 15 * 60000 ? "bg-green-500" : "bg-red-500"}`} />
                      </div>
                      <p className="text-lg font-bold">@{profile?.username || "utilisateur"}</p>
                    </div>

                    <div className="grid grid-cols-3 gap-2 rounded-2xl border border-gray-200 dark:border-white/5 bg-gray-50 dark:bg-zinc-800/50 py-4">
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-xl font-bold">{spots.length}</span>
                        <div className="flex items-center justify-center gap-1 text-xs text-gray-500 dark:text-zinc-400">
                          <MapPin size={12} /> Lieux
                        </div>
                      </div>
                      <div className="flex flex-col items-center gap-1 border-x border-gray-200 dark:border-white/10">
                        <span className="text-xl font-bold">{followers}</span>
                        <div className="flex items-center justify-center gap-1 text-xs text-gray-500 dark:text-zinc-400">
                          <Users size={12} /> Abonnés
                        </div>
                      </div>
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-xl font-bold">{totalLikes}</span>
                        <div className="flex items-center justify-center gap-1 text-xs text-gray-500 dark:text-zinc-400">
                          <Heart size={12} className="fill-red-500 text-red-500" /> Likes
                        </div>
                      </div>
                    </div>

                    <div>
                      <h3 className="mb-3 text-sm font-bold text-gray-900 dark:text-white">Ses Spots ({spots.length})</h3>
                      {spots.length === 0 ? (
                        <p className="p-4 text-center text-sm text-gray-500 dark:text-zinc-500">Aucun spot ajouté.</p>
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          {spots.map((spot) => {
                            const imageUrl = spot.image_url?.split(",")[0]?.trim() || null
                            return (
                              <button
                                key={spot.id}
                                onClick={() => onLocateSpot?.(spot.id, spot.lat, spot.lng)}
                                className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 dark:border-white/5 bg-gray-50 dark:bg-zinc-800/60 text-left transition-colors hover:bg-gray-100 dark:hover:bg-zinc-800"
                              >
                                <div className="aspect-square w-full overflow-hidden bg-gray-200 dark:bg-zinc-900/60">
                                  {imageUrl && (
                                    /* eslint-disable-next-line @next/next/no-img-element */
                                    <img src={imageUrl} alt={spot.title} className="h-full w-full object-cover" />
                                  )}
                                </div>
                                <div className="px-2.5 py-2">
                                  <p className="line-clamp-2 text-xs font-semibold leading-tight">{spot.title}</p>
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
