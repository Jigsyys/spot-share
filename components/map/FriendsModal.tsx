"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  X,
  Search,
  UserPlus,
  LoaderCircle,
  Users,
  Clock,
  Check,
  Bell,
  Trash2,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import type { User } from "@supabase/supabase-js"

function timeAgo(dateString?: string) {
  if (!dateString) return ""
  const diff = Date.now() - new Date(dateString).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return "à l'instant"
  if (minutes < 60) return `il y a ${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `il y a ${hours}h`
  return `il y a ${Math.floor(hours / 24)}j`
}

function isOnline(dateString?: string, ghost?: boolean) {
  if (ghost || !dateString) return false
  return Date.now() - new Date(dateString).getTime() < 15 * 60000
}

interface Profile {
  id: string
  username: string | null
  last_lat?: number
  last_lng?: number
  last_active_at?: string
  is_ghost_mode?: boolean
  avatar_url?: string | null
}

interface FriendRequest {
  id: string
  from_id: string
  to_id: string
  status: "pending" | "accepted" | "declined"
  profiles: { username: string | null; avatar_url: string | null }
}

interface FriendsModalProps {
  isOpen: boolean
  onClose: () => void
  currentUser: User | null
  followingIds: string[]
  onFollowingChange: (ids: string[]) => void
  visibleFriendIds: string[]
  setVisibleFriendIds: (ids: string[] | ((prev: string[]) => string[])) => void
  onRefreshFollowing?: () => void
  onLocateFriend?: (lat: number, lng: number) => void
  onSelectUser?: (id: string) => void
}

export default function FriendsModal({
  isOpen,
  onClose,
  currentUser,
  followingIds,
  onFollowingChange,
  visibleFriendIds,
  setVisibleFriendIds,
  onRefreshFollowing,
  onLocateFriend,
  onSelectUser,
}: FriendsModalProps) {
  const [query, setQuery] = useState("")
  const [searchResults, setSearchResults] = useState<Profile[]>([])
  const [following, setFollowing] = useState<Profile[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [pendingSent, setPendingSent] = useState<string[]>([]) // IDs we sent requests to
  const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([])
  const [recommendations, setRecommendations] = useState<Profile[]>([])
  const supabaseRef = useRef(createClient())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // --------------- Loaders ---------------

  const loadFollowing = useCallback(async (customIds?: string[]) => {
    const idsToLoad = customIds || followingIds
    if (!currentUser || idsToLoad.length === 0) {
      setFollowing([])
      return
    }
    try {
      const { data, error } = await supabaseRef.current
        .from("profiles")
        .select(
          "id, username, avatar_url, last_lat, last_lng, last_active_at, is_ghost_mode"
        )
        .in("id", idsToLoad)
      if (error) throw error
      setFollowing((data as Profile[]) ?? [])
    } catch {
      setFollowing([])
    }
  }, [currentUser, followingIds])

  const loadSentRequests = useCallback(async () => {
    if (!currentUser) return
    try {
      const { data } = await supabaseRef.current
        .from("friend_requests")
        .select("to_id")
        .eq("from_id", currentUser.id)
        .eq("status", "pending")
      if (data) setPendingSent(data.map((r: { to_id: string }) => r.to_id))
    } catch {
      /* table might not exist */
    }
  }, [currentUser])

  const loadIncomingRequests = useCallback(async () => {
    if (!currentUser) return
    try {
      const { data } = await supabaseRef.current
        .from("friend_requests")
        .select(
          "id, from_id, to_id, status, profiles!friend_requests_from_id_fkey(username, avatar_url)"
        )
        .eq("to_id", currentUser.id)
        .eq("status", "pending")
      if (data) setIncomingRequests(data as unknown as FriendRequest[])
    } catch {
      /* table might not exist */
    }
  }, [currentUser])

  const loadRecommendations = useCallback(async () => {
    if (!currentUser) return
    try {
      // Friends of friends
      if (followingIds.length > 0) {
        const { data } = await supabaseRef.current
          .from("followers")
          .select("following_id")
          .in("follower_id", followingIds)
          .not(
            "following_id",
            "in",
            `(${[currentUser.id, ...followingIds].join(",")})`
          )
          .limit(20)

        if (data && data.length > 0) {
          const ids = [
            ...new Set(
              data.map((r: { following_id: string }) => r.following_id)
            ),
          ].slice(0, 5)
          const { data: profiles, error } = await supabaseRef.current
            .from("profiles")
            .select("id, username, avatar_url, last_active_at, is_ghost_mode")
            .in("id", ids)
          if (error) throw error
          if (profiles && profiles.length > 0) {
            setRecommendations(profiles as Profile[])
            return
          }
        }
      }
      // Fallback: recently active users
      const { data: recent } = await supabaseRef.current
        .from("profiles")
        .select("id, username, avatar_url, last_active_at")
        .not("id", "in", `(${[currentUser.id, ...followingIds].join(",")})`)
        .not("last_active_at", "is", null)
        .order("last_active_at", { ascending: false })
        .limit(5)
      if (recent) setRecommendations(recent as Profile[])
    } catch {
      /* ignore */
    }
  }, [currentUser, followingIds])

  useEffect(() => {
    if (!isOpen || !currentUser) return

    onRefreshFollowing?.()
    loadFollowing()
    loadSentRequests()
    loadIncomingRequests()
    loadRecommendations()

    // S'abonner aux requêtes d'amis en temps réel (Realtime Supabase)
    const channel = supabaseRef.current
      .channel("friend_requests_realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "friend_requests",
          filter: `to_id=eq.${currentUser.id}`,
        },
        () => loadIncomingRequests()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "friend_requests",
          filter: `from_id=eq.${currentUser.id}`,
        },
        () => loadSentRequests()
      )
      .subscribe()

    return () => {
      supabaseRef.current.removeChannel(channel)
    }
  }, [
    isOpen,
    currentUser,
    loadFollowing,
    loadSentRequests,
    loadIncomingRequests,
    loadRecommendations,
    onRefreshFollowing,
  ])

  // --------------- Search ---------------

  const searchUsers = useCallback(
    async (q: string) => {
      if (q.length < 2) {
        setSearchResults([])
        return
      }
      setSearchLoading(true)
      try {
        const { data, error } = await supabaseRef.current
          .from("profiles")
          .select("id, username, avatar_url, last_active_at, is_ghost_mode")
          .ilike("username", `%${q}%`)
          .neq("id", currentUser?.id ?? "")
          .limit(8)
        if (error) throw error
        setSearchResults((data as Profile[]) ?? [])
      } catch {
        setSearchResults([])
      } finally {
        setSearchLoading(false)
      }
    },
    [currentUser]
  )

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => searchUsers(query), 400)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, searchUsers])

  // --------------- Actions ---------------

  const sendRequest = async (targetId: string) => {
    if (!currentUser) return
    setLoadingId(targetId)
    try {
      // Nettoyer toute ancienne demande orpheline (accepted sans followers, ou declined)
      await supabaseRef.current
        .from("friend_requests")
        .delete()
        .or(`status.eq.accepted,status.eq.declined`)
        .eq("from_id", currentUser.id)
        .eq("to_id", targetId)
      // Nettoyer aussi dans l'autre sens
      await supabaseRef.current
        .from("friend_requests")
        .delete()
        .or(`status.eq.accepted,status.eq.declined`)
        .eq("from_id", targetId)
        .eq("to_id", currentUser.id)

      const { error } = await supabaseRef.current
        .from("friend_requests")
        .insert({
          from_id: currentUser.id,
          to_id: targetId,
          status: "pending",
        })
      if (error) {
        console.error("sendRequest insert error:", error.message)
        // Si le UNIQUE constraint échoue encore, la demande existe déjà en pending
      }
      setPendingSent((prev) => [...prev, targetId])
    } catch (e) {
      console.error("sendRequest error:", e)
    } finally {
      setLoadingId(null)
    }
  }

  const cancelRequest = async (targetId: string) => {
    if (!currentUser) return
    setLoadingId(targetId)
    try {
      await supabaseRef.current
        .from("friend_requests")
        .delete()
        .eq("from_id", currentUser.id)
        .eq("to_id", targetId)
      setPendingSent((prev) => prev.filter((id) => id !== targetId))
    } catch {
      /* ignore */
    } finally {
      setLoadingId(null)
    }
  }

  const acceptRequest = async (req: FriendRequest) => {
    if (!currentUser) return
    setLoadingId(req.from_id)
    try {
      // Essaie d'abord via la fonction sécurisée (contourne les RLS restrictives)
      const { error: rpcError } = await supabaseRef.current.rpc(
        "accept_friend_request",
        { request_id: req.id }
      )

      if (rpcError) {
        // Fallback manuel si la fonction RPC n'existe pas encore
        console.warn("RPC unavailable, falling back to direct upsert:", rpcError.message)
        const { error: updErr } = await supabaseRef.current
          .from("friend_requests")
          .update({ status: "accepted" })
          .eq("id", req.id)
        if (updErr) throw new Error("Erreur update demande: " + updErr.message)

        const { error: follErr } = await supabaseRef.current
          .from("followers")
          .upsert([
            { follower_id: currentUser.id, following_id: req.from_id },
            { follower_id: req.from_id, following_id: currentUser.id },
          ])
        if (follErr) throw new Error("Erreur upsert followers: " + follErr.message)
      }

      const newIds = [...new Set([...followingIds, req.from_id])]
      onFollowingChange(newIds)
      setIncomingRequests((prev) => prev.filter((r) => r.id !== req.id))
      await loadFollowing(newIds)
    } catch (e) {
      console.error("acceptRequest error:", e)
    } finally {
      setLoadingId(null)
    }
  }

  const declineRequest = async (req: FriendRequest) => {
    if (!currentUser) return
    setLoadingId(req.from_id)
    try {
      await supabaseRef.current
        .from("friend_requests")
        .update({ status: "declined" })
        .eq("id", req.id)
      setIncomingRequests((prev) => prev.filter((r) => r.id !== req.id))
    } catch {
      /* ignore */
    } finally {
      setLoadingId(null)
    }
  }

  const unfollow = async (targetId: string) => {
    if (!currentUser) return
    setLoadingId(targetId)
    try {
      await supabaseRef.current
        .from("followers")
        .delete()
        .eq("follower_id", currentUser.id)
        .eq("following_id", targetId)
      const newIds = followingIds.filter((id) => id !== targetId)
      onFollowingChange(newIds)
      setFollowing((prev) => prev.filter((p) => p.id !== targetId))
    } catch {
      /* ignore */
    } finally {
      setLoadingId(null)
    }
  }

  const initials = (username: string | null) =>
    username ? username.charAt(0).toUpperCase() : "?"

  const isFollowing = (id: string) => followingIds.includes(id)
  const isPending = (id: string) => pendingSent.includes(id)

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
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
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
            className="fixed inset-x-0 bottom-0 z-50 sm:inset-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2"
          >
            <div className="pb-safe flex h-[90vh] flex-col overflow-hidden rounded-t-[2rem] border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-zinc-950 text-gray-900 dark:text-white shadow-2xl sm:h-auto sm:max-h-[90vh] sm:rounded-3xl">

              {/* Drag handle */}
              <div className="mx-auto mt-3 mb-1 h-1 w-10 flex-shrink-0 rounded-full bg-gray-300 dark:bg-zinc-700" />

              {/* Header */}
              <div className="flex flex-shrink-0 items-center justify-between px-5 py-4">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white">Amis</h2>
                  {incomingRequests.length > 0 && (
                    <span className="flex items-center gap-1 rounded-full bg-indigo-500 px-2 py-0.5 text-[10px] font-bold text-white">
                      <Bell size={10} /> {incomingRequests.length}
                    </span>
                  )}
                </div>
                <button
                  onClick={onClose}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 dark:bg-white/10 text-gray-500 dark:text-zinc-400 transition-colors hover:bg-gray-300 dark:hover:bg-white/20"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Search Bar */}
              <div className="flex-shrink-0 px-5 pb-3">
                <div className="relative">
                  <Search
                    size={15}
                    className="absolute top-1/2 left-4 -translate-y-1/2 text-gray-400 dark:text-zinc-500"
                  />
                  <input
                    type="text"
                    placeholder="Rechercher par nom d'utilisateur..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="w-full rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-zinc-900 px-4 py-3 pl-10 text-[16px] text-gray-900 dark:text-white transition-all outline-none placeholder:text-gray-400 dark:placeholder:text-zinc-500 focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20 sm:text-sm"
                  />
                  {searchLoading && (
                    <LoaderCircle
                      size={15}
                      className="absolute top-1/2 right-4 -translate-y-1/2 animate-spin text-indigo-400"
                    />
                  )}
                </div>
              </div>

              {/* Scrollable content */}
              <div className="flex-1 space-y-5 overflow-y-auto px-5 pb-[calc(5rem+env(safe-area-inset-bottom))]">

                {/* Incoming Requests */}
                {incomingRequests.length > 0 && query.length < 2 && (
                  <div>
                    <p className="mb-3 text-sm font-bold text-gray-900 dark:text-white">
                      Invitations ({incomingRequests.length})
                    </p>
                    <div className="space-y-2">
                      {incomingRequests.map((req) => (
                        <div
                          key={req.id}
                          className="flex items-center gap-3 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 p-3"
                        >
                          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white dark:border-zinc-900 bg-gradient-to-br from-indigo-500 to-purple-600 text-sm font-bold text-white">
                            {req.profiles?.avatar_url ? (
                              /* eslint-disable-next-line @next/next/no-img-element */
                              <img
                                src={req.profiles.avatar_url}
                                alt="avatar"
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              (req.profiles?.username ?? "?")
                                .charAt(0)
                                .toUpperCase()
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                              @{req.profiles?.username ?? "utilisateur"}
                            </p>
                            <p className="text-[10px] text-gray-500 dark:text-zinc-400">
                              veut être ton ami
                            </p>
                          </div>
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => acceptRequest(req)}
                              disabled={loadingId === req.from_id}
                              className="flex items-center gap-1 rounded-xl bg-green-500 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-green-400 disabled:opacity-50"
                            >
                              {loadingId === req.from_id ? (
                                <LoaderCircle size={12} className="animate-spin" />
                              ) : (
                                <>
                                  <Check size={12} /> Accepter
                                </>
                              )}
                            </button>
                            <button
                              onClick={() => declineRequest(req)}
                              disabled={loadingId === req.from_id}
                              className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 dark:bg-white/10 text-gray-500 dark:text-zinc-400 transition-colors hover:bg-red-100 dark:hover:bg-red-500/20 hover:text-red-500 disabled:opacity-50"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Search Results */}
                {query.length >= 2 && (
                  <div>
                    <p className="mb-3 text-sm font-bold text-gray-900 dark:text-white">
                      Résultats
                    </p>
                    {searchResults.length === 0 && !searchLoading ? (
                      <p className="py-4 text-center text-sm text-gray-500 dark:text-zinc-500">
                        Aucun utilisateur trouvé
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {searchResults.map((profile) => (
                          <UserRow
                            key={profile.id}
                            profile={profile}
                            initials={initials(profile.username)}
                            isFollowing={isFollowing(profile.id)}
                            isPending={isPending(profile.id)}
                            loading={loadingId === profile.id}
                            onSendRequest={() => sendRequest(profile.id)}
                            onCancelRequest={() => cancelRequest(profile.id)}
                            onUnfollow={() => unfollow(profile.id)}
                            onSelectUser={() => {
                              onSelectUser?.(profile.id)
                              onClose()
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Recommendations (only when actively searching) */}
                {query.length >= 2 && searchResults.length === 0 && !searchLoading && recommendations.length > 0 && (
                  <div>
                    <p className="mb-3 text-sm font-bold text-gray-900 dark:text-white">
                      Suggestions
                    </p>
                    <div className="space-y-2">
                      {recommendations
                        .filter((r) => !isFollowing(r.id))
                        .map((profile) => (
                          <UserRow
                            key={profile.id}
                            profile={profile}
                            initials={initials(profile.username)}
                            isFollowing={false}
                            isPending={isPending(profile.id)}
                            loading={loadingId === profile.id}
                            onSendRequest={() => sendRequest(profile.id)}
                            onCancelRequest={() => cancelRequest(profile.id)}
                            onUnfollow={() => unfollow(profile.id)}
                            onSelectUser={() => {
                              onSelectUser?.(profile.id)
                              onClose()
                            }}
                          />
                        ))}
                    </div>
                  </div>
                )}

                {/* Following list */}
                <div>
                  <p className="mb-3 text-sm font-bold text-gray-900 dark:text-white">
                    Amis ({followingIds.length})
                  </p>
                  {following.length === 0 ? (
                    <p className="py-4 text-center text-sm text-gray-500 dark:text-zinc-500">
                      Aucun ami pour l&apos;instant.
                      <br />
                      <span className="text-gray-400 dark:text-zinc-600">
                        Recherche et envoie des invitations !
                      </span>
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {following.map((profile) => (
                        <UserRow
                          key={profile.id}
                          profile={profile}
                          initials={initials(profile.username)}
                          isFollowing={true}
                          isPending={false}
                          loading={loadingId === profile.id}
                          onSendRequest={() => sendRequest(profile.id)}
                          onCancelRequest={() => cancelRequest(profile.id)}
                          onUnfollow={() => unfollow(profile.id)}
                          onSelectUser={() => {
                            onSelectUser?.(profile.id)
                            onClose()
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ---------------------------------------------------------------
// UserRow Component
// ---------------------------------------------------------------
function UserRow({
  profile,
  initials,
  isFollowing,
  isPending,
  loading,
  onSendRequest,
  onCancelRequest,
  onUnfollow,
  onSelectUser,
}: {
  profile: Profile
  initials: string
  isFollowing: boolean
  isPending: boolean
  loading: boolean
  onSendRequest: () => void
  onCancelRequest: () => void
  onUnfollow: () => void
  onSelectUser?: () => void
}) {
  const online = isOnline(profile.last_active_at, profile.is_ghost_mode)

  return (
    <div
      className="flex cursor-pointer items-center gap-3 rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-zinc-800"
      onClick={onSelectUser}
    >
      {/* Avatar */}
      <div className="relative flex-shrink-0">
        <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border-2 border-white dark:border-zinc-900 bg-gradient-to-br from-indigo-500 to-purple-600 text-sm font-bold text-white">
          {profile.avatar_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={profile.avatar_url}
              alt={profile.username || "avatar"}
              className="h-full w-full object-cover"
            />
          ) : (
            initials
          )}
        </div>
        {online && (
          <div className="absolute right-0 bottom-0 h-3 w-3 rounded-full border-2 border-white dark:border-zinc-900 bg-green-500" />
        )}
      </div>

      {/* Name + status */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">
          @{profile.username ?? "utilisateur"}
        </p>
        {profile.last_active_at && (
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs">
            {online ? (
              <span className="font-medium text-green-500 dark:text-green-400">En ligne</span>
            ) : (
              <span className="flex items-center gap-0.5 text-gray-500 dark:text-zinc-500">
                <Clock size={9} /> {timeAgo(profile.last_active_at)}
              </span>
            )}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-shrink-0 items-center gap-1">
        {isFollowing ? (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onUnfollow?.()
            }}
            disabled={loading}
            title="Supprimer l'ami"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-zinc-400 transition-all hover:bg-red-50 dark:hover:bg-red-500/20 hover:text-red-500 dark:hover:text-red-400 disabled:opacity-50"
          >
            {loading ? (
              <LoaderCircle size={14} className="animate-spin" />
            ) : (
              <Trash2 size={14} />
            )}
          </button>
        ) : isPending ? (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onCancelRequest?.()
            }}
            disabled={loading}
            title="Annuler la demande"
            className="flex items-center gap-1.5 rounded-full bg-gray-100 dark:bg-zinc-800 border border-gray-200 dark:border-white/10 px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-gray-500 dark:text-zinc-400 transition-all hover:bg-red-50 dark:hover:bg-red-500/20 hover:text-red-500 dark:hover:text-red-400 disabled:opacity-50"
          >
            {loading ? (
              <LoaderCircle size={12} className="animate-spin" />
            ) : (
              <>
                <Clock size={12} /> En attente
              </>
            )}
          </button>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onSendRequest?.()
            }}
            disabled={loading}
            title="Envoyer une invitation"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500 text-white transition-all hover:bg-indigo-400 disabled:opacity-50"
          >
            {loading ? (
              <LoaderCircle size={14} className="animate-spin" />
            ) : (
              <UserPlus size={14} />
            )}
          </button>
        )}
      </div>
    </div>
  )
}
