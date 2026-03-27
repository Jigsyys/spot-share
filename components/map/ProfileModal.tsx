"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  X,
  User,
  Mail,
  Check,
  LoaderCircle,
  MapPin,
  UploadCloud,
  Trash2,
  Sun,
  Moon,
  Ghost,
  ArrowLeft,
  Users,
  Navigation,
  UserMinus,
  LogOut,
  Heart,
} from "lucide-react"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import type { User as SupabaseUser } from "@supabase/supabase-js"
import { useTheme } from "next-themes"

interface Spot {
  id: string
  title: string
  category?: string
  address?: string | null
  image_url?: string | null
  lat: number
  lng: number
}

interface FollowProfile {
  id: string
  username: string | null
  avatar_url: string | null
}

interface ProfileModalProps {
  isOpen: boolean
  onClose: () => void
  user: SupabaseUser | null
  spotsCount: number
  userSpots?: Spot[]
  followingIds?: string[]
  onProfileUpdate?: (username: string, avatarUrl: string | null) => void
  onDeleteSpot?: (id: string) => void
  onUnfollow?: (id: string) => void
  onLocateSpot?: (id: string, lat: number, lng: number) => void
  onSignOut?: () => void
  onSelectUser?: (id: string) => void
}

type SubView = null | "spots" | "followers" | "following"

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

