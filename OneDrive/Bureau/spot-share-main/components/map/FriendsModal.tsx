"use client"

import { toast } from "sonner"
import { useState, useEffect, useRef, useCallback, useMemo } from "react"
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
  Sparkles,
  UserCheck,
  MapPin,
  CalendarPlus,
  ArrowLeft,
  Calendar,
  CalendarCheck,
  CalendarX,
  ChevronRight,
  ChevronDown,
  Trophy,
  Heart,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import type { User } from "@supabase/supabase-js"
import type { SpotGroupInvitation } from "@/lib/types"
import { useSwipeToClose } from "@/hooks/useSwipeToClose"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

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

function formatOutingDate(dateString?: string | null): string {
  if (!dateString) return "Date à confirmer"
  const d = new Date(dateString)
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const timeStr = d.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  })
  if (d.toDateString() === now.toDateString()) return `Aujourd'hui · ${timeStr}`
  if (d.toDateString() === tomorrow.toDateString()) return `Demain · ${timeStr}`
  return (
    d.toLocaleDateString("fr-FR", {
      weekday: "short",
      day: "numeric",
      month: "short",
    }) + ` · ${timeStr}`
  )
}

function isOutingPast(dateString?: string | null): boolean {
  if (!dateString) return false
  return new Date(dateString) < new Date()
}

