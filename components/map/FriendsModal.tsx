"use client"

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
  UserMinus,
  CalendarPlus,
  ArrowLeft,
  Calendar,
  CalendarCheck,
  CalendarX,
  ChevronRight,
  Trophy,
  Heart,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import type { User } from "@supabase/supabase-js"

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
  profiles?: { username: string | null; avatar_url: string | null }
}

interface Outing {
  id: string
  creator_id: string
  title: string
  description?: string | null
  location_name?: string | null
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
  outings?: Outing & {
    profiles?: { username: string | null; avatar_url: string | null }
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
  onLocateFriend?: (lat: number, lng: number) => void
  onSelectUser?: (id: string) => void
  spots?: Array<{ user_id: string; created_at: string; profiles?: { username: string | null; avatar_url: string | null } }>
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
  onLocateFriend,
  onSelectUser,
  spots,
  userProfile,
}: FriendsModalProps) {
  // ── UI state ────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>("amis")
  const [showCreateOuting, setShowCreateOuting] = useState(false)
  const [query, setQuery] = useState("")

  // ── Data state ──────────────────────────────────────────────
  const [searchResults, setSearchResults] = useState<Profile[]>([])
  const [following, setFollowing] = useState<Profile[]>([])
  const [pendingSent, setPendingSent] = useState<string[]>([])
  const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([])
  const [suggestions, setSuggestions] = useState<SuggestionProfile[]>([])
  const [outings, setOutings] = useState<Outing[]>([])
  const [outingInvitations, setOutingInvitations] = useState<OutingInvitationFull[]>([])

  // ── Loading state ───────────────────────────────────────────
  const [searchLoading, setSearchLoading] = useState(false)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)

  // ── Create outing form ──────────────────────────────────────
  const [createForm, setCreateForm] = useState({
    title: "",
    description: "",
    scheduled_at: "",
  })
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // ── Location search ─────────────────────────────────────────
  const [locationQuery, setLocationQuery] = useState("")
  const [locationResults, setLocationResults] = useState<LocationResult[]>([])
  const [selectedLocation, setSelectedLocation] = useState<LocationResult | null>(null)
  const [locationLoading, setLocationLoading] = useState(false)

  // ── Top liked spots ─────────────────────────────────────────
  type TopSpot = { id: string; title: string; image_url: string | null; username: string | null; likeCount: number }
  const [topSpots, setTopSpots] = useState<TopSpot[]>([])
  const [topSpotsLoading, setTopSpotsLoading] = useState(false)

  const supabaseRef = useRef(createClient())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const locationDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ─── Loaders ────────────────────────────────────────────────

  const loadFollowing = useCallback(
    async (customIds?: string[]) => {
      const ids = customIds ?? followingIds
      if (!currentUser || ids.length === 0) { setFollowing([]); return }
      try {
        const { data } = await supabaseRef.current
          .from("profiles")
          .select("id, username, avatar_url, last_lat, last_lng, last_active_at, is_ghost_mode")
          .in("id", ids)
        setFollowing((data as Profile[]) ?? [])
      } catch { setFollowing([]) }
    },
    [currentUser, followingIds]
  )

  const loadSentRequests = useCallback(async () => {
    if (!currentUser) return
    try {
      const { data } = await supabaseRef.current
        .from("friend_requests").select("to_id")
        .eq("from_id", currentUser.id).eq("status", "pending")
      if (data) setPendingSent(data.map((r: { to_id: string }) => r.to_id))
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
    if (!currentUser) return
    setSuggestionsLoading(true)
    try {
      if (followingIds.length === 0) {
        // No friends yet — show recently active users
        const { data } = await supabaseRef.current
          .from("profiles").select("id, username, avatar_url, last_active_at")
          .neq("id", currentUser.id)
          .not("last_active_at", "is", null)
          .order("last_active_at", { ascending: false }).limit(10)
        setSuggestions((data ?? []).map(u => ({ ...(u as Profile), mutualCount: 0 })))
        setSuggestionsLoading(false)
        return
      }

      const excludeIds = [currentUser.id, ...followingIds]
      const { data } = await supabaseRef.current
        .from("followers").select("following_id")
        .in("follower_id", followingIds)
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
          setSuggestionsLoading(false)
          return
        }
      }

      // Fallback: recently active users
      const { data: recent } = await supabaseRef.current
        .from("profiles").select("id, username, avatar_url, last_active_at")
        .not("id", "in", `(${excludeIds.join(",")})`)
        .not("last_active_at", "is", null)
        .order("last_active_at", { ascending: false }).limit(10)
      if (recent) setSuggestions(recent as SuggestionProfile[])
    } catch {}
    setSuggestionsLoading(false)
  }, [currentUser, followingIds])

  const loadOutings = useCallback(async () => {
    if (!currentUser) return
    try {
      // Sorties que j'ai créées (actives)
      const { data: created } = await supabaseRef.current
        .from("outings")
        .select(`
          *,
          profiles!outings_creator_id_fkey(username, avatar_url),
          outing_invitations(
            id, invitee_id, status,
            profiles!outing_invitations_invitee_id_fkey(username, avatar_url)
          )
        `)
        .eq("creator_id", currentUser.id)
        .eq("status", "active")
        .order("scheduled_at", { ascending: true })

      // Sorties auxquelles j'ai accepté d'aller (mais pas créées par moi)
      const { data: attending } = await supabaseRef.current
        .from("outing_invitations")
        .select(`
          outing_id,
          outings(
            *,
            profiles!outings_creator_id_fkey(username, avatar_url),
            outing_invitations(
              id, invitee_id, status,
              profiles!outing_invitations_invitee_id_fkey(username, avatar_url)
            )
          )
        `)
        .eq("invitee_id", currentUser.id)
        .eq("status", "accepted")

      const all: Outing[] = []
      if (created) all.push(...(created as unknown as Outing[]))
      if (attending) {
        for (const inv of attending as any[]) {
          const o = inv.outings as Outing
          if (o && !all.find(a => a.id === o.id)) all.push(o)
        }
      }
      all.sort((a, b) => {
        if (!a.scheduled_at) return 1
        if (!b.scheduled_at) return -1
        return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
      })
      setOutings(all)
    } catch {
      // Table pas encore créée — fonctionnera après la migration SQL
    }
  }, [currentUser])

  const loadOutingInvitations = useCallback(async () => {
    if (!currentUser) return
    try {
      const { data } = await supabaseRef.current
        .from("outing_invitations")
        .select("*, outings(*, profiles!outings_creator_id_fkey(username, avatar_url))")
        .eq("invitee_id", currentUser.id)
        .eq("status", "pending")
      if (data) setOutingInvitations(data as unknown as OutingInvitationFull[])
    } catch {}
  }, [currentUser])

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

  const monthlyRanking = useMemo<RankEntry[]>(() => {
    if (!spots?.length) return []
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    // Include following + current user
    const includedIds = new Set([...followingIds, ...(currentUser ? [currentUser.id] : [])])
    const counts: Record<string, { username: string | null; avatar_url: string | null; count: number }> = {}
    spots.forEach(s => {
      if (!includedIds.has(s.user_id)) return
      if (new Date(s.created_at) < startOfMonth) return
      if (!counts[s.user_id]) {
        // For current user, prefer userProfile data
        const username = s.user_id === currentUser?.id
          ? (userProfile?.username ?? s.profiles?.username ?? null)
          : (s.profiles?.username ?? null)
        const avatar_url = s.user_id === currentUser?.id
          ? (userProfile?.avatar_url ?? s.profiles?.avatar_url ?? null)
          : (s.profiles?.avatar_url ?? null)
        counts[s.user_id] = { username, avatar_url, count: 0 }
      }
      counts[s.user_id].count++
    })
    return Object.entries(counts)
      .map(([userId, v]) => ({ userId, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
  }, [spots, followingIds, currentUser, userProfile])

  // ─── Effect: fetch top liked spots when classement tab opens ───

  useEffect(() => {
    if (activeTab !== "classement" || !isOpen) return
    setTopSpotsLoading(true)
    supabaseRef.current
      .from("spot_reactions")
      .select("spot_id, spots(id, title, image_url, profiles(username))")
      .eq("type", "love")
      .then(({ data }) => {
        if (!data) { setTopSpots([]); setTopSpotsLoading(false); return }
        const counts: Record<string, { id: string; title: string; image_url: string | null; username: string | null; count: number }> = {}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data.forEach((r: any) => {
          const spot = Array.isArray(r.spots) ? r.spots[0] : r.spots
          if (!spot) return
          if (!counts[r.spot_id]) {
            const profile = Array.isArray(spot.profiles) ? spot.profiles[0] : spot.profiles
            counts[r.spot_id] = { id: spot.id, title: spot.title, image_url: spot.image_url ?? null, username: profile?.username ?? null, count: 0 }
          }
          counts[r.spot_id].count++
        })
        const top3 = Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 3)
        setTopSpots(top3.map(s => ({ id: s.id, title: s.title, image_url: s.image_url, username: s.username, likeCount: s.count })))
        setTopSpotsLoading(false)
      })
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
      .subscribe()

    return () => { supabaseRef.current.removeChannel(channel) }
  }, [
    isOpen, currentUser,
    loadFollowing, loadSentRequests, loadIncomingRequests,
    loadSuggestions, loadOutings, loadOutingInvitations, onRefreshFollowing,
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
      setPendingSent(prev => [...prev, targetId])
    } catch (e) { console.error(e) }
    setLoadingId(null)
  }

  const cancelRequest = async (targetId: string) => {
    if (!currentUser) return
    setLoadingId(targetId)
    try {
      await supabaseRef.current.from("friend_requests").delete()
        .eq("from_id", currentUser.id).eq("to_id", targetId)
      setPendingSent(prev => prev.filter(id => id !== targetId))
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

  const createOuting = async () => {
    if (!currentUser) return
    setCreateError(null)
    if (selectedFriendIds.length === 0) { setCreateError("Invite au moins un ami."); return }
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

      setShowCreateOuting(false)
      setCreateForm({ title: "", description: "", scheduled_at: "" })
      setSelectedFriendIds([])
      setSelectedLocation(null)
      setLocationQuery("")
      setLocationResults([])
      loadOutings()
    } catch (e: any) {
      setCreateError(e?.message?.includes("relation")
        ? "La fonctionnalité sortie n'est pas encore activée. Lance la migration SQL outings."
        : "Erreur lors de la création. Réessaie.")
      console.error("createOuting:", e)
    }
    setCreating(false)
  }

  const cancelOuting = async (outingId: string) => {
    if (!currentUser) return
    try {
      await supabaseRef.current.from("outings")
        .update({ status: "cancelled" })
        .eq("id", outingId).eq("creator_id", currentUser.id)
      setOutings(prev => prev.filter(o => o.id !== outingId))
    } catch {}
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
  const isPending = (id: string) => pendingSent.includes(id)

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
            drag="y"
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
                      onClick={() => { setActiveTab(tab.id); setQuery("") }}
                      className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-[11px] font-semibold transition-all duration-200 ${
                        activeTab === tab.id
                          ? "bg-white dark:bg-zinc-800 text-gray-900 dark:text-white shadow-sm ring-1 ring-black/[0.06] dark:ring-white/[0.08]"
                          : "text-gray-500 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300"
                      }`}
                    >
                      {tab.icon}
                      {tab.label}
                      {tab.id === "invitations" && totalInvitations > 0 && (
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
              <div className="flex-1 overflow-y-auto px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:pb-6">

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

                    {/* Sorties à venir */}
                    {upcomingOutings.length > 0 && query.length < 2 && (
                      <Section
                        title="Sorties à venir"
                        icon={<CalendarCheck size={10} />}
                        badge={
                          <span className="rounded-full bg-green-500/10 dark:bg-green-500/15 px-2 py-0.5 text-[10px] font-semibold text-green-600 dark:text-green-400">
                            {upcomingOutings.length}
                          </span>
                        }
                      >
                        {upcomingOutings.map(outing => (
                          <OutingCard
                            key={outing.id}
                            outing={outing}
                            currentUserId={currentUser?.id ?? ""}
                            onCancel={cancelOuting}
                          />
                        ))}
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
                    {/* Suggestions carousel (only when not searching) */}
                    {query.length < 2 && suggestions.length > 0 && (
                      <div>
                        <div className="mb-2 flex items-center gap-1.5">
                          <Sparkles size={10} className="text-gray-400 dark:text-zinc-600" />
                          <p className="text-[10px] font-semibold tracking-widest text-gray-400 dark:text-zinc-600 uppercase">
                            Suggestions
                          </p>
                        </div>
                        <div className="no-scrollbar flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
                          {suggestions.slice(0, 8).map(profile => (
                            <div key={profile.id} className="flex-shrink-0 flex flex-col items-center gap-1.5 w-[60px]">
                              <div className="relative">
                                <div className="h-11 w-11 overflow-hidden rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-sm font-bold text-white">
                                  {profile.avatar_url ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={profile.avatar_url} alt="avatar" className="h-full w-full object-cover" />
                                  ) : initials(profile.username)}
                                </div>
                                {(profile.mutualCount ?? 0) > 0 && (
                                  <span className="absolute -bottom-0.5 -right-0.5 flex h-[14px] min-w-[14px] items-center justify-center rounded-full border border-white dark:border-[#0e0e12] bg-indigo-500 text-[8px] font-bold text-white px-0.5">
                                    {profile.mutualCount}
                                  </span>
                                )}
                              </div>
                              <span className="w-full truncate text-center text-[9px] font-medium text-gray-500 dark:text-zinc-500">
                                {profile.username ?? "?"}
                              </span>
                              <button
                                onClick={() => !isPending(profile.id) ? sendRequest(profile.id) : cancelRequest(profile.id)}
                                disabled={loadingId === profile.id}
                                className={`w-full rounded-lg px-1 py-1 text-[9px] font-bold transition-all active:scale-95 disabled:opacity-50 ${
                                  isPending(profile.id)
                                    ? "bg-gray-100 dark:bg-zinc-800 text-gray-400 dark:text-zinc-500"
                                    : "bg-indigo-500 text-white hover:bg-indigo-400"
                                }`}
                              >
                                {loadingId === profile.id ? "…" : isPending(profile.id) ? "✓ Envoyé" : "+ Suivre"}
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ════ CLASSEMENT ══════════════════════════════ */}
                {activeTab === "classement" && (
                  <div className="space-y-5">
                    {/* Top 3 lieux les plus likés */}
                    <div>
                      <p className="text-[10px] font-semibold text-gray-400 dark:text-zinc-600 uppercase tracking-widest mb-2">
                        Top lieux les plus aimés
                      </p>
                      {topSpotsLoading ? (
                        <div className="flex justify-center py-3">
                          <LoaderCircle size={16} className="animate-spin text-gray-400" />
                        </div>
                      ) : topSpots.length === 0 ? (
                        <p className="text-[12px] text-gray-400 dark:text-zinc-600 py-1">Aucun like pour l&apos;instant</p>
                      ) : (
                        <div className="space-y-2">
                          {topSpots.map((spot, i) => (
                            <div key={spot.id} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${
                              i === 0 ? "bg-amber-50 dark:bg-amber-500/[0.06] border border-amber-200/60 dark:border-amber-500/20" :
                              i === 1 ? "bg-gray-50 dark:bg-zinc-800/50 border border-gray-200/60 dark:border-white/[0.04]" :
                              "bg-orange-50 dark:bg-orange-500/[0.06] border border-orange-200/60 dark:border-orange-500/20"
                            }`}>
                              <span className="text-lg leading-none w-7 text-center flex-shrink-0">
                                {i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉"}
                              </span>
                              {spot.image_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={spot.image_url} alt={spot.title} className="h-9 w-9 flex-shrink-0 rounded-lg object-cover" />
                              ) : (
                                <div className="h-9 w-9 flex-shrink-0 rounded-lg bg-gray-100 dark:bg-zinc-800 flex items-center justify-center">
                                  <MapPin size={14} className="text-gray-400 dark:text-zinc-600" />
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[13px] font-semibold text-gray-900 dark:text-white">{spot.title}</p>
                                <p className="text-[10px] text-gray-400 dark:text-zinc-600">par @{spot.username ?? "?"}</p>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <Heart size={12} className="fill-red-500 text-red-500" />
                                <span className={`text-[14px] font-bold ${
                                  i === 0 ? "text-amber-500" :
                                  i === 1 ? "text-gray-400 dark:text-zinc-500" :
                                  "text-orange-400"
                                }`}>{spot.likeCount}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Classement mensuel */}
                    <div className="space-y-3">
                    {monthlyRanking.length === 0 ? (
                      <EmptyState
                        icon={<Trophy size={24} />}
                        text="Aucun classement ce mois-ci"
                        sub="Le classement apparaît quand tes amis ajoutent des spots !"
                      />
                    ) : (
                      <>
                        <p className="text-[10px] font-semibold text-gray-400 dark:text-zinc-600 uppercase tracking-widest">
                          Spots ajoutés en {new Date().toLocaleDateString("fr-FR", { month: "long" })}
                        </p>
                        {monthlyRanking.map((entry, i) => {
                          const medals = ["🥇", "🥈", "🥉"]
                          const medal = medals[i]
                          const isMe = entry.userId === currentUser?.id
                          return (
                            <div key={entry.userId} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all ${
                              isMe ? "bg-indigo-50 dark:bg-indigo-500/[0.07] border-2 border-indigo-300/60 dark:border-indigo-500/30" :
                              i === 0 ? "bg-amber-50 dark:bg-amber-500/[0.06] border border-amber-200/60 dark:border-amber-500/20" :
                              i === 1 ? "bg-gray-50 dark:bg-zinc-800/50 border border-gray-200/60 dark:border-white/[0.04]" :
                              i === 2 ? "bg-orange-50 dark:bg-orange-500/[0.06] border border-orange-200/60 dark:border-orange-500/20" :
                              "hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                            }`}>
                              <div className="w-7 flex-shrink-0 text-center">
                                {medal
                                  ? <span className="text-lg leading-none">{medal}</span>
                                  : <span className="text-[11px] font-bold text-gray-400 dark:text-zinc-600">#{i + 1}</span>}
                              </div>
                              <div className={`h-9 w-9 flex-shrink-0 overflow-hidden rounded-full flex items-center justify-center text-sm font-bold text-white ${isMe ? "bg-gradient-to-br from-blue-500 to-indigo-600 ring-2 ring-indigo-400/50" : "bg-gradient-to-br from-indigo-500 to-purple-600"}`}>
                                {entry.avatar_url ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={entry.avatar_url} alt="avatar" className="h-full w-full object-cover" />
                                ) : (entry.username?.[0]?.toUpperCase() ?? "?")}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[13px] font-semibold text-gray-900 dark:text-white flex items-center gap-1.5">
                                  @{entry.username ?? "utilisateur"}
                                  {isMe && <span className="rounded-full bg-indigo-500/15 px-1.5 py-0.5 text-[9px] font-bold text-indigo-600 dark:text-indigo-400">Vous</span>}
                                </p>
                                <p className="text-[10px] text-gray-400 dark:text-zinc-600">
                                  {entry.count} spot{entry.count > 1 ? "s" : ""} ce mois
                                </p>
                              </div>
                              <span className={`text-[15px] font-bold ${
                                isMe ? "text-indigo-500 dark:text-indigo-400" :
                                i === 0 ? "text-amber-500" :
                                i === 1 ? "text-gray-400 dark:text-zinc-500" :
                                i === 2 ? "text-orange-400" :
                                "text-gray-500 dark:text-zinc-500"
                              }`}>
                                {entry.count}
                              </span>
                            </div>
                          )
                        })}
                      </>
                    )}
                    </div>
                  </div>
                )}

                {/* ════ INVITATIONS ═════════════════════════════ */}
                {activeTab === "invitations" && (
                  <div className="space-y-5">
                    {/* Invitations de sortie */}
                    {outingInvitations.length > 0 && (
                      <Section
                        title="Sorties proposées"
                        icon={<CalendarPlus size={10} />}
                        badge={<span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-violet-500 px-1.5 text-[10px] font-bold text-white leading-none">{outingInvitations.length}</span>}
                      >
                        {outingInvitations.map(inv => (
                          <OutingInvitationCard
                            key={inv.id}
                            invitation={inv}
                            onAccept={() => respondToOuting(inv.id, "accepted")}
                            onDecline={() => respondToOuting(inv.id, "declined")}
                          />
                        ))}
                      </Section>
                    )}

                    {/* Invitations d'amis */}
                    {incomingRequests.length > 0 ? (
                      <Section
                        title="Demandes d'amis" icon={<Bell size={10} />}
                        badge={<span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white leading-none">{incomingRequests.length}</span>}
                      >
                        {incomingRequests.map(req => (
                          <InvitationRow
                            key={req.id} req={req}
                            loading={loadingId === req.from_id}
                            onAccept={() => acceptRequest(req)}
                            onDecline={() => declineRequest(req)}
                          />
                        ))}
                      </Section>
                    ) : outingInvitations.length === 0 ? (
                      <EmptyState
                        icon={<Bell size={24} />}
                        text="Aucune invitation"
                        sub="Les demandes d'amis et sorties apparaîtront ici"
                      />
                    ) : null}

                    {/* Demandes envoyées */}
                    {pendingSent.length > 0 && (
                      <Section title="Demandes envoyées" icon={<Clock size={10} />}>
                        {pendingSent.map(id => (
                          <div key={id} className="flex items-center gap-3 rounded-xl px-3 py-2.5 bg-gray-50 dark:bg-zinc-900">
                            <div className="h-9 w-9 flex-shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-xs font-bold text-white">
                              {id.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-gray-600 dark:text-zinc-400 truncate">{id.slice(0, 12)}…</p>
                              <p className="text-[10px] text-gray-400 dark:text-zinc-600">En attente de réponse</p>
                            </div>
                            <button
                              onClick={() => cancelRequest(id)}
                              disabled={loadingId === id}
                              className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-gray-400 dark:text-zinc-600 transition-colors hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                            >
                              {loadingId === id ? <LoaderCircle size={11} className="animate-spin" /> : <><UserMinus size={11} /> Annuler</>}
                            </button>
                          </div>
                        ))}
                      </Section>
                    )}
                  </div>
                )}
              </div>

              {/* ══ CREATE OUTING OVERLAY ══════════════════════════ */}
              <AnimatePresence>
                {showCreateOuting && (
                  <motion.div
                    initial={{ x: "100%" }}
                    animate={{ x: 0 }}
                    exit={{ x: "100%" }}
                    transition={{ type: "spring", stiffness: 380, damping: 34 }}
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
                      {/* Date & time */}
                      <div>
                        <label className="block mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-600">
                          Date et heure <span className="normal-case text-gray-300 dark:text-zinc-700">(optionnel)</span>
                        </label>
                        <input
                          type="datetime-local"
                          min={minDateTime}
                          value={createForm.scheduled_at}
                          onChange={e => setCreateForm(f => ({ ...f, scheduled_at: e.target.value }))}
                          className="w-full rounded-xl border border-gray-200 dark:border-white/[0.07] bg-gray-50 dark:bg-zinc-900 px-3.5 py-2.5 text-[15px] text-gray-900 dark:text-white outline-none transition-all focus:border-indigo-400/60 focus:ring-2 focus:ring-indigo-500/15 sm:text-sm"
                        />
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
                    </div>

                    {/* Submit */}
                    <div className="flex-shrink-0 border-t border-gray-100 dark:border-white/[0.06] bg-white/95 dark:bg-[#0e0e12]/95 backdrop-blur-sm px-5 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-4">
                      {createError && (
                        <p className="mb-2 rounded-xl bg-red-50 dark:bg-red-500/10 px-3 py-2 text-[12px] font-medium text-red-600 dark:text-red-400">
                          {createError}
                        </p>
                      )}
                      <button
                        onClick={createOuting}
                        disabled={creating || selectedFriendIds.length === 0}
                        className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-500 py-3 text-[14px] font-bold text-white shadow-md shadow-indigo-500/30 transition-all hover:bg-indigo-400 active:scale-[0.98] disabled:opacity-50 disabled:shadow-none"
                      >
                        {creating ? (
                          <><LoaderCircle size={15} className="animate-spin" /> Envoi en cours…</>
                        ) : (
                          <><CalendarPlus size={15} /> Envoyer les invitations ({selectedFriendIds.length})</>
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
        {isCreator && !past && (
          <button
            onClick={() => onCancel(outing.id)}
            title="Annuler la sortie"
            className="flex-shrink-0 flex h-6 w-6 items-center justify-center rounded-lg text-gray-400 dark:text-zinc-600 transition-all hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-500"
          >
            <X size={12} />
          </button>
        )}
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
  invitation, onAccept, onDecline,
}: {
  invitation: OutingInvitationFull; onAccept: () => void; onDecline: () => void
}) {
  const [loading, setLoading] = useState(false)
  const outing = invitation.outings
  const creatorName = outing?.profiles?.username

  const handle = async (fn: () => void) => {
    setLoading(true)
    await fn()
    setLoading(false)
  }

  return (
    <div className="rounded-xl border border-violet-500/15 dark:border-violet-500/20 bg-violet-500/[0.04] dark:bg-violet-500/[0.06] p-3.5">
      {/* Outing info */}
      <div className="flex items-start gap-3 mb-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-violet-500/10 dark:bg-violet-500/15">
          <CalendarPlus size={16} className="text-violet-600 dark:text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold text-gray-900 dark:text-white truncate">
            {outing?.title ?? "Sortie"}
          </p>
          {creatorName && (
            <p className="text-[11px] text-gray-400 dark:text-zinc-600">
              @{creatorName} t&apos;invite
            </p>
          )}
          {outing?.scheduled_at && (
            <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-violet-600 dark:text-violet-400">
              <Calendar size={9} />
              {formatOutingDate(outing.scheduled_at)}
            </p>
          )}
          {outing?.location_name && (
            <p className="flex items-center gap-1 text-[11px] text-gray-400 dark:text-zinc-600">
              <MapPin size={9} />{outing.location_name}
            </p>
          )}
          {outing?.description && (
            <p className="mt-1.5 text-[11px] text-gray-500 dark:text-zinc-500 line-clamp-2">
              {outing.description}
            </p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={() => handle(onAccept)}
          disabled={loading}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-green-500 py-2 text-[12px] font-bold text-white shadow-sm shadow-green-500/25 transition-all hover:bg-green-400 active:scale-[0.98] disabled:opacity-50"
        >
          {loading ? <LoaderCircle size={12} className="animate-spin" /> : <><CalendarCheck size={12} /> Participer</>}
        </button>
        <button
          onClick={() => handle(onDecline)}
          disabled={loading}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-zinc-900 py-2 text-[12px] font-semibold text-gray-600 dark:text-zinc-400 transition-all hover:bg-gray-50 dark:hover:bg-zinc-800 active:scale-[0.98] disabled:opacity-50"
        >
          {loading ? <LoaderCircle size={12} className="animate-spin" /> : <><CalendarX size={12} /> Décliner</>}
        </button>
      </div>
    </div>
  )
}
