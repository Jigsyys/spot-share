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

  const CATEGORY_EMOJIS: Record<string, string> = {
    café: "☕", restaurant: "🍽️", bar: "🍸", outdoor: "🌿",
    vue: "🌅", culture: "🎭", shopping: "🛍️", other: "📍",
  }

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
            onDragEnd={(_e, { offset, velocity }) => {
              if (offset.y > 120 || velocity.y > 400) onClose()
            }}
            className="fixed inset-x-0 bottom-0 z-50 sm:inset-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2"
          >
            <div className="flex h-[90vh] flex-col overflow-hidden rounded-t-[2.5rem] border border-gray-200 dark:border-gray-200 dark:border-white/10 bg-white dark:bg-zinc-950 text-gray-900 dark:text-white shadow-2xl sm:h-auto sm:max-h-[90vh] sm:rounded-3xl sm:bg-gray-50 dark:sm:bg-zinc-900">
              <div className="mx-auto mt-4 mb-1 h-1.5 w-12 flex-shrink-0 rounded-full bg-gray-300 dark:bg-zinc-700/50 sm:hidden" />

              {/* Header */}
              <div className="flex flex-shrink-0 items-center justify-between p-5 pt-3 pb-4 sm:pt-5">
                {subView ? (
                  <button onClick={() => setSubView(null)} className="flex items-center gap-2 text-sm font-bold text-gray-600 dark:text-zinc-300 hover:text-white">
                    <ArrowLeft size={16} /> Retour
                  </button>
                ) : (
                  <h2 className="flex items-center gap-2 text-lg font-bold">
                    <User size={18} className="text-blue-600 dark:text-indigo-400" /> Mon profil
                  </h2>
                )}
                <button onClick={onClose} className="rounded-xl p-2 text-gray-500 dark:text-zinc-400 transition-colors hover:bg-gray-100 dark:hover:bg-white/10">
                  <X size={18} />
                </button>
              </div>

              <div className="flex flex-1 flex-col overflow-y-auto px-5 pb-[calc(5rem+env(safe-area-inset-bottom))]">
                {/* ============================================ */}
                {/* SUB-VIEW: Spots list */}
                {/* ============================================ */}
                {subView === "spots" && (
                  <div className="space-y-5">
                    <p className="mb-3 text-xs font-semibold tracking-wider text-gray-400 dark:text-zinc-500 uppercase">
                      Mes spots ({userSpots.length})
                    </p>
                    {userSpots.length === 0 ? (
                      <p className="py-8 text-center text-sm text-gray-400 dark:text-zinc-500">Aucun spot ajouté pour l&apos;instant.</p>
                    ) : (
                      <div className="space-y-2">
                        {userSpots.map((spot) => (
                          <button
                            key={spot.id}
                            onClick={() => onLocateSpot?.(spot.id, spot.lat, spot.lng)}
                            className="flex w-full items-center gap-3 rounded-2xl border border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-zinc-800/60 px-4 py-3 text-left transition-colors hover:bg-gray-100 dark:hover:bg-zinc-800 group"
                          >
                            <span className="text-lg">{CATEGORY_EMOJIS[spot.category || "other"] || "📍"}</span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold">{spot.title}</p>
                              {spot.address && <p className="truncate text-[11px] text-gray-400 dark:text-zinc-500">{spot.address}</p>}
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleDeleteUserSpot(spot.id)
                                }}
                                className="rounded-xl p-2 text-gray-500 dark:text-zinc-400 transition-colors hover:bg-red-500/10 hover:text-red-500"
                              >
                                <Trash2 size={14} />
                              </button>
                              <div className="rounded-xl p-2 text-blue-600 dark:text-indigo-400 opacity-80 group-hover:opacity-100">
                                <Navigation size={14} />
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ============================================ */}
                {/* SUB-VIEW: Followers list */}
                {/* ============================================ */}
                {subView === "followers" && (
                  <div className="space-y-5">
                    <p className="mb-3 text-xs font-semibold tracking-wider text-gray-400 dark:text-zinc-500 uppercase">
                      Abonnés ({followersCount})
                    </p>
                    {loadingList ? (
                      <div className="flex justify-center py-8"><LoaderCircle size={24} className="animate-spin text-blue-600 dark:text-indigo-400" /></div>
                    ) : followersList.length === 0 ? (
                      <p className="py-8 text-center text-sm text-gray-400 dark:text-zinc-500">Aucun abonné.</p>
                    ) : (
                      <div className="space-y-2">
                        {followersList.map((p) => (
                          <div key={p.id} className="flex items-center gap-3 rounded-2xl border border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-zinc-800/60 px-4 py-3">
                            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-blue-600 to-sky-500 dark:from-indigo-500 dark:to-purple-600 text-sm font-bold text-white">
                              {p.avatar_url ? (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img src={p.avatar_url} alt="" className="h-full w-full object-cover" />
                              ) : (
                                (p.username || "?").charAt(0).toUpperCase()
                              )}
                            </div>
                            <p className="truncate text-sm font-medium flex-1">@{p.username || "utilisateur"}</p>
                            <button
                              onClick={() => handleRemoveFollowerUser(p.id)}
                              className="rounded-xl p-2 text-gray-500 dark:text-zinc-400 transition-colors hover:bg-red-500/10 hover:text-red-500"
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
                  <div className="space-y-5">
                    <p className="mb-3 text-xs font-semibold tracking-wider text-gray-400 dark:text-zinc-500 uppercase">
                      Abonnements ({followingCount})
                    </p>
                    {loadingList ? (
                      <div className="flex justify-center py-8"><LoaderCircle size={24} className="animate-spin text-blue-600 dark:text-indigo-400" /></div>
                    ) : followingList.length === 0 ? (
                      <p className="py-8 text-center text-sm text-gray-400 dark:text-zinc-500">Aucun abonnement.</p>
                    ) : (
                      <div className="space-y-2">
                        {followingList.map((p) => (
                          <div
                            key={p.id}
                            className="flex cursor-pointer items-center gap-3 rounded-2xl border border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-zinc-800/60 px-4 py-3 transition-colors hover:bg-gray-100 dark:hover:bg-zinc-800"
                            onClick={() => { onSelectUser?.(p.id); onClose() }}
                          >
                            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-blue-600 to-sky-500 dark:from-indigo-500 dark:to-purple-600 text-sm font-bold text-white">
                              {p.avatar_url ? (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img src={p.avatar_url} alt="" className="h-full w-full object-cover" />
                              ) : (
                                (p.username || "?").charAt(0).toUpperCase()
                              )}
                            </div>
                            <p className="truncate text-sm font-medium flex-1">@{p.username || "utilisateur"}</p>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleUnfollowUser(p.id) }}
                              className="rounded-xl p-2 text-gray-500 dark:text-zinc-400 transition-colors hover:bg-red-500/10 hover:text-red-500"
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
                    {/* Avatar (click to change photo) */}
                    <div className="group relative flex flex-col items-center gap-3 py-2">
                      <div
                        onClick={() => fileInputRef.current?.click()}
                        className="relative flex h-24 w-24 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-blue-600/50 dark:border-indigo-500/50 bg-gradient-to-br from-blue-600 to-sky-500 dark:from-indigo-500 dark:to-purple-600 text-4xl font-bold text-white shadow-xl shadow-indigo-500/25"
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
                              className="w-40 rounded-lg border border-blue-600/50 dark:border-indigo-500/50 bg-gray-100 dark:bg-zinc-800 px-3 py-1.5 text-center text-sm text-gray-900 dark:text-white outline-none"
                            />
                            <button
                              onClick={saveName}
                              disabled={saving}
                              className="rounded-lg bg-blue-600 dark:bg-indigo-500 p-1.5 text-white hover:bg-blue-500 dark:hover:bg-indigo-400 disabled:opacity-50"
                            >
                              {saving ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}
                            </button>
                            <button onClick={() => setEditingName(false)} className="rounded-lg bg-gray-200 dark:bg-zinc-700 p-1.5 text-gray-600 dark:text-zinc-300 hover:bg-gray-300 dark:hover:bg-zinc-600">
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => { setNameInput(username); setEditingName(true) }} className="group/name">
                            <p className="text-base font-semibold transition-colors group-hover/name:text-blue-600 dark:group-hover/name:text-indigo-400">
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

                    {/* Stats (clickable) */}
                    <div className="grid grid-cols-3 gap-3">
                      <button onClick={() => openSubView("spots")} className="flex flex-col items-center gap-1 rounded-2xl border border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-zinc-800/60 py-3 transition-colors hover:border-blue-600/30 dark:hover:border-indigo-500/30 hover:bg-blue-600/5 dark:hover:bg-indigo-500/5">
                        <span className="text-blue-600 dark:text-indigo-400"><MapPin size={14} /></span>
                        <span className="text-lg font-bold">{spotsCount}</span>
                        <span className="text-xs text-gray-400 dark:text-zinc-500">Spots</span>
                      </button>
                      <button onClick={() => openSubView("followers")} className="flex flex-col items-center gap-1 rounded-2xl border border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-zinc-800/60 py-3 transition-colors hover:border-blue-600/30 dark:hover:border-indigo-500/30 hover:bg-blue-600/5 dark:hover:bg-indigo-500/5">
                        <span className="text-blue-600 dark:text-indigo-400"><Users size={14} /></span>
                        <span className="text-lg font-bold">{followersCount}</span>
                        <span className="text-xs text-gray-400 dark:text-zinc-500">Abonnés</span>
                      </button>
                      <button onClick={() => openSubView("following")} className="flex flex-col items-center gap-1 rounded-2xl border border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-zinc-800/60 py-3 transition-colors hover:border-blue-600/30 dark:hover:border-indigo-500/30 hover:bg-blue-600/5 dark:hover:bg-indigo-500/5">
                        <span className="text-blue-600 dark:text-indigo-400"><Users size={14} /></span>
                        <span className="text-lg font-bold">{followingCount}</span>
                        <span className="text-xs text-gray-400 dark:text-zinc-500">Abonnements</span>
                      </button>
                    </div>

                    {saveError && <p className="text-center text-xs text-red-400">{saveError}</p>}

                    {/* Ghost Mode */}
                    <div className="border-t border-gray-200 dark:border-white/10 pt-5">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="flex items-center gap-2 text-sm font-semibold">
                            <Ghost size={14} className="text-gray-500 dark:text-zinc-400" /> Mode Fantôme
                          </h3>
                          <p className="mt-1 max-w-[250px] text-[11px] text-gray-400 dark:text-zinc-500">
                            Cache ta position sur la carte pour les autres.
                          </p>
                        </div>
                        <button
                          onClick={toggleGhostMode}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isGhostMode ? "bg-blue-600 dark:bg-indigo-500" : "bg-gray-300 dark:bg-zinc-700"}`}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isGhostMode ? "translate-x-6" : "translate-x-1"}`} />
                        </button>
                      </div>
                    </div>

                    {/* Theme Toggle */}
                    <div className="border-t border-gray-200 dark:border-white/10 pt-5">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="flex items-center gap-2 text-sm font-semibold">
                            {theme === "dark" ? <Moon size={14} className="text-gray-500 dark:text-zinc-400" /> : <Sun size={14} className="text-amber-400" />}
                            Thème clair
                          </h3>
                          <p className="mt-1 max-w-[250px] text-[11px] text-gray-400 dark:text-zinc-500">
                            Passe du mode sombre au mode clair
                          </p>
                        </div>
                        <button
                          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${theme === "light" ? "bg-blue-600 dark:bg-indigo-500" : "bg-gray-300 dark:bg-zinc-700"}`}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${theme === "light" ? "translate-x-6" : "translate-x-1"}`} />
                        </button>
                      </div>
                    </div>

                    </div>

                    {/* Log Out */}
                    <div className="mt-8">
                       <button
                         onClick={() => {
                           onSignOut?.()
                           onClose()
                         }}
                         className="flex w-full items-center justify-center gap-2 rounded-xl bg-gray-100 dark:bg-zinc-800/50 border border-gray-200 dark:border-white/5 px-4 py-3 text-sm font-semibold text-gray-600 dark:text-zinc-300 transition-colors hover:bg-gray-200 dark:hover:bg-zinc-800"
                       >
                         <LogOut size={16} />
                         Se déconnecter
                       </button>
                    </div>

                    {/* Delete Account */}
                    <div className="mt-4 border-t border-red-500/20 pt-5 sm:mt-8">
                      <button
                        onClick={handleDeleteAccount}
                        disabled={deletingAccount}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-500 transition-colors hover:bg-red-500/20 disabled:opacity-50"
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