function getCountdown(dateString?: string | null): { label: string; urgent: boolean } | null {
  if (!dateString) return null
  const diff = new Date(dateString).getTime() - Date.now()
  if (diff < 0) return null
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (hours < 1) return { label: "Maintenant 🔥", urgent: true }
  if (hours < 24) return { label: `Dans ${hours}h 🔥`, urgent: true }
  if (days === 1) return { label: "Demain !", urgent: true }
  if (days < 7) return { label: `Dans ${days} jours`, urgent: false }
  return { label: `Dans ${days} jours`, urgent: false }
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Profile {
  id: string
  username: string | null
  last_lat?: number
  last_lng?: number
  last_active_at?: string
  is_ghost_mode?: boolean
  avatar_url?: string | null
}

interface SuggestionProfile extends Profile {
  mutualCount?: number
}

interface FriendRequest {
  id: string
  from_id: string
  to_id: string
  status: "pending" | "accepted" | "declined"
  profiles: { username: string | null; avatar_url: string | null }
}

interface OutingInviteStatus {
  id: string
  invitee_id: string
  status: "pending" | "accepted" | "declined"
  reply?: string | null
  profiles?: { username: string | null; avatar_url: string | null }
}

interface Outing {
  id: string
  creator_id: string
  title: string
  description?: string | null
  location_name?: string | null
  spot_id?: string | null
  lat?: number | null
  lng?: number | null
  scheduled_at?: string | null
  status: "active" | "cancelled" | "completed"
  created_at: string
  profiles?: { username: string | null; avatar_url: string | null }
  outing_invitations?: OutingInviteStatus[]
}

interface OutingInvitationFull {
  id: string
  outing_id: string
  invitee_id: string
  status: "pending" | "accepted" | "declined"
  reply?: string | null
  outings?: Outing & {
    profiles?: { username: string | null; avatar_url: string | null }
    allInvitations?: OutingInviteStatus[]
  }
}

type Tab = "amis" | "classement" | "invitations"

type RankEntry = { userId: string; username: string | null; avatar_url: string | null; count: number }

interface LocationResult {
  id: string
  label: string
  sublabel?: string
  lat: number
  lng: number
  isAppSpot?: boolean
  spotId?: string
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
  onRefreshGroups?: () => void
  onLocateFriend?: (lat: number, lng: number) => void
  onSelectUser?: (id: string) => void
  onSelectSpot?: (spotId: string) => void
  spots?: Array<{ id: string; user_id: string; created_at: string; image_url?: string | null; lat?: number; lng?: number; profiles?: { username: string | null; avatar_url: string | null } }>
  onLocateOuting?: (lat: number, lng: number) => void
  userProfile?: { username: string | null; avatar_url: string | null } | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function FriendsModal({
  isOpen,
  onClose,
  currentUser,
  followingIds,
  onFollowingChange,
  visibleFriendIds,
  setVisibleFriendIds,
  onRefreshFollowing,
  onRefreshGroups,
  onLocateFriend,
  onSelectUser,
  onSelectSpot,
  spots,
  userProfile,
  onLocateOuting,
}: FriendsModalProps) {
  // ── UI state ────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>("amis")
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean; title: string; message: string
    confirmLabel?: string; danger?: boolean; onConfirm: () => void
  } | null>(null)
  const openConfirm = useCallback((opts: {
    title: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void
  }) => setConfirmDialog({ open: true, ...opts }), [])
  const [showCreateOuting, setShowCreateOuting] = useState(false)
  const [query, setQuery] = useState("")
  const [invitationsSeen, setInvitationsSeen] = useState(false)
  const [expandedNotifId, setExpandedNotifId] = useState<string | null>(null)

  // ── Data state ──────────────────────────────────────────────
  const [searchResults, setSearchResults] = useState<Profile[]>([])
  const [following, setFollowing] = useState<Profile[]>([])
  const [pendingSent, setPendingSent] = useState<{ id: string; username: string | null; avatar_url: string | null }[]>([])
  const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([])
  const [suggestions, setSuggestions] = useState<SuggestionProfile[]>([])
  const [outings, setOutings] = useState<Outing[]>([])
  const [outingInvitations, setOutingInvitations] = useState<OutingInvitationFull[]>([])
  type GroupInvitationEnriched = SpotGroupInvitation & { inviterProfile: { username: string | null; avatar_url: string | null } | null }
  const [groupInvitations, setGroupInvitations] = useState<GroupInvitationEnriched[]>([])

  // ── Loading state ───────────────────────────────────────────
  const [searchLoading, setSearchLoading] = useState(false)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [respondingId, setRespondingId] = useState<string | null>(null)

  // ── Create outing form ──────────────────────────────────────
  const [createForm, setCreateForm] = useState({
    title: "",
    description: "",
    scheduled_at: "",
  })
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // ── Edit outing ──────────────────────────────────────────────
  const [editingOuting, setEditingOuting] = useState<Outing | null>(null)
  const [editForm, setEditForm] = useState({ title: "", description: "", scheduled_at: "" })
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  // ── Location search ─────────────────────────────────────────
  const [locationQuery, setLocationQuery] = useState("")
  const [locationResults, setLocationResults] = useState<LocationResult[]>([])
  const [selectedLocation, setSelectedLocation] = useState<LocationResult | null>(null)
  const [locationLoading, setLocationLoading] = useState(false)

  // ── Classement tab data ──────────────────────────────────────
  type TopSpot = { id: string; title: string; image_url: string | null; username: string | null; likeCount: number }
  const [monthlyRankingData, setMonthlyRankingData] = useState<RankEntry[]>([])
  const [monthlyRankingLoading, setMonthlyRankingLoading] = useState(false)
  const [topSpots, setTopSpots] = useState<TopSpot[]>([])
  const [topSpotsLoading, setTopSpotsLoading] = useState(false)

  const [userMonthlyRank, setUserMonthlyRank] = useState<{ entry: RankEntry; rank: number } | null>(null)
  const [userTopSpot, setUserTopSpot] = useState<{ spot: TopSpot; rank: number } | null>(null)

  const supabaseRef = useRef(createClient())
  const swipe = useSwipeToClose(onClose, showCreateOuting || !!editingOuting)
  const followingIdsRef = useRef(followingIds)
  followingIdsRef.current = followingIds
  const currentUserRef = useRef(currentUser)
  currentUserRef.current = currentUser
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const locationDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ─── Loaders ────────────────────────────────────────────────

  const loadFollowing = useCallback(
    async (customIds?: string[]) => {
      const ids = customIds ?? followingIdsRef.current
      if (!currentUser || ids.length === 0) { setFollowing([]); return }
      // Afficher immédiatement depuis le cache localStorage
      try {
        const cached = localStorage.getItem(`following_${currentUser.id}`)
        if (cached) setFollowing(JSON.parse(cached))
      } catch { /* ignore */ }
      // Puis charger les données fraîches
      try {
        const { data } = await supabaseRef.current
          .from("profiles")
          .select("id, username, avatar_url, last_lat, last_lng, last_active_at, is_ghost_mode")
          .in("id", ids)
        const profiles = (data as Profile[]) ?? []
        setFollowing(profiles)
        localStorage.setItem(`following_${currentUser.id}`, JSON.stringify(profiles))
      } catch { /* ignore */ }
    },
    [currentUser] // followingIds retiré — on utilise followingIdsRef pour éviter les re-renders en boucle
  )

  const loadSentRequests = useCallback(async () => {
    if (!currentUser) return
    try {
      const { data } = await supabaseRef.current
        .from("friend_requests").select("to_id, profiles!friend_requests_to_id_fkey(username, avatar_url)")
        .eq("from_id", currentUser.id).eq("status", "pending")
      if (data) {
        // FK join may fail if to_id references auth.users — fetch profiles separately
        const ids = data.map((r: { to_id: string }) => r.to_id)
        const { data: profiles } = await supabaseRef.current.from("profiles").select("id, username, avatar_url").in("id", ids)
        const profileMap = Object.fromEntries((profiles ?? []).map((p: { id: string; username: string | null; avatar_url: string | null }) => [p.id, p]))
        setPendingSent(ids.map((id: string) => ({ id, username: profileMap[id]?.username ?? null, avatar_url: profileMap[id]?.avatar_url ?? null })))
      }
    } catch {}
  }, [currentUser])

  const loadIncomingRequests = useCallback(async () => {
    if (!currentUser) return
    try {
      const { data } = await supabaseRef.current
        .from("friend_requests")
        .select("id, from_id, to_id, status, profiles!friend_requests_from_id_fkey(username, avatar_url)")
        .eq("to_id", currentUser.id).eq("status", "pending")
      if (data) setIncomingRequests(data as unknown as FriendRequest[])
    } catch {}
  }, [currentUser])

  const loadSuggestions = useCallback(async () => {
    const ids = followingIdsRef.current
    if (!currentUser || ids.length === 0) {
      setSuggestions([])
      setSuggestionsLoading(false)
      return
    }
    setSuggestionsLoading(true)
    try {
      const excludeIds = [currentUser.id, ...ids]
      const { data } = await supabaseRef.current
        .from("followers").select("following_id")
        .in("follower_id", ids)
        .not("following_id", "in", `(${excludeIds.join(",")})`)
        .limit(60)

      if (data && data.length > 0) {
        const counts: Record<string, number> = {}
        data.forEach((r: { following_id: string }) => {
          counts[r.following_id] = (counts[r.following_id] || 0) + 1
        })
        const sortedIds = Object.entries(counts)
          .sort(([, a], [, b]) => b - a).slice(0, 10).map(([id]) => id)
        const { data: profiles } = await supabaseRef.current
          .from("profiles")
          .select("id, username, avatar_url, last_active_at, is_ghost_mode")
          .in("id", sortedIds)
        if (profiles && profiles.length > 0) {
          const enriched: SuggestionProfile[] = (profiles as Profile[]).map(p => ({
            ...p, mutualCount: counts[p.id] || 0,
          })).sort((a, b) => (b.mutualCount ?? 0) - (a.mutualCount ?? 0))
          setSuggestions(enriched)
        } else {
          setSuggestions([])
        }
      } else {
        setSuggestions([])
      }
    } catch {}
    setSuggestionsLoading(false)
  }, [currentUser]) // followingIds retiré — on utilise followingIdsRef

  const loadOutings = useCallback(async () => {
    if (!currentUser) return
    const cacheKey = `friendspot_outings_${currentUser.id}`
    try {
      const raw = localStorage.getItem(cacheKey)
      if (raw) {
        const { data: cached, ts } = JSON.parse(raw)
        if (Date.now() - ts < 3 * 60 * 1000 && Array.isArray(cached)) setOutings(cached)
      }
    } catch {}
    try {
      // 1. Sorties créées par moi
      const { data: created } = await supabaseRef.current
        .from("outings")
        .select("id, creator_id, title, description, location_name, spot_id, lat, lng, scheduled_at, status, created_at, outing_invitations(id, invitee_id, status)")
        .eq("creator_id", currentUser.id)
        .eq("status", "active")
        .order("scheduled_at", { ascending: true })

      // 2. Sorties où j'ai accepté (pas créées par moi)
      const { data: accepted } = await supabaseRef.current
        .from("outing_invitations")
        .select("outing_id, outings(id, creator_id, title, description, location_name, spot_id, lat, lng, scheduled_at, status, created_at, outing_invitations(id, invitee_id, status))")
        .eq("invitee_id", currentUser.id)
        .eq("status", "accepted")

      const all: Outing[] = []
      if (created) all.push(...(created as unknown as Outing[]))
      if (accepted) {
        for (const inv of accepted as any[]) {
          const o = inv.outings as Outing
          if (o && o.status !== "cancelled" && !all.find(a => a.id === o.id)) all.push(o)
        }
      }

      // 3. Enrichir les invitations avec les profils des invités
      const inviteeIds = [...new Set(all.flatMap(o => (o.outing_invitations ?? []).map((i: any) => i.invitee_id)))]
      const creatorIds = [...new Set(all.map(o => o.creator_id).filter(Boolean))]
      const allIds = [...new Set([...inviteeIds, ...creatorIds])]
      let profilesMap: Record<string, { username: string | null; avatar_url: string | null }> = {}
      if (allIds.length > 0) {
        const { data: profiles } = await supabaseRef.current
          .from("profiles").select("id, username, avatar_url").in("id", allIds)
        profilesMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]))
      }

      const enriched = all.map(o => ({
        ...o,
        profiles: profilesMap[o.creator_id] ?? null,
        outing_invitations: (o.outing_invitations ?? []).map((i: any) => ({
          ...i,
          profiles: profilesMap[i.invitee_id] ?? null,
        })),
      }))

      enriched.sort((a, b) => {
        if (!a.scheduled_at) return 1
        if (!b.scheduled_at) return -1
        return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
      })
      setOutings(enriched as unknown as Outing[])
      try { localStorage.setItem(cacheKey, JSON.stringify({ data: enriched, ts: Date.now() })) } catch {}
    } catch (e) {
      console.error("loadOutings:", e)
    }
  }, [currentUser])

  const loadOutingInvitations = useCallback(async () => {
    if (!currentUser) return
    try {
      const { data } = await supabaseRef.current
        .from("outing_invitations")
        .select("*, outings(*)")
        .eq("invitee_id", currentUser.id)
        .eq("status", "pending")
      if (!data) return

      const creatorIds = [...new Set(data.map((d: any) => d.outings?.creator_id).filter(Boolean))]
      const outingIds = data.map((d: any) => d.outing_id).filter(Boolean)

      // Profils des créateurs
      let profilesMap: Record<string, { username: string | null; avatar_url: string | null }> = {}
      if (creatorIds.length > 0) {
        const { data: profiles } = await supabaseRef.current
          .from("profiles").select("id, username, avatar_url").in("id", creatorIds)
        profilesMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]))
      }

      // Toutes les invitations pour ces sorties (pour afficher les réponses)
      let allInvitesMap: Record<string, OutingInviteStatus[]> = {}
      if (outingIds.length > 0) {
        const { data: allInvites } = await supabaseRef.current
          .from("outing_invitations")
          .select("id, outing_id, invitee_id, status")
          .in("outing_id", outingIds)
        if (allInvites) {
          const inviteeIds = [...new Set(allInvites.map((i: any) => i.invitee_id))]
          let inviteeProfiles: Record<string, { username: string | null; avatar_url: string | null }> = {}
          if (inviteeIds.length > 0) {
            const { data: iProfiles } = await supabaseRef.current
              .from("profiles").select("id, username, avatar_url").in("id", inviteeIds)
            inviteeProfiles = Object.fromEntries((iProfiles ?? []).map((p: any) => [p.id, p]))
          }
          allInvites.forEach((i: any) => {
            if (!allInvitesMap[i.outing_id]) allInvitesMap[i.outing_id] = []
            allInvitesMap[i.outing_id].push({ ...i, profiles: inviteeProfiles[i.invitee_id] ?? null })
          })
        }
      }

      const enriched = data
        .filter((d: any) => d.outings?.status !== "cancelled")
        .map((d: any) => ({
          ...d,
          outings: d.outings ? {
            ...d.outings,
            profiles: profilesMap[d.outings.creator_id] ?? null,
            allInvitations: allInvitesMap[d.outing_id] ?? [],
          } : null,
        }))
      setOutingInvitations(enriched as unknown as OutingInvitationFull[])
    } catch (e) {
      console.error("loadOutingInvitations:", e)
    }
  }, [currentUser])

  const loadGroupInvitations = useCallback(async () => {
    if (!currentUser) return
    try {
      const { data } = await supabaseRef.current
        .from("spot_group_invitations")
        .select("*, spot_groups(*)")
        .eq("invitee_id", currentUser.id)
        .eq("status", "pending")
      if (!data) return

      const inviterIds = [...new Set(data.map((d: any) => d.inviter_id).filter(Boolean))]
      let profilesMap: Record<string, { username: string | null; avatar_url: string | null }> = {}
      if (inviterIds.length > 0) {
        const { data: profiles } = await supabaseRef.current
          .from("profiles").select("id, username, avatar_url").in("id", inviterIds)
        profilesMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]))
      }

      setGroupInvitations(data.map((d: any) => ({ ...d, inviterProfile: profilesMap[d.inviter_id] ?? null })))
    } catch (e) {
      console.error("loadGroupInvitations:", e)
    }
  }, [currentUser])

  const acceptGroupInvitation = useCallback(async (inv: GroupInvitationEnriched) => {
    if (!currentUser) return
    try {
      await Promise.all([
        supabaseRef.current.from("spot_group_invitations").update({ status: "accepted" }).eq("id", inv.id),
        supabaseRef.current.from("spot_group_members").insert({ group_id: inv.group_id, user_id: currentUser.id }),
      ])
      setGroupInvitations(prev => prev.filter(i => i.id !== inv.id))
      onRefreshGroups?.()
      toast.success(`Tu as rejoint ${inv.spot_groups?.emoji ?? "🏠"} ${inv.spot_groups?.name ?? "le groupe"} !`)
    } catch (e) {
      console.error("acceptGroupInvitation:", e)
      toast.error("Impossible de rejoindre le groupe")
    }
  }, [currentUser, onRefreshGroups])

  const declineGroupInvitation = useCallback(async (inv: GroupInvitationEnriched) => {
    try {
      await supabaseRef.current.from("spot_group_invitations").update({ status: "declined" }).eq("id", inv.id)
      setGroupInvitations(prev => prev.filter(i => i.id !== inv.id))
    } catch (e) {
      console.error("declineGroupInvitation:", e)
    }
  }, [])

  // ─── Location search ────────────────────────────────────────

  const searchLocations = useCallback(async (q: string) => {
    if (q.length < 2) { setLocationResults([]); return }
    setLocationLoading(true)
    const results: LocationResult[] = []
    try {
      const { data: appSpots } = await supabaseRef.current
        .from("spots")
        .select("id, title, lat, lng, profiles(username)")
        .ilike("title", `%${q}%`)
        .limit(5)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      appSpots?.forEach((s: any) => results.push({
        id: `spot-${s.id}`,
        label: s.title,
        sublabel: `Spot · ${s.profiles?.username ?? "?"}`,
        lat: s.lat,
        lng: s.lng,
        isAppSpot: true,
        spotId: s.id,
      }))
    } catch {}
    try {
      const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
      if (token) {
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${token}&limit=5&language=fr`
        )
        const geo = await res.json()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        geo.features?.forEach((f: any) => results.push({
          id: f.id,
          label: f.text,
          sublabel: f.place_name,
          lat: f.center[1],
          lng: f.center[0],
        }))
      }
    } catch {}
    setLocationResults(results)
    setLocationLoading(false)
  }, [])

  // ─── Monthly ranking ─────────────────────────────────────────

  // ─── Effect: fetch classement data when tab opens ────────────

  useEffect(() => {
    if (activeTab !== "classement" || !isOpen) return
    const ids = followingIdsRef.current
    const me = currentUserRef.current
    const allIds = me ? [...ids, me.id] : ids
    if (allIds.length === 0) {
      setMonthlyRankingData([])
      setUserMonthlyRank(null)
      setTopSpots([])
      setUserTopSpot(null)
      setMonthlyRankingLoading(false)
      setTopSpotsLoading(false)
      return
    }

    // ── Cache stale-while-revalidate ─────────────────────────
    const cacheKey = me ? `friendspot_classement_${me.id}` : null
    let hasCachedRanking = false
    let hasCachedSpots = false
    if (cacheKey) {
      try {
        const raw = localStorage.getItem(cacheKey)
        if (raw) {
          const { ranking, spots: cachedSpots, userRank, userSpot, ts } = JSON.parse(raw)
          // Cache valide 5 min — afficher immédiatement, rafraîchir en arrière-plan
          if (Date.now() - ts < 5 * 60 * 1000) {
            if (ranking?.length) { setMonthlyRankingData(ranking); hasCachedRanking = true }
            if (cachedSpots?.length) { setTopSpots(cachedSpots); hasCachedSpots = true }
            if (userRank !== undefined) setUserMonthlyRank(userRank)
            if (userSpot !== undefined) setUserTopSpot(userSpot)
          }
        }
      } catch {}
    }

    // ── Classement du mois ────────────────────────────────────
    // Montrer le spinner uniquement s'il n'y a pas de données en cache
    if (!hasCachedRanking) setMonthlyRankingLoading(true)
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    supabaseRef.current
      .from("spots")
      .select("user_id, profiles(id, username, avatar_url)")
      .in("user_id", allIds)
      .gte("created_at", startOfMonth)
      .then(({ data: spotsData }) => {
        const counts: Record<string, { username: string | null; avatar_url: string | null; count: number }> = {}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(spotsData ?? []).forEach((s: any) => {
          const profile = Array.isArray(s.profiles) ? s.profiles[0] : s.profiles
          if (!counts[s.user_id]) {
            counts[s.user_id] = { username: profile?.username ?? null, avatar_url: profile?.avatar_url ?? null, count: 0 }
          }
          counts[s.user_id].count++
        })
        const sorted = Object.entries(counts)
          .map(([userId, v]) => ({ userId, ...v }))
          .sort((a, b) => b.count - a.count)
        setMonthlyRankingData(sorted.slice(0, 6))
        const top6 = sorted.slice(0, 6)
        const userRank = me ? (sorted.findIndex(e => e.userId === me.id) >= 6 ? { entry: sorted[sorted.findIndex(e => e.userId === me.id)], rank: sorted.findIndex(e => e.userId === me.id) + 1 } : null) : null
        setMonthlyRankingData(top6)
        setUserMonthlyRank(userRank)
        setMonthlyRankingLoading(false)
        // Persist for next open
        if (cacheKey) {
          try {
            const existing = localStorage.getItem(cacheKey)
            const prev = existing ? JSON.parse(existing) : {}
            localStorage.setItem(cacheKey, JSON.stringify({ ...prev, ranking: top6, userRank, ts: Date.now() }))
          } catch {}
        }
      })
      .then(undefined, () => { setMonthlyRankingData([]); setUserMonthlyRank(null); setMonthlyRankingLoading(false) })

    // ── Spots les plus aimés ──────────────────────────────────
    if (!hasCachedSpots) setTopSpotsLoading(true)
    supabaseRef.current
      .from("spots")
      .select("id, title, image_url, user_id, profiles(username)")
      .in("user_id", allIds)
      .then(async ({ data: allSpots }) => {
        if (!allSpots || allSpots.length === 0) { setTopSpots([]); setUserTopSpot(null); setTopSpotsLoading(false); return }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const spotIds = (allSpots as any[]).map((s: any) => s.id)
        const { data: reactions } = await supabaseRef.current
          .from("spot_reactions")
          .select("spot_id")
          .eq("type", "love")
          .in("spot_id", spotIds)
        const counts: Record<string, number> = {}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(reactions ?? []).forEach((r: any) => { counts[r.spot_id] = (counts[r.spot_id] ?? 0) + 1 })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sorted = (allSpots as any[])
          .filter((s: any) => counts[s.id] > 0)
          .sort((a: any, b: any) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const toTopSpot = (s: any, rank?: number): TopSpot => {
          const profile = Array.isArray(s.profiles) ? s.profiles[0] : s.profiles
          const firstImg = s.image_url ? s.image_url.split(",")[0].trim() : null
          return { id: s.id, title: s.title ?? "?", image_url: firstImg, username: profile?.username ?? null, likeCount: counts[s.id] ?? 0, ...(rank !== undefined ? { _rank: rank } : {}) }
        }
        const top3 = sorted.slice(0, 3).map((s: any) => toTopSpot(s))
        const userSpot = me ? (sorted.findIndex((s: any) => s.user_id === me.id) >= 3 ? { spot: toTopSpot(sorted[sorted.findIndex((s: any) => s.user_id === me.id)]), rank: sorted.findIndex((s: any) => s.user_id === me.id) + 1 } : null) : null
        setTopSpots(top3)
        setUserTopSpot(userSpot)
        setTopSpotsLoading(false)
        // Persist for next open
        if (cacheKey) {
          try {
            const existing = localStorage.getItem(cacheKey)
            const prev = existing ? JSON.parse(existing) : {}
            localStorage.setItem(cacheKey, JSON.stringify({ ...prev, spots: top3, userSpot, ts: Date.now() }))
          } catch {}
        }
      })
      .then(undefined, () => { setTopSpots([]); setUserTopSpot(null); setTopSpotsLoading(false) })
  }, [activeTab, isOpen])

  // ─── Effect: load on open ────────────────────────────────────

  useEffect(() => {
    if (!isOpen || !currentUser) return
    onRefreshFollowing?.()
    loadFollowing()
    loadSentRequests()
    loadIncomingRequests()
    loadSuggestions()
    loadOutings()
    loadOutingInvitations()
    loadGroupInvitations()

    const channel = supabaseRef.current
      .channel(`friends-modal-${currentUser.id}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "friend_requests",
        filter: `to_id=eq.${currentUser.id}`,
      }, () => loadIncomingRequests())
      .on("postgres_changes", {
        event: "*", schema: "public", table: "friend_requests",
        filter: `from_id=eq.${currentUser.id}`,
      }, () => loadSentRequests())
      // 🔔 Notification en temps réel pour les invitations de sortie
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "outing_invitations",
        filter: `invitee_id=eq.${currentUser.id}`,
      }, () => {
        loadOutingInvitations()
        loadOutings()
      })
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "outing_invitations",
        filter: `invitee_id=eq.${currentUser.id}`,
      }, () => {
        loadOutingInvitations()
        loadOutings()
      })
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "spot_group_invitations",
        filter: `invitee_id=eq.${currentUser.id}`,
      }, () => loadGroupInvitations())
      // Sortie annulée ou modifiée par l'organisateur
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "outings",
      }, (payload) => {
        const updated = payload.new as { id: string; status: string }
        if (updated.status === "cancelled") {
          setOutings(prev => prev.filter(o => o.id !== updated.id))
          setOutingInvitations(prev => prev.filter(i => i.outings?.id !== updated.id))
        } else {
          loadOutings()
        }
      })
      .subscribe()

    return () => { supabaseRef.current.removeChannel(channel) }
  }, [
    isOpen, currentUser,
    loadFollowing, loadSentRequests, loadIncomingRequests,
    loadSuggestions, loadOutings, loadOutingInvitations, loadGroupInvitations, onRefreshFollowing,
  ])

  // ─── Search ──────────────────────────────────────────────────

  const searchUsers = useCallback(async (q: string) => {
    if (q.length < 2) { setSearchResults([]); return }
    setSearchLoading(true)
    try {
      const { data } = await supabaseRef.current
        .from("profiles")
        .select("id, username, avatar_url, last_active_at, is_ghost_mode")
        .ilike("username", `%${q}%`).neq("id", currentUser?.id ?? "").limit(8)
      setSearchResults((data as Profile[]) ?? [])
    } catch { setSearchResults([]) }
    setSearchLoading(false)
  }, [currentUser])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => searchUsers(query), 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, searchUsers])

  // ─── Friend actions ──────────────────────────────────────────

  const sendRequest = async (targetId: string) => {
    if (!currentUser) return
    setLoadingId(targetId)
    try {
      await supabaseRef.current.from("friend_requests").delete()
        .or(`status.eq.accepted,status.eq.declined`)
        .eq("from_id", currentUser.id).eq("to_id", targetId)
      await supabaseRef.current.from("friend_requests").delete()
        .or(`status.eq.accepted,status.eq.declined`)
        .eq("from_id", targetId).eq("to_id", currentUser.id)
      const { error } = await supabaseRef.current.from("friend_requests")
        .insert({ from_id: currentUser.id, to_id: targetId, status: "pending" })
      if (error) console.error("sendRequest:", error.message)
      const { data: prof } = await supabaseRef.current.from("profiles").select("username, avatar_url").eq("id", targetId).single()
      setPendingSent(prev => [...prev, { id: targetId, username: prof?.username ?? null, avatar_url: prof?.avatar_url ?? null }])
    } catch (e) { console.error(e) }
    setLoadingId(null)
  }

  const cancelRequest = async (targetId: string) => {
    if (!currentUser) return
    setLoadingId(targetId)
    try {
      await supabaseRef.current.from("friend_requests").delete()
        .eq("from_id", currentUser.id).eq("to_id", targetId)
      setPendingSent(prev => prev.filter(p => p.id !== targetId))
    } catch {}
    setLoadingId(null)
  }

  const acceptRequest = async (req: FriendRequest) => {
    if (!currentUser) return
    setLoadingId(req.from_id)
    try {
      const { error: rpcError } = await supabaseRef.current.rpc(
        "accept_friend_request", { request_id: req.id }
      )
      if (rpcError) {
        const { error: updErr } = await supabaseRef.current.from("friend_requests")
          .update({ status: "accepted" }).eq("id", req.id)
        if (updErr) throw new Error(updErr.message)
        const { error: follErr } = await supabaseRef.current.from("followers").upsert([
          { follower_id: currentUser.id, following_id: req.from_id },
          { follower_id: req.from_id, following_id: currentUser.id },
        ])
        if (follErr) throw new Error(follErr.message)
      }
      const newIds = [...new Set([...followingIds, req.from_id])]
      onFollowingChange(newIds)
      setIncomingRequests(prev => prev.filter(r => r.id !== req.id))
      await loadFollowing(newIds)
    } catch (e) { console.error("acceptRequest:", e) }
    setLoadingId(null)
  }

  const declineRequest = async (req: FriendRequest) => {
    if (!currentUser) return
    setLoadingId(req.from_id)
    try {
      await supabaseRef.current.from("friend_requests")
        .update({ status: "declined" }).eq("id", req.id)
      setIncomingRequests(prev => prev.filter(r => r.id !== req.id))
    } catch {}
    setLoadingId(null)
  }

  const unfollow = async (targetId: string) => {
    if (!currentUser) return
    setLoadingId(targetId)
    try {
      await supabaseRef.current.from("followers").delete()
        .eq("follower_id", currentUser.id).eq("following_id", targetId)
      const newIds = followingIds.filter(id => id !== targetId)
      onFollowingChange(newIds)
      setFollowing(prev => prev.filter(p => p.id !== targetId))
    } catch {}
    setLoadingId(null)
  }

  // ─── Outing actions ──────────────────────────────────────────

  const cancelOuting = async (outingId: string) => {
    openConfirm({
      title: "Annuler la sortie ?",
      message: "Les participants seront informés.",
      confirmLabel: "Annuler la sortie",
      danger: true,
      onConfirm: async () => {
        setCancellingId(outingId)
        try {
          await supabaseRef.current.from("outings").update({ status: "cancelled" }).eq("id", outingId)
          setOutings(prev => prev.filter(o => o.id !== outingId))
        } catch { /* ignore */ }
        setCancellingId(null)
      },
    })
  }

  const withdrawOuting = async (outingId: string) => {
    if (!currentUser) return
    openConfirm({
      title: "Se désister ?",
      message: "Tu seras retiré(e) de cette sortie.",
      confirmLabel: "Se désister",
      danger: true,
      onConfirm: async () => {
        try {
          await supabaseRef.current.from("outing_invitations")
            .update({ status: "declined", responded_at: new Date().toISOString() })
            .eq("outing_id", outingId)
            .eq("invitee_id", currentUser.id)
          setOutings(prev => prev.filter(o => o.id !== outingId))
        } catch { /* ignore */ }
      },
    })
  }

  const updateOuting = async () => {
    if (!editingOuting) return
    setSaving(true)
    setEditError(null)
    try {
      const { error } = await supabaseRef.current
        .from("outings")
        .update({
          title: editForm.title.trim() || editingOuting.title,
          description: editForm.description.trim() || null,
          scheduled_at: editForm.scheduled_at || null,
        })
        .eq("id", editingOuting.id)
      if (error) throw error
      setOutings(prev => prev.map(o => o.id === editingOuting.id
        ? { ...o, title: editForm.title.trim() || o.title, description: editForm.description.trim() || null, scheduled_at: editForm.scheduled_at || null }
        : o
      ))
      setEditingOuting(null)
    } catch { setEditError("Erreur lors de la modification.") }
    setSaving(false)
  }

  const createOuting = async () => {
    if (!currentUser) return
    setCreateError(null)
    if (selectedFriendIds.length === 0) { toast.error("Sélectionne au moins 1 ami"); return }
    const title = createForm.title.trim() || selectedLocation?.label || "Sortie"
    setCreating(true)
    try {
      const { data: outing, error } = await supabaseRef.current
        .from("outings")
        .insert({
          creator_id: currentUser.id,
          title,
          description: createForm.description.trim() || null,
          location_name: selectedLocation?.label ?? null,
          lat: selectedLocation?.lat ?? null,
          lng: selectedLocation?.lng ?? null,
          spot_id: selectedLocation?.spotId ?? null,
          scheduled_at: createForm.scheduled_at || null,
          status: "active",
        })
        .select().single()
      if (error) throw error

      const { error: invErr } = await supabaseRef.current
        .from("outing_invitations")
        .insert(selectedFriendIds.map(id => ({
          outing_id: outing.id, invitee_id: id, status: "pending",
        })))
      if (invErr) throw invErr

      toast.success("Sortie proposée !")
      setShowCreateOuting(false)
      setCreateForm({ title: "", description: "", scheduled_at: "" })
      setSelectedFriendIds([])
      setSelectedLocation(null)
      setLocationQuery("")
      setLocationResults([])
      loadOutings()
    } catch (e: any) {
      const msg = (e as any)?.message ?? ""
      toast.error(msg.includes("relation") || msg.includes("does not exist")
        ? "La table sorties n'existe pas encore. Lance la migration SQL."
        : `Erreur : ${msg || "Réessaie."}`)
      console.error("createOuting:", e)
    }
    setCreating(false)
  }

  const respondToOuting = async (invitationId: string, status: "accepted" | "declined") => {
    try {
      await supabaseRef.current.from("outing_invitations")
        .update({ status, responded_at: new Date().toISOString() })
        .eq("id", invitationId)
      setOutingInvitations(prev => prev.filter(i => i.id !== invitationId))
      if (status === "accepted") loadOutings()
    } catch (e) { console.error("respondToOuting:", e) }
  }

  // ─── Helpers ─────────────────────────────────────────────────

  const initials = (username: string | null) =>
    username ? username.charAt(0).toUpperCase() : "?"

  const isFollowingUser = (id: string) => followingIds.includes(id)
  const isPending = (id: string) => pendingSent.some(p => p.id === id)

  const sortedFollowing = useMemo(() => [...following].sort((a, b) => {
    const aOn = isOnline(a.last_active_at, a.is_ghost_mode) ? 1 : 0
    const bOn = isOnline(b.last_active_at, b.is_ghost_mode) ? 1 : 0
    return bOn - aOn
  }), [following])

  const onlineCount = useMemo(
    () => following.filter(f => isOnline(f.last_active_at, f.is_ghost_mode)).length,
    [following]
  )

  const toggleFriendSelection = (id: string) =>
    setSelectedFriendIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )

  // Total badge for Invitations tab
  const totalInvitations = incomingRequests.length + outingInvitations.length

  // Reset seen state when new invitations arrive
  const prevTotalRef = useRef(0)
  useEffect(() => {
    if (totalInvitations > prevTotalRef.current) setInvitationsSeen(false)
    prevTotalRef.current = totalInvitations
  }, [totalInvitations])

  // Upcoming + past outings split
  const upcomingOutings = outings.filter(o => !isOutingPast(o.scheduled_at) || !o.scheduled_at)
  const pastOutings = outings.filter(o => isOutingPast(o.scheduled_at))

  const minDateTime = new Date(Date.now() + 5 * 60000).toISOString().slice(0, 16)

  if (!isOpen) return null

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "amis", label: "Amis", icon: <UserCheck size={12} /> },
    { id: "classement", label: "Classement", icon: <Trophy size={12} /> },
    { id: "invitations", label: "Invitations", icon: <Bell size={12} /> },
  ]

  return (
    <>
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] sm:bg-black/25"
          />

          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, y: 60 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 60 }}
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
            className="fixed inset-x-0 bottom-0 z-50 sm:inset-auto sm:top-0 sm:right-0 sm:bottom-0 sm:w-[360px]"
            drag={showCreateOuting ? false : "y"}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.04, bottom: 0.35 }}
            dragMomentum={false}
            onDragEnd={(_e, { offset, velocity }) => {
              if (offset.y > 110 || velocity.y > 380) onClose()
            }}
          >
            <div className="relative flex h-[92vh] flex-col overflow-hidden
              rounded-t-[2rem] border border-gray-200/80 dark:border-white/[0.06]
              bg-white dark:bg-[#0e0e12] shadow-2xl
              sm:h-full sm:rounded-none sm:rounded-l-2xl
              sm:border-l sm:border-y-0 sm:border-r-0
              sm:shadow-[-12px_0_48px_rgba(0,0,0,0.15)] dark:sm:shadow-[-12px_0_48px_rgba(0,0,0,0.4)]"
            >
              {/* Drag handle */}
              <div className="mx-auto mt-3.5 mb-0 h-1 w-10 flex-shrink-0 rounded-full bg-gray-200 dark:bg-zinc-800 sm:hidden" />

              {/* ── Header ──────────────────────────────────────── */}
              <div className="flex flex-shrink-0 items-center justify-between px-5 pt-4 pb-3 sm:pt-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/10 dark:bg-indigo-500/15">
                    <Users size={16} className="text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <div>
                    <h2 className="text-[15px] font-bold tracking-tight text-gray-900 dark:text-white">
                      Réseau
                    </h2>
                    <p className="flex items-center gap-2 text-[11px] text-gray-400 dark:text-zinc-600">
                      <span>{followingIds.length} ami{followingIds.length !== 1 ? "s" : ""}</span>
                      {onlineCount > 0 && (
                        <span className="flex items-center gap-1 text-green-500 dark:text-green-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-current" />
                          {onlineCount} en ligne
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="flex h-8 w-8 items-center justify-center rounded-xl text-gray-400 dark:text-zinc-600 transition-all hover:bg-gray-100 dark:hover:bg-white/8 hover:text-gray-700 dark:hover:text-white"
                >
                  <X size={15} />
                </button>
              </div>

              {/* ── Tabs ────────────────────────────────────────── */}
              <div className="flex-shrink-0 px-4 pb-3">
                <div className="flex gap-0.5 rounded-xl bg-gray-100/80 dark:bg-zinc-900/80 p-1">
                  {tabs.map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => { setActiveTab(tab.id as Tab); setQuery(""); if (tab.id === "invitations") setInvitationsSeen(true) }}
                      className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-[11px] font-semibold transition-all duration-200 ${
                        activeTab === tab.id
                          ? "bg-white dark:bg-zinc-800 text-gray-900 dark:text-white shadow-sm ring-1 ring-black/[0.06] dark:ring-white/[0.08]"
                          : "text-gray-500 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300"
                      }`}
                    >
                      {tab.icon}
                      {tab.label}
                      {tab.id === "invitations" && totalInvitations > 0 && !invitationsSeen && (
                        <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white leading-none">
                          {totalInvitations}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Search bar ──────────────────────────────────── */}
              {activeTab === "amis" && (
                <div className="flex-shrink-0 px-4 pb-3">
                  <div className="relative">
                    <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-400 dark:text-zinc-600" />
                    <input
                      type="text"
                      placeholder="Rechercher un utilisateur…"
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 dark:border-white/[0.07] bg-gray-50 dark:bg-zinc-900 py-2.5 pr-4 pl-9 text-[16px] text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-zinc-600 outline-none transition-all focus:border-indigo-400/60 focus:ring-2 focus:ring-indigo-500/15 sm:text-sm"
                    />
                    {searchLoading && (
                      <LoaderCircle size={14} className="absolute top-1/2 right-3 -translate-y-1/2 animate-spin text-indigo-400" />
                    )}
                  </div>
                </div>
              )}

              {/* ── Scrollable content ──────────────────────────── */}
              <div ref={swipe.ref} onTouchStart={swipe.onTouchStart} onTouchEnd={swipe.onTouchEnd} className="flex-1 overflow-y-auto px-4">

                {/* ════ AMIS ════════════════════════════════════ */}
                {activeTab === "amis" && (
                  <div className="space-y-5">

                    {/* CTA Proposer une sortie */}
                    <button
                      onClick={() => setShowCreateOuting(true)}
                      className="group w-full flex items-center gap-3 rounded-xl border-2 border-dashed border-indigo-300/60 dark:border-indigo-500/25 bg-indigo-50/50 dark:bg-indigo-500/[0.04] px-4 py-3 text-left transition-all hover:border-indigo-400/80 dark:hover:border-indigo-500/50 hover:bg-indigo-50 dark:hover:bg-indigo-500/[0.08] active:scale-[0.99]"
                    >
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 dark:bg-indigo-500/15 transition-colors group-hover:bg-indigo-500/20">
                        <CalendarPlus size={16} className="text-indigo-600 dark:text-indigo-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-indigo-700 dark:text-indigo-300">
                          Proposer une sortie
                        </p>
                        <p className="text-[11px] text-indigo-500/70 dark:text-indigo-400/60">
                          Invite tes amis à un spot ou un endroit
                        </p>
                      </div>
                      <ChevronRight size={14} className="text-indigo-400 dark:text-indigo-600 flex-shrink-0" />
                    </button>

                    {/* Sortie à venir — uniquement la plus proche */}
                    {upcomingOutings.length > 0 && query.length < 2 && (
                      <Section
                        title="Sortie à venir"
                        icon={<CalendarCheck size={10} />}
                        badge={upcomingOutings.length > 1 ? (
                          <span className="rounded-full bg-green-500/10 dark:bg-green-500/15 px-2 py-0.5 text-[10px] font-semibold text-green-600 dark:text-green-400">
                            +{upcomingOutings.length - 1} autres
                          </span>
                        ) : undefined}
                      >
                        <FeaturedOutingCard
                          outing={upcomingOutings[0]}
                          currentUserId={currentUser?.id ?? ""}
                          spots={spots}
                          onCancel={cancelOuting}
                          onLocate={onLocateOuting}
                        />
                      </Section>
                    )}

                    {/* Sorties passées (collapsed by default) */}
                    {pastOutings.length > 0 && query.length < 2 && (
                      <Section title="Sorties passées" icon={<Clock size={10} />}>
                        {pastOutings.map(outing => (
                          <OutingCard
                            key={outing.id}
                            outing={outing}
                            currentUserId={currentUser?.id ?? ""}
                            onCancel={cancelOuting}
                            past
                          />
                        ))}
                      </Section>
                    )}

                    {/* Search results */}
                    {query.length >= 2 ? (
                      <Section title="Résultats" icon={<Search size={10} />}>
                        {searchResults.length === 0 && !searchLoading ? (
                          <EmptyState icon={<Search size={22} />} text="Aucun utilisateur trouvé" />
                        ) : (
                          searchResults.map(profile => (
                            <UserRow
                              key={profile.id}
                              profile={profile}
                              initials={initials(profile.username)}
                              isFollowing={isFollowingUser(profile.id)}
                              isPending={isPending(profile.id)}
                              loading={loadingId === profile.id}
                              onSendRequest={() => sendRequest(profile.id)}
                              onCancelRequest={() => cancelRequest(profile.id)}
                              onUnfollow={() => unfollow(profile.id)}
                              onSelectUser={() => { onSelectUser?.(profile.id); onClose() }}
                              onLocate={profile.last_lat && profile.last_lng
                                ? () => { onLocateFriend?.(profile.last_lat!, profile.last_lng!); onClose() }
                                : undefined}
                            />
                          ))
                        )}
                      </Section>
                    ) : sortedFollowing.length === 0 ? (
                      <EmptyState
                        icon={<Users size={24} />}
                        text="Aucun ami pour l'instant"
                        sub="Trouve des gens à suivre dans l'onglet Classement !"
                      />
                    ) : (
                      <>
                        {onlineCount > 0 && (
                          <Section title="En ligne" icon={<span className="h-1.5 w-1.5 rounded-full bg-green-500" />}>
                            {sortedFollowing
                              .filter(f => isOnline(f.last_active_at, f.is_ghost_mode))
                              .map(profile => (
                                <UserRow
                                  key={profile.id} profile={profile}
                                  initials={initials(profile.username)}
                                  isFollowing isPending={false}
                                  loading={loadingId === profile.id}
                                  onSendRequest={() => sendRequest(profile.id)}
                                  onCancelRequest={() => cancelRequest(profile.id)}
                                  onUnfollow={() => unfollow(profile.id)}
                                  onSelectUser={() => { onSelectUser?.(profile.id); onClose() }}
                                  onLocate={profile.last_lat && profile.last_lng
                                    ? () => { onLocateFriend?.(profile.last_lat!, profile.last_lng!); onClose() }
                                    : undefined}
                                />
                              ))}
                          </Section>
                        )}
                        <Section
                          title={onlineCount > 0 ? "Hors ligne" : `Tous les amis (${following.length})`}
                          icon={<Clock size={10} />}
                        >
                          {sortedFollowing
                            .filter(f => !isOnline(f.last_active_at, f.is_ghost_mode))
                            .map(profile => (
                              <UserRow
                                key={profile.id} profile={profile}
                                initials={initials(profile.username)}
                                isFollowing isPending={false}
                                loading={loadingId === profile.id}
                                onSendRequest={() => sendRequest(profile.id)}
                                onCancelRequest={() => cancelRequest(profile.id)}
                                onUnfollow={() => unfollow(profile.id)}
                                onSelectUser={() => { onSelectUser?.(profile.id); onClose() }}
                                onLocate={profile.last_lat && profile.last_lng
                                  ? () => { onLocateFriend?.(profile.last_lat!, profile.last_lng!); onClose() }
                                  : undefined}
                              />
                            ))}
                        </Section>
                      </>
                    )}
                  </div>
                )}

                {/* ════ CLASSEMENT ══════════════════════════════ */}
                {activeTab === "classement" && (
                  <div className="space-y-8 pb-2">

                    {/* ── Classement mensuel ─────────────────────── */}
                    <div>
                      {/* Header */}
                      <div className="flex items-center justify-between mb-5">
                        <div>
                          <p className="text-[16px] font-bold text-gray-900 dark:text-white">Classement du mois</p>
                          <p className="mt-0.5 text-[11px] text-gray-400 dark:text-zinc-500 capitalize">
                            {new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}
                          </p>
                        </div>
                        <span className="flex items-center gap-1.5 rounded-full bg-amber-50 dark:bg-amber-500/10 border border-amber-200/50 dark:border-amber-500/20 px-2.5 py-1 text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wide">
                          <Trophy size={10} />
                          Spots ajoutés
                        </span>
                      </div>

                      {monthlyRankingLoading ? (
                        <div className="flex justify-center py-6">
                          <LoaderCircle size={20} className="animate-spin text-gray-300 dark:text-zinc-700" />
                        </div>
                      ) : monthlyRankingData.length === 0 ? (
                        <EmptyState
                          icon={<Trophy size={24} />}
                          text="Aucun classement ce mois-ci"
                          sub="Le classement apparaît quand tes amis ajoutent des spots !"
                        />
                      ) : (
                        <>
                          {/* Podium — top 3 */}
                          <div className="flex items-end justify-center gap-2 mb-5">

                            {/* #2 */}
                            <div
                              onClick={() => monthlyRankingData[1] && onSelectUser?.(monthlyRankingData[1].userId)}
                              className="flex flex-1 flex-col items-center gap-2 min-w-0 cursor-pointer hover:opacity-75 transition-opacity active:scale-95"
                            >
                              {monthlyRankingData[1] ? (
                                <>
                                  <div className="relative">
                                    <div className="h-12 w-12 overflow-hidden rounded-full ring-2 ring-gray-300 dark:ring-zinc-600 shadow-sm">
                                      {monthlyRankingData[1].avatar_url
                                        // eslint-disable-next-line @next/next/no-img-element
                                        ? <img src={monthlyRankingData[1].avatar_url} alt="" className="h-full w-full object-cover" />
                                        : <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-slate-400 to-slate-500 text-sm font-bold text-white">{monthlyRankingData[1].username?.[0]?.toUpperCase() ?? "?"}</div>
                                      }
                                    </div>
                                    <span className="absolute -top-1 -right-1 text-[15px] leading-none">🥈</span>
                                  </div>
                                  <div className="flex items-center justify-center gap-1">
                                    <p className="text-center text-[11px] font-semibold text-gray-600 dark:text-zinc-400 truncate max-w-[56px] px-1">@{monthlyRankingData[1].username ?? "?"}</p>
                                    {monthlyRankingData[1].userId === currentUser?.id && <span className="rounded-full bg-indigo-500/15 px-1 py-px text-[8px] font-bold text-indigo-600 dark:text-indigo-400 leading-tight">vous</span>}
                                  </div>
                                  <div className={`w-full rounded-t-xl flex flex-col items-center justify-center ${monthlyRankingData[1].userId === currentUser?.id ? "bg-indigo-50 dark:bg-indigo-500/[0.08] border-t-2 border-indigo-300/40 dark:border-indigo-500/20" : "bg-gray-100 dark:bg-zinc-800"}`} style={{ height: 60 }}>
                                    <span className="text-[20px] font-black text-gray-600 dark:text-zinc-300">{monthlyRankingData[1].count}</span>
                                    <span className="text-[9px] font-medium text-gray-400 dark:text-zinc-600">spots</span>
                                  </div>
                                </>
                              ) : <div style={{ height: 60 }} className="w-full" />}
                            </div>

                            {/* #1 — tallest, center */}
                            <div
                              onClick={() => onSelectUser?.(monthlyRankingData[0].userId)}
                              className="flex flex-1 flex-col items-center gap-2 min-w-0 cursor-pointer hover:opacity-75 transition-opacity active:scale-95"
                            >
                              <div className="relative">
                                <div className={`h-[60px] w-[60px] overflow-hidden rounded-full shadow-lg ring-[3px] ${monthlyRankingData[0].userId === currentUser?.id ? "ring-indigo-400 shadow-indigo-500/25" : "ring-amber-400 shadow-amber-500/20"}`}>
                                  {monthlyRankingData[0].avatar_url
                                    // eslint-disable-next-line @next/next/no-img-element
                                    ? <img src={monthlyRankingData[0].avatar_url} alt="" className="h-full w-full object-cover" />
                                    : <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-amber-400 to-orange-500 text-xl font-black text-white">{monthlyRankingData[0].username?.[0]?.toUpperCase() ?? "?"}</div>
                                  }
                                </div>
                                <span className="absolute -top-2 -right-0.5 text-[18px] leading-none drop-shadow-sm">🥇</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <p className="text-center text-[12px] font-bold text-gray-900 dark:text-white truncate max-w-[72px]">@{monthlyRankingData[0].username ?? "?"}</p>
                                {monthlyRankingData[0].userId === currentUser?.id && (
                                  <span className="rounded-full bg-indigo-500/15 px-1 py-px text-[8px] font-bold text-indigo-600 dark:text-indigo-400 leading-tight">vous</span>
                                )}
                              </div>
                              <div className="w-full rounded-t-xl bg-gradient-to-b from-amber-50 to-amber-100/60 dark:from-amber-500/15 dark:to-amber-500/5 border-t-2 border-amber-300/50 dark:border-amber-500/25 flex flex-col items-center justify-center" style={{ height: 80 }}>
                                <span className="text-[26px] font-black text-amber-500 dark:text-amber-400 leading-tight">{monthlyRankingData[0].count}</span>
                                <span className="text-[9px] font-medium text-amber-500/60 dark:text-amber-500/50">spots</span>
                              </div>
                            </div>

                            {/* #3 */}
                            <div
                              onClick={() => monthlyRankingData[2] && onSelectUser?.(monthlyRankingData[2].userId)}
                              className="flex flex-1 flex-col items-center gap-2 min-w-0 cursor-pointer hover:opacity-75 transition-opacity active:scale-95"
                            >
                              {monthlyRankingData[2] ? (
                                <>
                                  <div className="relative">
                                    <div className="h-10 w-10 overflow-hidden rounded-full ring-2 ring-orange-300 dark:ring-orange-700/50 shadow-sm">
                                      {monthlyRankingData[2].avatar_url
                                        // eslint-disable-next-line @next/next/no-img-element
                                        ? <img src={monthlyRankingData[2].avatar_url} alt="" className="h-full w-full object-cover" />
                                        : <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-orange-400 to-red-400 text-xs font-bold text-white">{monthlyRankingData[2].username?.[0]?.toUpperCase() ?? "?"}</div>
                                      }
                                    </div>
                                    <span className="absolute -top-1 -right-1 text-[13px] leading-none">🥉</span>
                                  </div>
                                  <div className="flex items-center justify-center gap-1">
                                    <p className="text-center text-[11px] font-semibold text-gray-600 dark:text-zinc-400 truncate max-w-[56px] px-1">@{monthlyRankingData[2].username ?? "?"}</p>
                                    {monthlyRankingData[2].userId === currentUser?.id && <span className="rounded-full bg-indigo-500/15 px-1 py-px text-[8px] font-bold text-indigo-600 dark:text-indigo-400 leading-tight">vous</span>}
                                  </div>
                                  <div className={`w-full rounded-t-xl flex flex-col items-center justify-center ${monthlyRankingData[2].userId === currentUser?.id ? "bg-indigo-50 dark:bg-indigo-500/[0.08] border-t-2 border-indigo-300/40 dark:border-indigo-500/20" : "bg-orange-50/80 dark:bg-orange-500/[0.07]"}`} style={{ height: 46 }}>
                                    <span className="text-[17px] font-black text-orange-500 dark:text-orange-400">{monthlyRankingData[2].count}</span>
                                    <span className="text-[9px] font-medium text-orange-400/60">spots</span>
                                  </div>
                                </>
                              ) : <div style={{ height: 46 }} className="w-full" />}
                            </div>
                          </div>
                        </>
                      )}
                    </div>

                    {/* ── Positions 4-5-6 ──────────────────────────── */}
                    {monthlyRankingData.slice(3, 6).length > 0 && (
                      <div className="space-y-1.5">
                        {monthlyRankingData.slice(3, 6).map((entry, i) => {
                          const isMe = entry.userId === currentUser?.id
                          return (
                            <button
                              key={entry.userId}
                              onClick={() => onSelectUser?.(entry.userId)}
                              className={`w-full flex items-center gap-3 rounded-xl px-3 py-2 transition-colors active:scale-[0.99] ${isMe ? "bg-indigo-50 dark:bg-indigo-500/[0.08] ring-1 ring-indigo-200 dark:ring-indigo-500/20" : "bg-gray-50 dark:bg-zinc-800/60 hover:bg-gray-100 dark:hover:bg-zinc-800"}`}
                            >
                              <span className={`w-5 text-center text-[13px] font-bold flex-shrink-0 ${isMe ? "text-indigo-500 dark:text-indigo-400" : "text-gray-400 dark:text-zinc-500"}`}>
                                {i + 4}
                              </span>
                              <div className={`h-8 w-8 flex-shrink-0 overflow-hidden rounded-full ${isMe ? "ring-2 ring-indigo-400" : ""} bg-indigo-100 dark:bg-zinc-700`}>
                                {entry.avatar_url
                                  // eslint-disable-next-line @next/next/no-img-element
                                  ? <img src={entry.avatar_url} alt="" className="h-full w-full object-cover" />
                                  : <div className="h-full w-full flex items-center justify-center text-xs font-bold text-indigo-400">{entry.username?.[0]?.toUpperCase() ?? "?"}</div>
                                }
                              </div>
                              <p className={`min-w-0 flex-1 truncate text-[13px] font-semibold text-left ${isMe ? "text-indigo-600 dark:text-indigo-300" : "text-gray-700 dark:text-zinc-300"}`}>
                                @{entry.username ?? "?"}
                                {isMe && <span className="ml-1.5 rounded-full bg-indigo-500/15 px-1.5 py-px text-[8px] font-bold text-indigo-600 dark:text-indigo-400">vous</span>}
                              </p>
                              <span className={`flex-shrink-0 text-[12px] font-bold ${isMe ? "text-indigo-500 dark:text-indigo-400" : "text-indigo-500 dark:text-indigo-400"}`}>{entry.count} spots</span>
                            </button>
                          )
                        })}
                        {/* Utilisateur hors top 6 */}
                        {userMonthlyRank && (
                          <>
                            <div className="flex items-center gap-2 py-1">
                              <div className="flex-1 h-px bg-dashed border-t border-dashed border-gray-200 dark:border-zinc-700" />
                              <span className="text-[10px] text-gray-300 dark:text-zinc-600">···</span>
                              <div className="flex-1 h-px border-t border-dashed border-gray-200 dark:border-zinc-700" />
                            </div>
                            <button
                              onClick={() => onSelectUser?.(userMonthlyRank.entry.userId)}
                              className="w-full flex items-center gap-3 rounded-xl px-3 py-2 bg-indigo-50 dark:bg-indigo-500/[0.08] ring-1 ring-indigo-200 dark:ring-indigo-500/20 transition-colors active:scale-[0.99]"
                            >
                              <span className="w-5 text-center text-[13px] font-bold text-indigo-500 dark:text-indigo-400 flex-shrink-0">{userMonthlyRank.rank}</span>
                              <div className="h-8 w-8 flex-shrink-0 overflow-hidden rounded-full ring-2 ring-indigo-400 bg-indigo-100 dark:bg-zinc-700">
                                {userMonthlyRank.entry.avatar_url
                                  // eslint-disable-next-line @next/next/no-img-element
                                  ? <img src={userMonthlyRank.entry.avatar_url} alt="" className="h-full w-full object-cover" />
                                  : <div className="h-full w-full flex items-center justify-center text-xs font-bold text-indigo-400">{userMonthlyRank.entry.username?.[0]?.toUpperCase() ?? "?"}</div>
                                }
                              </div>
                              <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-indigo-600 dark:text-indigo-300 text-left">
                                @{userMonthlyRank.entry.username ?? "?"}
                                <span className="ml-1.5 rounded-full bg-indigo-500/15 px-1.5 py-px text-[8px] font-bold text-indigo-600 dark:text-indigo-400">vous</span>
                              </p>
                              <span className="flex-shrink-0 text-[12px] font-bold text-indigo-500 dark:text-indigo-400">{userMonthlyRank.entry.count} spots</span>
                            </button>
                          </>
                        )}
                        {/* Utilisateur pas encore dans le classement */}
                        {!userMonthlyRank && monthlyRankingData.every(e => e.userId !== currentUser?.id) && (
                          <p className="text-center text-[11px] text-gray-400 dark:text-zinc-500 pt-1 pb-0.5">Ajoute des spots ce mois-ci pour apparaître !</p>
                        )}
                      </div>
                    )}

                    {/* Divider */}
                    <div className="h-px bg-gray-100 dark:bg-white/[0.05]" />

                    {/* ── Top spots les plus aimés ────────────────── */}
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <p className="text-[16px] font-bold text-gray-900 dark:text-white">Spots les plus aimés</p>
                          <p className="mt-0.5 text-[11px] text-gray-400 dark:text-zinc-500">Tous les temps · tes amis</p>
                        </div>
                        <Heart size={16} className="fill-red-400 text-red-400" />
                      </div>

                      {topSpotsLoading ? (
                        <div className="flex justify-center py-6">
                          <LoaderCircle size={20} className="animate-spin text-gray-300 dark:text-zinc-700" />
                        </div>
                      ) : topSpots.length === 0 ? (
                        <EmptyState icon={<Heart size={22} />} text="Aucun like pour l'instant" sub="Les spots les plus aimés de tes amis apparaîtront ici" />
                      ) : (
                        <div className="space-y-2.5">
                          {topSpots.map((spot, i) => {
                            const medals = ["🥇", "🥈", "🥉"]
                            const likeColors = [
                              "text-amber-500 dark:text-amber-400",
                              "text-slate-500 dark:text-zinc-400",
                              "text-orange-500 dark:text-orange-400",
                            ]
                            return (
                              <button
                                key={spot.id}
                                onClick={() => onSelectSpot?.(spot.id)}
                                className="w-full flex items-center gap-3.5 rounded-2xl border border-gray-100 dark:border-white/[0.06] bg-white dark:bg-zinc-900/50 p-3 text-left transition-all hover:border-gray-200 dark:hover:border-white/[0.1] hover:shadow-sm active:scale-[0.99]"
                              >
                                <div className="relative flex-shrink-0">
                                  <div className="h-12 w-12 overflow-hidden rounded-xl shadow-sm bg-indigo-100 dark:bg-zinc-700">
                                    {spot.image_url
                                      // eslint-disable-next-line @next/next/no-img-element
                                      ? <img src={spot.image_url} alt="" className="h-full w-full object-cover" />
                                      : <div className="h-full w-full flex items-center justify-center"><MapPin size={18} className="text-indigo-400" /></div>
                                    }
                                  </div>
                                  <span className="absolute -top-1 -right-1 text-[14px] leading-none">{medals[i]}</span>
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-[14px] font-bold text-gray-900 dark:text-white">{spot.title}</p>
                                  <p className="truncate text-[11px] text-gray-400 dark:text-zinc-500">@{spot.username ?? "?"}</p>
                                </div>
                                <div className="flex-shrink-0 flex items-center gap-1.5 rounded-full bg-red-50 dark:bg-red-500/[0.08] border border-red-100 dark:border-red-500/15 px-2.5 py-1.5">
                                  <Heart size={10} className="fill-red-400 text-red-400" />
                                  <span className={`text-[13px] font-bold ${likeColors[i]}`}>{spot.likeCount}</span>
                                </div>
                              </button>
                            )
                          })}
                          {/* Meilleur spot de l'utilisateur hors top 3 */}
                          {userTopSpot && (
                            <>
                              <div className="flex items-center gap-2 py-0.5">
                                <div className="flex-1 border-t border-dashed border-gray-200 dark:border-zinc-700" />
                                <span className="text-[10px] text-gray-300 dark:text-zinc-600">···</span>
                                <div className="flex-1 border-t border-dashed border-gray-200 dark:border-zinc-700" />
                              </div>
                              <button
                                onClick={() => onSelectSpot?.(userTopSpot.spot.id)}
                                className="w-full flex items-center gap-3.5 rounded-2xl border border-indigo-200 dark:border-indigo-500/20 bg-indigo-50 dark:bg-indigo-500/[0.06] p-3 text-left transition-all active:scale-[0.99]"
                              >
                                <div className="relative flex-shrink-0">
                                  <div className="h-12 w-12 overflow-hidden rounded-xl shadow-sm bg-indigo-100 dark:bg-zinc-700 ring-2 ring-indigo-300 dark:ring-indigo-500/30">
                                    {userTopSpot.spot.image_url
                                      // eslint-disable-next-line @next/next/no-img-element
                                      ? <img src={userTopSpot.spot.image_url} alt="" className="h-full w-full object-cover" />
                                      : <div className="h-full w-full flex items-center justify-center"><MapPin size={18} className="text-indigo-400" /></div>
                                    }
                                  </div>
                                  <span className="absolute -top-1 -right-1 text-[12px] font-black text-indigo-500 dark:text-indigo-400 leading-none bg-white dark:bg-zinc-900 rounded-full px-1">#{userTopSpot.rank}</span>
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 mb-0.5">
                                    <p className="truncate text-[14px] font-bold text-indigo-700 dark:text-indigo-300">{userTopSpot.spot.title}</p>
                                    <span className="rounded-full bg-indigo-500/15 px-1.5 py-px text-[8px] font-bold text-indigo-600 dark:text-indigo-400 flex-shrink-0">vous</span>
                                  </div>
                                  <p className="text-[11px] text-indigo-400 dark:text-indigo-500">Ajoute-en d&apos;autres pour monter !</p>
                                </div>
                                <div className="flex-shrink-0 flex items-center gap-1.5 rounded-full bg-red-50 dark:bg-red-500/[0.08] border border-red-100 dark:border-red-500/15 px-2.5 py-1.5">
                                  <Heart size={10} className="fill-red-400 text-red-400" />
                                  <span className="text-[13px] font-bold text-indigo-500 dark:text-indigo-400">{userTopSpot.spot.likeCount}</span>
                                </div>
                              </button>
                            </>
                          )}
                          {/* Utilisateur sans spot liké */}
                          {!userTopSpot && topSpots.every(s => s.username !== userProfile?.username) && (
                            <p className="text-center text-[11px] text-gray-400 dark:text-zinc-500 pt-1">Partage des spots pour apparaître !</p>
                          )}
                        </div>
                      )}
                    </div>

                  </div>
                )}

                {/* ════ INVITATIONS ═════════════════════════════ */}
                {activeTab === "invitations" && (
                  <div className="pb-2 -mx-1">

                    {/* Empty state */}
                    {incomingRequests.length === 0 && outingInvitations.length === 0 && groupInvitations.length === 0 && upcomingOutings.length === 0 && pendingSent.length === 0 && (
                      <div className="flex flex-col items-center gap-4 py-8 px-4">
                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-500/10">
                          <Bell size={24} className="text-indigo-400" />
                        </div>
                        <div className="text-center">
                          <p className="text-sm font-semibold text-gray-700 dark:text-zinc-200">Tout est calme</p>
                          <p className="mt-1 text-xs text-gray-400 dark:text-zinc-500">Aucune invitation en attente</p>
                        </div>
                        {followingIds.length > 0 && (
                          <button
                            onClick={() => setShowCreateOuting(true)}
                            className="flex items-center gap-2 rounded-2xl bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 transition-all active:scale-95"
                          >
                            <CalendarPlus size={15} />
                            Proposer une sortie
                          </button>
                        )}
                      </div>
                    )}

                    {/* 1. Demandes d'amis */}
                    {incomingRequests.length > 0 && (
                      <div>
                        <p className="px-4 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600">
                          Demandes d&apos;amis · {incomingRequests.length}
                        </p>
                        <div className="space-y-1 px-1">
                          {incomingRequests.map(req => (
                            <InvitationRow
                              key={req.id} req={req}
                              loading={loadingId === req.from_id}
                              onAccept={() => acceptRequest(req)}
                              onDecline={() => declineRequest(req)}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 2. Invitations de groupe */}
                    {groupInvitations.length > 0 && (
                      <div>
                        <p className="px-4 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600">
                          Invitations de groupe · {groupInvitations.length}
                        </p>
                        <div className="space-y-1.5 px-1">
                          {groupInvitations.map(inv => (
                            <div key={inv.id} className="flex items-center gap-3 rounded-2xl border border-gray-100 dark:border-white/[0.06] bg-white dark:bg-zinc-900 px-3 py-2.5">
                              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-500/10 text-xl">
                                {inv.spot_groups?.emoji ?? "🏠"}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[13px] font-semibold text-gray-800 dark:text-zinc-100">
                                  {inv.spot_groups?.name ?? "Groupe"}
                                </p>
                                <p className="truncate text-[11px] text-gray-400 dark:text-zinc-500">
                                  Invité par @{inv.inviterProfile?.username ?? "quelqu'un"}
                                </p>
                              </div>
                              <div className="flex gap-1.5 flex-shrink-0">
                                <button
                                  onClick={() => acceptGroupInvitation(inv)}
                                  className="rounded-xl bg-indigo-500 px-3 py-1.5 text-[12px] font-semibold text-white transition active:scale-95 hover:bg-indigo-400"
                                >
                                  Rejoindre
                                </button>
                                <button
                                  onClick={() => declineGroupInvitation(inv)}
                                  className="rounded-xl border border-gray-200 dark:border-white/10 px-3 py-1.5 text-[12px] font-medium text-gray-500 dark:text-zinc-400 transition hover:bg-gray-50 dark:hover:bg-white/5 active:scale-95"
                                >
                                  Décliner
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 3. Sorties proposées (cartes visuelles) */}
                    {outingInvitations.length > 0 && (
                      <div>
                        <p className="px-4 pt-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600">
                          Sorties proposées · {outingInvitations.length}
                        </p>
                        <div className="space-y-3 px-1">
                          {outingInvitations.map(inv => {
                            const outing = inv.outings
                            const creator = outing?.profiles
                            const allInvitations = outing?.allInvitations ?? []
                            const appSpot = outing?.spot_id ? spots?.find(s => s.id === outing.spot_id) : null
                            const photoUrl = appSpot?.image_url?.split(",")[0]?.trim()
                              ?? (outing?.lat && outing?.lng
                                ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${outing.lng},${outing.lat},14,0/600x280?access_token=${process.env.NEXT_PUBLIC_MAPBOX_TOKEN}`
                                : null)
                            const countdown = getCountdown(outing?.scheduled_at)
                            const accepted = allInvitations.filter(i => i.status === "accepted")
                            const pending = allInvitations.filter(i => i.status === "pending")

                            return (
                              <div key={inv.id} className="rounded-3xl overflow-hidden bg-white dark:bg-zinc-900 shadow-lg shadow-black/[0.08] dark:shadow-black/30 border border-gray-100 dark:border-white/[0.06]">

                                {/* Photo hero */}
                                {photoUrl ? (
                                  <div className="relative h-44 w-full overflow-hidden">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={photoUrl} alt={outing?.title} className="h-full w-full object-cover" />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                                    {/* Countdown badge */}
                                    {countdown && (
                                      <span className={`absolute top-3 left-3 text-[11px] font-bold px-2.5 py-1 rounded-full backdrop-blur-sm ${countdown.urgent ? "bg-orange-500 text-white" : "bg-black/40 text-white"}`}>
                                        {countdown.label}
                                      </span>
                                    )}
                                    {/* Creator avatar */}
                                    <div className="absolute top-3 right-3 flex items-center gap-1.5 rounded-full bg-black/40 backdrop-blur-sm px-2 py-1">
                                      <div className="h-5 w-5 rounded-full overflow-hidden bg-gradient-to-br from-violet-400 to-indigo-500 flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">
                                        {creator?.avatar_url
                                          // eslint-disable-next-line @next/next/no-img-element
                                          ? <img src={creator.avatar_url} alt="" className="h-full w-full object-cover" />
                                          : (creator?.username?.[0]?.toUpperCase() ?? "?")}
                                      </div>
                                      <span className="text-[10px] font-semibold text-white">@{creator?.username ?? "?"}</span>
                                    </div>
                                    {/* Title + info overlay */}
                                    <div className="absolute bottom-0 left-0 right-0 px-4 pb-4">
                                      <p className="text-white font-bold text-[17px] leading-tight">{outing?.title}</p>
                                      <div className="flex items-center gap-3 mt-1">
                                        {outing?.scheduled_at && (
                                          <p className="flex items-center gap-1 text-white/80 text-[12px]">
                                            <Calendar size={10} />{formatOutingDate(outing.scheduled_at)}
                                          </p>
                                        )}
                                        {outing?.location_name && (
                                          <button
                                            onClick={() => outing.lat && outing.lng && (onLocateOuting?.(outing.lat, outing.lng), onClose())}
                                            disabled={!outing.lat || !outing.lng}
                                            className="flex items-center gap-1 text-white/70 text-[11px] truncate hover:text-white transition-colors disabled:cursor-default"
                                          >
                                            <MapPin size={9} />{outing.location_name}
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  /* No photo fallback — gradient card */
                                  <div className="relative h-28 w-full overflow-hidden bg-gradient-to-br from-violet-500 via-indigo-500 to-blue-500">
                                    <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(circle at 30% 50%, white 1px, transparent 1px), radial-gradient(circle at 70% 20%, white 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
                                    {countdown && (
                                      <span className={`absolute top-3 left-3 text-[11px] font-bold px-2.5 py-1 rounded-full ${countdown.urgent ? "bg-orange-500 text-white" : "bg-white/20 text-white"}`}>
                                        {countdown.label}
                                      </span>
                                    )}
                                    <div className="absolute bottom-0 left-0 right-0 px-4 pb-4">
                                      <p className="text-white font-bold text-[17px] leading-tight">{outing?.title}</p>
                                      {outing?.scheduled_at && (
                                        <p className="flex items-center gap-1 text-white/80 text-[12px] mt-0.5">
                                          <Calendar size={10} />{formatOutingDate(outing.scheduled_at)}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {/* Body */}
                                <div className="px-4 pt-3 pb-4 space-y-3">

                                  {/* Description */}
                                  {outing?.description && (
                                    <p className="text-[13px] text-gray-600 dark:text-zinc-400 leading-relaxed">
                                      {outing.description}
                                    </p>
                                  )}

                                  {/* Participants */}
                                  {allInvitations.length > 0 && (
                                    <div className="flex items-center gap-2">
                                      <div className="flex -space-x-2">
                                        {allInvitations.slice(0, 5).map((p, i) => (
                                          <div key={p.id + i} className={`h-7 w-7 rounded-full overflow-hidden border-2 border-white dark:border-zinc-900 flex items-center justify-center text-[9px] font-bold text-white ${p.status === "accepted" ? "bg-gradient-to-br from-indigo-400 to-purple-500" : "bg-gray-300 dark:bg-zinc-600"}`}>
                                            {p.profiles?.avatar_url
                                              // eslint-disable-next-line @next/next/no-img-element
                                              ? <img src={p.profiles.avatar_url} alt="" className={`h-full w-full object-cover ${p.status === "pending" ? "opacity-50" : ""}`} />
                                              : (p.profiles?.username?.[0]?.toUpperCase() ?? "?")}
                                          </div>
                                        ))}
                                      </div>
                                      <p className="text-[12px] text-gray-500 dark:text-zinc-400">
                                        {accepted.length > 0 && <span className="font-semibold text-green-600 dark:text-green-400">{accepted.length} {accepted.length > 1 ? "vont" : "va"}</span>}
                                        {pending.length > 0 && <span className="text-gray-400"> · {pending.length} en attente</span>}
                                      </p>
                                    </div>
                                  )}

                                  {/* RSVP Buttons */}
                                  <div className="flex gap-2 pt-1">
                                    <button
                                      onClick={async () => {
                                        setRespondingId(inv.id)
                                        await respondToOuting(inv.id, "accepted")
                                        setRespondingId(null)
                                      }}
                                      disabled={respondingId === inv.id}
                                      className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-indigo-600 py-3 text-[13px] font-bold text-white shadow-md shadow-indigo-500/25 transition-all active:scale-[0.98] disabled:opacity-50"
                                    >
                                      {respondingId === inv.id ? <LoaderCircle size={13} className="animate-spin" /> : <><CalendarCheck size={13} /> Participer</>}
                                    </button>
                                    <button
                                      onClick={() => openConfirm({
                                        title: "Décliner cette sortie ?",
                                        message: "Tu ne seras pas compté(e) parmi les participants.",
                                        confirmLabel: "Décliner",
                                        danger: true,
                                        onConfirm: async () => {
                                          setRespondingId(inv.id)
                                          await respondToOuting(inv.id, "declined")
                                          setRespondingId(null)
                                        },
                                      })}
                                      disabled={respondingId === inv.id}
                                      className="flex items-center justify-center rounded-2xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-zinc-800 px-4 py-3 text-[13px] font-semibold text-gray-500 dark:text-zinc-400 transition-all active:scale-[0.98] disabled:opacity-50"
                                    >
                                      <CalendarX size={13} />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* 3. Mes sorties (expandables) */}
                    {upcomingOutings.length > 0 && (
                      <div>
                        <p className="px-4 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600">
                          Mes sorties · {upcomingOutings.length}
                        </p>
                        <div className="space-y-2 px-1">
                          {upcomingOutings.map(outing => {
                            const notifKey = `outing-${outing.id}`
                            const isExpanded = expandedNotifId === notifKey
                            const isCreator = outing.creator_id === currentUser?.id
                            const countdown = getCountdown(outing.scheduled_at)
                            const invitations = outing.outing_invitations ?? []
                            const accepted = invitations.filter(i => i.status === "accepted")
                            const pending = invitations.filter(i => i.status === "pending")
                            const creatorEntry = { invitee_id: outing.creator_id, status: "accepted" as const, id: "creator", profiles: outing.profiles }
                            const allGoing = [creatorEntry, ...accepted]
                            const allParticipants = [creatorEntry, ...invitations]
                            const totalParticipants = allGoing.length + pending.length
                            const appSpot = outing.spot_id ? spots?.find(s => s.id === outing.spot_id) : null
                            const photoUrl = appSpot?.image_url?.split(",")[0]?.trim()
                              ?? (outing.lat && outing.lng
                                ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${outing.lng},${outing.lat},14,0/400x200?access_token=${process.env.NEXT_PUBLIC_MAPBOX_TOKEN}`
                                : null)
                            return (
                              <div key={outing.id} className="rounded-2xl overflow-hidden border border-gray-100 dark:border-white/[0.06] bg-white dark:bg-zinc-900 shadow-sm">

                                {/* ── Rangée compacte ── */}
                                <button
                                  onClick={() => setExpandedNotifId(isExpanded ? null : notifKey)}
                                  className="flex w-full items-center gap-3 px-3 py-3 text-left active:scale-[0.99] transition-all"
                                >
                                  <div className="h-14 w-14 flex-shrink-0 rounded-xl overflow-hidden bg-gray-100 dark:bg-zinc-800">
                                    {photoUrl
                                      // eslint-disable-next-line @next/next/no-img-element
                                      ? <img src={photoUrl} alt="" className="h-full w-full object-cover" />
                                      : <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-indigo-500 to-purple-600">
                                          <CalendarCheck size={18} className="text-white" />
                                        </div>
                                    }
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[13px] font-bold text-gray-900 dark:text-white truncate">{outing.title}</p>
                                    <p className={`text-[12px] font-semibold mt-0.5 ${countdown?.urgent ? "text-orange-500" : "text-indigo-500 dark:text-indigo-400"}`}>
                                      {countdown ? countdown.label : formatOutingDate(outing.scheduled_at)}
                                    </p>
                                    {outing.location_name && (
                                      <button
                                        onClick={() => outing.lat && outing.lng && (onLocateOuting?.(outing.lat, outing.lng), onClose())}
                                        disabled={!outing.lat || !outing.lng}
                                        className="flex items-center gap-0.5 text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5 truncate hover:text-blue-500 dark:hover:text-indigo-400 transition-colors disabled:cursor-default text-left"
                                      >
                                        <MapPin size={9} className="flex-shrink-0" />{outing.location_name}
                                      </button>
                                    )}
                                  </div>
                                  {/* Avatar stack + count */}
                                  <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <div className="flex -space-x-1.5">
                                      {allGoing.slice(0, 3).map((p, i) => (
                                        <div key={p.invitee_id + i} className="h-6 w-6 rounded-full overflow-hidden border-2 border-white dark:border-zinc-900 bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-[8px] font-bold text-white">
                                          {p.profiles?.avatar_url
                                            // eslint-disable-next-line @next/next/no-img-element
                                            ? <img src={p.profiles.avatar_url} alt="" className="h-full w-full object-cover" />
                                            : (p.profiles?.username ?? "?").charAt(0).toUpperCase()}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                  <ChevronDown size={14} className={`flex-shrink-0 text-gray-400 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />
                                </button>

                                {/* ── Carte dépliée ── */}
                                {isExpanded && (
                                  <div className="border-t border-gray-100 dark:border-white/[0.06]">

                                    {/* Photo */}
                                    {photoUrl && (
                                      <button
                                        onClick={() => outing.lat && outing.lng && (onLocateOuting?.(outing.lat, outing.lng), onClose())}
                                        disabled={!outing.lat || !outing.lng}
                                        className="relative block w-full h-40 overflow-hidden"
                                      >
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={photoUrl} alt={outing.title} className="h-full w-full object-cover" />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                                        {countdown && (
                                          <span className={`absolute top-2 left-2 text-[11px] font-bold px-2.5 py-1 rounded-full ${countdown.urgent ? "bg-orange-500 text-white" : "bg-black/40 backdrop-blur-sm text-white"}`}>
                                            {countdown.label}
                                          </span>
                                        )}
                                        {outing.lat && outing.lng && (
                                          <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-black/40 backdrop-blur-sm px-2.5 py-1">
                                            <MapPin size={10} className="text-white" />
                                            <span className="text-[10px] font-semibold text-white">Voir sur la carte</span>
                                          </div>
                                        )}
                                      </button>
                                    )}

                                    {/* Infos */}
                                    <div className="px-3 pt-3 pb-2">
                                      <p className="text-[14px] font-bold text-gray-900 dark:text-white">{outing.title}</p>
                                      {outing.scheduled_at && (
                                        <p className="flex items-center gap-1 text-[12px] text-gray-500 dark:text-zinc-400 mt-0.5">
                                          <Calendar size={10} />{formatOutingDate(outing.scheduled_at)}
                                        </p>
                                      )}
                                      {outing.location_name && (
                                        <p className="flex items-center gap-1 text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5">
                                          <MapPin size={9} />{outing.location_name}
                                        </p>
                                      )}
                                    </div>

                                    {/* Participants — avatars + menu */}
                                    <div className="px-3 pb-2">
                                      <button
                                        onClick={() => setExpandedNotifId(isExpanded ? `${notifKey}-att` : notifKey)}
                                        className="flex items-center gap-2 w-full text-left"
                                      >
                                        <div className="flex -space-x-2">
                                          {allGoing.slice(0, 4).map((p, i) => (
                                            <div key={p.invitee_id + i} className="h-7 w-7 rounded-full overflow-hidden border-2 border-white dark:border-zinc-900 bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-[9px] font-bold text-white">
                                              {p.profiles?.avatar_url
                                                // eslint-disable-next-line @next/next/no-img-element
                                                ? <img src={p.profiles.avatar_url} alt="" className="h-full w-full object-cover" />
                                                : (p.profiles?.username ?? "?").charAt(0).toUpperCase()}
                                            </div>
                                          ))}
                                          {pending.slice(0, 2).map((p, i) => (
                                            <div key={"pend-" + p.invitee_id + i} className="h-7 w-7 rounded-full overflow-hidden border-2 border-white dark:border-zinc-900 bg-gray-300 dark:bg-zinc-600 flex items-center justify-center text-[9px] font-bold text-gray-500 opacity-60">
                                              {p.profiles?.avatar_url
                                                // eslint-disable-next-line @next/next/no-img-element
                                                ? <img src={p.profiles.avatar_url} alt="" className="h-full w-full object-cover" />
                                                : (p.profiles?.username ?? "?").charAt(0).toUpperCase()}
                                            </div>
                                          ))}
                                        </div>
                                        <div className="flex items-center gap-1.5 text-[12px]">
                                          <span className="font-semibold text-green-600 dark:text-green-400">{allGoing.length} {allGoing.length > 1 ? "vont" : "va"}</span>
                                          {pending.length > 0 && <span className="text-gray-400 dark:text-zinc-500">· {pending.length} en attente</span>}
                                          <ChevronDown size={10} className="text-gray-400" />
                                        </div>
                                      </button>

                                      {/* Liste participants */}
                                      <div className="mt-2 rounded-xl border border-gray-100 dark:border-white/[0.06] bg-gray-50 dark:bg-zinc-800/60 px-3 py-2 space-y-2">
                                        {allParticipants.map((p, i) => {
                                          const isOrg = p.invitee_id === outing.creator_id
                                          return (
                                            <div key={p.invitee_id + i} className="flex items-center gap-2.5">
                                              <div className="h-8 w-8 flex-shrink-0 rounded-full overflow-hidden bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-[10px] font-bold text-white">
                                                {p.profiles?.avatar_url
                                                  // eslint-disable-next-line @next/next/no-img-element
                                                  ? <img src={p.profiles.avatar_url} alt="" className={`h-full w-full object-cover ${p.status === "pending" ? "opacity-50" : ""}`} />
                                                  : (p.profiles?.username ?? "?").charAt(0).toUpperCase()}
                                              </div>
                                              <span className="flex-1 text-[13px] font-medium text-gray-800 dark:text-zinc-100 truncate">
                                                {p.profiles?.username ?? "Utilisateur"}
                                              </span>
                                              {isOrg && <span className="text-[10px] font-semibold text-indigo-500 dark:text-indigo-400">organisateur</span>}
                                              {!isOrg && p.status === "pending" && <span className="text-[10px] text-gray-400 dark:text-zinc-500">en attente</span>}
                                              {!isOrg && p.status === "declined" && <span className="text-[10px] text-red-400">a décliné</span>}
                                            </div>
                                          )
                                        })}
                                      </div>
                                    </div>

                                    {/* Action principale */}
                                    <div className="px-3 pb-3 flex gap-2">
                                      {isCreator ? (
                                        <>
                                          <button
                                            onClick={() => { setEditingOuting(outing); setEditForm({ title: outing.title, description: outing.description ?? "", scheduled_at: outing.scheduled_at ? outing.scheduled_at.slice(0, 16) : "" }); setEditError(null) }}
                                            className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 px-3 py-2.5 text-[12px] font-semibold text-indigo-600 dark:text-indigo-400"
                                          >
                                            <CalendarPlus size={12} /> Modifier
                                          </button>
                                          <button
                                            onClick={() => cancelOuting(outing.id)}
                                            className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-red-50 dark:bg-red-500/10 px-3 py-2.5 text-[12px] font-semibold text-red-500"
                                          >
                                            <CalendarX size={12} /> Annuler
                                          </button>
                                        </>
                                      ) : (
                                        <button
                                          onClick={() => withdrawOuting(outing.id)}
                                          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-red-50 dark:bg-red-500/10 px-3 py-3 text-[13px] font-semibold text-red-500"
                                        >
                                          <CalendarX size={13} /> Se désister
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* 4. Demandes envoyées (minimal) */}
                    {pendingSent.length > 0 && (
                      <div>
                        <p className="px-4 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600">
                          Envoyées · {pendingSent.length}
                        </p>
                        <div className="space-y-0.5 px-1">
                          {pendingSent.map(p => (
                            <div key={p.id} className="flex items-center gap-2.5 rounded-xl px-3 py-2.5">
                              <div className="h-8 w-8 flex-shrink-0 rounded-full overflow-hidden bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-[11px] font-bold text-white">
                                {p.avatar_url
                                  // eslint-disable-next-line @next/next/no-img-element
                                  ? <img src={p.avatar_url} alt="" className="h-full w-full object-cover" />
                                  : (p.username?.[0] ?? "?").toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[12px] text-gray-600 dark:text-zinc-400 truncate">
                                  <span className="font-medium">@{p.username ?? "?"}</span>
                                  <span className="text-gray-400 dark:text-zinc-600"> · En attente</span>
                                </p>
                              </div>
                              <button
                                onClick={() => cancelRequest(p.id)}
                                disabled={loadingId === p.id}
                                className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-gray-400 dark:text-zinc-600 transition-colors hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50"
                              >
                                {loadingId === p.id ? <LoaderCircle size={10} className="animate-spin" /> : "Annuler"}
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  </div>
                )}
                {/* Spacer universel — empêche le dernier élément d'être sous la barre */}
                <div style={{ height: "max(5rem, calc(env(safe-area-inset-bottom) + 4rem))" }} />
              </div>

              {/* ══ CREATE OUTING OVERLAY ══════════════════════════ */}
              <AnimatePresence>
                {showCreateOuting && (
                  <motion.div
                    initial={{ x: "100%" }}
                    animate={{ x: 0 }}
                    exit={{ x: "100%" }}
                    transition={{ type: "spring", stiffness: 380, damping: 34 }}
                    style={{ touchAction: "pan-y" }}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="absolute inset-0 z-20 flex flex-col overflow-hidden
                      bg-white dark:bg-[#0e0e12]
                      rounded-t-[2rem] sm:rounded-l-2xl sm:rounded-t-none"
                  >
                    {/* Header */}
                    <div className="flex flex-shrink-0 items-center gap-3 border-b border-gray-100 dark:border-white/[0.06] px-5 pt-5 pb-4">
                      <button
                        onClick={() => {
                          setShowCreateOuting(false)
                          setCreateError(null)
                          setSelectedLocation(null)
                          setLocationQuery("")
                          setLocationResults([])
                        }}
                        className="flex h-8 w-8 items-center justify-center rounded-xl text-gray-500 dark:text-zinc-400 transition-all hover:bg-gray-100 dark:hover:bg-white/8"
                      >
                        <ArrowLeft size={16} />
                      </button>
                      <div>
                        <h3 className="text-[15px] font-bold text-gray-900 dark:text-white">
                          Nouvelle sortie
                        </h3>
                        <p className="text-[11px] text-gray-400 dark:text-zinc-600">
                          Propose un plan à tes amis
                        </p>
                      </div>
                    </div>

                    {/* Form */}
                    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                      {/* Titre */}
                      <div>
                        <label className="block mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600">
                          Titre <span className="normal-case text-gray-300 dark:text-zinc-700">(optionnel — sinon le lieu)</span>
                        </label>
                        <input
                          type="text"
                          placeholder="Ex : Soirée Parc Astérix, Week-end ski…"
                          value={createForm.title}
                          onChange={e => setCreateForm(f => ({ ...f, title: e.target.value }))}
                          maxLength={60}
                          className="w-full rounded-xl border border-gray-200 dark:border-white/[0.07] bg-gray-50 dark:bg-zinc-900 px-3.5 py-2.5 text-[15px] text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-zinc-600 outline-none transition-all focus:border-indigo-400/60 focus:ring-2 focus:ring-indigo-500/15 sm:text-sm"
                        />
                      </div>

                      {/* Date & time */}
                      <div>
                        <label className="block mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600">
                          Date et heure <span className="normal-case text-gray-300 dark:text-zinc-700">(optionnel)</span>
                        </label>
                        <div className="w-full rounded-xl border border-gray-200 dark:border-white/[0.07] bg-gray-50 dark:bg-zinc-900 overflow-hidden" style={{ height: "42px" }}>
                          <input
                            type="datetime-local"
                            min={minDateTime}
                            value={createForm.scheduled_at}
                            onChange={e => setCreateForm(f => ({ ...f, scheduled_at: e.target.value }))}
                            className="w-full h-full bg-transparent px-3.5 text-[13px] text-gray-900 dark:text-white outline-none"
                            style={{ colorScheme: "light dark" }}
                          />
                        </div>
                      </div>

                      {/* Location */}
                      <div>
                        <label className="block mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600">
                          Lieu <span className="normal-case text-gray-300 dark:text-zinc-700">(optionnel)</span>
                        </label>
                        {selectedLocation ? (
                          <div className="flex items-center gap-2.5 rounded-xl border border-indigo-300/60 dark:border-indigo-500/25 bg-indigo-50/50 dark:bg-indigo-500/[0.05] px-3.5 py-2.5">
                            <MapPin size={14} className="flex-shrink-0 text-indigo-500 dark:text-indigo-400" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{selectedLocation.label}</p>
                              {selectedLocation.sublabel && (
                                <p className="truncate text-[11px] text-gray-400 dark:text-zinc-600">{selectedLocation.sublabel}</p>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => { setSelectedLocation(null); setLocationQuery("") }}
                              className="flex-shrink-0 text-gray-400 hover:text-gray-600 dark:text-zinc-600 dark:hover:text-zinc-400 transition-colors"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {/* Mes spots — quick picks */}
                            {(() => {
                              const mySpots = (spots ?? []).filter((s: any) => s.user_id === currentUser?.id).slice(0, 10)
                              if (mySpots.length === 0) return null
                              return (
                                <div>
                                  <p className="mb-1.5 text-[10px] font-semibold text-gray-400 dark:text-zinc-600 uppercase tracking-wider">
                                    Mes spots
                                  </p>
                                  <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1 -mx-0.5 px-0.5">
                                    {mySpots.map((s: any) => {
                                      const img = s.image_url?.split(",")[0]?.trim() || null
                                      return (
                                        <button
                                          key={s.id}
                                          type="button"
                                          onClick={() => setSelectedLocation({
                                            id: `spot-${s.id}`,
                                            label: s.title,
                                            sublabel: "Mon spot",
                                            lat: s.lat,
                                            lng: s.lng,
                                            isAppSpot: true,
                                            spotId: s.id,
                                          })}
                                          className="flex-shrink-0 w-24 overflow-hidden rounded-xl border border-gray-200 dark:border-white/[0.07] bg-white dark:bg-zinc-900 text-left transition-all active:scale-95 hover:border-indigo-400/60 dark:hover:border-indigo-500/40"
                                        >
                                          <div className="relative h-14 w-full overflow-hidden bg-gray-100 dark:bg-zinc-800">
                                            {img
                                              // eslint-disable-next-line @next/next/no-img-element
                                              ? <img src={img} alt={s.title} className="h-full w-full object-cover" />
                                              : <div className="flex h-full w-full items-center justify-center text-xl">{s.category ? "📍" : "📍"}</div>}
                                          </div>
                                          <div className="px-1.5 py-1">
                                            <p className="truncate text-[10px] font-semibold text-gray-800 dark:text-zinc-200">{s.title}</p>
                                          </div>
                                        </button>
                                      )
                                    })}
                                  </div>
                                </div>
                              )
                            })()}

                            {/* Search field */}
                            <div className="relative">
                              <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-400 dark:text-zinc-600 z-10" />
                              <input
                                type="text"
                                placeholder="Ou chercher un autre lieu…"
                                value={locationQuery}
                                onChange={e => {
                                  const val = e.target.value
                                  setLocationQuery(val)
                                  if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current)
                                  locationDebounceRef.current = setTimeout(() => searchLocations(val), 400)
                                }}
                                className="w-full rounded-xl border border-gray-200 dark:border-white/[0.07] bg-gray-50 dark:bg-zinc-900 py-2.5 pr-8 pl-9 text-[15px] text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-zinc-600 outline-none transition-all focus:border-indigo-400/60 focus:ring-2 focus:ring-indigo-500/15 sm:text-sm"
                              />
                              {locationLoading && (
                                <LoaderCircle size={14} className="absolute top-1/2 right-3 -translate-y-1/2 animate-spin text-indigo-400" />
                              )}
                              {locationResults.length > 0 && (
                                <div className="absolute top-full left-0 right-0 z-20 mt-1 overflow-hidden rounded-xl border border-gray-200 dark:border-white/[0.07] bg-white dark:bg-zinc-900 shadow-xl">
                                  {locationResults.map((r, i) => (
                                    <button
                                      key={r.id}
                                      type="button"
                                      onClick={() => {
                                        setSelectedLocation(r)
                                        setLocationQuery("")
                                        setLocationResults([])
                                      }}
                                      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors ${i > 0 ? "border-t border-gray-100 dark:border-white/[0.04]" : ""}`}
                                    >
                                      <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${r.isAppSpot ? "bg-indigo-100 dark:bg-indigo-500/15" : "bg-gray-100 dark:bg-zinc-800"}`}>
                                        <MapPin size={12} className={r.isAppSpot ? "text-indigo-500 dark:text-indigo-400" : "text-gray-400 dark:text-zinc-600"} />
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <p className="truncate text-[12px] font-semibold text-gray-900 dark:text-white">{r.label}</p>
                                        {r.sublabel && <p className="truncate text-[10px] text-gray-400 dark:text-zinc-600">{r.sublabel}</p>}
                                      </div>
                                      {r.isAppSpot && (
                                        <span className="flex-shrink-0 rounded-full bg-indigo-100 dark:bg-indigo-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-indigo-600 dark:text-indigo-400">
                                          App
                                        </span>
                                      )}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Description */}
                      <div>
                        <label className="block mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600">
                          Message <span className="normal-case text-gray-300 dark:text-zinc-700">(optionnel)</span>
                        </label>
                        <textarea
                          placeholder="Donne envie ! Infos pratiques, dress code…"
                          value={createForm.description}
                          onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))}
                          rows={3}
                          maxLength={300}
                          className="w-full resize-none rounded-xl border border-gray-200 dark:border-white/[0.07] bg-gray-50 dark:bg-zinc-900 px-3.5 py-2.5 text-[15px] text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-zinc-600 outline-none transition-all focus:border-indigo-400/60 focus:ring-2 focus:ring-indigo-500/15 sm:text-sm"
                        />
                      </div>

                      {/* Friend selector */}
                      <div>
                        <label className="block mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600">
                          Inviter *{" "}
                          {selectedFriendIds.length > 0 && (
                            <span className="normal-case text-indigo-600 dark:text-indigo-400">
                              ({selectedFriendIds.length} sélectionné{selectedFriendIds.length > 1 ? "s" : ""})
                            </span>
                          )}
                        </label>
                        {following.length === 0 ? (
                          <p className="text-[12px] text-gray-400 dark:text-zinc-600 py-3 text-center">
                            Ajoute d&apos;abord des amis pour les inviter
                          </p>
                        ) : (
                          <div className="grid grid-cols-4 gap-2">
                            {following.map(friend => {
                              const selected = selectedFriendIds.includes(friend.id)
                              return (
                                <button
                                  key={friend.id}
                                  type="button"
                                  onClick={() => toggleFriendSelection(friend.id)}
                                  className={`flex flex-col items-center gap-1.5 rounded-xl p-2 transition-all active:scale-95 ${
                                    selected
                                      ? "bg-indigo-500/10 dark:bg-indigo-500/15 ring-2 ring-indigo-500"
                                      : "hover:bg-gray-50 dark:hover:bg-zinc-900"
                                  }`}
                                >
                                  <div className="relative">
                                    <div className="h-11 w-11 overflow-hidden rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-sm font-bold text-white">
                                      {friend.avatar_url ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={friend.avatar_url} alt="avatar" className="h-full w-full object-cover" />
                                      ) : initials(friend.username)}
                                    </div>
                                    {selected && (
                                      <div className="absolute -top-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-white dark:border-[#0e0e12] bg-indigo-500">
                                        <Check size={9} className="text-white" />
                                      </div>
                                    )}
                                    {isOnline(friend.last_active_at, friend.is_ghost_mode) && !selected && (
                                      <div className="absolute right-0 bottom-0 h-3 w-3 rounded-full border-2 border-white dark:border-[#0e0e12] bg-green-500" />
                                    )}
                                  </div>
                                  <span className="w-full truncate text-center text-[10px] font-medium text-gray-600 dark:text-zinc-400">
                                    {friend.username ?? "?"}
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>

                      {/* Spacer before sticky button */}
                      <div className="h-4" />
                    </div>

                    {/* Bouton sticky — toujours visible au bas de l'overlay */}
                    <div
                      className="flex-shrink-0 border-t border-gray-100 dark:border-white/[0.06] bg-white dark:bg-[#0e0e12] px-5 pt-3"
                      style={{ paddingBottom: "max(5.5rem, calc(env(safe-area-inset-bottom) + 4.5rem))" }}
                    >
                      {createError && (
                        <p className="mb-2 rounded-xl bg-red-50 dark:bg-red-500/10 px-3 py-2 text-[12px] font-medium text-red-600 dark:text-red-400">
                          {createError}
                        </p>
                      )}
                      {selectedFriendIds.length === 0 && !creating && (
                        <p className="mb-2 text-center text-[11px] text-gray-400 dark:text-zinc-500">
                          Sélectionne au moins 1 ami pour envoyer
                        </p>
                      )}
                      <button
                        onClick={createOuting}
                        disabled={creating || selectedFriendIds.length === 0}
                        className={`w-full flex items-center justify-center gap-2 rounded-xl py-3.5 text-[14px] font-bold transition-all active:scale-[0.98] ${
                          selectedFriendIds.length === 0
                            ? "bg-gray-100 dark:bg-zinc-800 text-gray-400 dark:text-zinc-500 cursor-not-allowed opacity-60"
                            : "bg-indigo-600 text-white shadow-lg shadow-indigo-500/30 hover:bg-indigo-500 cursor-pointer"
                        }`}
                      >
                        {creating ? (
                          <><LoaderCircle size={15} className="animate-spin" /> Envoi en cours…</>
                        ) : (
                          <><CalendarPlus size={15} /> {selectedFriendIds.length === 0 ? "Envoyer les invitations" : `Envoyer (${selectedFriendIds.length} ami${selectedFriendIds.length > 1 ? "s" : ""})`}</>
                        )}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ══ EDIT OUTING OVERLAY ══════════════════════════ */}
              <AnimatePresence>
                {editingOuting && (
                  <motion.div
                    initial={{ x: "100%" }}
                    animate={{ x: 0 }}
                    exit={{ x: "100%" }}
                    transition={{ type: "spring", stiffness: 380, damping: 34 }}
                    style={{ touchAction: "pan-y" }}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="absolute inset-0 z-20 flex flex-col overflow-hidden
                      bg-white dark:bg-[#0e0e12]
                      rounded-t-[2rem] sm:rounded-l-2xl sm:rounded-t-none"
                  >
                    {/* Header */}
                    <div className="flex flex-shrink-0 items-center gap-3 border-b border-gray-100 dark:border-white/[0.06] px-5 pt-5 pb-4">
                      <button
                        onClick={() => {
                          setEditingOuting(null)
                          setEditError(null)
                        }}
                        className="flex h-8 w-8 items-center justify-center rounded-xl text-gray-500 dark:text-zinc-400 transition-all hover:bg-gray-100 dark:hover:bg-white/8"
                      >
                        <ArrowLeft size={16} />
                      </button>
                      <div>
                        <h3 className="text-[15px] font-bold text-gray-900 dark:text-white">
                          Modifier la sortie
                        </h3>
                        <p className="text-[11px] text-gray-400 dark:text-zinc-600">
                          Mets à jour les infos
                        </p>
                      </div>
                    </div>

                    {/* Form */}
                    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                      {/* Title */}
                      <div>
                        <label className="block mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600">
                          Titre *
                        </label>
                        <input
                          type="text"
                          placeholder="Nom de la sortie"
                          value={editForm.title}
                          onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                          maxLength={80}
                          className="w-full rounded-xl border border-gray-200 dark:border-white/[0.07] bg-gray-50 dark:bg-zinc-900 px-3.5 py-2.5 text-[15px] text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-zinc-600 outline-none transition-all focus:border-indigo-400/60 focus:ring-2 focus:ring-indigo-500/15 sm:text-sm"
                        />
                      </div>

                      {/* Date & time */}
                      <div>
                        <label className="block mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600">
                          Date et heure <span className="normal-case text-gray-300 dark:text-zinc-700">(optionnel)</span>
                        </label>
                        <div className="w-full rounded-xl border border-gray-200 dark:border-white/[0.07] bg-gray-50 dark:bg-zinc-900 overflow-hidden" style={{ height: "42px" }}>
                          <input
                            type="datetime-local"
                            min={minDateTime}
                            value={editForm.scheduled_at}
                            onChange={e => setEditForm(f => ({ ...f, scheduled_at: e.target.value }))}
                            className="w-full h-full bg-transparent px-3.5 text-[13px] text-gray-900 dark:text-white outline-none"
                            style={{ colorScheme: "light dark" }}
                          />
                        </div>
                      </div>

                      {/* Description */}
                      <div>
                        <label className="block mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600">
                          Message <span className="normal-case text-gray-300 dark:text-zinc-700">(optionnel)</span>
                        </label>
                        <textarea
                          placeholder="Donne envie ! Infos pratiques, dress code…"
                          value={editForm.description}
                          onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                          rows={3}
                          maxLength={300}
                          className="w-full resize-none rounded-xl border border-gray-200 dark:border-white/[0.07] bg-gray-50 dark:bg-zinc-900 px-3.5 py-2.5 text-[15px] text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-zinc-600 outline-none transition-all focus:border-indigo-400/60 focus:ring-2 focus:ring-indigo-500/15 sm:text-sm"
                        />
                      </div>

                      <div className="h-4" />
                    </div>

                    {/* Submit */}
                    <div
                      className="flex-shrink-0 border-t border-gray-100 dark:border-white/[0.06] bg-white dark:bg-[#0e0e12] px-5 pt-3"
                      style={{ paddingBottom: "max(5.5rem, calc(env(safe-area-inset-bottom) + 4.5rem))" }}
                    >
                      {editError && (
                        <p className="mb-2 rounded-xl bg-red-50 dark:bg-red-500/10 px-3 py-2 text-[12px] font-medium text-red-600 dark:text-red-400">
                          {editError}
                        </p>
                      )}
                      <button
                        onClick={updateOuting}
                        disabled={saving || !editForm.title.trim()}
                        className={`w-full flex items-center justify-center gap-2 rounded-xl py-3.5 text-[14px] font-bold transition-all active:scale-[0.98] ${
                          saving || !editForm.title.trim()
                            ? "bg-gray-100 dark:bg-zinc-800 text-gray-400 dark:text-zinc-500 cursor-not-allowed"
                            : "bg-indigo-600 text-white shadow-lg shadow-indigo-500/30 hover:bg-indigo-500 cursor-pointer"
                        }`}
                      >
                        {saving ? (
                          <><LoaderCircle size={15} className="animate-spin" /> Enregistrement…</>
                        ) : (
                          <><CalendarCheck size={15} /> Enregistrer les modifications</>
                        )}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
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
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function Section({
  title, icon, badge, children,
}: {
  title: string; icon?: React.ReactNode; badge?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-widest text-gray-400 dark:text-zinc-600 uppercase">
          {icon}{title}
        </p>
        {badge}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function EmptyState({ icon, text, sub }: { icon: React.ReactNode; text: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 dark:bg-zinc-900 text-gray-300 dark:text-zinc-700">
        {icon}
      </div>
      <p className="text-sm font-medium text-gray-500 dark:text-zinc-500">{text}</p>
      {sub && <p className="mt-1 max-w-[200px] text-[11px] text-gray-400 dark:text-zinc-600">{sub}</p>}
    </div>
  )
}

function UserRow({
  profile, initials, isFollowing, isPending, loading,
  onSendRequest, onCancelRequest, onUnfollow, onSelectUser, onLocate,
}: {
  profile: Profile; initials: string; isFollowing: boolean; isPending: boolean; loading: boolean
  onSendRequest: () => void; onCancelRequest: () => void; onUnfollow: () => void
  onSelectUser?: () => void; onLocate?: () => void
}) {
  const online = isOnline(profile.last_active_at, profile.is_ghost_mode)
  return (
    <div
      className="group flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-all hover:bg-gray-50 dark:hover:bg-white/[0.04]"
      onClick={onSelectUser}
    >
      <div className="relative flex-shrink-0">
        <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-sm font-bold text-white">
          {profile.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.avatar_url} alt="avatar" className="h-full w-full object-cover" />
          ) : initials}
        </div>
        {online && <span className="absolute right-0 bottom-0 h-3 w-3 rounded-full border-2 border-white dark:border-[#0e0e12] bg-green-500" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold leading-tight text-gray-900 dark:text-white">
          @{profile.username ?? "utilisateur"}
        </p>
        <p className="mt-0.5 flex items-center gap-1 text-[10px] text-gray-400 dark:text-zinc-600">
          {online ? (
            <span className="font-medium text-green-500 dark:text-green-400">En ligne</span>
          ) : profile.last_active_at ? (
            <><Clock size={9} />{timeAgo(profile.last_active_at)}</>
          ) : null}
        </p>
      </div>
      <div className="flex flex-shrink-0 items-center gap-1">
        {onLocate && (
          <button
            onClick={e => { e.stopPropagation(); onLocate() }}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-300 dark:text-zinc-700 opacity-0 transition-all group-hover:opacity-100 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 hover:text-indigo-500 dark:hover:text-indigo-400"
          >
            <MapPin size={13} />
          </button>
        )}
        {isFollowing ? (
          <button onClick={e => { e.stopPropagation(); onUnfollow() }} disabled={loading}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 dark:text-zinc-600 transition-all hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50">
            {loading ? <LoaderCircle size={13} className="animate-spin" /> : <Trash2 size={13} />}
          </button>
        ) : isPending ? (
          <button onClick={e => { e.stopPropagation(); onCancelRequest() }} disabled={loading}
            className="flex items-center gap-1 rounded-lg bg-gray-100 dark:bg-zinc-800 px-2.5 py-1.5 text-[11px] font-medium text-gray-500 dark:text-zinc-400 transition-all hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50">
            {loading ? <LoaderCircle size={11} className="animate-spin" /> : <><Clock size={11} /> Envoyé</>}
          </button>
        ) : (
          <button onClick={e => { e.stopPropagation(); onSendRequest() }} disabled={loading}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500 text-white transition-all hover:bg-indigo-400 active:scale-95 disabled:opacity-50">
            {loading ? <LoaderCircle size={13} className="animate-spin" /> : <UserPlus size={13} />}
          </button>
        )}
      </div>
    </div>
  )
}

function SuggestionRow({
  profile, initials, isPending, loading, mutualCount, onSendRequest, onCancelRequest,
}: {
  profile: Profile; initials: string; isPending: boolean; loading: boolean; mutualCount?: number
  onSendRequest: () => void; onCancelRequest: () => void
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all hover:bg-gray-50 dark:hover:bg-white/[0.04]">
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-sm font-bold text-white">
        {profile.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.avatar_url} alt="avatar" className="h-full w-full object-cover" />
        ) : initials}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold leading-tight text-gray-900 dark:text-white">
          @{profile.username ?? "utilisateur"}
        </p>
        {(mutualCount ?? 0) > 0 ? (
          <p className="mt-0.5 flex items-center gap-1 text-[10px] font-medium text-indigo-600 dark:text-indigo-400">
            <Users size={9} />{mutualCount} ami{(mutualCount ?? 0) > 1 ? "s" : ""} en commun
          </p>
        ) : profile.last_active_at ? (
          <p className="mt-0.5 flex items-center gap-1 text-[10px] text-gray-400 dark:text-zinc-600">
            <Clock size={9} />{timeAgo(profile.last_active_at)}
          </p>
        ) : null}
      </div>
      {isPending ? (
        <button onClick={onCancelRequest} disabled={loading}
          className="flex items-center gap-1 rounded-xl bg-gray-100 dark:bg-zinc-800 px-3 py-1.5 text-[11px] font-semibold text-gray-500 dark:text-zinc-400 transition-all hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50">
          {loading ? <LoaderCircle size={11} className="animate-spin" /> : <><Check size={11} /> Envoyé</>}
        </button>
      ) : (
        <button onClick={onSendRequest} disabled={loading}
          className="flex items-center gap-1.5 rounded-xl bg-indigo-500 px-3 py-1.5 text-[11px] font-bold text-white shadow-sm shadow-indigo-500/25 transition-all hover:bg-indigo-400 active:scale-95 disabled:opacity-50">
          {loading ? <LoaderCircle size={11} className="animate-spin" /> : <><UserPlus size={11} /> Suivre</>}
        </button>
      )}
    </div>
  )
}

function InvitationRow({
  req, loading, onAccept, onDecline,
}: {
  req: FriendRequest; loading: boolean; onAccept: () => void; onDecline: () => void
}) {
  const init = (req.profiles?.username ?? "?").charAt(0).toUpperCase()
  return (
    <div className="flex items-center gap-3 rounded-xl border border-indigo-500/15 bg-indigo-500/[0.04] dark:bg-indigo-500/[0.06] px-3 py-3">
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-sm font-bold text-white">
        {req.profiles?.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={req.profiles.avatar_url} alt="avatar" className="h-full w-full object-cover" />
        ) : init}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-gray-900 dark:text-white">
          @{req.profiles?.username ?? "utilisateur"}
        </p>
        <p className="text-[10px] text-gray-400 dark:text-zinc-600">veut être ton ami</p>
      </div>
      <div className="flex gap-1.5">
        <button onClick={onAccept} disabled={loading}
          className="flex items-center gap-1 rounded-xl bg-green-500 px-3 py-1.5 text-[11px] font-bold text-white shadow-sm shadow-green-500/25 transition-all hover:bg-green-400 active:scale-95 disabled:opacity-50">
          {loading ? <LoaderCircle size={11} className="animate-spin" /> : <><Check size={11} /> Accepter</>}
        </button>
        <button onClick={onDecline} disabled={loading}
          className="flex h-8 w-8 items-center justify-center rounded-xl text-gray-400 dark:text-zinc-600 transition-all hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

function FeaturedOutingCard({
  outing, currentUserId, spots, onCancel, onLocate, onEdit, onWithdraw,
}: {
  outing: Outing
  currentUserId: string
  spots?: Array<{ id: string; image_url?: string | null; lat?: number; lng?: number }>
  onCancel: (id: string) => void
  onLocate?: (lat: number, lng: number) => void
  onEdit?: () => void
  onWithdraw?: () => void
}) {
  const [showAttendees, setShowAttendees] = useState(false)

  const isCreator = outing.creator_id === currentUserId
  const invitations = outing.outing_invitations ?? []
  const accepted = invitations.filter(i => i.status === "accepted")
  const pending = invitations.filter(i => i.status === "pending")
  const declined = invitations.filter(i => i.status === "declined")

  // Créateur inclus dans la liste "qui y va"
  const creatorEntry = { invitee_id: outing.creator_id, status: "accepted" as const, id: "creator", profiles: outing.profiles }
  const allGoing = [creatorEntry, ...accepted]

  // Photo : spot de l'app ou Mapbox static
  const appSpot = outing.spot_id ? spots?.find(s => s.id === outing.spot_id) : null
  const photoUrl = appSpot?.image_url?.split(",")[0]?.trim()
    ?? (outing.lat && outing.lng
      ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${outing.lng},${outing.lat},14,0/400x200?access_token=${process.env.NEXT_PUBLIC_MAPBOX_TOKEN}`
      : null)

  const canLocate = !!(outing.lat && outing.lng)

  return (
    <div className="rounded-2xl overflow-hidden border border-indigo-500/15 dark:border-indigo-500/10 bg-white dark:bg-zinc-900 shadow-sm">
      {/* Photo */}
      {photoUrl ? (
        <button
          onClick={() => canLocate && onLocate?.(outing.lat!, outing.lng!)}
          disabled={!canLocate}
          className={`relative block w-full h-36 overflow-hidden ${canLocate ? "cursor-pointer" : "cursor-default"}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoUrl} alt={outing.title} className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
          {canLocate && (
            <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-white/20 backdrop-blur-sm px-2 py-1">
              <MapPin size={10} className="text-white" />
              <span className="text-[10px] font-semibold text-white">Voir sur la carte</span>
            </div>
          )}
          {(() => { const cd = getCountdown(outing.scheduled_at); return cd ? (
            <span className={`absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-full ${cd.urgent ? "bg-orange-500 text-white" : "bg-black/40 backdrop-blur-sm text-white"}`}>
              {cd.label}
            </span>
          ) : null })()}
        </button>
      ) : (
        <div className="flex items-center justify-between px-3 pt-3">
          {(() => { const cd = getCountdown(outing.scheduled_at); return cd ? (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${cd.urgent ? "bg-orange-100 dark:bg-orange-500/15 text-orange-600 dark:text-orange-400" : "bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400"}`}>
              {cd.label}
            </span>
          ) : <span /> })()}
          {isCreator && !onEdit && (
            <button onClick={() => onCancel(outing.id)} className="flex h-6 w-6 items-center justify-center rounded-lg text-gray-400 hover:text-red-500 transition-colors">
              <X size={12} />
            </button>
          )}
        </div>
      )}

      <div className="px-3 pb-3 pt-2.5 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[13px] font-bold text-gray-900 dark:text-white truncate">{outing.title}</p>
            {outing.scheduled_at && (
              <p className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-zinc-500 mt-0.5">
                <Calendar size={9} />{formatOutingDate(outing.scheduled_at)}
              </p>
            )}
            {outing.location_name && (
              <p className="flex items-center gap-1 text-[11px] text-gray-400 dark:text-zinc-600">
                <MapPin size={9} />{outing.location_name}
              </p>
            )}
          </div>
          {photoUrl && isCreator && !onEdit && (
            <button onClick={() => onCancel(outing.id)} className="flex-shrink-0 flex h-6 w-6 items-center justify-center rounded-lg text-gray-400 hover:text-red-500 transition-colors">
              <X size={12} />
            </button>
          )}
        </div>

        {/* Participants */}
        <button
          onClick={() => setShowAttendees(v => !v)}
          className="flex items-center gap-2 w-full text-left"
        >
          <div className="flex -space-x-2">
            {allGoing.slice(0, 4).map((p, i) => (
              <div key={p.invitee_id + i} className="h-7 w-7 rounded-full border-2 border-white dark:border-zinc-900 bg-gradient-to-br from-indigo-400 to-purple-500 overflow-hidden flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">
                {p.profiles?.avatar_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={p.profiles.avatar_url} alt="" className="h-full w-full object-cover" />
                  : (p.profiles?.username ?? "?").charAt(0).toUpperCase()}
              </div>
            ))}
            {pending.slice(0, 3).map((p, i) => (
              <div key={"pending-" + p.invitee_id + i} className="h-7 w-7 rounded-full border-2 border-white dark:border-zinc-900 bg-gray-300 dark:bg-zinc-600 overflow-hidden flex items-center justify-center text-[9px] font-bold text-gray-500 dark:text-zinc-300 flex-shrink-0 opacity-60">
                {p.profiles?.avatar_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={p.profiles.avatar_url} alt="" className="h-full w-full object-cover opacity-60" />
                  : (p.profiles?.username ?? "?").charAt(0).toUpperCase()}
              </div>
            ))}
            {(allGoing.length + pending.length) > 7 && (
              <div className="h-7 w-7 rounded-full border-2 border-white dark:border-zinc-900 bg-gray-200 dark:bg-zinc-700 flex items-center justify-center text-[9px] font-bold text-gray-500 dark:text-zinc-400">
                +{allGoing.length + pending.length - 7}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 text-[11px]">
            <span className="font-semibold text-green-600 dark:text-green-400">{allGoing.length} {allGoing.length > 1 ? "vont" : "va"}</span>
            {pending.length > 0 && <span className="text-gray-400 dark:text-zinc-600">· {pending.length} en attente</span>}
            {declined.length > 0 && <span className="text-red-400 dark:text-red-500">· {declined.length} décliné</span>}
            <ChevronDown size={10} className={`text-gray-400 transition-transform ${showAttendees ? "rotate-180" : ""}`} />
          </div>
        </button>

        {/* Expanded attendees list */}
        {showAttendees && (
          <div className="rounded-xl border border-gray-100 dark:border-white/[0.06] bg-gray-50 dark:bg-zinc-800/60 p-2 space-y-1.5">
            {allGoing.map((p, i) => (
              <div key={p.invitee_id + i} className="flex items-center gap-2">
                <div className="h-6 w-6 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 overflow-hidden flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">
                  {p.profiles?.avatar_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={p.profiles.avatar_url} alt="" className="h-full w-full object-cover" />
                    : (p.profiles?.username ?? "?").charAt(0).toUpperCase()}
                </div>
                <span className="text-[11px] font-medium text-gray-700 dark:text-zinc-300 truncate">
                  {p.profiles?.username ?? "Utilisateur"}
                  {p.invitee_id === outing.creator_id && (
                    <span className="ml-1 text-[9px] text-indigo-500 font-semibold">organisateur</span>
                  )}
                </span>
              </div>
            ))}
            {pending.map(p => (
              <div key={p.invitee_id} className="flex items-center gap-2 opacity-50">
                <div className="h-6 w-6 rounded-full bg-gray-300 dark:bg-zinc-700 overflow-hidden flex items-center justify-center text-[9px] font-bold text-gray-500">
                  {p.profiles?.avatar_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={p.profiles.avatar_url} alt="" className="h-full w-full object-cover" />
                    : (p.profiles?.username ?? "?").charAt(0).toUpperCase()}
                </div>
                <span className="text-[11px] text-gray-400 dark:text-zinc-500 truncate">
                  {p.profiles?.username ?? "Utilisateur"} <span className="text-[9px]">· en attente</span>
                </span>
              </div>
            ))}
            {declined.map(p => (
              <div key={p.invitee_id} className="flex items-center gap-2 opacity-40">
                <div className="h-6 w-6 rounded-full bg-red-200 dark:bg-red-900/30 overflow-hidden flex items-center justify-center text-[9px] font-bold text-red-400">
                  {p.profiles?.avatar_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={p.profiles.avatar_url} alt="" className="h-full w-full object-cover" />
                    : (p.profiles?.username ?? "?").charAt(0).toUpperCase()}
                </div>
                <span className="text-[11px] text-gray-400 dark:text-zinc-500 truncate line-through">
                  {p.profiles?.username ?? "Utilisateur"}
                </span>
                <span className="text-[9px] text-red-400 no-underline">a décliné</span>
              </div>
            ))}
          </div>
        )}

        {/* Footer actions (Invitations tab) */}
        {isCreator && onEdit && (
          <div className="flex gap-2 pt-1 border-t border-gray-100 dark:border-white/[0.05] mt-1">
            <button
              onClick={onEdit}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 px-3 py-2 text-[12px] font-semibold text-indigo-600 dark:text-indigo-400 transition-colors hover:bg-indigo-100 dark:hover:bg-indigo-500/20"
            >
              <CalendarPlus size={12} /> Modifier
            </button>
            <button
              onClick={() => onCancel(outing.id)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-50 dark:bg-red-500/10 px-3 py-2 text-[12px] font-semibold text-red-500 dark:text-red-400 transition-colors hover:bg-red-100 dark:hover:bg-red-500/20"
            >
              <CalendarX size={12} /> Annuler
            </button>
          </div>
        )}
        {!isCreator && onWithdraw && (
          <div className="pt-1 border-t border-gray-100 dark:border-white/[0.05] mt-1">
            <button
              onClick={onWithdraw}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-red-50 dark:bg-red-500/10 px-3 py-2 text-[12px] font-semibold text-red-500 dark:text-red-400 transition-colors hover:bg-red-100 dark:hover:bg-red-500/20"
            >
              <CalendarX size={12} /> Se désister
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function OutingCard({
  outing, currentUserId, onCancel, past = false,
}: {
  outing: Outing; currentUserId: string; onCancel: (id: string) => void; past?: boolean
}) {
  const isCreator = outing.creator_id === currentUserId
  const invitations = outing.outing_invitations ?? []
  const accepted = invitations.filter(i => i.status === "accepted")
  const pending = invitations.filter(i => i.status === "pending")
  const declined = invitations.filter(i => i.status === "declined")

  return (
    <div className={`rounded-xl border p-3 transition-all ${
      past ? "opacity-55" : ""
    } ${isCreator
      ? "border-indigo-500/20 dark:border-indigo-500/15 bg-indigo-500/[0.04] dark:bg-indigo-500/[0.04]"
      : "border-green-500/20 dark:border-green-500/15 bg-green-500/[0.04] dark:bg-green-500/[0.04]"
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-gray-900 dark:text-white truncate">
            {outing.title}
          </p>
          {outing.scheduled_at && (
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-gray-500 dark:text-zinc-500">
              <Calendar size={9} />
              {formatOutingDate(outing.scheduled_at)}
            </p>
          )}
          {outing.location_name && (
            <p className="flex items-center gap-1 text-[11px] text-gray-400 dark:text-zinc-600">
              <MapPin size={9} />{outing.location_name}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          {(() => { const cd = getCountdown(outing.scheduled_at); return cd ? (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${cd.urgent ? "bg-orange-100 dark:bg-orange-500/15 text-orange-600 dark:text-orange-400" : "bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400"}`}>
              {cd.label}
            </span>
          ) : null })()}
          {isCreator && !past && (
            <button
              onClick={() => onCancel(outing.id)}
              title="Annuler la sortie"
              className="flex h-6 w-6 items-center justify-center rounded-lg text-gray-400 dark:text-zinc-600 transition-all hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-500"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Attendees row */}
      {invitations.length > 0 && (
        <div className="mt-2.5 flex items-center gap-2">
          {/* Avatar stack for accepted */}
          {accepted.length > 0 && (
            <div className="flex -space-x-2">
              {accepted.slice(0, 5).map(inv => (
                <div
                  key={inv.invitee_id}
                  className="h-6 w-6 rounded-full border-2 border-white dark:border-[#0e0e12] bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center text-[9px] font-bold text-white overflow-hidden flex-shrink-0"
                  title={inv.profiles?.username ?? ""}
                >
                  {inv.profiles?.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={inv.profiles.avatar_url} alt="avatar" className="h-full w-full object-cover" />
                  ) : (inv.profiles?.username ?? "?").charAt(0).toUpperCase()}
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-500 dark:text-zinc-500 flex items-center gap-1.5">
            {accepted.length > 0 && (
              <span className="flex items-center gap-0.5 text-green-600 dark:text-green-400 font-medium">
                <CalendarCheck size={9} />{accepted.length} vont
              </span>
            )}
            {pending.length > 0 && (
              <span className="text-gray-400 dark:text-zinc-600">
                · {pending.length} en attente
              </span>
            )}
            {declined.length > 0 && (
              <span className="flex items-center gap-0.5 text-red-400">
                <CalendarX size={9} />{declined.length} non
              </span>
            )}
          </p>
        </div>
      )}

      {/* "Créé par" for outings you were invited to */}
      {!isCreator && outing.profiles?.username && (
        <p className="mt-1.5 text-[10px] text-gray-400 dark:text-zinc-600">
          Proposé par @{outing.profiles.username}
        </p>
      )}
    </div>
  )
}

function OutingInvitationCard({
  invitation, onAccept, onDecline, spots, onSelectSpot,
}: {
  invitation: OutingInvitationFull
  onAccept: () => void
  onDecline: () => void
  spots?: Array<{ id: string; image_url?: string | null; lat?: number; lng?: number }>
  onSelectSpot?: (id: string) => void
}) {
  const [loading, setLoading] = useState(false)
  const [showAttendees, setShowAttendees] = useState(false)

  const outing = invitation.outings
  const creator = outing?.profiles
  const allInvitations = outing?.allInvitations ?? []
  const appSpot = outing?.spot_id ? spots?.find(s => s.id === outing.spot_id) : null
  const photoUrl = appSpot?.image_url?.split(",")[0]?.trim()
    ?? (outing?.lat && outing?.lng
      ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${outing.lng},${outing.lat},14,0/400x180?access_token=${process.env.NEXT_PUBLIC_MAPBOX_TOKEN}`
      : null)

  const handle = async (fn: () => void) => {
    setLoading(true)
    await fn()
    setLoading(false)
  }

  const statusConfig = {
    accepted: { label: "Participe", color: "text-green-600 dark:text-green-400", bg: "bg-green-50 dark:bg-green-500/10", dot: "bg-green-500" },
    pending:  { label: "En attente", color: "text-gray-400 dark:text-zinc-500", bg: "bg-gray-50 dark:bg-zinc-800", dot: "bg-gray-300 dark:bg-zinc-600" },
    declined: { label: "A décliné", color: "text-red-400 dark:text-red-500", bg: "bg-red-50 dark:bg-red-500/10", dot: "bg-red-400" },
  }

  return (
    <div className="rounded-2xl overflow-hidden border border-gray-100 dark:border-white/[0.07] bg-white dark:bg-zinc-900 shadow-sm">

      {/* Photo du spot */}
      {photoUrl ? (
        <button
          onClick={() => appSpot && onSelectSpot?.(appSpot.id)}
          disabled={!appSpot}
          className={`relative block w-full h-40 overflow-hidden ${appSpot ? "cursor-pointer" : "cursor-default"}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoUrl} alt={outing?.title} className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 px-3 pb-3">
            <p className="text-white font-bold text-[14px] leading-tight truncate">{outing?.title}</p>
            {outing?.location_name && (
              <p className="flex items-center gap-1 text-white/70 text-[11px] mt-0.5">
                <MapPin size={9} />{outing.location_name}
              </p>
            )}
          </div>
          {appSpot && (
            <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-white/20 backdrop-blur-sm px-2 py-1">
              <MapPin size={9} className="text-white" />
              <span className="text-[10px] font-semibold text-white">Voir le spot</span>
            </div>
          )}
          {outing?.scheduled_at && (
            <div className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-black/40 backdrop-blur-sm px-2 py-1">
              <Calendar size={9} className="text-white/80" />
              <span className="text-[10px] font-medium text-white/90">{formatOutingDate(outing.scheduled_at)}</span>
            </div>
          )}
        </button>
      ) : (
        <div className="px-3 pt-3 pb-1">
          <p className="font-bold text-[14px]">{outing?.title}</p>
          {outing?.scheduled_at && (
            <p className="flex items-center gap-1 text-[11px] text-violet-500 mt-0.5">
              <Calendar size={9} />{formatOutingDate(outing.scheduled_at)}
            </p>
          )}
          {outing?.location_name && (
            <p className="flex items-center gap-1 text-[11px] text-gray-400 dark:text-zinc-500">
              <MapPin size={9} />{outing.location_name}
            </p>
          )}
        </div>
      )}

      <div className="px-3 pt-3 pb-3 space-y-3">

        {/* Description du créateur */}
        {outing?.description && (
          <div className="flex items-start gap-2">
            <div className="h-7 w-7 flex-shrink-0 rounded-full bg-gradient-to-br from-violet-400 to-indigo-500 overflow-hidden flex items-center justify-center text-[10px] font-bold text-white">
              {creator?.avatar_url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={creator.avatar_url} alt="" className="h-full w-full object-cover" />
                : (creator?.username?.[0]?.toUpperCase() ?? "?")}
            </div>
            <div className="flex-1 min-w-0 bg-violet-50 dark:bg-violet-500/10 rounded-2xl rounded-tl-sm px-3 py-2">
              <p className="text-[12px] text-gray-700 dark:text-zinc-200">{outing.description}</p>
            </div>
          </div>
        )}

        {/* Participants invités */}
        {(creator || allInvitations.length > 0) && (() => {
          const accepted = allInvitations.filter(i => i.status === "accepted")
          const pending = allInvitations.filter(i => i.status === "pending")
          const declined = allInvitations.filter(i => i.status === "declined")
          const creatorEntry = { invitee_id: outing?.creator_id ?? "", status: "accepted" as const, id: "creator", profiles: creator }
          const allGoing = [creatorEntry, ...accepted]
          const totalShown = Math.min(allGoing.length, 4) + Math.min(pending.length, 3)
          const totalAll = allGoing.length + pending.length
          return (
            <div>
              <button
                onClick={() => setShowAttendees(v => !v)}
                className="flex items-center gap-2 w-full text-left"
              >
                <div className="flex -space-x-2">
                  {allGoing.slice(0, 4).map((p, i) => (
                    <div key={p.invitee_id + i} className="h-7 w-7 rounded-full border-2 border-white dark:border-zinc-900 bg-gradient-to-br from-indigo-400 to-purple-500 overflow-hidden flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">
                      {p.profiles?.avatar_url
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={p.profiles.avatar_url} alt="" className="h-full w-full object-cover" />
                        : (p.profiles?.username?.[0]?.toUpperCase() ?? "?")}
                    </div>
                  ))}
                  {pending.slice(0, 3).map((p, i) => (
                    <div key={"pending-" + p.invitee_id + i} className="h-7 w-7 rounded-full border-2 border-white dark:border-zinc-900 bg-gray-300 dark:bg-zinc-600 overflow-hidden flex items-center justify-center text-[9px] font-bold text-gray-500 dark:text-zinc-300 flex-shrink-0 opacity-60">
                      {p.profiles?.avatar_url
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={p.profiles.avatar_url} alt="" className="h-full w-full object-cover opacity-60" />
                        : (p.profiles?.username?.[0]?.toUpperCase() ?? "?")}
                    </div>
                  ))}
                  {totalAll > totalShown && (
                    <div className="h-7 w-7 rounded-full border-2 border-white dark:border-zinc-900 bg-gray-200 dark:bg-zinc-700 flex items-center justify-center text-[9px] font-bold text-gray-500 dark:text-zinc-400">
                      +{totalAll - totalShown}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 text-[11px]">
                  <span className="font-semibold text-green-600 dark:text-green-400">{allGoing.length} {allGoing.length > 1 ? "vont" : "va"}</span>
                  {pending.length > 0 && <span className="text-gray-400 dark:text-zinc-600">· {pending.length} en attente</span>}
                  {declined.length > 0 && <span className="text-red-400 dark:text-red-500">· {declined.length} décliné</span>}
                  <ChevronDown size={10} className={`text-gray-400 transition-transform ${showAttendees ? "rotate-180" : ""}`} />
                </div>
              </button>

              {showAttendees && (
                <div className="mt-2 rounded-xl border border-gray-100 dark:border-white/[0.06] bg-gray-50 dark:bg-zinc-800/60 p-2 space-y-1.5">
                  {allGoing.map((p, i) => (
                    <div key={p.invitee_id + i} className="flex items-center gap-2">
                      <div className="h-6 w-6 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 overflow-hidden flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">
                        {p.profiles?.avatar_url
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={p.profiles.avatar_url} alt="" className="h-full w-full object-cover" />
                          : (p.profiles?.username?.[0]?.toUpperCase() ?? "?")}
                      </div>
                      <span className="text-[11px] font-medium text-gray-700 dark:text-zinc-300 truncate flex-1">
                        {p.profiles?.username ?? "Utilisateur"}
                        {p.invitee_id === outing?.creator_id && (
                          <span className="ml-1 text-[9px] text-indigo-500 font-semibold">organisateur</span>
                        )}
                        {p.invitee_id === invitation.invitee_id && (
                          <span className="ml-1 text-[9px] text-indigo-500 font-semibold">vous</span>
                        )}
                      </span>
                    </div>
                  ))}
                  {pending.map(p => (
                    <div key={p.invitee_id} className="flex items-center gap-2 opacity-50">
                      <div className="h-6 w-6 rounded-full bg-gray-300 dark:bg-zinc-700 overflow-hidden flex items-center justify-center text-[9px] font-bold text-gray-500 flex-shrink-0">
                        {p.profiles?.avatar_url
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={p.profiles.avatar_url} alt="" className="h-full w-full object-cover" />
                          : (p.profiles?.username?.[0]?.toUpperCase() ?? "?")}
                      </div>
                      <span className="text-[11px] text-gray-400 dark:text-zinc-500 truncate flex-1">
                        {p.profiles?.username ?? "Utilisateur"}
                        {p.invitee_id === invitation.invitee_id && (
                          <span className="ml-1 text-[9px] text-indigo-500 font-semibold">vous</span>
                        )}
                        <span className="text-[9px]"> · en attente</span>
                      </span>
                    </div>
                  ))}
                  {declined.map(p => (
                    <div key={p.invitee_id} className="flex items-center gap-2 opacity-40">
                      <div className="h-6 w-6 rounded-full bg-red-200 dark:bg-red-900/30 overflow-hidden flex items-center justify-center text-[9px] font-bold text-red-400 flex-shrink-0">
                        {p.profiles?.avatar_url
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={p.profiles.avatar_url} alt="" className="h-full w-full object-cover" />
                          : (p.profiles?.username?.[0]?.toUpperCase() ?? "?")}
                      </div>
                      <span className="text-[11px] text-gray-400 dark:text-zinc-500 truncate line-through flex-1">
                        {p.profiles?.username ?? "Utilisateur"}
                      </span>
                      <span className="text-[9px] text-red-400">a décliné</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })()}

        {/* Participer / Décliner */}
        <div className="flex gap-2 pt-1 border-t border-gray-100 dark:border-white/[0.06]">
          <button
            onClick={() => handle(onAccept)}
            disabled={loading}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-green-500 py-2 text-[12px] font-bold text-white shadow-sm shadow-green-500/25 transition-all active:scale-[0.98] disabled:opacity-50"
          >
            {loading ? <LoaderCircle size={12} className="animate-spin" /> : <><CalendarCheck size={12} /> Participer</>}
          </button>
          <button
            onClick={() => handle(onDecline)}
            disabled={loading}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-zinc-900 py-2 text-[12px] font-semibold text-gray-600 dark:text-zinc-400 transition-all active:scale-[0.98] disabled:opacity-50"
          >
            {loading ? <LoaderCircle size={12} className="animate-spin" /> : <><CalendarX size={12} /> Décliner</>}
          </button>
        </div>
      </div>
    </div>
  )
}