export default function ProfileModal({
  isOpen,
  onClose,
  user,
  spotsCount,
  userSpots = [],
  followingIds = [],
  onProfileUpdate,
  onDeleteSpot,
  onUnfollow,
  onLocateSpot,
  onSignOut,
  onSelectUser,
}: ProfileModalProps) {
  const [username, setUsername] = useState("")
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [followersCount, setFollowersCount] = useState(0)
  const [followingCount, setFollowingCount] = useState(0)
  const [totalLikes, setTotalLikes] = useState(0)
  const [isGhostMode, setIsGhostMode] = useState(false)
  const [subView, setSubView] = useState<SubView>(null)
  const [followersList, setFollowersList] = useState<FollowProfile[]>([])
  const [followingList, setFollowingList] = useState<FollowProfile[]>([])
  const [loadingList, setLoadingList] = useState(false)

  // Inline editing
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState("")

  const supabaseRef = useRef(createClient())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { theme, setTheme } = useTheme()

  // ---------------------------------------------------------------
  // Load profile
  // ---------------------------------------------------------------
  useEffect(() => {
    if (!isOpen || !user) return
    setSubView(null)

    const loadProfile = async () => {
      try {
        const { data } = await supabaseRef.current
          .from("profiles")
          .select("username, avatar_url, is_ghost_mode")
          .eq("id", user.id)
          .single()
        if (data) {
          const name = data.username || user.email?.split("@")[0] || ""
          setUsername(name)
          setNameInput(name)
          if (data.avatar_url) setAvatarUrl(data.avatar_url)
          if (data.is_ghost_mode !== undefined) setIsGhostMode(!!data.is_ghost_mode)
        }
      } catch {
        const fallback = user.email?.split("@")[0] ?? ""
        setUsername(fallback)
        setNameInput(fallback)
      }

      try {
        const [{ count: followers }, { count: following }] = await Promise.all([
          supabaseRef.current
            .from("followers")
            .select("*", { count: "exact", head: true })
            .eq("following_id", user.id),
          supabaseRef.current
            .from("followers")
            .select("*", { count: "exact", head: true })
            .eq("follower_id", user.id),
        ])
        setFollowersCount(followers ?? 0)
        setFollowingCount(following ?? 0)
      } catch { /* */ }

      try {
        const { data: spotIds } = await supabaseRef.current
          .from("spots").select("id").eq("user_id", user.id)
        if (spotIds && spotIds.length > 0) {
          const ids = spotIds.map((s: { id: string }) => s.id)
          const { count } = await supabaseRef.current
            .from("spot_reactions")
            .select("*", { count: "exact", head: true })
            .in("spot_id", ids)
            .eq("type", "love")
            .neq("user_id", user.id)
          setTotalLikes(count ?? 0)
        }
      } catch { /* */ }
    }

    loadProfile()
  }, [isOpen, user])

  // ---------------------------------------------------------------
  // Save username
  // ---------------------------------------------------------------
  const saveName = async () => {
    if (!user) return
    setSaving(true)
    setSaveError(null)
    try {
      const finalName = nameInput.trim() || user.email?.split("@")[0] || "user"
      const { error } = await supabaseRef.current
        .from("profiles")
        .upsert({ id: user.id, username: finalName })
      if (error) throw error
      setUsername(finalName)
      setEditingName(false)
      onProfileUpdate?.(finalName, avatarUrl)
      toast.success("Nom mis à jour !")
    } catch (e: unknown) {
      const err = e as { message?: string }
      setSaveError("Erreur : " + (err.message || "inconnue"))
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteUserSpot = async (id: string) => {
    if (!window.confirm("Es-tu sûr de vouloir supprimer ce lieu ?")) return
    try {
      await supabaseRef.current.from("spots").delete().eq("id", id)
      toast.success("Lieu supprimé !")
      onDeleteSpot?.(id)
    } catch {
      toast.error("Erreur lors de la suppression.")
    }
  }

  const handleUnfollowUser = async (targetId: string) => {
    if (!user) return
    if (!window.confirm("Ne plus suivre cet ami ?")) return
    try {
      await supabaseRef.current.from("followers").delete().eq("follower_id", user.id).eq("following_id", targetId)
      setFollowingList(prev => prev.filter(p => p.id !== targetId))
      setFollowingCount(prev => Math.max(0, prev - 1))
      onUnfollow?.(targetId)
      toast.success("Abonnement annulé !")
    } catch { toast.error("Erreur.") }
  }

  const handleRemoveFollowerUser = async (targetId: string) => {
    if (!user) return
    if (!window.confirm("Retirer cet abonné ?")) return
    try {
      await supabaseRef.current.from("followers").delete().eq("follower_id", targetId).eq("following_id", user.id)
      setFollowersList(prev => prev.filter(p => p.id !== targetId))
      setFollowersCount(prev => Math.max(0, prev - 1))
      toast.success("Abonné retiré !")
    } catch { toast.error("Erreur.") }
  }

  // ---------------------------------------------------------------
  // Avatar upload
  // ---------------------------------------------------------------
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0] || !user) return
    const file = e.target.files[0]
    const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]
    const MAX_SIZE = 10 * 1024 * 1024
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error("Format non supporté. Utilise JPG, PNG ou WebP.")
      return
    }
    if (file.size > MAX_SIZE) {
      toast.error("Image trop lourde (max 10 Mo).")
      return
    }
    setUploadingAvatar(true)
    setSaveError(null)
    const fileExt = file.name.split(".").pop()
    const filePath = `${user.id}-${Math.random()}.${fileExt}`
    try {
      const { error: uploadError } = await supabaseRef.current.storage
        .from("avatars")
        .upload(filePath, file)
      if (uploadError) throw uploadError
      const { data: { publicUrl } } = supabaseRef.current.storage
        .from("avatars")
        .getPublicUrl(filePath)
      const { error: updateError } = await supabaseRef.current
        .from("profiles")
        .update({ avatar_url: publicUrl })
        .eq("id", user.id)
      if (updateError) throw updateError
      setAvatarUrl(publicUrl)
      onProfileUpdate?.(username, publicUrl)
      toast.success("Photo mise à jour !")
    } catch (err) {
      console.error("[Avatar upload error]:", err)
      setSaveError("Erreur lors de l'upload de la photo.")
    } finally {
      setUploadingAvatar(false)
    }
  }

  // ---------------------------------------------------------------
  // Ghost mode toggle
  // ---------------------------------------------------------------
  const toggleGhostMode = async () => {
    if (!user) return
    const newValue = !isGhostMode
    setIsGhostMode(newValue)
    try {
      const { error } = await supabaseRef.current
        .from("profiles")
        .update({ is_ghost_mode: newValue })
        .eq("id", user.id)
      if (error) throw error
      toast.success(newValue ? "Mode fantôme activé" : "Mode fantôme désactivé")
    } catch {
      setIsGhostMode(!newValue)
      toast.error("Erreur lors de la mise à jour. La colonne is_ghost_mode existe-t-elle ?")
    }
  }

  // ---------------------------------------------------------------
  // Delete account
  // ---------------------------------------------------------------
  const handleDeleteAccount = async () => {
    if (!user) return
    if (!window.confirm("Es-tu sûr ? Cette action est irréversible.")) return
    setDeletingAccount(true)
    try {
      await supabaseRef.current.from("spots").delete().eq("user_id", user.id)
      await supabaseRef.current.from("profiles").delete().eq("id", user.id)
      await supabaseRef.current.rpc("delete_user")
      await supabaseRef.current.auth.signOut()
      window.location.reload()
    } catch {
      toast.error("Erreur lors de la suppression du compte.")
    } finally {
      setDeletingAccount(false)
    }
  }

  // ---------------------------------------------------------------
  // Sub-views (spots, followers, following)
  // ---------------------------------------------------------------
  const loadFollowersList = useCallback(async () => {
    if (!user) return
    setLoadingList(true)
    try {
      const { data } = await supabaseRef.current
        .from("followers")
        .select("follower_id")
        .eq("following_id", user.id)
      if (data && data.length > 0) {
        const ids = data.map((r: { follower_id: string }) => r.follower_id)
        const { data: profiles } = await supabaseRef.current
          .from("profiles")
          .select("id, username, avatar_url")
          .in("id", ids)
        setFollowersList((profiles as FollowProfile[]) || [])
      } else {
        setFollowersList([])
      }
    } catch { setFollowersList([]) }
    finally { setLoadingList(false) }
  }, [user])

  const loadFollowingList = useCallback(async () => {
    if (!user) return
    setLoadingList(true)
    try {
      const { data } = await supabaseRef.current
        .from("followers")
        .select("following_id")
        .eq("follower_id", user.id)
      if (data && data.length > 0) {
        const ids = data.map((r: { following_id: string }) => r.following_id)
        const { data: profiles } = await supabaseRef.current
          .from("profiles")
          .select("id, username, avatar_url")
          .in("id", ids)
        setFollowingList((profiles as FollowProfile[]) || [])
      } else {
        setFollowingList([])
      }
    } catch { setFollowingList([]) }
    finally { setLoadingList(false) }
  }, [user])

  const openSubView = (view: SubView) => {
    setSubView(view)
    if (view === "followers") loadFollowersList()
    if (view === "following") loadFollowingList()
  }

  const initials = username
    ? username.charAt(0).toUpperCase()
    : (user?.email?.charAt(0).toUpperCase() ?? "?")

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
            <div className="flex h-[90vh] flex-col overflow-hidden rounded-t-[2rem] border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-zinc-950 text-gray-900 dark:text-white shadow-2xl sm:h-auto sm:max-h-[90vh] sm:rounded-3xl">

              {/* Drag handle */}
              <div className="mx-auto mt-3 mb-1 h-1 w-10 flex-shrink-0 rounded-full bg-gray-300 dark:bg-zinc-700" />

              {/* Header */}
              <div className="flex flex-shrink-0 items-center justify-between px-5 py-4">
                {subView ? (
                  <button
                    onClick={() => setSubView(null)}
                    className="flex items-center gap-2 text-sm font-bold text-gray-600 dark:text-zinc-300 hover:text-gray-900 dark:hover:text-white transition-colors"
                  >
                    <ArrowLeft size={16} /> Retour
                  </button>
                ) : (
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white">Mon profil</h2>
                )}
                <button
                  onClick={onClose}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 dark:bg-white/10 text-gray-500 dark:text-zinc-400 transition-colors hover:bg-gray-300 dark:hover:bg-white/20"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Scrollable content */}
              <div className="flex flex-1 flex-col overflow-y-auto px-5 pb-[calc(5rem+env(safe-area-inset-bottom))]">

                {/* ============================================ */}
                {/* SUB-VIEW: Spots list */}
                {/* ============================================ */}
                {subView === "spots" && (
                  <div>
                    <p className="mb-4 text-sm font-bold text-gray-900 dark:text-white">
                      Mes spots ({userSpots.length})
                    </p>
                    {userSpots.length === 0 ? (
                      <p className="py-8 text-center text-sm text-gray-400 dark:text-zinc-500">Aucun spot ajouté pour l&apos;instant.</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        {userSpots.map((spot) => {
                          const imageUrl = (spot as Spot & { image_url?: string | null }).image_url?.split(",")[0]?.trim() || null
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
                              {/* Nav button overlay top-left */}
                              <div
                                onClick={(e) => { e.stopPropagation(); onLocateSpot?.(spot.id, spot.lat, spot.lng) }}
                                className="absolute left-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm"
                              >
                                <Navigation size={12} />
                              </div>
                              {/* Trash button overlay top-right */}
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteUserSpot(spot.id) }}
                                className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-red-500/80"
                              >
                                <Trash2 size={12} />
                              </button>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* ============================================ */}
                {/* SUB-VIEW: Followers list */}
                {/* ============================================ */}
                {subView === "followers" && (
                  <div>
                    <p className="mb-4 text-sm font-bold text-gray-900 dark:text-white">
                      Abonnés ({followersCount})
                    </p>
                    {loadingList ? (
                      <div className="flex justify-center py-8"><LoaderCircle size={24} className="animate-spin text-indigo-500" /></div>
                    ) : followersList.length === 0 ? (
                      <p className="py-8 text-center text-sm text-gray-400 dark:text-zinc-500">Aucun abonné.</p>
                    ) : (
                      <div className="space-y-2">
                        {followersList.map((p) => (
                          <div
                            key={p.id}
                            className="flex cursor-pointer items-center gap-3 rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-zinc-800"
                            onClick={() => { onSelectUser?.(p.id); onClose() }}
                          >
                            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 text-sm font-bold text-white">
                              {p.avatar_url ? (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img src={p.avatar_url} alt="" className="h-full w-full object-cover" />
                              ) : (
                                (p.username || "?").charAt(0).toUpperCase()
                              )}
                            </div>
                            <p className="truncate text-sm font-semibold flex-1 text-gray-900 dark:text-white">@{p.username || "utilisateur"}</p>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleRemoveFollowerUser(p.id) }}
                              className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-zinc-400 transition-colors hover:bg-red-50 dark:hover:bg-red-500/20 hover:text-red-500"
                            >
                              <UserMinus size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ============================================ */}
                {/* SUB-VIEW: Following list */}
                {/* ============================================ */}
                {subView === "following" && (
                  <div>
                    <p className="mb-4 text-sm font-bold text-gray-900 dark:text-white">
                      Abonnements ({followingCount})
                    </p>
                    {loadingList ? (
                      <div className="flex justify-center py-8"><LoaderCircle size={24} className="animate-spin text-indigo-500" /></div>
                    ) : followingList.length === 0 ? (
                      <p className="py-8 text-center text-sm text-gray-400 dark:text-zinc-500">Aucun abonnement.</p>
                    ) : (
                      <div className="space-y-2">
                        {followingList.map((p) => (
                          <div
                            key={p.id}
                            className="flex cursor-pointer items-center gap-3 rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-zinc-800"
                            onClick={() => { onSelectUser?.(p.id); onClose() }}
                          >
                            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 text-sm font-bold text-white">
                              {p.avatar_url ? (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img src={p.avatar_url} alt="" className="h-full w-full object-cover" />
                              ) : (
                                (p.username || "?").charAt(0).toUpperCase()
                              )}
                            </div>
                            <p className="truncate text-sm font-semibold flex-1 text-gray-900 dark:text-white">@{p.username || "utilisateur"}</p>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleUnfollowUser(p.id) }}
                              className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-zinc-400 transition-colors hover:bg-red-50 dark:hover:bg-red-500/20 hover:text-red-500"
                            >
                              <UserMinus size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ============================================ */}
                {/* MAIN PROFILE VIEW */}
                {/* ============================================ */}
                {!subView && (
                  <div className="flex flex-1 flex-col pb-2">
                    <div className="space-y-5">

                      {/* Avatar + username */}
                      <div className="group relative flex flex-col items-center gap-3 pt-2">
                        <div
                          onClick={() => fileInputRef.current?.click()}
                          className="relative flex h-24 w-24 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-indigo-500/40 bg-gradient-to-br from-indigo-500 to-purple-600 text-4xl font-bold text-white shadow-xl shadow-indigo-500/20"
                        >
                          <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleAvatarUpload} />
                          {uploadingAvatar ? (
                            <LoaderCircle className="z-10 h-8 w-8 animate-spin text-white" />
                          ) : avatarUrl ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
                          ) : (
                            <span className="z-10">{initials}</span>
                          )}
                          <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                            <UploadCloud size={24} className="text-white drop-shadow-md" />
                          </div>
                        </div>

                        {/* Username: click to edit inline */}
                        <div className="text-center">
                          {editingName ? (
                            <div className="flex items-center gap-2">
                              <input
                                autoFocus
                                type="text"
                                value={nameInput}
                                onChange={(e) => setNameInput(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") saveName() }}
                                className="w-40 rounded-xl border border-indigo-500/40 bg-white dark:bg-zinc-900 px-3 py-1.5 text-center text-sm text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500/20"
                              />
                              <button
                                onClick={saveName}
                                disabled={saving}
                                className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500 text-white hover:bg-indigo-400 disabled:opacity-50"
                              >
                                {saving ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}
                              </button>
                              <button
                                onClick={() => setEditingName(false)}
                                className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 dark:bg-zinc-700 text-gray-600 dark:text-zinc-300 hover:bg-gray-300 dark:hover:bg-zinc-600"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => { setNameInput(username); setEditingName(true) }}
                              className="group/name"
                            >
                              <p className="text-xl font-bold text-gray-900 dark:text-white transition-colors group-hover/name:text-indigo-500">
                                @{username || "…"}
                              </p>
                              <p className="text-[10px] text-gray-400 dark:text-zinc-600 opacity-0 transition-opacity group-hover/name:opacity-100">
                                Cliquer pour modifier
                              </p>
                            </button>
                          )}
                          <p className="mt-1 flex items-center justify-center gap-1 text-xs text-gray-400 dark:text-zinc-500">
                            <Mail size={11} /> {user?.email}
                          </p>
                        </div>
                      </div>

                      {/* Stats (4 clickable) */}
                      <div className="grid grid-cols-4 gap-2">
                        <button
                          onClick={() => openSubView("spots")}
                          className="flex flex-col items-center gap-1 rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 py-3 transition-colors hover:border-indigo-500/30 hover:bg-indigo-50 dark:hover:bg-indigo-500/5"
                        >
                          <MapPin size={14} className="text-indigo-500" />
                          <span className="text-lg font-bold text-gray-900 dark:text-white">{spotsCount}</span>
                          <span className="text-xs text-gray-500 dark:text-zinc-400">Spots</span>
                        </button>
                        <button
                          onClick={() => openSubView("followers")}
                          className="flex flex-col items-center gap-1 rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 py-3 transition-colors hover:border-indigo-500/30 hover:bg-indigo-50 dark:hover:bg-indigo-500/5"
                        >
                          <Users size={14} className="text-indigo-500" />
                          <span className="text-lg font-bold text-gray-900 dark:text-white">{followersCount}</span>
                          <span className="text-xs text-gray-500 dark:text-zinc-400">Abonnés</span>
                        </button>
                        <button
                          onClick={() => openSubView("following")}
                          className="flex flex-col items-center gap-1 rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 py-3 transition-colors hover:border-indigo-500/30 hover:bg-indigo-50 dark:hover:bg-indigo-500/5"
                        >
                          <Users size={14} className="text-indigo-500" />
                          <span className="text-lg font-bold text-gray-900 dark:text-white">{followingCount}</span>
                          <span className="text-xs text-gray-500 dark:text-zinc-400">Abonnements</span>
                        </button>
                        <div className="flex flex-col items-center gap-1 rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 py-3">
                          <Heart size={14} className="fill-red-500 text-red-500" />
                          <span className="text-lg font-bold text-gray-900 dark:text-white">{totalLikes}</span>
                          <span className="text-xs text-gray-500 dark:text-zinc-400">Likes</span>
                        </div>
                      </div>

                      {saveError && <p className="text-center text-xs text-red-400">{saveError}</p>}

                      {/* Settings section */}
                      <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 overflow-hidden">
                        {/* Ghost Mode */}
                        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100 dark:border-white/5">
                          <div>
                            <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                              <Ghost size={14} className="text-gray-500 dark:text-zinc-400" /> Mode Fantôme
                            </h3>
                            <p className="mt-0.5 max-w-[230px] text-[11px] text-gray-400 dark:text-zinc-500">
                              Cache ta position sur la carte pour les autres.
                            </p>
                          </div>
                          <button
                            onClick={toggleGhostMode}
                            className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${isGhostMode ? "bg-indigo-500" : "bg-gray-300 dark:bg-zinc-600"}`}
                          >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${isGhostMode ? "translate-x-6" : "translate-x-1"}`} />
                          </button>
                        </div>

                        {/* Theme Toggle */}
                        <div className="flex items-center justify-between px-4 py-4">
                          <div>
                            <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                              {theme === "dark" ? <Moon size={14} className="text-gray-500 dark:text-zinc-400" /> : <Sun size={14} className="text-amber-400" />}
                              Thème clair
                            </h3>
                            <p className="mt-0.5 max-w-[230px] text-[11px] text-gray-400 dark:text-zinc-500">
                              Passe du mode sombre au mode clair
                            </p>
                          </div>
                          <button
                            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                            className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${theme === "light" ? "bg-indigo-500" : "bg-gray-300 dark:bg-zinc-600"}`}
                          >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${theme === "light" ? "translate-x-6" : "translate-x-1"}`} />
                          </button>
                        </div>
                      </div>

                    </div>

                    {/* Log Out */}
                    <div className="mt-6">
                      <button
                        onClick={() => {
                          onSignOut?.()
                          onClose()
                        }}
                        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 px-4 py-3 text-sm font-semibold text-gray-600 dark:text-zinc-300 transition-colors hover:bg-gray-100 dark:hover:bg-zinc-800"
                      >
                        <LogOut size={16} />
                        Se déconnecter
                      </button>
                    </div>

                    {/* Delete Account */}
                    <div className="mt-3 mb-4">
                      <button
                        onClick={handleDeleteAccount}
                        disabled={deletingAccount}
                        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm font-semibold text-red-500 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                      >
                        {deletingAccount ? <LoaderCircle size={16} className="animate-spin" /> : <Trash2 size={16} />}
                        Supprimer mon compte
                      </button>
                      <p className="mt-2 text-center text-[10px] text-gray-400 dark:text-zinc-600">
                        Action irréversible.
                      </p>
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
