"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
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
  Sparkles,
  UserPlus,
  Bell,
} from "lucide-react"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import type { User as SupabaseUser } from "@supabase/supabase-js"
import { useTheme } from "next-themes"
import { useSwipeToClose } from "@/hooks/useSwipeToClose"

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

interface LikeHistoryItem {
  reactionId: string
  spotId: string
  spotTitle: string
  spotCategory: string | null
  spotImageUrl: string | null
  spotLat: number
  spotLng: number
  likerUsername: string | null
  likerAvatarUrl: string | null
  likedAt: string
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
  onSelectSpot?: (id: string, lat: number, lng: number) => void
  navHeight?: number
}

type SubView = null | "spots" | "followers" | "following" | "likes"

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
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
  onSelectSpot,
  navHeight = 0,
}: ProfileModalProps) {
  const [username, setUsername] = useState("")
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean; title: string; message: string
    confirmLabel?: string; danger?: boolean; onConfirm: () => void
  } | null>(null)
  const openConfirm = useCallback((opts: {
    title: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void
  }) => setConfirmDialog({ open: true, ...opts }), [])
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [followersCount, setFollowersCount] = useState(0)
  const [followingCount, setFollowingCount] = useState(0)
  const [totalLikes, setTotalLikes] = useState(0)
  const [statsLoading, setStatsLoading] = useState(false)
  const skeletonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [subView, setSubView] = useState<SubView>(null)
  const [followersList, setFollowersList] = useState<FollowProfile[]>([])
  const [followingList, setFollowingList] = useState<FollowProfile[]>([])
  const [loadingList, setLoadingList] = useState(false)
  const [likeHistory, setLikeHistory] = useState<LikeHistoryItem[]>([])
  const [loadingLikes, setLoadingLikes] = useState(false)

  // Suggestions
  const [suggestions, setSuggestions] = useState<{ id: string; username: string | null; avatar_url: string | null }[]>([])
  const [showSuggestionsSheet, setShowSuggestionsSheet] = useState(false)
  const [pendingSuggestions, setPendingSuggestions] = useState<Set<string>>(new Set())

  // Inline editing
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState("")

  // Notifications
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>("default")
  const [notifLoading, setNotifLoading] = useState(false)
  const [monthlyRank, setMonthlyRank] = useState<1 | 2 | 3 | null>(null)

  const supabaseRef = useRef(createClient())
  const swipe = useSwipeToClose(onClose)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { theme, setTheme } = useTheme()

  // ---------------------------------------------------------------
  // Load profile — RPC + cache localStorage (stale-while-revalidate)
  // ---------------------------------------------------------------
  const STATS_CACHE_TTL = 5 * 60 * 1000

  const applyStats = useCallback((d: {
    username: string | null; avatar_url: string | null
    followers_count: number; following_count: number; total_likes: number
  }, fromEmail?: string) => {
    const name = d.username || fromEmail || ""
    setUsername(name)
    setNameInput(name)
    if (d.avatar_url) setAvatarUrl(d.avatar_url)
    setFollowersCount(d.followers_count ?? 0)
    setFollowingCount(d.following_count ?? 0)
    setTotalLikes(d.total_likes ?? 0)
  }, [])

  useEffect(() => {
    if (!isOpen || !user) return
    setSubView(null)
    if ("Notification" in window) {
      setNotifPermission(Notification.permission)
    }

    // 1. Afficher le cache immédiatement si disponible
    let hasCachedData = false
    try {
      const raw = localStorage.getItem(`profile_stats_${user.id}`)
      if (raw) {
        const { data: cached, ts } = JSON.parse(raw)
        applyStats(cached, user.email?.split("@")[0])
        hasCachedData = true
        if (Date.now() - ts < STATS_CACHE_TTL) return // cache frais → pas de refetch
      }
    } catch { /* ignore */ }

    // 2. Skeleton seulement si aucun cache (150ms délai pour éviter le flash)
    if (!hasCachedData) {
      skeletonTimerRef.current = setTimeout(() => setStatsLoading(true), 150)
    }

    // 3. RPC en arrière-plan
    supabaseRef.current.rpc("get_profile_stats", { p_user_id: user.id }).then(async ({ data }) => {
      if (skeletonTimerRef.current) { clearTimeout(skeletonTimerRef.current); skeletonTimerRef.current = null }
      setStatsLoading(false)
      if (data && data.username !== undefined) {
        applyStats(data, user.email?.split("@")[0])
        try { localStorage.setItem(`profile_stats_${user.id}`, JSON.stringify({ data, ts: Date.now() })) } catch { /* ignore */ }
      } else if (!hasCachedData) {
        // RPC indisponible et pas de cache — charger directement depuis profiles
        const { data: profile } = await supabaseRef.current
          .from("profiles").select("username, avatar_url").eq("id", user.id).single()
        if (profile?.username) {
          setUsername(profile.username)
          setNameInput(profile.username)
          if (profile.avatar_url) setAvatarUrl(profile.avatar_url)
        }
      }
    })

    return () => {
      if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current)
    }
  }, [isOpen, user, applyStats]) // eslint-disable-line react-hooks/exhaustive-deps

  // Monthly ranking medal
  useEffect(() => {
    if (!isOpen || !user) return
    setMonthlyRank(null)
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    supabaseRef.current
      .from("spots")
      .select("user_id")
      .gte("created_at", startOfMonth)
      .then(({ data }) => {
        if (!data) return
        const counts: Record<string, number> = {}
        data.forEach((s: { user_id: string }) => { counts[s.user_id] = (counts[s.user_id] ?? 0) + 1 })
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
        const rank = sorted.findIndex(([id]) => id === user.id)
        if (rank === 0) setMonthlyRank(1)
        else if (rank === 1) setMonthlyRank(2)
        else if (rank === 2) setMonthlyRank(3)
      })
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
      try {
        const raw = localStorage.getItem(`profile_stats_${user.id}`)
        if (raw) { const p = JSON.parse(raw); p.data.username = finalName; p.ts = Date.now(); localStorage.setItem(`profile_stats_${user.id}`, JSON.stringify(p)) }
      } catch { /* ignore */ }
      toast.success("Nom mis à jour !")
    } catch (e: unknown) {
      const err = e as { message?: string }
      setSaveError("Erreur : " + (err.message || "inconnue"))
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteUserSpot = (id: string) => {
    openConfirm({
      title: "Supprimer ce lieu ?",
      message: "Cette action est irréversible.",
      confirmLabel: "Supprimer",
      danger: true,
      onConfirm: async () => {
        try {
          await supabaseRef.current.from("spots").delete().eq("id", id)
          toast.success("Lieu supprimé !")
          onDeleteSpot?.(id)
        } catch {
          toast.error("Erreur lors de la suppression.")
        }
      },
    })
  }

  const handleUnfollowUser = (targetId: string) => {
    if (!user) return
    openConfirm({
      title: "Ne plus suivre ?",
      message: "Tu ne verras plus ses spots sur la carte.",
      confirmLabel: "Se désabonner",
      danger: false,
      onConfirm: async () => {
        try {
          await supabaseRef.current.from("followers").delete().eq("follower_id", user.id).eq("following_id", targetId)
          setFollowingList(prev => prev.filter(p => p.id !== targetId))
          setFollowingCount(prev => {
            const next = Math.max(0, prev - 1)
            try { const raw = localStorage.getItem(`profile_stats_${user!.id}`); if (raw) { const p = JSON.parse(raw); p.data.following_count = next; localStorage.setItem(`profile_stats_${user!.id}`, JSON.stringify(p)) } } catch { /* */ }
            return next
          })
          onUnfollow?.(targetId)
          toast.success("Abonnement annulé !")
        } catch { toast.error("Erreur.") }
      },
    })
  }

  const handleRemoveFollowerUser = (targetId: string) => {
    if (!user) return
    openConfirm({
      title: "Retirer cet abonné ?",
      message: "Il ne pourra plus voir tes spots.",
      confirmLabel: "Retirer",
      danger: false,
      onConfirm: async () => {
        try {
          await supabaseRef.current.from("followers").delete().eq("follower_id", targetId).eq("following_id", user.id)
          setFollowersList(prev => prev.filter(p => p.id !== targetId))
          setFollowersCount(prev => {
            const next = Math.max(0, prev - 1)
            try { const raw = localStorage.getItem(`profile_stats_${user!.id}`); if (raw) { const p = JSON.parse(raw); p.data.followers_count = next; localStorage.setItem(`profile_stats_${user!.id}`, JSON.stringify(p)) } } catch { /* */ }
            return next
          })
          toast.success("Abonné retiré !")
        } catch { toast.error("Erreur.") }
      },
    })
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
      try {
        const raw = localStorage.getItem(`profile_stats_${user.id}`)
        if (raw) { const p = JSON.parse(raw); p.data.avatar_url = publicUrl; p.ts = Date.now(); localStorage.setItem(`profile_stats_${user.id}`, JSON.stringify(p)) }
      } catch { /* ignore */ }
      toast.success("Photo mise à jour !")
    } catch (err) {
      console.error("[Avatar upload error]:", err)
      setSaveError("Erreur lors de l'upload de la photo.")
    } finally {
      setUploadingAvatar(false)
    }
  }

  // ---------------------------------------------------------------
  // Notifications toggle
  // ---------------------------------------------------------------
  const handleToggleNotifications = useCallback(async () => {
    if (notifLoading) return
    setNotifLoading(true)
    try {
      if (notifPermission === "granted") {
        const reg = await navigator.serviceWorker.getRegistration("/sw.js")
        if (reg) {
          const sub = await reg.pushManager.getSubscription()
          if (sub) {
            await sub.unsubscribe()
            await fetch("/api/push/subscribe", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ endpoint: sub.endpoint }),
            })
          }
        }
        toast.success("Notifications désactivées")
        setNotifPermission("denied")
      } else {
        const perm = await Notification.requestPermission()
        setNotifPermission(perm)
        if (perm === "granted") {
          const reg = await navigator.serviceWorker.register("/sw.js")
          const existing = await reg.pushManager.getSubscription()
          const sub = existing ?? await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!) as unknown as ArrayBuffer,
          })
          const { endpoint, keys } = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
          await fetch("/api/push/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint, p256dh: keys.p256dh, auth: keys.auth }),
          })
          toast.success("Notifications activées !")
        } else {
          toast.error("Permission refusée par le navigateur")
        }
      }
    } catch (err) {
      console.error("toggle notif error:", err)
      toast.error("Erreur lors de la configuration des notifications")
    } finally {
      setNotifLoading(false)
    }
  }, [notifPermission, notifLoading])

  // ---------------------------------------------------------------
  // Suggestions
  // ---------------------------------------------------------------
  const loadSuggestions = useCallback(async () => {
    if (!user) { setSuggestions([]); return }
    try {
      const excludeIds = [user.id, ...followingIds]
      if (followingIds.length > 0) {
        // Amis des amis
        const { data } = await supabaseRef.current
          .from("followers").select("following_id")
          .in("follower_id", followingIds)
          .not("following_id", "in", `(${excludeIds.join(",")})`)
          .limit(40)
        if (data && data.length > 0) {
          const counts: Record<string, number> = {}
          data.forEach((r: { following_id: string }) => {
            counts[r.following_id] = (counts[r.following_id] || 0) + 1
          })
          const topIds = Object.entries(counts).sort(([, a], [, b]) => b - a).slice(0, 8).map(([id]) => id)
          const { data: profiles } = await supabaseRef.current
            .from("profiles").select("id, username, avatar_url").in("id", topIds)
          setSuggestions(profiles ?? [])
          return
        }
      }
      // Fallback : utilisateurs populaires
      const { data: profiles } = await supabaseRef.current
        .from("profiles").select("id, username, avatar_url")
        .neq("id", user.id)
        .limit(8)
      setSuggestions(profiles ?? [])
    } catch { setSuggestions([]) }
  }, [user, followingIds])

  // ---------------------------------------------------------------
  // Delete account
  // ---------------------------------------------------------------
  const handleDeleteAccount = () => {
    if (!user) return
    openConfirm({
      title: "Supprimer ton compte ?",
      message: "Tous tes spots, relations et données seront définitivement supprimés. Cette action est irréversible.",
      confirmLabel: "Supprimer mon compte",
      danger: true,
      onConfirm: async () => { await doDeleteAccount() },
    })
  }

  const doDeleteAccount = async () => {
    if (!user) return
    setDeletingAccount(true)
    try {
      // 1. Supprimer les images de spots depuis le storage
      const { data: spotFiles } = await supabaseRef.current.storage
        .from("avatars")
        .list("spots", { search: user.id, limit: 200 })
      if (spotFiles && spotFiles.length > 0) {
        await supabaseRef.current.storage
          .from("avatars")
          .remove(spotFiles.map(f => `spots/${f.name}`))
      }

      // 2. Supprimer l'avatar depuis le storage
      const { data: avatarFiles } = await supabaseRef.current.storage
        .from("avatars")
        .list("", { search: user.id, limit: 10 })
      if (avatarFiles && avatarFiles.length > 0) {
        await supabaseRef.current.storage
          .from("avatars")
          .remove(avatarFiles.map(f => f.name))
      }

      // 3. Supprimer le compte auth + cascade (spots, profil, réactions,
      //    visites, sorties, invitations, relations amis)
      await supabaseRef.current.rpc("delete_user")

      await supabaseRef.current.auth.signOut()
      window.location.href = "/login"
    } catch {
      toast.error("Erreur lors de la suppression du compte.")
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

  const loadLikeHistory = useCallback(async () => {
    if (!user) return
    setLoadingLikes(true)
    try {
      // Get all spot IDs owned by user
      const { data: spotData } = await supabaseRef.current
        .from("spots")
        .select("id, title, category, lat, lng, image_url")
        .eq("user_id", user.id)
      if (!spotData || spotData.length === 0) { setLikeHistory([]); setLoadingLikes(false); return }

      const spotIds = spotData.map((s: { id: string }) => s.id)
      const spotMap = Object.fromEntries(spotData.map((s: { id: string; title: string; category: string | null; lat: number; lng: number; image_url: string | null }) => [s.id, s]))

      // Get reactions (likes) from others on those spots
      // Note: spot_reactions has no id column — PK is (spot_id, user_id, type)
      const { data: reactions } = await supabaseRef.current
        .from("spot_reactions")
        .select("spot_id, user_id, created_at")
        .in("spot_id", spotIds)
        .eq("type", "love")
        .neq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50)

      if (!reactions || reactions.length === 0) { setLikeHistory([]); setLoadingLikes(false); return }

      // Fetch liker profiles
      const likerIds = [...new Set(reactions.map((r: { user_id: string }) => r.user_id))]
      const { data: profiles } = await supabaseRef.current
        .from("profiles")
        .select("id, username, avatar_url")
        .in("id", likerIds)
      const profileMap = Object.fromEntries((profiles ?? []).map((p: { id: string; username: string | null; avatar_url: string | null }) => [p.id, p]))

      const history: LikeHistoryItem[] = reactions.map((r: { spot_id: string; user_id: string; created_at: string }) => {
        const spot = spotMap[r.spot_id]
        const liker = profileMap[r.user_id]
        return {
          reactionId: `${r.spot_id}_${r.user_id}`,
          spotId: r.spot_id,
          spotTitle: spot?.title ?? "Spot",
          spotCategory: spot?.category ?? null,
          spotImageUrl: spot?.image_url?.split(",")[0]?.trim() ?? null,
          spotLat: spot?.lat ?? 0,
          spotLng: spot?.lng ?? 0,
          likerUsername: liker?.username ?? null,
          likerAvatarUrl: liker?.avatar_url ?? null,
          likedAt: r.created_at,
        }
      })
      setLikeHistory(history)
    } catch { setLikeHistory([]) }
    finally { setLoadingLikes(false) }
  }, [user])

  const openSubView = (view: SubView) => {
    setSubView(view)
    if (view === "followers") loadFollowersList()
    if (view === "following") loadFollowingList()
    if (view === "likes") loadLikeHistory()
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
            className="fixed inset-x-0 z-50 sm:inset-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-[calc(50%+2rem)]"
            style={{ bottom: navHeight > 0 ? navHeight : undefined }}
          >
            <div className="flex h-[90vh] flex-col overflow-hidden rounded-t-[2.5rem] border border-gray-200 dark:border-gray-200 dark:border-white/10 bg-white dark:bg-zinc-950 text-gray-900 dark:text-white shadow-2xl sm:h-auto sm:max-h-[calc(100vh-7rem)] sm:rounded-3xl sm:bg-gray-50 dark:sm:bg-zinc-900">
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

              <div ref={swipe.ref} onTouchStart={swipe.onTouchStart} onTouchEnd={swipe.onTouchEnd} className="flex flex-1 flex-col overflow-y-auto px-5 sm:pb-6">
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
                      <div className="space-y-2 animate-pulse">
                        {[1,2,3].map(i => (
                          <div key={i} className="flex items-center gap-3 rounded-2xl border border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-zinc-800/60 px-4 py-3">
                            <div className="h-9 w-9 rounded-full bg-gray-200 dark:bg-zinc-700 flex-shrink-0" />
                            <div className="flex-1 space-y-1.5">
                              <div className="h-3 w-1/2 rounded-full bg-gray-200 dark:bg-zinc-700" />
                              <div className="h-3 w-1/3 rounded-full bg-gray-200 dark:bg-zinc-700" />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : followersList.length === 0 ? (
                      <div className="py-8 flex flex-col items-center gap-3 text-center">
                        <p className="text-sm text-gray-400 dark:text-zinc-500">Aucun abonné pour l&apos;instant.</p>
                        <button
                          onClick={async () => {
                            const url = window.location.origin
                            if (navigator.share) {
                              try { await navigator.share({ title: "FriendSpot", text: "Rejoins-moi sur FriendSpot !", url }) } catch { /* cancelled */ }
                            } else {
                              await navigator.clipboard.writeText(url)
                              toast.success("Lien copié !")
                            }
                          }}
                          className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
                        >
                          Inviter des amis
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {followersList.map((p) => (
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
                            <p className="truncate text-sm font-medium flex-1">{p.username || "utilisateur"}</p>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleRemoveFollowerUser(p.id) }}
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
                      <div className="space-y-2 animate-pulse">
                        {[1,2,3].map(i => (
                          <div key={i} className="flex items-center gap-3 rounded-2xl border border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-zinc-800/60 px-4 py-3">
                            <div className="h-9 w-9 rounded-full bg-gray-200 dark:bg-zinc-700 flex-shrink-0" />
                            <div className="flex-1 space-y-1.5">
                              <div className="h-3 w-1/2 rounded-full bg-gray-200 dark:bg-zinc-700" />
                              <div className="h-3 w-1/3 rounded-full bg-gray-200 dark:bg-zinc-700" />
                            </div>
                          </div>
                        ))}
                      </div>
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
                            <p className="truncate text-sm font-medium flex-1">{p.username || "utilisateur"}</p>
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
                {/* SUB-VIEW: Likes history */}
                {/* ============================================ */}
                {subView === "likes" && (
                  <div className="space-y-3">
                    <p className="mb-3 text-xs font-semibold tracking-wider text-gray-400 dark:text-zinc-500 uppercase">
                      Historique des likes ({likeHistory.length})
                    </p>
                    {loadingLikes ? (
                      <div className="flex justify-center py-8"><LoaderCircle size={24} className="animate-spin text-red-500" /></div>
                    ) : likeHistory.length === 0 ? (
                      <p className="py-8 text-center text-sm text-gray-400 dark:text-zinc-500">Aucun like reçu pour l&apos;instant.</p>
                    ) : (
                      <div className="space-y-2">
                        {likeHistory.map((item) => {
                          const timeDiff = Date.now() - new Date(item.likedAt).getTime()
                          const h = Math.floor(timeDiff / 3_600_000)
                          const d = Math.floor(h / 24)
                          const timeStr = h < 1 ? "à l'instant" : h < 24 ? `il y a ${h}h` : `il y a ${d}j`
                          const CATEGORY_EMOJIS: Record<string, string> = { café: "☕", restaurant: "🍽️", bar: "🍸", outdoor: "🌿", vue: "🌅", culture: "🎭", shopping: "🛍️", other: "📍" }
                          return (
                            <button
                              key={item.reactionId}
                              onClick={() => { onSelectSpot?.(item.spotId, item.spotLat, item.spotLng); onClose() }}
                              className="flex w-full items-center gap-3 rounded-2xl border border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-zinc-800/60 px-4 py-3 text-left transition-colors hover:bg-gray-100 dark:hover:bg-zinc-800 group"
                            >
                              {/* Liker avatar */}
                              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-pink-500 to-red-500 text-sm font-bold text-white">
                                {item.likerAvatarUrl ? (
                                  /* eslint-disable-next-line @next/next/no-img-element */
                                  <img src={item.likerAvatarUrl} alt="" className="h-full w-full object-cover" />
                                ) : (
                                  (item.likerUsername || "?").charAt(0).toUpperCase()
                                )}
                              </div>
                              {/* Info */}
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">
                                  <span className="font-bold">{item.likerUsername || "utilisateur"}</span>
                                  {" a aimé "}
                                  <span className="font-semibold">{item.spotTitle}</span>
                                </p>
                                <p className="text-[11px] text-gray-400 dark:text-zinc-500">{timeStr}</p>
                              </div>
                              {/* Spot thumbnail or category emoji */}
                              <div className="relative flex-shrink-0">
                                {item.spotImageUrl ? (
                                  /* eslint-disable-next-line @next/next/no-img-element */
                                  <img src={item.spotImageUrl} alt="" className="h-11 w-11 rounded-xl object-cover" />
                                ) : (
                                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gray-100 dark:bg-zinc-700 text-xl">
                                    {CATEGORY_EMOJIS[item.spotCategory || "other"] || "📍"}
                                  </div>
                                )}
                                <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-white dark:bg-zinc-900 shadow">
                                  <Heart size={10} className="fill-red-500 text-red-500" />
                                </span>
                              </div>
                            </button>
                          )
                        })}
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
                            <p className="flex items-center justify-center gap-1.5 text-base font-semibold transition-colors group-hover/name:text-blue-600 dark:group-hover/name:text-indigo-400">
                              {username || "…"}
                              {monthlyRank === 1 && <span className="text-[18px] leading-none">🥇</span>}
                              {monthlyRank === 2 && <span className="text-[18px] leading-none">🥈</span>}
                              {monthlyRank === 3 && <span className="text-[18px] leading-none">🥉</span>}
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
                    {statsLoading ? (
                      <div className="grid grid-cols-3 gap-2 animate-pulse">
                        {[0,1,2].map(i => (
                          <div key={i} className="flex flex-col items-center gap-2 rounded-2xl border border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-zinc-800/60 py-3">
                            <div className="h-3.5 w-3.5 rounded bg-gray-200 dark:bg-zinc-700" />
                            <div className="h-5 w-8 rounded bg-gray-200 dark:bg-zinc-700" />
                            <div className="h-2.5 w-10 rounded bg-gray-200 dark:bg-zinc-700" />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        <button onClick={() => openSubView("spots")} className="flex flex-col items-center gap-1 rounded-2xl border border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-zinc-800/60 py-3 transition-colors hover:border-blue-600/30 dark:hover:border-indigo-500/30 hover:bg-blue-600/5 dark:hover:bg-indigo-500/5">
                          <span className="text-blue-600 dark:text-indigo-400"><MapPin size={14} /></span>
                          <span className="text-lg font-bold">{spotsCount}</span>
                          <span className="text-xs text-gray-400 dark:text-zinc-500">Spots</span>
                        </button>
                        <button onClick={() => openSubView("following")} className="flex flex-col items-center gap-1 rounded-2xl border border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-zinc-800/60 py-3 transition-colors hover:border-blue-600/30 dark:hover:border-indigo-500/30 hover:bg-blue-600/5 dark:hover:bg-indigo-500/5">
                          <span className="text-blue-600 dark:text-indigo-400"><Users size={14} /></span>
                          <span className="text-lg font-bold">{followingCount}</span>
                          <span className="text-xs text-gray-400 dark:text-zinc-500">Amis</span>
                        </button>
                        <button onClick={() => openSubView("likes")} className="flex flex-col items-center gap-1 rounded-2xl border border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-zinc-800/60 py-3 transition-colors hover:border-red-500/30 hover:bg-red-500/5">
                          <span className="text-red-500"><Heart size={14} className="fill-red-500" /></span>
                          <span className="text-lg font-bold">{totalLikes}</span>
                          <span className="text-xs text-gray-400 dark:text-zinc-500">Likes reçus</span>
                        </button>
                      </div>
                    )}

                    {saveError && <p className="text-center text-xs text-red-400">{saveError}</p>}


                    {/* Ghost Mode */}
                    {/* Notifications Toggle */}
                    {"Notification" in window && (
                      <div className="border-t border-gray-200 dark:border-white/10 pt-5">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="flex items-center gap-2 text-sm font-semibold">
                              <Bell size={14} className="text-gray-500 dark:text-zinc-400" /> Notifications
                            </h3>
                            <p className="mt-1 max-w-[250px] text-[11px] text-gray-400 dark:text-zinc-500">
                              Reçois une alerte quand tes amis ajoutent des spots.
                            </p>
                          </div>
                          <button
                            onClick={handleToggleNotifications}
                            disabled={notifLoading}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${notifPermission === "granted" ? "bg-blue-600 dark:bg-indigo-500" : "bg-gray-300 dark:bg-zinc-700"}`}
                          >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${notifPermission === "granted" ? "translate-x-6" : "translate-x-1"}`} />
                          </button>
                        </div>
                      </div>
                    )}

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
                {/* Spacer — empêche le dernier élément d'être sous la barre de navigation */}
                <div style={{ height: "max(6rem, calc(env(safe-area-inset-bottom) + 5rem))", flexShrink: 0 }} />
              </div>
            </div>
          </motion.div>

        </>
      )}
      {confirmDialog && (
        <ConfirmDialog
          open={confirmDialog.open}
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          danger={confirmDialog.danger}
          onConfirm={() => { confirmDialog.onConfirm(); setConfirmDialog(null) }}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </AnimatePresence>
  )
}
