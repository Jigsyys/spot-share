"use client"

import { useEffect, useRef, useState, useCallback, useMemo, startTransition } from "react"
import Map, { Marker as MapMarker, MapRef, Layer } from "react-map-gl/mapbox"
import "mapbox-gl/dist/mapbox-gl.css"
import { toast } from "sonner"
import {
  MapPin,
  Locate,
  Plus,
  Users,
  User,
  Share,
  Navigation,
  Search,
  X,
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Pencil,
  CheckCircle2,
  Heart,
  SlidersHorizontal,
  Shuffle,
  Layers,
  Settings,
  CalendarPlus,
  Check,
  LoaderCircle,
} from "lucide-react"
import { motion, AnimatePresence, useDragControls } from "framer-motion"
import useSupercluster from "use-supercluster"
import { cn, getOpeningStatus, getGoogleOpeningStatus } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/useAuth"
import { useTheme } from "next-themes"
import dynamic from "next/dynamic"
import UserMenu from "./UserMenu"
import type { Spot, FilterMode, SpotGroup } from "@/lib/types"

const AddSpotModal = dynamic(() => import("./AddSpotModal"), { ssr: false })
const EditSpotModal = dynamic(() => import("./EditSpotModal"), { ssr: false })
const FriendsModal = dynamic(() => import("./FriendsModal"), { ssr: false })
const PublicProfileModal = dynamic(() => import("./PublicProfileModal"), { ssr: false })
const ProfileModal = dynamic(() => import("./ProfileModal"), { ssr: false })
const OnboardingModal = dynamic(() => import("./OnboardingModal"), { ssr: false })
const ExploreModal = dynamic(() => import("./ExploreModal"), { ssr: false })
const GroupSettingsModal = dynamic(() => import("./GroupSettingsModal"), { ssr: false })
import { CATEGORY_EMOJIS as CAT_EMOJIS, CATEGORIES } from "@/lib/categories"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ""
const SPOTS_CACHE_KEY = "friendspot_spots_v2"
const SPOTS_CACHE_TTL = 10 * 60 * 1000 // 10 min
const PROFILE_CACHE_TTL = 30 * 60 * 1000 // 30 min
const FOLLOWING_CACHE_TTL = 15 * 60 * 1000 // 15 min
const LIKES_CACHE_TTL = 5 * 60 * 1000 // 5 min
const DARK_STYLE = "mapbox://styles/mapbox/dark-v11"
const LIGHT_STYLE = "mapbox://styles/mapbox/outdoors-v12"

// Couches à masquer complètement (géométrie autoroutes + POIs)
const LIGHT_HIDDEN_LAYERS = ["motorway", "trunk", "poi", "landmark", "monument", "tourism", "transit-label", "airport-label"]
// Classes de route à exclure des labels (numéros A1, A4…)
const LIGHT_HIDDEN_ROAD_CLASSES = ["motorway", "motorway_link", "trunk", "trunk_link"]

// ─── Push notifications helpers ─────────────────────────────────────────────
async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null
  try {
    const reg = await navigator.serviceWorker.register("/sw.js")
    return reg
  } catch { return null }
}

async function subscribeToPush(reg: ServiceWorkerRegistration): Promise<void> {
  try {
    const existing = await reg.pushManager.getSubscription()
    const sub = existing ?? await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    })
    const { endpoint, keys } = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint, p256dh: keys.p256dh, auth: keys.auth }),
    })
  } catch { /* ignore — user bloqué ou SW non dispo */ }
}

function geoDistKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371, dLat = ((lat2 - lat1) * Math.PI) / 180, dLng = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Couche fill-extrusion pour les bâtiments 3D — thème sombre
const BUILDINGS_LAYER = {
  id: "3d-buildings",
  source: "composite",
  "source-layer": "building",
  filter: ["==", "extrude", "true"],
  type: "fill-extrusion",
  minzoom: 10,
  paint: {
    "fill-extrusion-color": [
      "interpolate",
      ["linear"],
      ["get", "height"],
      0,
      "#1e1b4b",
      50,
      "#312e81",
      100,
      "#4338ca",
      200,
      "#6366f1",
      400,
      "#a5b4fc",
    ],
    "fill-extrusion-height": [
      "interpolate",
      ["linear"],
      ["zoom"],
      10,
      0,
      10.05,
      ["get", "height"],
    ],
    "fill-extrusion-base": [
      "interpolate",
      ["linear"],
      ["zoom"],
      10,
      0,
      10.05,
      ["get", "min_height"],
    ],
    "fill-extrusion-opacity": 0.85,
    "fill-extrusion-ambient-occlusion-intensity": 0.5,
    "fill-extrusion-ambient-occlusion-radius": 3,
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

// Couche fill-extrusion pour les bâtiments 3D — thème clair
const BUILDINGS_LAYER_LIGHT = {
  id: "3d-buildings",
  source: "composite",
  "source-layer": "building",
  filter: ["==", "extrude", "true"],
  type: "fill-extrusion",
  minzoom: 10,
  paint: {
    "fill-extrusion-color": [
      "interpolate",
      ["linear"],
      ["get", "height"],
      0,
      "#e2e8f0",
      50,
      "#cbd5e1",
      100,
      "#94a3b8",
      200,
      "#64748b",
      400,
      "#475569",
    ],
    "fill-extrusion-height": [
      "interpolate",
      ["linear"],
      ["zoom"],
      10,
      0,
      10.05,
      ["get", "height"],
    ],
    "fill-extrusion-base": [
      "interpolate",
      ["linear"],
      ["zoom"],
      10,
      0,
      10.05,
      ["get", "min_height"],
    ],
    "fill-extrusion-opacity": 0.65,
    "fill-extrusion-ambient-occlusion-intensity": 0.3,
    "fill-extrusion-ambient-occlusion-radius": 3,
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

const CATEGORY_COLORS: Record<string, string> = {
  café: "#F59E0B",
  restaurant: "#EF4444",
  bar: "#3B82F6",
  outdoor: "#10B981",
  vue: "#8B5CF6",
  culture: "#EC4899",
  shopping: "#F97316",
  other: "#6366F1",
  default: "#6366F1",
}
const CATEGORY_EMOJIS = CAT_EMOJIS

const DEMO_SPOTS: Spot[] = []

function cleanDescription(text: string): string {
  return text
    .replace(/[,.]?\s*d[''']après une publication (instagram|tiktok|instagram ou tiktok)/gi, "")
    .replace(/[,.]?\s*selon une publication (instagram|tiktok)/gi, "")
    .replace(/[,.]?\s*d[''']après (son |sa |leur |les? )?(compte|publication|post) (instagram|tiktok)/gi, "")
    .replace(/[,.]?\s*(source|via)\s*:\s*(instagram|tiktok)[^.)]*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim()
}

function renderDescription(text: string): React.ReactNode {
  return text.split("\n").map((line, li) => (
    <span key={li}>
      {li > 0 && <br />}
      {line.split(/(\*\*[^*]+\*\*)/).map((part, pi) =>
        part.startsWith("**") && part.endsWith("**")
          ? <strong key={pi} className="font-semibold text-gray-900 dark:text-white">{part.slice(2, -2)}</strong>
          : part
      )}
    </span>
  ))
}

// ---------------------------------------------------------------------------
// Composant horaires d'ouverture avec dropdown animé
// ---------------------------------------------------------------------------
function OpeningHoursBlock({
  weekdays,
  openingHours,
}: {
  weekdays: string[] | null | undefined
  openingHours: Record<string, string> | null | undefined
}) {
  const [expanded, setExpanded] = useState(false)

  const googleStatus = weekdays?.length ? getGoogleOpeningStatus(weekdays) : null
  const manualStatus = googleStatus == null ? getOpeningStatus(openingHours ?? null) : null
  const status = googleStatus ?? manualStatus

  if (!status) return null

  const canExpand = !!weekdays?.length
  // Aujourd'hui en index Google (0=Lun … 6=Dim)
  const todayIdx = (new Date().getDay() + 6) % 7

  return (
    <div className="mt-2">
      <button
        onClick={() => canExpand && setExpanded((e) => !e)}
        className={cn(
          "flex items-center gap-2 text-left",
          canExpand ? "cursor-pointer" : "cursor-default"
        )}
      >
        <div className={cn("h-2 w-2 flex-shrink-0 rounded-full", status.color)} />
        <span className="text-sm font-medium text-gray-700 dark:text-zinc-300">{status.text}</span>
        {canExpand && (
          <ChevronDown
            size={13}
            className={cn(
              "text-gray-400 dark:text-zinc-500 transition-transform duration-200",
              expanded && "rotate-180"
            )}
          />
        )}
      </button>

      <AnimatePresence>
        {expanded && weekdays && (
          <motion.div
            key="hours"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="mt-2 space-y-1 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-zinc-900/60 px-3 py-2.5">
              {weekdays.map((day, i) => (
                <p
                  key={i}
                  className={cn(
                    "text-xs leading-relaxed",
                    i === todayIdx
                      ? "font-semibold text-blue-600 dark:text-white"
                      : "text-gray-500 dark:text-zinc-400"
                  )}
                >
                  {day}
                </p>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function MapView() {
  const mapRef = useRef<MapRef>(null)
  const { user, loading: authLoading, signOut } = useAuth()
  const { resolvedTheme } = useTheme()

  const [filter, setFilter] = useState<FilterMode>("friends")
  const [groups, setGroups] = useState<SpotGroup[]>([])
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const [groupSpotIds, setGroupSpotIds] = useState<Set<string>>(new Set())
  // true une fois que loadGroups a eu la chance de restaurer depuis localStorage
  const groupRestoredRef = useRef(false)

  // Persister le groupe sélectionné dans localStorage
  // Ne s'exécute qu'après la restauration initiale pour ne pas effacer la valeur sauvegardée
  useEffect(() => {
    if (!user || !groupRestoredRef.current) return
    try {
      if (activeGroupId) {
        localStorage.setItem(`friendspot_active_group_${user.id}`, activeGroupId)
      } else {
        localStorage.removeItem(`friendspot_active_group_${user.id}`)
      }
    } catch { /* ignore */ }
  }, [activeGroupId, user])
  const [showGroupsDropdown, setShowGroupsDropdown] = useState(false)
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState("")
  const [newGroupEmoji, setNewGroupEmoji] = useState("🍻")
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [selectedGroupForSettings, setSelectedGroupForSettings] = useState<SpotGroup | null>(null)
  const [friendFilterIds, setFriendFilterIds] = useState<Set<string>>(new Set())
  const [friendCategoryFilter, setFriendCategoryFilter] = useState<Set<string>>(new Set())
  const [showFriendFilter, setShowFriendFilter] = useState(false)
  const [friendFilterSearch, setFriendFilterSearch] = useState("")

  const [selectedSpot, setSelectedSpot] = useState<Spot | null>(null)
  const [proposeOutingSpot, setProposeOutingSpot] = useState<Spot | null>(null)
  const [showGroupPicker, setShowGroupPicker] = useState(false)
  const [pickerSpotGroupIds, setPickerSpotGroupIds] = useState<Set<string>>(new Set())
  const [togglingGroupId, setTogglingGroupId] = useState<string | null>(null)
  const [editingSpot, setEditingSpot] = useState<Spot | null>(null)
  const [carouselIdx, setCarouselIdx] = useState(0)
  const [descExpanded, setDescExpanded] = useState(false)
  const [showLikersPanel, setShowLikersPanel] = useState(false)
  const carouselRef = useRef<HTMLDivElement>(null)
  const spotScrollRef = useRef<HTMLDivElement>(null)
  const touchStartX = useRef<number | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const spotDragControls = useDragControls()
  const [isLocating, setIsLocating] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showFriendsModal, setShowFriendsModal] = useState(false)
  const [showExploreModal, setShowExploreModal] = useState(false)
  const [surprisePin, setSurprisePin] = useState<{ spot: Spot } | null>(null)
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [publicProfileUserId, setPublicProfileUserId] = useState<string | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [spots, setSpots] = useState<Spot[]>([])
  const [spotsLoaded, setSpotsLoaded] = useState(false)
  const [likeCountsBySpotId, setLikeCountsBySpotId] = useState<Record<string, number>>({})
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean; title: string; message: string
    confirmLabel?: string; danger?: boolean; onConfirm: () => void
  } | null>(null)
  const openConfirm = useCallback((opts: {
    title: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void
  }) => setConfirmDialog({ open: true, ...opts }), [])
  const [followingIds, setFollowingIds] = useState<string[]>([])
  const [followingProfilesMap, setFollowingProfilesMap] = useState<Record<string, { username: string | null; avatar_url: string | null }>>({})
  const [visibleFriendIds, setVisibleFriendIds] = useState<string[]>([])
  const visibleFriendIdsRef = useRef<Set<string>>(new Set())
  // In-memory cache: avoids re-fetching reactions/visits for already-opened spots
  type SpotDataCache = globalThis.Map<string, {
    reactions: { user_id: string; type: "love" | "save"; username: string | null; avatar_url: string | null }[]
    visits: { user_id: string; username: string | null; avatar_url: string | null }[]
  }>
  const spotDataCacheRef = useRef<SpotDataCache>(new globalThis.Map())
  const [incomingCount, setIncomingCount] = useState(0)
  const [newLikesCount, setNewLikesCount] = useState(0)
  const [mapError, setMapError] = useState<string | null>(null)
  const [showPushBanner, setShowPushBanner] = useState(false)
  const swRegRef = useRef<ServiceWorkerRegistration | null>(null)
  const [userLocation, setUserLocation] = useState<{
    lat: number
    lng: number
  } | null>(null)
  const [userProfile, setUserProfile] = useState<{
    username: string
    avatar_url: string | null
    is_ghost_mode?: boolean
    is_admin?: boolean
  } | null>(null)
  const [initialAddUrl, setInitialAddUrl] = useState<string>("")
  const [visits, setVisits] = useState<{ user_id: string; username: string | null; avatar_url: string | null }[]>([])
  const [reactions, setReactions] = useState<{ user_id: string; type: "love" | "save"; username: string | null; avatar_url: string | null }[]>([])
  const [is3D, setIs3D] = useState(true)
  const [friendLocations, setFriendLocations] = useState<
    {
      id: string
      username: string | null
      avatar_url: string | null
      lat: number
      lng: number
      last_active_at: string
    }[]
  >([])

  const [bounds, setBounds] = useState<[number, number, number, number]>([
    -180, -85, 180, 85,
  ])
  const [zoom, setZoom] = useState(12.5)

  const supabaseRef = useRef(createClient())
  const pendingSpotIdRef = useRef<string | null>(null)

  const themeRef = useRef(resolvedTheme)
  useEffect(() => { themeRef.current = resolvedTheme }, [resolvedTheme])

  // Enregistrer le service worker + logique bannière permission
  useEffect(() => {
    if (!user) return
    registerServiceWorker().then(reg => { swRegRef.current = reg })

    try {
      const count = parseInt(localStorage.getItem("friendspot_open_count") ?? "0", 10) + 1
      localStorage.setItem("friendspot_open_count", String(count))
      const alreadyDismissed = localStorage.getItem("friendspot_push_dismissed")
      if (count >= 3 && !alreadyDismissed && Notification.permission === "default") {
        setShowPushBanner(true)
      }
    } catch { /* ignore */ }
  }, [user])

  useEffect(() => {
    if (!showGroupsDropdown) setShowCreateGroup(false)
  }, [showGroupsDropdown])

  const applyLightFilters = useCallback(() => {
    const map = mapRef.current?.getMap()
    if (!map || themeRef.current !== "light") return
    try {
      const layers = map.getStyle()?.layers ?? []
      layers.forEach((layer) => {
        if (LIGHT_HIDDEN_LAYERS.some((k) => layer.id.includes(k))) {
          try { map.setLayoutProperty(layer.id, "visibility", "none") } catch { /* ignore */ }
        }
      })
      // Retire les numéros d'autoroutes (A1, A4…) de la couche road-label
      if (layers.some((l) => l.id === "road-label")) {
        try {
          map.setFilter("road-label", [
            "!",
            ["in", ["get", "class"], ["literal", LIGHT_HIDDEN_ROAD_CLASSES]],
          ])
        } catch { /* ignore */ }
      }
    } catch { /* style not ready */ }
  }, [])

  // Fetch user profile — separated from fetchSpots so both run in parallel
  const fetchUserProfile = useCallback(async () => {
    if (!user) return
    // Show cached profile instantly while fetching fresh data
    const cacheKey = `friendspot_profile_${user.id}`
    try {
      const raw = localStorage.getItem(cacheKey)
      if (raw) {
        const { data: cached, ts } = JSON.parse(raw)
        if (Date.now() - ts < PROFILE_CACHE_TTL && cached) {
          setUserProfile(cached)
        }
      }
    } catch { /* ignore */ }

    try {
      const { data, error } = await supabaseRef.current
        .from("profiles")
        .select("username, avatar_url, is_ghost_mode, is_admin")
        .eq("id", user.id)
        .single()
      if (error) {
        if (error.code === "PGRST116") {
          setShowOnboarding(true)
        } else throw error
      } else if (data) {
        setUserProfile(data)
        if (!data.username) setShowOnboarding(true)
        try { localStorage.setItem(cacheKey, JSON.stringify({ data, ts: Date.now() })) } catch { /* ignore */ }
      }
    } catch (err: unknown) {
      const e = err as { message?: string; code?: string }
      if (e.message?.includes("avatar_url") || e.code === "PGRST204") {
        const { data } = await supabaseRef.current
          .from("profiles").select("username").eq("id", user.id).single()
        if (data) {
          setUserProfile({ username: data.username, avatar_url: null })
          if (!data.username) setShowOnboarding(true)
          try { localStorage.setItem(cacheKey, JSON.stringify({ data: { username: data.username, avatar_url: null }, ts: Date.now() })) } catch { /* ignore */ }
        }
      }
    }
  }, [user])

  const fetchSpots = useCallback(async () => {
    const PAGE_SIZE = 100
    const filterExpired = (list: Spot[]) =>
      list.filter(s => !s.expires_at || new Date(s.expires_at).getTime() > Date.now())

    // Load cached spots instantly — user sees the map before the network responds
    try {
      const raw = localStorage.getItem(SPOTS_CACHE_KEY)
      if (raw) {
        const { data: cached, ts } = JSON.parse(raw)
        if (Date.now() - ts < SPOTS_CACHE_TTL && Array.isArray(cached)) {
          setSpots(filterExpired(cached as Spot[]))
        }
      }
    } catch { /* localStorage unavailable */ }

    try {
      const { data, error } = await supabaseRef.current
        .from("spots")
        .select("*, profiles(id, username, avatar_url, created_at)")
        .order("created_at", { ascending: false })
        .range(0, PAGE_SIZE - 1)

      if (error) {
        if (error.message?.includes("avatar_url") || error.code === "PGRST204") {
          const { data: fallbackData } = await supabaseRef.current
            .from("spots").select("*, profiles(id, username, created_at)")
            .order("created_at", { ascending: false }).range(0, PAGE_SIZE - 1)
          setSpots(fallbackData && fallbackData.length > 0 ? (fallbackData as Spot[]) : DEMO_SPOTS)
          return
        }
        throw error
      }

      const firstPage = data && data.length > 0 ? filterExpired(data as Spot[]) : DEMO_SPOTS
      setSpots(firstPage)

      // Accumulate all pages for cache
      let allSpots: Spot[] = [...(data ?? [])]

      if (data && data.length === PAGE_SIZE) {
        let offset = PAGE_SIZE
        let hasMore = true
        while (hasMore) {
          const { data: more } = await supabaseRef.current
            .from("spots").select("*, profiles(id, username, avatar_url, created_at)")
            .order("created_at", { ascending: false }).range(offset, offset + PAGE_SIZE - 1)
          if (!more || more.length === 0) { hasMore = false; break }
          allSpots = [...allSpots, ...more]
          setSpots(prev => {
            const existingIds = new Set(prev.map(s => s.id))
            const fresh = filterExpired(more as Spot[]).filter(s => !existingIds.has(s.id))
            return fresh.length > 0 ? [...prev, ...fresh] : prev
          })
          offset += PAGE_SIZE
          if (more.length < PAGE_SIZE) hasMore = false
        }
      }

      // Persist to localStorage for next load
      try {
        localStorage.setItem(SPOTS_CACHE_KEY, JSON.stringify({ data: allSpots, ts: Date.now() }))
      } catch { /* storage quota exceeded */ }
    } catch (_e) {
      console.error("fetchSpots error:", _e)
      setSpots(DEMO_SPOTS)
      toast.error("Impossible de charger les spots", {
        action: { label: "Réessayer", onClick: () => fetchSpots() },
        duration: 8000,
      })
    } finally {
      setSpotsLoaded(true)
    }
  }, []) // no user dependency — profile fetch is now separate

  const fetchLikeCounts = useCallback(async () => {
    const cacheKey = "friendspot_likes_v1"
    try {
      const raw = localStorage.getItem(cacheKey)
      if (raw) {
        const { data: cached, ts } = JSON.parse(raw)
        if (Date.now() - ts < LIKES_CACHE_TTL && cached) setLikeCountsBySpotId(cached)
      }
    } catch {}
    try {
      const { data, error } = await supabaseRef.current
        .from("spot_reactions")
        .select("spot_id")
        .eq("type", "love")
      if (error) { console.error("fetchLikeCounts:", error); return }
      if (!data) return
      const counts: Record<string, number> = {}
      data.forEach((r: { spot_id: string }) => { counts[r.spot_id] = (counts[r.spot_id] ?? 0) + 1 })
      setLikeCountsBySpotId(counts)
      try { localStorage.setItem(cacheKey, JSON.stringify({ data: counts, ts: Date.now() })) } catch {}
    } catch (e) { console.error("fetchLikeCounts exception:", e) }
  }, [])

  const fetchFollowing = useCallback(async () => {
    if (!user) return
    const cacheKey = `friendspot_following_${user.id}`
    // Afficher les amis instantanément depuis le cache
    try {
      const raw = localStorage.getItem(cacheKey)
      if (raw) {
        const { data: cached, ts } = JSON.parse(raw)
        if (Date.now() - ts < FOLLOWING_CACHE_TTL && Array.isArray(cached)) {
          setFollowingIds(cached)
          setVisibleFriendIds((prev) => [...new Set([...prev, ...cached])])
        }
      }
    } catch {}
    // Rafraîchir en arrière-plan
    try {
      const { data } = await supabaseRef.current
        .from("followers")
        .select("following_id")
        .eq("follower_id", user.id)
      if (data) {
        const ids = data.map((f: { following_id: string }) => f.following_id)
        setFollowingIds(ids)
        setVisibleFriendIds((prev) => [...new Set([...prev, ...ids])])
        try { localStorage.setItem(cacheKey, JSON.stringify({ data: ids, ts: Date.now() })) } catch {}
        // Fetch profiles for all followed users
        if (ids.length > 0) {
          const { data: profiles } = await supabaseRef.current
            .from("profiles").select("id, username, avatar_url").in("id", ids)
          if (profiles) {
            setFollowingProfilesMap(Object.fromEntries(
              profiles.map((p: any) => [p.id, { username: p.username, avatar_url: p.avatar_url }])
            ))
          }
        }
      }
    } catch {
      /* table might not exist */
    }
  }, [user])

  // Fetch friend locations (non-ghost, with a recorded position)
  const fetchFriendLocations = useCallback(async () => {
    if (!user || followingIds.length === 0) {
      setFriendLocations([])
      return
    }
    try {
      const { data } = await supabaseRef.current
        .from("profiles")
        .select(
          "id, username, avatar_url, last_lat, last_lng, last_active_at, is_ghost_mode"
        )
        .in("id", followingIds)
        .not("last_lat", "is", null)
        .not("last_lng", "is", null)
        .eq("is_ghost_mode", false)
      if (data) {
        const TEN_MIN = 10 * 60 * 1000
        const now = Date.now()
        setFriendLocations(
          data
            .filter((p: { last_active_at: string | null }) =>
              p.last_active_at && now - new Date(p.last_active_at).getTime() < TEN_MIN
            )
            .map(
              (p: {
                id: string
                username: string | null
                avatar_url: string | null
                last_lat: number
                last_lng: number
                last_active_at: string
              }) => ({
                id: p.id,
                username: p.username,
                avatar_url: p.avatar_url,
                lat: p.last_lat,
                lng: p.last_lng,
                last_active_at: p.last_active_at,
              })
            )
        )
      }
    } catch {
      /* columns might not exist yet */
    }
  }, [user, followingIds])

  // Publish user location to DB (respects ghost mode)
  const publishLocation = useCallback(
    async (lat: number, lng: number) => {
      if (!user || userProfile?.is_ghost_mode) return
      try {
        await supabaseRef.current
          .from("profiles")
          .update({
            last_lat: lat,
            last_lng: lng,
            last_active_at: new Date().toISOString(),
          })
          .eq("id", user.id)
      } catch {
        /* columns might not exist yet */
      }
    },
    [user, userProfile?.is_ghost_mode]
  )

  const checkNewLikes = useCallback(async () => {
    if (!user) return
    try {
      const { data } = await supabaseRef.current
        .rpc("count_likes_on_my_spots", { p_user_id: user.id })
      const count = data as number ?? 0
      const known = parseInt(localStorage.getItem(`likesKnown_${user.id}`) || "0")
      setNewLikesCount(Math.max(0, count - known))
    } catch { /* ignore */ }
  }, [user])

  const loadGroups = useCallback(async () => {
    if (!user) return
    try {
      const { data } = await supabaseRef.current
        .from("spot_group_members")
        .select("group_id, spot_groups(id, creator_id, name, emoji, created_at)")
        .eq("user_id", user.id)
      if (data) {
        const loaded = data.map((d: any) => d.spot_groups).filter(Boolean) as SpotGroup[]
        setGroups(loaded)
        // Restaurer le groupe sélectionné depuis localStorage
        try {
          const saved = localStorage.getItem(`friendspot_active_group_${user.id}`)
          if (saved && loaded.some(g => g.id === saved)) {
            setActiveGroupId(saved)
            setFilter("groups" as FilterMode)
          }
        } catch { /* ignore */ }
        groupRestoredRef.current = true
      }
    } catch (e) {
      console.error("loadGroups:", e)
    }
  }, [user])

  const handleCreateGroup = async () => {
    if (!user || !newGroupName.trim()) return
    setCreatingGroup(true)
    try {
      const { data: group, error } = await supabaseRef.current
        .from("spot_groups")
        .insert({ creator_id: user.id, name: newGroupName.trim(), emoji: newGroupEmoji })
        .select()
        .single()
      if (error) throw error
      // Ajouter le créateur comme membre
      await supabaseRef.current
        .from("spot_group_members")
        .insert({ group_id: group.id, user_id: user.id })
      setGroups(prev => [...prev, group as SpotGroup])
      setNewGroupName("")
      setNewGroupEmoji("🍻")
      setShowCreateGroup(false)
      toast.success(`Groupe "${group.name}" créé !`)
    } catch (e) {
      toast.error("Erreur lors de la création du groupe")
    }
    setCreatingGroup(false)
  }

  const openGroupPicker = async (spotId: string) => {
    const { data } = await supabaseRef.current
      .from("spot_group_spots").select("group_id").eq("spot_id", spotId)
    setPickerSpotGroupIds(new Set((data ?? []).map((r: any) => r.group_id as string)))
    setShowGroupPicker(true)
  }

  const handleToggleSpotInGroup = async (groupId: string, spotId: string) => {
    if (!user) return
    setTogglingGroupId(groupId)
    const isIn = pickerSpotGroupIds.has(groupId)
    try {
      if (isIn) {
        const { error } = await supabaseRef.current.from("spot_group_spots").delete()
          .eq("spot_id", spotId).eq("group_id", groupId)
        if (error) throw error
        setPickerSpotGroupIds(prev => { const n = new Set(prev); n.delete(groupId); return n })
        if (groupId === activeGroupId) setGroupSpotIds(prev => { const n = new Set(prev); n.delete(spotId); return n })
      } else {
        const { error } = await supabaseRef.current.from("spot_group_spots")
          .insert({ spot_id: spotId, group_id: groupId, added_by: user.id })
        if (error) throw error
        setPickerSpotGroupIds(prev => new Set([...prev, groupId]))
        if (groupId === activeGroupId) setGroupSpotIds(prev => new Set([...prev, spotId]))
      }
    } catch {
      toast.error("Erreur lors de la mise à jour du groupe")
    }
    setTogglingGroupId(null)
  }

  const markLikesSeen = useCallback(async () => {
    if (!user) return
    try {
      const { data } = await supabaseRef.current
        .rpc("count_likes_on_my_spots", { p_user_id: user.id })
      const count = data as number ?? 0
      localStorage.setItem(`likesKnown_${user.id}`, String(count))
      setNewLikesCount(0)
    } catch { /* ignore */ }
  }, [user])

  const checkIncomingRequests = useCallback(async () => {
    if (!user) return
    try {
      // Récupérer le timestamp de la dernière fois que l'utilisateur a ouvert l'onglet Amis
      const seenAt = localStorage.getItem(`friendspot_notif_seen_${user.id}`)

      let friendQuery = supabaseRef.current
        .from("friend_requests")
        .select("*", { count: "exact", head: true })
        .eq("to_id", user.id)
        .eq("status", "pending")
      if (seenAt) friendQuery = friendQuery.gt("created_at", seenAt) as typeof friendQuery

      let outingQuery = supabaseRef.current
        .from("outing_invitations")
        .select("*", { count: "exact", head: true })
        .eq("invitee_id", user.id)
        .eq("status", "pending")
      if (seenAt) outingQuery = outingQuery.gt("created_at", seenAt) as typeof outingQuery

      let groupQuery = supabaseRef.current
        .from("spot_group_invitations")
        .select("*", { count: "exact", head: true })
        .eq("invitee_id", user.id)
        .eq("status", "pending")
      if (seenAt) groupQuery = groupQuery.gt("created_at", seenAt) as typeof groupQuery

      const [{ count: friendCount }, { count: outingCount }, { count: groupCount }] = await Promise.all([friendQuery, outingQuery, groupQuery])
      setIncomingCount((friendCount || 0) + (outingCount || 0) + (groupCount || 0))
    } catch {
      /* ignore */
    }
  }, [user])

  // Garde le ref à jour pour les closures realtime
  useEffect(() => { visibleFriendIdsRef.current = new Set(visibleFriendIds) }, [visibleFriendIds])

  const checkIncomingRequestsRef = useRef(checkIncomingRequests)
  useEffect(() => { checkIncomingRequestsRef.current = checkIncomingRequests }, [checkIncomingRequests])

  // Bouton retour navigateur → ferme le modal du dessus
  const closeTopModalRef = useRef<() => void>(() => {})
  useEffect(() => {
    closeTopModalRef.current = () => {
      if (publicProfileUserId) { setPublicProfileUserId(null); return }
      if (showProfileModal) { setShowProfileModal(false); return }
      if (showFriendsModal) { setShowFriendsModal(false); return }
      if (showExploreModal) { setShowExploreModal(false); return }
      if (showAddModal) { setShowAddModal(false); return }
      if (selectedSpot) { setSelectedSpot(null); return }
    }
  }, [publicProfileUserId, showProfileModal, showFriendsModal, showExploreModal, showAddModal, selectedSpot])
  useEffect(() => {
    const handler = () => closeTopModalRef.current()
    window.addEventListener("popstate", handler)
    return () => window.removeEventListener("popstate", handler)
  }, [])
  const prevAnyOpenRef = useRef(false)
  useEffect(() => {
    const anyOpen = showFriendsModal || showExploreModal || showAddModal || showProfileModal || !!publicProfileUserId || !!selectedSpot
    if (anyOpen && !prevAnyOpenRef.current) window.history.pushState({ modal: true }, "")
    prevAnyOpenRef.current = anyOpen
  }, [showFriendsModal, showExploreModal, showAddModal, showProfileModal, publicProfileUserId, selectedSpot])

  // On mount: fetch spots + like counts in parallel (no auth needed)
  useEffect(() => {
    Promise.all([fetchSpots(), fetchLikeCounts()])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // When user is available: run all user-specific fetches in parallel
  useEffect(() => {
    if (!user) return
    Promise.all([fetchFollowing(), fetchUserProfile(), checkNewLikes(), checkIncomingRequests(), loadGroups()])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  useEffect(() => {
    fetchFriendLocations()
  }, [fetchFriendLocations])

  // Charger les IDs des spots du groupe actif
  useEffect(() => {
    if (!activeGroupId) { setGroupSpotIds(new Set()); return }
    supabaseRef.current
      .from("spot_group_spots")
      .select("spot_id")
      .eq("group_id", activeGroupId)
      .then(({ data }) => {
        setGroupSpotIds(new Set((data ?? []).map((r: { spot_id: string }) => r.spot_id)))
      })
  }, [activeGroupId])

  const handleSurpriseFromMap = useCallback(() => {
    if (!followingIds.length) { toast.error("Suis des amis pour utiliser cette fonctionnalité !"); return }
    const friendSet = new Set(followingIds)
    const friendSpots = spots.filter(s =>
      friendSet.has(s.user_id) && (!s.expires_at || new Date(s.expires_at).getTime() > Date.now())
    )
    if (!friendSpots.length) { toast.error("Tes amis n'ont pas encore ajouté de spots."); return }

    let pool = friendSpots
    if (userLocation) {
      const nearby = friendSpots.filter(s => geoDistKm(userLocation.lat, userLocation.lng, s.lat, s.lng) <= 30)
      if (nearby.length > 0) pool = nearby
    }
    // Évite de retomber sur le même spot
    if (pool.length > 1 && surprisePin?.spot.id) {
      const filtered = pool.filter(s => s.id !== surprisePin.spot.id)
      if (filtered.length > 0) pool = filtered
    }

    const picked = pool[Math.floor(Math.random() * pool.length)]
    setSurprisePin({ spot: picked })
    setFilter("friends")
    setVisibleFriendIds(followingIds)
    setFriendFilterIds(new Set())
    setSelectedSpot(picked)
    setShowExploreModal(false)
    mapRef.current?.flyTo({ center: [picked.lng, picked.lat], zoom: 15.5, offset: [0, 100], duration: 900 })
  }, [followingIds, spots, userLocation, surprisePin])

  // Clear surprise pin once the user has visited and then left the suggested spot
  const surpriseVisitedRef = useRef(false)
  useEffect(() => {
    if (!surprisePin) { surpriseVisitedRef.current = false; return }
    if (selectedSpot?.id === surprisePin.spot.id) {
      surpriseVisitedRef.current = true
    } else if (surpriseVisitedRef.current) {
      setSurprisePin(null)
    }
  }, [selectedSpot, surprisePin])

  useEffect(() => {
    if (!user) return
    checkIncomingRequestsRef.current()

    const channel = supabaseRef.current
      .channel(`global-${user.id}`)
      // ── friend_requests ──────────────────────────────────────────────────
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "friend_requests", filter: `to_id=eq.${user.id}` },
        () => {
          setIncomingCount(prev => prev + 1)
          toast("🔔 Nouvelle demande !", {
            description: "Quelqu'un veut s'abonner à toi.",
            action: { label: "Voir", onClick: () => setShowFriendsModal(true) },
          })
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "friend_requests", filter: `to_id=eq.${user.id}` },
        (payload) => {
          const s = (payload.new as { status: string }).status
          if (s !== "pending") setIncomingCount(prev => Math.max(0, prev - 1))
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "friend_requests", filter: `to_id=eq.${user.id}` },
        () => setIncomingCount(prev => Math.max(0, prev - 1))
      )
      // ── outing_invitations ─────────────────────────────────────────────
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "outing_invitations", filter: `invitee_id=eq.${user.id}` },
        () => {
          setIncomingCount(prev => prev + 1)
          toast("🗓️ Nouvelle sortie !", {
            description: "On t'a invité à une sortie.",
            action: { label: "Voir", onClick: () => setShowFriendsModal(true) },
          })
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "outing_invitations", filter: `invitee_id=eq.${user.id}` },
        (payload) => {
          const s = (payload.new as { status: string }).status
          if (s !== "pending") setIncomingCount(prev => Math.max(0, prev - 1))
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "outing_invitations", filter: `invitee_id=eq.${user.id}` },
        () => setIncomingCount(prev => Math.max(0, prev - 1))
      )
      // ── spot_group_invitations ──────────────────────────────────────────
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "spot_group_invitations", filter: `invitee_id=eq.${user.id}` },
        () => {
          setIncomingCount(prev => prev + 1)
          toast("👥 Invitation groupe !", {
            description: "On t'a invité à rejoindre un groupe.",
            action: { label: "Voir", onClick: () => setShowFriendsModal(true) },
          })
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "spot_group_invitations", filter: `invitee_id=eq.${user.id}` },
        (payload) => {
          const s = (payload.new as { status: string }).status
          if (s !== "pending") setIncomingCount(prev => Math.max(0, prev - 1))
        }
      )
      // ── followers (ami accepté) ───────────────────────────────────────────
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "followers", filter: `follower_id=eq.${user.id}` },
        async (payload) => {
          const newId = (payload.new as { following_id: string }).following_id
          setFollowingIds((prev) => prev.includes(newId) ? prev : [...prev, newId])
          setVisibleFriendIds((prev) => prev.includes(newId) ? prev : [...prev, newId])
          toast("✅ Ami accepté !", { description: "Ses spots apparaissent maintenant sur ta carte." })
        }
      )
      // ── spots (nouveaux / mis à jour / supprimés) ─────────────────────────
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "spots" },
        async (payload) => {
          const raw = payload.new as Spot
          if (raw.user_id === user.id) return
          if (!visibleFriendIdsRef.current.has(raw.user_id)) return
          const { data } = await supabaseRef.current
            .from("spots")
            .select("*, profiles(id, username, avatar_url, created_at)")
            .eq("id", raw.id)
            .single()
          if (data) setSpots((prev) => prev.some((s) => s.id === data.id) ? prev : [data, ...prev])
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "spots" },
        (payload) => {
          const updated = payload.new as Spot
          setSpots((prev) => prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)))
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "spots" },
        (payload) => {
          const deleted = payload.old as { id: string }
          setSpots((prev) => prev.filter((s) => s.id !== deleted.id))
        }
      )
      .subscribe()

    return () => { supabaseRef.current.removeChannel(channel) }
  }, [user])

  const visibleFriendSet = useMemo(() => new Set(visibleFriendIds), [visibleFriendIds])

  const friendProfiles = useMemo(() => {
    return followingIds.map(id => ({
      id,
      username: followingProfilesMap[id]?.username ?? null,
      avatar_url: followingProfilesMap[id]?.avatar_url ?? null,
    }))
  }, [followingIds, followingProfilesMap])

  const loveReactions = useMemo(() => reactions.filter(r => r.type === "love"), [reactions])

  const visibleSpots = useMemo(() => {
    if (filter === "mine") return spots.filter((s) => s.user_id === user?.id)
    if (filter === "groups" && activeGroupId) {
      return spots.filter((s) => groupSpotIds.has(s.id))
    }
    let base = spots.filter((s) => {
      if (s.visibility === "group") return false
      if (s.visibility === "private") return false
      return s.user_id === user?.id || visibleFriendSet.has(s.user_id)
    })
    if (friendFilterIds.size > 0) base = base.filter((s) => friendFilterIds.has(s.user_id))
    if (friendCategoryFilter.size > 0) base = base.filter((s) => friendCategoryFilter.has(s.category ?? "other"))
    return base
  }, [spots, filter, user?.id, visibleFriendSet, friendFilterIds, friendCategoryFilter, activeGroupId, groupSpotIds])

  const locateUser = useCallback(() => {
    if (!navigator.geolocation || !mapRef.current) return
    setIsLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocating(false)
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        mapRef.current?.flyTo({
          center: [pos.coords.longitude, pos.coords.latitude],
          zoom: 15,
          duration: 1200,
        })
      },
      (err) => {
        setIsLocating(false)
        if (err.code === 1) {
          toast.error("Localisation refusée", {
            description: "Active la géolocalisation dans les paramètres de ton navigateur.",
            duration: 6000,
          })
        }
      },
      { enableHighAccuracy: true }
    )
  }, [])

  // Détection discrète de la position au lancement + publication dans la DB + refresh toutes les 5 min
  useEffect(() => {
    if (!navigator.geolocation) return
    const publish = (pos: GeolocationPosition) => {
      const { latitude: lat, longitude: lng } = pos.coords
      setUserLocation({ lat, lng })
      publishLocation(lat, lng)
    }
    navigator.geolocation.getCurrentPosition(publish, () => {}, {
      enableHighAccuracy: true,
    })
    const interval = setInterval(
      () => {
        navigator.geolocation.getCurrentPosition(publish, () => {}, {
          enableHighAccuracy: true,
        })
      },
      5 * 60 * 1000
    )
    return () => clearInterval(interval)
  }, [publishLocation])

  // Interception du Web Share Target (PWA) + deep link ?spot=<id>
  useEffect(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search)

      // Deep link: ?spot=<id> — ouvrir un spot partagé
      const spotDeepLink = urlParams.get("spot")
      if (spotDeepLink) {
        pendingSpotIdRef.current = spotDeepLink
        window.history.replaceState({}, document.title, window.location.pathname)
      }

      const sharedUrl = urlParams.get("share_url")
      const sharedText = urlParams.get("text")

      const targetUrl = sharedUrl || sharedText || ""
      if (
        targetUrl &&
        (targetUrl.includes("instagram.com") ||
          targetUrl.includes("instagr.am"))
      ) {
        const urlMatch = targetUrl.match(
          /(https?:\/\/(?:www\.)?instagr(am\.com|\.am)\/[^\s]+)/
        )
        if (urlMatch) {
          setInitialAddUrl(urlMatch[0])
          setShowAddModal(true)
          window.history.replaceState(
            {},
            document.title,
            window.location.pathname
          )
        }
      }
    }
  }, [])

  // Reset carousel index and description state when a new spot is selected
  useEffect(() => {
    setCarouselIdx(0)
    setDescExpanded(false)
    setShowLikersPanel(false)
    setShowGroupPicker(false)
    if (carouselRef.current) carouselRef.current.scrollLeft = 0
  }, [selectedSpot?.id])

  // Deep link: sélectionner et centrer sur un spot dès que les données sont chargées
  useEffect(() => {
    if (!pendingSpotIdRef.current || spots.length === 0) return
    const id = pendingSpotIdRef.current
    const spot = spots.find(s => s.id === id)
    if (spot) {
      pendingSpotIdRef.current = null
      setSelectedSpot(spot)
      if (spot.lat && spot.lng) {
        mapRef.current?.flyTo({ center: [spot.lng, spot.lat], zoom: 15, duration: 1200 })
      }
    }
  }, [spots])


  const handlePushAccept = useCallback(async () => {
    setShowPushBanner(false)
    try { localStorage.setItem("friendspot_push_dismissed", "1") } catch {}
    const perm = await Notification.requestPermission()
    if (perm === "granted" && swRegRef.current) {
      await subscribeToPush(swRegRef.current)
      toast.success("Notifications activées !")
    }
  }, [])

  const handlePushDismiss = useCallback(() => {
    setShowPushBanner(false)
    try { localStorage.setItem("friendspot_push_dismissed", "1") } catch {}
  }, [])

  const handleOpenAddSpot = () => {
    setInitialAddUrl("")
    setShowAddModal(true)
  }

  const handleAddSpot = async (spotData: {
    title: string
    description: string | null
    lat: number
    lng: number
    category: string
    instagram_url: string | null
    image_url: string | null
    address: string | null
    opening_hours: Record<string, string> | null
    weekday_descriptions: string[] | null
    maps_url: string | null
    price_range: string | null
    expires_at: string | null
    visibility: 'friends' | 'private'
    groupIds: string[]
  }) => {
    if (!user) throw new Error("Tu dois être connecté !")

    // Extraire groupIds (non stocké dans spots)
    const { groupIds, ...spotDbData } = spotData

    const tempId = `temp-${Date.now()}`
    const profileSnap = {
      id: user.id,
      username: userProfile?.username || "moi",
      avatar_url: userProfile?.avatar_url || null,
      created_at: "",
    }
    const optimisticSpot: Spot = {
      id: tempId,
      user_id: user.id,
      ...spotDbData,
      created_at: new Date().toISOString(),
      profiles: profileSnap,
    }

    // Supprimer l'ancien spot de l'utilisateur à la même adresse (doublon)
    let duplicateId: string | undefined
    if (spotDbData.address) {
      const duplicate = spots.find(s => s.user_id === user.id && s.address === spotDbData.address)
      if (duplicate) {
        duplicateId = duplicate.id
        await supabaseRef.current.from("spots").delete().eq("id", duplicate.id)
      }
    }

    setSpots((prev) => [
      optimisticSpot,
      ...(duplicateId ? prev.filter(s => s.id !== duplicateId) : prev),
    ])

    try {
      // Tenter insert avec tous les champs, dont maps_url
      const { data: inserted, error } = await supabaseRef.current
        .from("spots")
        .insert({ user_id: user.id, ...spotDbData })
        .select()
        .single()

      if (error) {
        // Colonne inconnue (42703) → retry sans les champs optionnels non migrés
        if (error.code === "42703" || error.code === "PGRST204") {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { maps_url, weekday_descriptions, image_url, expires_at, price_range, opening_hours, ...core } = spotDbData
          const { data: fallback, error: fallbackError } = await supabaseRef.current
            .from("spots")
            .insert({ user_id: user.id, ...core, image_url })
            .select()
            .single()
          if (fallbackError) throw new Error(fallbackError.message)
          if (fallback) {
            if (groupIds.length > 0) {
              await supabaseRef.current.from("spot_group_spots").insert(
                groupIds.map(gid => ({ spot_id: fallback.id, group_id: gid, added_by: user.id }))
              )
              setGroupSpotIds(prev => { const next = new Set(prev); groupIds.forEach(gid => { if (gid === activeGroupId) next.add(fallback.id) }); return next })
            }
            const realSpot: Spot = {
              ...fallback,
              maps_url: spotDbData.maps_url,
              weekday_descriptions: spotDbData.weekday_descriptions,
              profiles: profileSnap,
            }
            setSpots((prev) => [realSpot, ...prev.filter((s) => s.id !== tempId)])
            setSelectedSpot(realSpot)
            mapRef.current?.flyTo({ center: [spotDbData.lng, spotDbData.lat], zoom: 15, duration: 1200 })
          } else {
            await fetchSpots()
          }
          return
        }
        throw new Error(error.message || "Erreur Supabase RLS")
      }

      // Insérer dans spot_group_spots si des groupes sont sélectionnés
      if (groupIds.length > 0 && inserted) {
        await supabaseRef.current.from("spot_group_spots").insert(
          groupIds.map(gid => ({ spot_id: inserted.id, group_id: gid, added_by: user.id }))
        )
        setGroupSpotIds(prev => { const next = new Set(prev); groupIds.forEach(gid => { if (gid === activeGroupId) next.add(inserted.id) }); return next })
      }

      // Succès : remplacer le spot optimiste par le vrai et l'ouvrir
      const realSpot: Spot = {
        ...inserted,
        maps_url: spotDbData.maps_url,
        weekday_descriptions: spotDbData.weekday_descriptions,
        profiles: profileSnap,
      }
      setSpots((prev) => [realSpot, ...prev.filter((s) => s.id !== tempId)])
      setSelectedSpot(realSpot)
      mapRef.current?.flyTo({ center: [spotDbData.lng, spotDbData.lat], zoom: 15, duration: 1200 })
    } catch (e: unknown) {
      const err = e as { message?: string }
      console.error("Insert error:", err)
      setSpots((prev) => prev.filter((s) => s.id !== tempId))
      const msg = err?.message || "Erreur inconnue"
      // Colonnes manquantes → indiquer la migration à faire
      if (msg.includes("price_range") || msg.includes("opening_hours") || msg.includes("expires_at") || msg.includes("column")) {
        toast.error("Migration SQL manquante. Ajoute les colonnes dans Supabase (voir CLAUDE.md).")
      } else {
        toast.error(`Erreur serveur : ${msg}`)
      }
      throw err
    }
  }

  const isAdmin = userProfile?.is_admin === true

  const handleDeleteSpot = async (spotId: string) => {
    if (!user) return
    try {
      await supabaseRef.current.from("spot_reactions").delete().eq("spot_id", spotId)
      let q = supabaseRef.current.from("spots").delete().eq("id", spotId)
      if (!isAdmin) q = q.eq("user_id", user.id)
      const { error } = await q
      if (error) throw error
      setSpots((prev) => prev.filter((s) => s.id !== spotId))
      if (selectedSpot?.id === spotId) setSelectedSpot(null)
    } catch (err) {
      console.error("Error deleting spot:", err)
      throw err
    }
  }

  const handleUpdateSpot = (updatedSpot: Spot) => {
    setSpots((prev) => prev.map((s) => s.id === updatedSpot.id ? updatedSpot : s))
    if (selectedSpot?.id === updatedSpot.id) setSelectedSpot(updatedSpot)
    // Rafraîchir les IDs du groupe actif si le spot édité en fait partie
    if (activeGroupId) {
      supabaseRef.current
        .from("spot_group_spots")
        .select("spot_id")
        .eq("group_id", activeGroupId)
        .then(({ data }) => {
          setGroupSpotIds(new Set((data ?? []).map((r: { spot_id: string }) => r.spot_id)))
        })
    }
  }

  const filterButtons: {
    key: FilterMode
    label: string
    icon: React.ReactNode
  }[] = [
    { key: "mine", label: "Moi", icon: <User size={13} /> },
    { key: "friends", label: "Amis", icon: <Users size={13} /> },
  ]

  const fetchVisits = useCallback(async (spotId: string) => {
    // Show cached data instantly while re-fetching in background
    const cached = spotDataCacheRef.current.get(spotId)
    if (cached?.visits) setVisits(cached.visits)
    try {
      const { data, error } = await supabaseRef.current
        .from("spot_visits").select("user_id").eq("spot_id", spotId)
      if (error) { console.error("fetchVisits:", error); return }
      if (!data || data.length === 0) {
        setVisits([])
        spotDataCacheRef.current.set(spotId, { ...(spotDataCacheRef.current.get(spotId) ?? { reactions: [] }), visits: [] })
        return
      }
      const userIds = [...new Set(data.map((v: { user_id: string }) => v.user_id))]
      const { data: profiles } = await supabaseRef.current
        .from("profiles").select("id, username, avatar_url").in("id", userIds)
      const pm = Object.fromEntries((profiles ?? []).map((p: { id: string; username: string | null; avatar_url: string | null }) => [p.id, p]))
      const newVisits = data.map((v: { user_id: string }) => ({
        user_id: v.user_id, username: pm[v.user_id]?.username ?? null, avatar_url: pm[v.user_id]?.avatar_url ?? null,
      }))
      setVisits(newVisits)
      spotDataCacheRef.current.set(spotId, { ...(spotDataCacheRef.current.get(spotId) ?? { reactions: [] }), visits: newVisits })
    } catch { setVisits([]) }
  }, [])

  const handleToggleVisit = useCallback(async () => {
    if (!user || !selectedSpot) return
    const alreadyVisited = visits.some((v) => v.user_id === user.id)
    // Optimistic update
    if (alreadyVisited) {
      setVisits((prev) => prev.filter((v) => v.user_id !== user.id))
    } else {
      setVisits((prev) => [
        ...prev,
        { user_id: user.id, username: userProfile?.username ?? null, avatar_url: userProfile?.avatar_url ?? null },
      ])
    }
    try {
      if (alreadyVisited) {
        await supabaseRef.current
          .from("spot_visits")
          .delete()
          .eq("spot_id", selectedSpot.id)
          .eq("user_id", user.id)
      } else {
        const { error: visitError } = await supabaseRef.current
          .from("spot_visits")
          .upsert({ spot_id: selectedSpot.id, user_id: user.id }, { onConflict: "spot_id,user_id", ignoreDuplicates: true })
        if (visitError) throw visitError
      }
      spotDataCacheRef.current.delete(selectedSpot.id) // invalidate cache after write
    } catch {
      // rollback
      if (alreadyVisited) {
        setVisits((prev) => [
          ...prev,
          { user_id: user.id, username: userProfile?.username ?? null, avatar_url: userProfile?.avatar_url ?? null },
        ])
      } else {
        setVisits((prev) => prev.filter((v) => v.user_id !== user.id))
      }
      toast.error("Erreur lors de la mise à jour.")
    }
  }, [user, selectedSpot, visits, userProfile])

  const fetchReactions = useCallback(async (spotId: string) => {
    const cached = spotDataCacheRef.current.get(spotId)
    if (cached?.reactions) setReactions(cached.reactions)
    try {
      const { data, error } = await supabaseRef.current
        .from("spot_reactions").select("user_id, type").eq("spot_id", spotId)
      if (error) { console.error("fetchReactions:", error); return }
      if (!data || data.length === 0) {
        setReactions([])
        spotDataCacheRef.current.set(spotId, { ...(spotDataCacheRef.current.get(spotId) ?? { visits: [] }), reactions: [] })
        return
      }
      const userIds = [...new Set(data.map((r: { user_id: string }) => r.user_id))]
      const { data: profiles } = await supabaseRef.current
        .from("profiles").select("id, username, avatar_url").in("id", userIds)
      const pm = Object.fromEntries((profiles ?? []).map((p: { id: string; username: string | null; avatar_url: string | null }) => [p.id, p]))
      const newReactions = data.map((r: { user_id: string; type: string }) => ({
        user_id: r.user_id, type: r.type as "love" | "save",
        username: pm[r.user_id]?.username ?? null, avatar_url: pm[r.user_id]?.avatar_url ?? null,
      }))
      setReactions(newReactions)
      spotDataCacheRef.current.set(spotId, { ...(spotDataCacheRef.current.get(spotId) ?? { visits: [] }), reactions: newReactions })
    } catch { setReactions([]) }
  }, [])


  const handleToggleLove = useCallback(async () => {
    if (!user || !selectedSpot) return
    const hasLoved = reactions.some(r => r.user_id === user.id && r.type === "love")
    const myReaction = { user_id: user.id, type: "love" as const, username: userProfile?.username ?? null, avatar_url: userProfile?.avatar_url ?? null }
    if (hasLoved) {
      setReactions(prev => prev.filter(r => !(r.user_id === user.id && r.type === "love")))
      setLikeCountsBySpotId(prev => ({ ...prev, [selectedSpot.id]: Math.max(0, (prev[selectedSpot.id] ?? 1) - 1) }))
    } else {
      setReactions(prev => [...prev, myReaction])
      setLikeCountsBySpotId(prev => ({ ...prev, [selectedSpot.id]: (prev[selectedSpot.id] ?? 0) + 1 }))
    }
    try {
      if (hasLoved) {
        const { error } = await supabaseRef.current.from("spot_reactions").delete()
          .eq("spot_id", selectedSpot.id).eq("user_id", user.id).eq("type", "love")
        if (error) throw error
      } else {
        const { error } = await supabaseRef.current.from("spot_reactions")
          .upsert({ spot_id: selectedSpot.id, user_id: user.id, type: "love" }, { onConflict: "spot_id,user_id,type", ignoreDuplicates: true })
        if (error) throw error
      }
      spotDataCacheRef.current.delete(selectedSpot.id) // invalidate cache after write
    } catch {
      if (hasLoved) {
        setReactions(prev => [...prev, myReaction])
        setLikeCountsBySpotId(prev => ({ ...prev, [selectedSpot.id]: (prev[selectedSpot.id] ?? 0) + 1 }))
      } else {
        setReactions(prev => prev.filter(r => !(r.user_id === user.id && r.type === "love")))
        setLikeCountsBySpotId(prev => ({ ...prev, [selectedSpot.id]: Math.max(0, (prev[selectedSpot.id] ?? 1) - 1) }))
      }
      toast.error("Erreur lors de la mise à jour.")
    }
  }, [user, selectedSpot, reactions, userProfile])

  // Fetch visits + reactions + realtime subscription when a spot is selected
  useEffect(() => {
    if (!selectedSpot) {
      setVisits([])
      setReactions([])
      return
    }
    Promise.all([fetchVisits(selectedSpot.id), fetchReactions(selectedSpot.id)])
    const channel = supabaseRef.current
      .channel(`spot-${selectedSpot.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "spot_visits", filter: `spot_id=eq.${selectedSpot.id}` },
        () => fetchVisits(selectedSpot.id)
      )
      .on("postgres_changes",
        { event: "*", schema: "public", table: "spot_reactions", filter: `spot_id=eq.${selectedSpot.id}` },
        () => fetchReactions(selectedSpot.id)
      )
      .subscribe()
    return () => { supabaseRef.current.removeChannel(channel) }
  }, [selectedSpot?.id, fetchVisits, fetchReactions])


  const points = useMemo(() => visibleSpots.map((spot) => ({
    type: "Feature" as const,
    properties: { cluster: false, spotId: spot.id, category: spot.category },
    geometry: { type: "Point" as const, coordinates: [spot.lng, spot.lat] },
  })), [visibleSpots])

  const visibleSpotsMap = useMemo(
    () => Object.fromEntries(visibleSpots.map(s => [s.id, s])) as Record<string, Spot>,
    [visibleSpots]
  )

  const { clusters, supercluster } = useSupercluster({
    points,
    bounds,
    zoom,
    options: { radius: 25, maxZoom: 16 },
  })

  const markerElements = useMemo(() => clusters.map((cluster) => {
    const [longitude, latitude] = cluster.geometry.coordinates
    const { cluster: isCluster, point_count: pointCount } =
      cluster.properties as { cluster: boolean; point_count: number }

    if (isCluster) {
      return (
        <MapMarker
          key={`cluster-${cluster.id}`}
          latitude={latitude}
          longitude={longitude}
        >
          <div
            className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-full border-[3px] border-white/90 bg-blue-600 dark:bg-indigo-500 text-sm font-bold text-white shadow-[0_0_20px_rgba(37,99,235,0.5)] dark:shadow-[0_0_20px_rgba(99,102,241,0.5)] transition-transform hover:scale-110"
            onClick={(e) => {
              e.stopPropagation()
              if (!supercluster) return
              const expansionZoom = Math.min(
                supercluster.getClusterExpansionZoom(cluster.id as number),
                20
              )
              mapRef.current?.flyTo({ center: [longitude, latitude], zoom: expansionZoom, speed: 1.2 })
            }}
          >
            {pointCount}
          </div>
        </MapMarker>
      )
    }

    const spotId = cluster.properties.spotId
    const spot = visibleSpotsMap[spotId]
    if (!spot) return null

    const color = CATEGORY_COLORS[spot.category ?? "default"] ?? CATEGORY_COLORS.default
    const emoji = CATEGORY_EMOJIS[spot.category ?? "other"] ?? "📍"
    const isMine = spot.user_id === user?.id
    const firstPhoto = spot.image_url?.split(",")[0]?.trim() || null
    const friendAvatar = !isMine ? (spot.profiles?.avatar_url ?? null) : null
    const friendInitial = !isMine ? (spot.profiles?.username ?? "?")[0].toUpperCase() : ""
    const markerScale = Math.min(1.4, Math.max(0.5, zoom / 15))

    return (
      <MapMarker
        key={`spot-${spot.id}`}
        longitude={spot.lng}
        latitude={spot.lat}
        anchor="bottom"
        onClick={(e) => {
          e.originalEvent.stopPropagation()
          setSelectedSpot(spot)
          mapRef.current?.flyTo({ center: [spot.lng, spot.lat], zoom: 15.5, offset: [0, 100], duration: 800 })
        }}
      >
        <div
          className="relative cursor-pointer"
          style={{ transform: `scale(${markerScale})`, transformOrigin: "bottom center" }}
        >
          {!isMine && (
            <div className="absolute -top-1.5 -right-1.5 z-10 flex h-5 w-5 items-center justify-center overflow-hidden rounded-full border-2 border-white dark:border-zinc-900 bg-gradient-to-br from-indigo-500 to-purple-600 text-[8px] font-bold text-white shadow-md">
              {friendAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={friendAvatar} alt="" className="h-full w-full object-cover" />
              ) : (
                friendInitial
              )}
            </div>
          )}
          <div
            className={cn(
              "overflow-hidden rounded-full border-[3px] shadow-lg",
              isMine
                ? "h-11 w-11 border-white dark:border-white/90 shadow-black/30"
                : "h-10 w-10 border-indigo-400 dark:border-indigo-300 shadow-indigo-500/30"
            )}
          >
            {firstPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={firstPhoto}
                alt=""
                className="h-full w-full object-cover"
                onError={(e) => {
                  const target = e.currentTarget
                  target.style.display = "none"
                  target.parentElement!.style.background = color
                  target.parentElement!.innerHTML = `<span style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:1.1em">${emoji}</span>`
                }}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-base" style={{ background: color }}>
                {emoji}
              </div>
            )}
          </div>
          <div
            className="mx-auto h-2.5 w-[3px] rounded-b-full"
            style={{ background: isMine ? "rgba(255,255,255,0.85)" : "rgba(129,140,248,0.9)" }}
          />
        </div>
      </MapMarker>
    )
  }), [clusters, supercluster, visibleSpotsMap, zoom, user?.id])

  if (authLoading) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-gray-50 dark:bg-zinc-950">
        <motion.div
          animate={{ scale: [1, 1.1, 1], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-sky-500 dark:from-indigo-500 dark:to-purple-600 shadow-2xl shadow-blue-600/30 dark:shadow-indigo-500/30"
        >
          <MapPin size={28} className="text-white" />
        </motion.div>
        <p className="text-sm font-medium tracking-wide text-gray-500 dark:text-zinc-400">
          Chargement...
        </p>
      </div>
    )
  }

  return (
    <div className="relative h-screen w-full overflow-hidden bg-gray-50 dark:bg-zinc-950">
      {/* Map Layer */}
      <div className="absolute inset-0 h-full w-full">
        <Map
          ref={mapRef}
          mapboxAccessToken={MAPBOX_TOKEN}
          initialViewState={{
            longitude: 2.3522,
            latitude: 48.8566,
            zoom: 13,
            pitch: 50,
            bearing: -10,
          }}
          mapStyle={resolvedTheme === "light" ? LIGHT_STYLE : DARK_STYLE}
          attributionControl={false}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onError={(e: any) => setMapError(e.error?.message || "Erreur carte")}
          onClick={() => setSelectedSpot(null)}
          onLoad={() => {
            if (mapRef.current) {
              const b = mapRef.current.getBounds()?.toArray().flat()
              if (b) setBounds(b as [number, number, number, number])
              setZoom(mapRef.current.getZoom())
              const map = mapRef.current.getMap()
              applyLightFilters()
              map.on("style.load", applyLightFilters)
            }
          }}
          onMove={() => {
            if (!mapRef.current) return
            const b = mapRef.current.getBounds()?.toArray().flat()
            const z = mapRef.current.getZoom()
            startTransition(() => {
              if (b) setBounds(b as [number, number, number, number])
              setZoom(z)
            })
          }}
          style={{ width: "100%", height: "100%" }}
        >
          {markerElements}

          {/* User Location Profile Marker */}
          {userLocation && (
            <MapMarker
              longitude={userLocation.lng}
              latitude={userLocation.lat}
              anchor="bottom"
            >
              <div className="group relative flex cursor-pointer flex-col items-center transition-transform hover:scale-110">
                <div className="relative z-10 flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border-4 border-blue-600 dark:border-indigo-500 bg-gradient-to-br from-blue-600 to-sky-500 dark:from-indigo-500 dark:to-purple-600 text-lg font-bold text-white shadow-[0_0_20px_rgba(37,99,235,0.6)] dark:shadow-[0_0_20px_rgba(99,102,241,0.6)]">
                  {userProfile?.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={userProfile.avatar_url}
                      alt="Moi"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    (userProfile?.username
                      ? userProfile.username.charAt(0)
                      : (user?.email?.charAt(0) ?? "M")
                    ).toUpperCase()
                  )}
                </div>
                {/* Petit triangle pointeur */}
                <div className="z-0 -mt-2 h-3 w-3 rotate-45 bg-blue-600 dark:bg-indigo-500 shadow-sm" />
                <span className="absolute -bottom-6 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium whitespace-nowrap text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
                  Ma position
                </span>
              </div>
            </MapMarker>
          )}

          {/* Friend Location Markers */}
          {friendLocations.map((friend) => {
            const friendOnline =
              Date.now() - new Date(friend.last_active_at).getTime() <
              15 * 60000
            const initials = (friend.username ?? "?").charAt(0).toUpperCase()
            return (
              <MapMarker
                key={`friend-${friend.id}`}
                longitude={friend.lng}
                latitude={friend.lat}
                anchor="bottom"
              >
                <div
                  className="group relative flex cursor-pointer flex-col items-center transition-transform hover:scale-110"
                  onClick={() => setPublicProfileUserId(friend.id)}
                >
                  <div className="relative z-10">
                    <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border-[3px] border-purple-400 bg-gradient-to-br from-purple-500 to-pink-500 text-sm font-bold text-white shadow-[0_0_14px_rgba(168,85,247,0.5)]">
                      {friend.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={friend.avatar_url}
                          alt={friend.username ?? ""}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        initials
                      )}
                    </div>
                    <div className={`absolute -right-0.5 -bottom-0.5 z-20 h-3.5 w-3.5 rounded-full border-2 border-white dark:border-zinc-950 ${friendOnline ? "bg-green-500" : "bg-red-500"}`} />
                  </div>
                  <div className="z-0 -mt-1.5 h-2.5 w-2.5 rotate-45 bg-purple-400" />
                  <span className="absolute -bottom-6 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium whitespace-nowrap text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
                    @{friend.username ?? "ami"}
                  </span>
                </div>
              </MapMarker>
            )
          })}

          {/* 3D Buildings Layer */}
          {is3D && <Layer {...(resolvedTheme === "light" ? BUILDINGS_LAYER_LIGHT : BUILDINGS_LAYER)} />}
        </Map>
      </div>

      {/* Map Error Overlay */}
      {mapError && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm">
          <div className="max-w-md rounded-3xl border border-gray-200 dark:border-white/10 bg-zinc-900 p-8 text-center">
            <p className="mb-2 text-lg font-semibold text-red-400">
              ⚠️ Erreur carte
            </p>
            <p className="text-sm text-zinc-400">{mapError}</p>
          </div>
        </div>
      )}

      {/* Top Bar */}
      <div className="pointer-events-none absolute top-[env(safe-area-inset-top)] right-0 left-0 z-30 mt-4 flex items-start justify-end px-4">
        <div className="pointer-events-auto hidden">
          <UserMenu
            user={user}
            userProfile={userProfile}
            incomingCount={incomingCount}
            followingCount={followingIds.length}
            onSignOut={signOut}
            onOpenProfile={() => setShowProfileModal(true)}
            onOpenFriends={() => {
              fetchFollowing()
              setShowFriendsModal(true)
            }}
          />
        </div>
      </div>

      <div className="absolute top-[calc(env(safe-area-inset-top)+1.5rem)] left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-2">
          <div className="flex flex-col items-center gap-2">
          <div className="relative flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-full border border-gray-200 dark:border-white/10 bg-white/90 dark:bg-zinc-900/90 p-1 shadow-lg backdrop-blur-md">
              {filterButtons.map(({ key, label, icon }) => {
                const isAmisKey = key === "friends"
                const isActive = filter === key || (isAmisKey && filter === "groups")
                const activeGroup = isAmisKey && activeGroupId ? groups.find(g => g.id === activeGroupId) : null
                const displayLabel = activeGroup ? activeGroup.name : label
                const displayIcon = activeGroup
                  ? <span className="text-sm leading-none">{activeGroup.emoji}</span>
                  : icon
                return (
                  <motion.button
                    key={key}
                    onClick={() => {
                      if (isAmisKey) {
                        if (isActive) {
                          setShowGroupsDropdown(v => !v)
                        } else {
                          setFilter("friends")
                          setActiveGroupId(null)
                          setShowGroupsDropdown(false)
                        }
                      } else {
                        setFilter(key)
                        setActiveGroupId(null)
                        setShowGroupsDropdown(false)
                        if (key === "mine") { setFriendFilterIds(new Set()); setFriendCategoryFilter(new Set()); setShowFriendFilter(false) }
                      }
                    }}
                    className={cn(
                      "relative flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold whitespace-nowrap transition-colors",
                      isActive
                        ? "bg-blue-600 dark:bg-indigo-500 text-white shadow-[0_2px_10px_rgba(37,99,235,0.5)] dark:shadow-[0_2px_10px_rgba(99,102,241,0.5)]"
                        : "text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white"
                    )}
                    whileTap={{ scale: 0.95 }}
                  >
                    {displayIcon} {displayLabel}
                    {isAmisKey && isActive && (
                      <ChevronDown size={11} className={cn("ml-0.5 transition-transform", showGroupsDropdown && "rotate-180")} />
                    )}
                    {isAmisKey && activeGroupId && (
                      <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-indigo-300 border border-indigo-500" />
                    )}
                  </motion.button>
                )
              })}
            </div>

            {/* Overlay to close dropdown */}
            {showGroupsDropdown && (
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowGroupsDropdown(false)}
              />
            )}

            {/* Groups dropdown */}
            {showGroupsDropdown && (
              <div
                className="absolute top-full mt-2 left-0 z-50 w-64 rounded-2xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-zinc-900 shadow-xl overflow-hidden"
                onPointerDown={e => e.stopPropagation()}
              >
                {/* Entrée "Amis" — groupe par défaut */}
                <div
                  className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-white/[0.04] cursor-pointer border-b border-gray-100 dark:border-white/[0.05]"
                  onClick={() => {
                    setFilter("friends")
                    setActiveGroupId(null)
                    setShowGroupsDropdown(false)
                  }}
                >
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
                    <Users size={16} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-bold text-gray-900 dark:text-white truncate">Amis</p>
                    <p className="text-[10px] text-gray-400 dark:text-zinc-500">Tous tes amis</p>
                  </div>
                  {filter === "friends" && !activeGroupId && (
                    <div className="w-4 h-4 rounded-full bg-indigo-500 flex items-center justify-center">
                      <span className="text-white text-[9px] font-bold">✓</span>
                    </div>
                  )}
                </div>

                {groups.map(group => (
                  <div
                    key={group.id}
                    className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-white/[0.04] cursor-pointer border-b border-gray-100 dark:border-white/[0.05]"
                    onClick={() => {
                      const nextId = activeGroupId === group.id ? null : group.id
                      setActiveGroupId(nextId)
                      setFilter(nextId ? "groups" : "friends")
                      setShowGroupsDropdown(false)
                    }}
                  >
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-base flex-shrink-0">
                      {group.emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-bold text-white truncate">{group.name}</p>
                    </div>
                    {activeGroupId === group.id && (
                      <div className="w-4 h-4 rounded-full bg-indigo-500 flex items-center justify-center">
                        <span className="text-white text-[9px] font-bold">✓</span>
                      </div>
                    )}
                    <button
                      onPointerDown={e => e.stopPropagation()}
                      onClick={e => {
                        e.stopPropagation()
                        setSelectedGroupForSettings(group)
                        setShowGroupsDropdown(false)
                      }}
                      className="w-7 h-7 rounded-lg bg-white/[0.05] flex items-center justify-center text-zinc-400 hover:text-white transition-colors flex-shrink-0"
                    >
                      <Settings size={12} />
                    </button>
                  </div>
                ))}

                {/* Créer un groupe */}
                {!showCreateGroup ? (
                  <button
                    onClick={() => setShowCreateGroup(true)}
                    className="flex items-center gap-3 px-3 py-2.5 w-full hover:bg-white/[0.04] transition-colors"
                  >
                    <div className="w-8 h-8 rounded-xl border-2 border-dashed border-indigo-500/40 flex items-center justify-center text-indigo-400 text-lg flex-shrink-0">
                      +
                    </div>
                    <div>
                      <p className="text-[12px] font-semibold text-indigo-400">Créer un groupe</p>
                      <p className="text-[10px] text-zinc-600">Inviter des amis, partager des spots</p>
                    </div>
                  </button>
                ) : (
                  <div className="px-3 py-2.5 space-y-2">
                    <div className="flex gap-2">
                      <input
                        value={newGroupEmoji}
                        onChange={e => setNewGroupEmoji(e.target.value)}
                        className="w-10 text-center rounded-lg bg-white/[0.06] border border-white/[0.08] text-white text-sm py-1.5"
                        maxLength={2}
                      />
                      <input
                        autoFocus
                        value={newGroupName}
                        onChange={e => setNewGroupName(e.target.value)}
                        placeholder="Nom du groupe..."
                        className="flex-1 rounded-lg bg-white/[0.06] border border-white/[0.08] text-white text-[12px] px-2.5 py-1.5 placeholder:text-zinc-600"
                        onKeyDown={e => e.key === "Enter" && handleCreateGroup()}
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowCreateGroup(false)}
                        className="flex-1 rounded-lg bg-white/[0.05] py-1.5 text-[11px] font-semibold text-zinc-500"
                      >
                        Annuler
                      </button>
                      <button
                        onClick={handleCreateGroup}
                        disabled={!newGroupName.trim() || creatingGroup}
                        className="flex-1 rounded-lg bg-indigo-500 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
                      >
                        {creatingGroup ? "..." : "Créer"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Bouton filtre amis — petit, discret, visible seulement en mode Amis */}
            {(filter === "friends" || filter === "groups") && friendProfiles.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setShowFriendFilter(v => !v)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-2.5 py-2 text-xs font-medium shadow-md backdrop-blur-md transition-colors",
                    friendFilterIds.size > 0 || friendCategoryFilter.size > 0
                      ? "border-blue-600 dark:border-indigo-500 bg-blue-600 dark:bg-indigo-500 text-white"
                      : "border-gray-200 dark:border-white/10 bg-white/80 dark:bg-zinc-900/80 text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white"
                  )}
                >
                  <SlidersHorizontal size={13} />
                  {(friendFilterIds.size > 0 || friendCategoryFilter.size > 0) && (
                    <span>{friendFilterIds.size + friendCategoryFilter.size}</span>
                  )}
                </button>

                <AnimatePresence>
                  {showFriendFilter && (
                    <>
                      {/* Overlay pour fermer en cliquant à côté */}
                      <div className="fixed inset-0 z-40" onClick={() => setShowFriendFilter(false)} />
                      <motion.div
                        initial={{ opacity: 0, scale: 0.92 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.92 }}
                        transition={{ duration: 0.15 }}
                        className="fixed left-1/2 -translate-x-1/2 z-50 w-[min(17rem,88vw)] rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-zinc-900 shadow-2xl p-4" style={{ top: "calc(env(safe-area-inset-top) + 4.5rem)" }}
                      >
                        {filter === "friends" && (
                          <>
                            {/* Recherche */}
                            <input
                              type="text"
                              placeholder="Rechercher..."
                              value={friendFilterSearch}
                              onChange={e => setFriendFilterSearch(e.target.value)}
                              className="w-full rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-zinc-800 px-3 py-2 text-xs text-gray-800 dark:text-zinc-200 outline-none placeholder-gray-400 dark:placeholder-zinc-500"
                            />
                            {/* Tout cocher / tout décocher */}
                            <div className="mt-2 flex gap-1.5">
                              <button
                                onClick={() => setFriendFilterIds(new Set(friendProfiles.map(f => f.id)))}
                                className="flex-1 rounded-xl bg-gray-100 dark:bg-zinc-800 py-1.5 text-[11px] font-medium text-gray-700 dark:text-zinc-300 hover:bg-gray-200 dark:hover:bg-zinc-700 transition-colors"
                              >
                                Tout cocher
                              </button>
                              <button
                                onClick={() => setFriendFilterIds(new Set())}
                                className="flex-1 rounded-xl bg-gray-100 dark:bg-zinc-800 py-1.5 text-[11px] font-medium text-gray-700 dark:text-zinc-300 hover:bg-gray-200 dark:hover:bg-zinc-700 transition-colors"
                              >
                                Tout décocher
                              </button>
                            </div>
                            {/* Liste des amis */}
                            <div className="mt-2 max-h-44 overflow-y-auto space-y-0.5">
                              {friendProfiles
                                .filter(fp => !friendFilterSearch || (fp.username ?? "").toLowerCase().includes(friendFilterSearch.toLowerCase()))
                                .map(fp => (
                                  <button
                                    key={fp.id}
                                    onClick={() => setFriendFilterIds(prev => {
                                      const next = new Set(prev)
                                      if (next.has(fp.id)) next.delete(fp.id)
                                      else next.add(fp.id)
                                      return next
                                    })}
                                    className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 transition-colors hover:bg-gray-50 dark:hover:bg-zinc-800"
                                  >
                                    {fp.avatar_url ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={fp.avatar_url} alt="" className="h-7 w-7 flex-shrink-0 rounded-full object-cover" />
                                    ) : (
                                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-xs font-bold text-white">
                                        {(fp.username ?? "?")[0].toUpperCase()}
                                      </div>
                                    )}
                                    <span className="flex-1 text-left text-xs text-gray-700 dark:text-zinc-300">@{fp.username ?? "ami"}</span>
                                    <div className={cn(
                                      "flex h-4 w-4 items-center justify-center rounded border-2 transition-colors",
                                      friendFilterIds.has(fp.id)
                                        ? "border-blue-600 dark:border-indigo-500 bg-blue-600 dark:bg-indigo-500"
                                        : "border-gray-300 dark:border-zinc-600"
                                    )}>
                                      {friendFilterIds.has(fp.id) && <div className="h-1.5 w-1.5 rounded-sm bg-white" />}
                                    </div>
                                  </button>
                                ))}
                            </div>
                          </>
                        )}

                        {/* Filtre par catégorie */}
                        <div className="mt-3 border-t border-gray-100 dark:border-white/[0.07] pt-3">
                          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500">Catégories</p>
                          <div className="flex flex-wrap gap-1.5">
                            {CATEGORIES.map(cat => (
                              <button
                                key={cat.key}
                                onClick={() => setFriendCategoryFilter(prev => {
                                  const next = new Set(prev)
                                  if (next.has(cat.key)) next.delete(cat.key)
                                  else next.add(cat.key)
                                  return next
                                })}
                                className={cn(
                                  "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium border transition-colors",
                                  friendCategoryFilter.has(cat.key)
                                    ? "border-blue-600 dark:border-indigo-500 bg-blue-600 dark:bg-indigo-500 text-white"
                                    : "border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400"
                                )}
                              >
                                <span>{cat.emoji}</span> {cat.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
      </div>


      {/* Floating Action Buttons (Desktop overrides & Locate) */}
      <div className={cn("pointer-events-none absolute right-4 bottom-[calc(9rem+env(safe-area-inset-bottom))] flex flex-col items-end gap-3 sm:bottom-6", selectedSpot ? "z-10" : "z-40")}>
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={() => setShowExploreModal(true)}
          className="pointer-events-auto hidden"
          title="Explorer"
        >
          <Search size={20} />
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={locateUser}
          className={cn(
            "pointer-events-auto rounded-2xl border border-gray-200 dark:border-white/10 bg-white/90 dark:bg-zinc-900/90 p-3 text-gray-700 dark:text-white shadow-lg backdrop-blur-md transition-all hover:bg-gray-100 dark:hover:bg-zinc-800",
            isLocating && "animate-pulse"
          )}
        >
          <Locate size={20} className={isLocating ? "text-indigo-400" : ""} />
        </motion.button>

        <motion.button
          whileTap={{ scale: 0.93 }}
          onClick={handleOpenAddSpot}
          className={cn(
            "pointer-events-auto hidden",
            visibleSpots.length === 0 &&
              "animate-pulse ring-4 ring-blue-600/20 dark:ring-indigo-500/20"
          )}
        >
          <Plus size={18} /> Ajouter un spot
        </motion.button>
      </div>


      {/* Bouton 3D (En bas à gauche) */}
      <div className={cn("pointer-events-none absolute bottom-[calc(9rem+env(safe-area-inset-bottom))] left-4 sm:bottom-6 sm:left-[4.5rem]", selectedSpot ? "z-10" : "z-40")}>
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={() => {
            const next = !is3D
            setIs3D(next)
            mapRef.current?.easeTo({
              pitch: next ? 55 : 0,
              bearing: next ? -10 : 0,
              duration: 800,
            })
          }}
          className={cn(
            "pointer-events-auto rounded-2xl border p-3 shadow-lg backdrop-blur-md transition-all",
            is3D
              ? "border-blue-500/50 dark:border-indigo-400/50 bg-blue-600/90 dark:bg-indigo-500/90 text-white shadow-blue-600/30 dark:shadow-indigo-500/30"
              : "border-gray-200 dark:border-white/10 bg-white/90 dark:bg-zinc-900/90 text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800 hover:text-gray-900 dark:hover:text-white"
          )}
          title={is3D ? "Passer en 2D" : "Passer en 3D"}
        >
          <Building2 size={20} />
        </motion.button>
      </div>

      {/* Selected Spot Details (Version Agrandie Premium) */}
      <AnimatePresence>
        {selectedSpot && (
          <motion.div
            key={selectedSpot.id}
            initial={{ y: 200, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 200, opacity: 0 }}
            drag="y"
            dragControls={spotDragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_e, info) => {
              if (info.offset.y > 60 || info.velocity.y > 500) setSelectedSpot(null)
            }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            className="absolute right-2 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] left-2 z-20 flex max-h-[78vh] flex-col overflow-hidden rounded-[2.5rem] border border-gray-200 dark:border-white/10 bg-white/95 dark:bg-zinc-950/95 text-gray-900 dark:text-white shadow-[0_-10px_50px_rgba(0,0,0,0.2)] dark:shadow-[0_-10px_50px_rgba(0,0,0,0.5)] backdrop-blur-2xl sm:right-auto sm:bottom-6 sm:left-[4.5rem] sm:max-h-[88vh] sm:w-[440px] sm:rounded-3xl sm:shadow-2xl"
          >
            {/* Drag Handle Mobile — glisser ici pour fermer */}
            <div
              className="absolute top-0 left-0 right-0 z-30 flex touch-none cursor-grab justify-center pt-3 pb-5 sm:hidden"
              onPointerDown={(e) => spotDragControls.start(e)}
            >
              <div className="h-1.5 w-12 rounded-full bg-white/30" />
            </div>

            <button
              className="absolute top-4 right-4 z-30 flex h-8 w-8 items-center justify-center rounded-full bg-gray-200/80 dark:bg-black/60 text-gray-600 dark:text-zinc-300 backdrop-blur-md transition-colors hover:text-gray-900 dark:hover:text-white"
              onClick={() => setSelectedSpot(null)}
            >
              <X size={16} />
            </button>

            {/* Tout le contenu est scrollable, photo incluse */}
            <div
              ref={spotScrollRef}
              className="flex-1 overflow-y-auto"
              onPointerDown={(e) => {
                if (spotScrollRef.current && spotScrollRef.current.scrollTop === 0) {
                  spotDragControls.start(e)
                }
              }}
              onTouchStart={(e) => {
                const el = spotScrollRef.current as any
                if (!el) return
                el._touchStartY = e.touches[0].clientY
                el._touchStartTime = Date.now()
                el._touchStartScroll = el.scrollTop ?? 0
              }}
              onTouchEnd={(e) => {
                const el = spotScrollRef.current as any
                if (!el) return
                const dy = e.changedTouches[0].clientY - (el._touchStartY ?? 0)
                const dt = Date.now() - (el._touchStartTime ?? 0)
                const velocity = dy / Math.max(dt, 1)
                const scrollTop = el._touchStartScroll ?? 0
                // Fermer si :
                // – swipe bas lent depuis le haut (scrollTop=0, dy>100)
                // – swipe bas rapide depuis n'importe où (velocity>0.5 px/ms)
                if ((scrollTop === 0 && dy > 100) || (dy > 60 && velocity > 0.5)) {
                  setSelectedSpot(null)
                }
              }}
            >

            {selectedSpot.image_url ? (() => {
              const photos = selectedSpot.image_url!.split(",").map(s => s.trim()).filter(Boolean)
              return (
                <div className="relative h-60 w-full overflow-hidden rounded-t-[2.5rem] sm:h-72 sm:rounded-t-3xl">
                  <div
                    ref={carouselRef}
                    className="relative h-full w-full"
                    onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX }}
                    onTouchEnd={(e) => {
                      if (touchStartX.current === null) return
                      const delta = e.changedTouches[0].clientX - touchStartX.current
                      if (delta > 45 && carouselIdx > 0) setCarouselIdx(i => i - 1)
                      else if (delta < -45 && carouselIdx < photos.length - 1) setCarouselIdx(i => i + 1)
                      touchStartX.current = null
                    }}
                  >
                    {photos.map((url, idx) => (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        key={idx}
                        src={url}
                        alt={selectedSpot.title}
                        className="absolute inset-0 h-full w-full object-cover object-center transition-transform duration-300 ease-in-out"
                        style={{ transform: `translateX(${(idx - carouselIdx) * 100}%)` }}
                      />
                    ))}
                  </div>
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-zinc-950/80 via-zinc-950/20 to-transparent" />


                  {selectedSpot.user_id === user?.id && (
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => setEditingSpot(selectedSpot)}
                      className="absolute bottom-3 right-3 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
                      title="Modifier ce spot"
                    >
                      <Pencil size={16} />
                    </button>
                  )}
                  {photos.length > 1 && (
                    <>
                      <button
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => setCarouselIdx(i => Math.max(0, i - 1))}
                        className="absolute left-3 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm disabled:opacity-30"
                        disabled={carouselIdx === 0}
                      >
                        <ChevronLeft size={18} />
                      </button>
                      <button
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => setCarouselIdx(i => Math.min(photos.length - 1, i + 1))}
                        className="absolute right-3 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm disabled:opacity-30"
                        disabled={carouselIdx === photos.length - 1}
                      >
                        <ChevronRight size={18} />
                      </button>
                      <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-1.5">
                        {photos.map((_, idx) => (
                          <button
                            key={idx}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={() => setCarouselIdx(idx)}
                            className={cn(
                              "h-1.5 rounded-full transition-all",
                              idx === carouselIdx ? "w-4 bg-white" : "w-1.5 bg-white/40"
                            )}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )
            })() : (
              <div className="h-10" />
            )}

            <div className="px-5 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-6">
              <div className="flex items-start gap-3">
                <h3 className="flex-1 line-clamp-2 text-2xl leading-tight font-extrabold">
                  {selectedSpot.title}
                </h3>
                {user && (() => {
                  const loveList = loveReactions
                  const hasLoved = loveList.some(r => r.user_id === user.id)
                  return (
                    <button
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        longPressTimer.current = setTimeout(() => {
                          if (loveList.length > 0) setShowLikersPanel(true)
                        }, 500)
                      }}
                      onPointerUp={(e) => {
                        e.stopPropagation()
                        if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null }
                      }}
                      onPointerLeave={() => {
                        if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null }
                      }}
                      onClick={() => handleToggleLove()}
                      className={cn(
                        "mt-1 flex flex-shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold transition-colors select-none",
                        hasLoved
                          ? "bg-red-500 text-white"
                          : "bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400 hover:bg-red-50 dark:hover:bg-red-500/20 hover:text-red-500"
                      )}
                    >
                      <Heart size={15} className={hasLoved ? "fill-current" : ""} />
                      <span className="text-xs font-bold">{loveList.length}</span>
                    </button>
                  )
                })()}
              </div>
              {selectedSpot.address && (
                <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-zinc-400">
                  <MapPin size={14} className="text-blue-600 dark:text-indigo-400" />{" "}
                  {selectedSpot.address}
                </p>
              )}

              {selectedSpot.price_range && (
                <p className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  <span className="text-base leading-none">💶</span>{selectedSpot.price_range}
                </p>
              )}

              <OpeningHoursBlock
                weekdays={selectedSpot.weekday_descriptions}
                openingHours={selectedSpot.opening_hours}
              />

              {selectedSpot.description && cleanDescription(selectedSpot.description) && (
                <div className="mt-4 rounded-2xl border border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-zinc-900/60 p-4">
                  <p className={cn(
                    "text-[15px] leading-relaxed text-gray-600 dark:text-zinc-300",
                    !descExpanded && "line-clamp-4"
                  )}>
                    {renderDescription(cleanDescription(selectedSpot.description))}
                  </p>
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => setDescExpanded((v) => !v)}
                    className="mt-2 text-xs font-semibold text-blue-600 dark:text-indigo-400 hover:underline"
                  >
                    {descExpanded ? "Voir moins" : "Voir plus"}
                  </button>
                </div>
              )}

              {user && followingIds.length > 0 && (
                <div className="mt-4 flex gap-2">
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => {
                      setProposeOutingSpot(selectedSpot)
                      setSelectedSpot(null)
                      setShowFriendsModal(true)
                    }}
                    className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 px-4 py-2.5 text-[13px] font-semibold text-indigo-700 dark:text-indigo-300 transition-colors hover:bg-indigo-100 dark:hover:bg-indigo-500/20 active:scale-[0.98]"
                  >
                    <CalendarPlus size={14} /> Proposer ici
                  </button>
                  {groups.length > 0 && (
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => openGroupPicker(selectedSpot.id)}
                      title="Ajouter au groupe"
                      className="flex items-center justify-center rounded-2xl bg-gray-100 dark:bg-white/[0.07] p-2.5 text-gray-700 dark:text-zinc-300 transition-colors hover:bg-gray-200 dark:hover:bg-white/[0.12] active:scale-[0.98]"
                    >
                      <Layers size={16} />
                    </button>
                  )}
                </div>
              )}

              <div className="mt-5 flex flex-wrap items-center gap-2">
                <a
                  href={selectedSpot.maps_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([selectedSpot.title, selectedSpot.address].filter(Boolean).join(" "))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-blue-600 dark:bg-indigo-500 py-3 text-sm font-bold text-white transition-transform hover:scale-[1.02] hover:bg-blue-500 dark:hover:bg-indigo-400"
                >
                  <Navigation size={16} /> S&apos;y rendre
                </a>
                <button
                  onClick={async () => {
                    const spotUrl = `${window.location.origin}/spot/${selectedSpot.id}`
                    const text = `📍 ${selectedSpot.title}${selectedSpot.address ? ` · ${selectedSpot.address}` : ""}`
                    if (navigator.share) {
                      try {
                        await navigator.share({ title: selectedSpot.title, text, url: spotUrl })
                      } catch {
                        /* user cancelled */
                      }
                    } else {
                      await navigator.clipboard.writeText(spotUrl)
                      toast.success("Lien copié !")
                    }
                  }}
                  className="flex items-center justify-center gap-2 rounded-2xl bg-gray-100 dark:bg-white/10 px-5 py-3 text-sm font-bold text-gray-700 dark:text-white transition-colors hover:bg-gray-200 dark:hover:bg-white/20"
                >
                  <Share size={16} /> Partager
                </button>
                {(selectedSpot.user_id === user?.id || isAdmin) && (
                  <>
                    <button
                      onClick={() => {
                        openConfirm({
                          title: "Supprimer ce lieu ?",
                          message: "Cette action est irréversible.",
                          confirmLabel: "Supprimer",
                          danger: true,
                          onConfirm: () => toast.promise(handleDeleteSpot(selectedSpot.id), {
                            loading: "Suppression du spot...",
                            success: "Adieu petit spot ! Supprimé avec succès.",
                            error: "Erreur lors de la suppression.",
                          }),
                        })
                      }}
                      className="flex items-center justify-center rounded-2xl bg-red-500/10 p-3 text-red-500 transition-colors hover:bg-red-500/20"
                      title="Supprimer ce spot"
                    >
                      <X size={18} />
                    </button>
                  </>
                )}
              </div>


              {/* Visits Section */}
              <div className="mt-5 border-t border-gray-100 dark:border-white/5 pt-4">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-sm font-bold text-gray-900 dark:text-white">Qui a visité ce lieu</h4>
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={handleToggleVisit}
                    className={cn(
                      "flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors",
                      visits.some((v) => v.user_id === user?.id)
                        ? "bg-green-500/15 text-green-600 dark:text-green-400"
                        : "bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-zinc-300 hover:bg-gray-200 dark:hover:bg-white/15"
                    )}
                  >
                    <CheckCircle2 size={14} /> J&apos;ai visité ce lieu
                  </button>
                </div>
                {visits.length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-zinc-500">Visite cet endroit en premier !</p>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="flex -space-x-2">
                      {visits.slice(0, 8).map((v) => (
                        <button
                          key={v.user_id}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => {
                            if (v.user_id !== user?.id) setPublicProfileUserId(v.user_id)
                          }}
                          title={`@${v.username ?? "utilisateur"}`}
                          className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border-2 border-white dark:border-zinc-950 bg-gradient-to-br from-indigo-500 to-purple-600 text-xs font-bold text-white transition-transform hover:scale-110 hover:z-10"
                        >
                          {v.avatar_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={v.avatar_url} alt={v.username ?? ""} className="h-full w-full object-cover" />
                          ) : (
                            (v.username ?? "?").charAt(0).toUpperCase()
                          )}
                        </button>
                      ))}
                      {visits.length > 8 && (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white dark:border-zinc-950 bg-gray-200 dark:bg-zinc-700 text-xs font-bold text-gray-600 dark:text-zinc-300">
                          +{visits.length - 8}
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-gray-400 dark:text-zinc-500">
                      {visits.length} visite{visits.length > 1 ? "s" : ""}
                    </span>
                  </div>
                )}
              </div>

              <div className="mt-5 flex items-center justify-between border-t border-gray-100 dark:border-white/5 pt-4 text-gray-500 dark:text-zinc-500">
                <div
                  className={cn(
                    "flex items-center gap-2",
                    selectedSpot.user_id !== user?.id && "cursor-pointer transition-transform hover:scale-105 active:scale-95"
                  )}
                  onClick={() => {
                    if (selectedSpot.user_id !== user?.id) {
                      setPublicProfileUserId(selectedSpot.user_id)
                    } else {
                      setShowProfileModal(true)
                    }
                  }}
                >
                  <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-gray-100 dark:bg-zinc-800 text-xs font-bold text-indigo-500 dark:text-indigo-400 ring-2 ring-gray-900/60 dark:ring-white/20">
                    {selectedSpot.profiles?.avatar_url ? (
                       <img src={selectedSpot.profiles.avatar_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      (selectedSpot.profiles?.username || "I")[0].toUpperCase()
                    )}
                  </div>
                  <div>
                    <p className="text-xs leading-none text-zinc-500">
                      Ajouté par
                    </p>
                    <span className="text-sm font-semibold text-gray-700 dark:text-zinc-300 group-hover:underline">
                      @{selectedSpot.profiles?.username ?? "inconnu"}
                    </span>
                  </div>
                </div>
                {selectedSpot.instagram_url && (
                  <a
                    href={selectedSpot.instagram_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`bg-clip-text text-xs font-bold text-transparent transition-opacity hover:opacity-80 ${selectedSpot.instagram_url.includes("tiktok") ? "bg-gradient-to-r from-cyan-400 to-pink-500" : "bg-gradient-to-r from-pink-500 to-orange-400"}`}
                  >
                    {selectedSpot.instagram_url.includes("tiktok") ? "VOIR SUR TIKTOK →" : "POST INSTAGRAM →"}
                  </a>
                )}
              </div>
            </div>{/* fin px-5 pb-6 pt-4 */}
            </div>{/* fin flex-1 overflow-y-auto */}

          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Group picker overlay (fixed, au-dessus de la nav bar) ── */}
      <AnimatePresence>
        {showGroupPicker && selectedSpot && (
          <div className="fixed inset-0 z-[100] flex flex-col justify-end">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowGroupPicker(false)} />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 400, damping: 34 }}
              className="relative z-10 rounded-t-3xl bg-white dark:bg-zinc-950 px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))]"
            >
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[15px] font-bold text-gray-900 dark:text-white">Ajouter à un groupe</p>
                <button onClick={() => setShowGroupPicker(false)} className="rounded-xl p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-white">
                  <X size={15} />
                </button>
              </div>
              <div className="space-y-2">
                {groups.map(group => {
                  const isIn = pickerSpotGroupIds.has(group.id)
                  const toggling = togglingGroupId === group.id
                  return (
                    <button
                      key={group.id}
                      onClick={() => handleToggleSpotInGroup(group.id, selectedSpot.id)}
                      disabled={toggling}
                      className={cn(
                        "w-full flex items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-all active:scale-[0.99] disabled:opacity-60",
                        isIn
                          ? "border-indigo-300 dark:border-indigo-500/40 bg-indigo-50 dark:bg-indigo-500/[0.08]"
                          : "border-gray-100 dark:border-white/[0.06] bg-white dark:bg-zinc-900 hover:bg-gray-50 dark:hover:bg-zinc-800"
                      )}
                    >
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-500/10 text-lg">
                        {group.emoji}
                      </div>
                      <p className="flex-1 text-[14px] font-semibold text-gray-800 dark:text-zinc-100 truncate">{group.name}</p>
                      {toggling
                        ? <LoaderCircle size={16} className="flex-shrink-0 animate-spin text-indigo-400" />
                        : isIn
                          ? <Check size={16} className="flex-shrink-0 text-indigo-500" />
                          : null
                      }
                    </button>
                  )
                })}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Panel likers (long press sur ❤️) */}
      <AnimatePresence>
        {showLikersPanel && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-sm"
              onClick={() => setShowLikersPanel(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ duration: 0.15 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[100] w-[min(18rem,88vw)] rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-zinc-900 shadow-2xl p-4"
            >
              <div className="mb-3 flex items-center justify-between">
                <p className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-white">
                  <Heart size={14} className="fill-red-500 text-red-500" />
                  {loveReactions.length} j&apos;adore
                </p>
                <button onClick={() => setShowLikersPanel(false)} className="rounded-lg p-1 text-gray-400 hover:text-gray-700 dark:hover:text-white">
                  <X size={16} />
                </button>
              </div>
              <div className="max-h-60 overflow-y-auto space-y-1">
                {loveReactions.map(r => (
                  <button
                    key={r.user_id}
                    onClick={() => { setShowLikersPanel(false); if (r.user_id !== user?.id) setPublicProfileUserId(r.user_id) }}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-gray-50 dark:hover:bg-zinc-800"
                  >
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-pink-400 to-red-500 text-xs font-bold text-white">
                      {r.avatar_url
                        ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={r.avatar_url} alt="" className="h-full w-full object-cover" />
                        : (r.username ?? "?")[0].toUpperCase()}
                    </div>
                    <span className="text-sm font-medium text-gray-800 dark:text-zinc-200">
                      @{r.username ?? "utilisateur"}
                      {r.user_id === user?.id && <span className="ml-1 text-xs text-gray-400 dark:text-zinc-500">(toi)</span>}
                    </span>
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Bottom Navigation Bar — mobile only */}
      <div
        className="sm:hidden fixed right-0 bottom-0 left-0 z-[90] border-t border-gray-200 dark:border-white/10 bg-white/90 dark:bg-zinc-950/90 backdrop-blur-xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex h-16 items-center justify-around px-2">
          <button
            onClick={() => {
              setSelectedSpot(null)
              setShowProfileModal(false)
              setShowFriendsModal(false)
              setShowAddModal(false)
              setShowExploreModal(false)
            }}
            className={cn(
               "flex w-16 flex-col items-center gap-1 p-2 transition-colors",
               !showProfileModal && !showFriendsModal && !showAddModal
                 ? "text-blue-600 dark:text-indigo-400"
                 : "text-gray-400 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300"
            )}
          >
            <MapPin
              size={22}
              className={
                !selectedSpot && !showProfileModal && !showFriendsModal && !showAddModal
                  ? "drop-shadow-[0_0_8px_rgba(37,99,235,0.8)] dark:drop-shadow-[0_0_8px_rgba(99,102,241,0.8)]"
                  : ""
              }
            />
            <span className="text-[10px] font-medium">Carte</span>
          </button>

          <button
            onClick={() => {
              fetchFollowing()
              setShowProfileModal(false)
              setShowAddModal(false)
              setShowExploreModal(false)
              setShowFriendsModal(true)
              setIncomingCount(0)
              // Marquer toutes les notifs actuelles comme vues
              if (user) {
                try { localStorage.setItem(`friendspot_notif_seen_${user.id}`, new Date().toISOString()) } catch {}
              }
            }}
            className={cn(
               "flex w-16 flex-col items-center gap-1 p-2 transition-colors",
               showFriendsModal ? "text-blue-600 dark:text-indigo-400" : "text-gray-400 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300"
            )}
          >
            <div className="relative">
              <Users size={22} className={showFriendsModal ? "drop-shadow-[0_0_8px_rgba(37,99,235,0.8)] dark:drop-shadow-[0_0_8px_rgba(99,102,241,0.8)]" : ""} />
              {incomingCount > 0 && (
                <div className="absolute -top-1 -right-1 flex h-[14px] w-[14px] items-center justify-center rounded-full border border-white dark:border-zinc-950 bg-red-500 text-[8px] font-bold text-white">
                  {incomingCount}
                </div>
              )}
            </div>
            <span className="text-[10px] font-medium">Amis</span>
          </button>

          <div className="relative -top-5">
            <button
              onClick={() => {
                setShowProfileModal(false)
                setShowFriendsModal(false)
                setShowExploreModal(false)
                handleOpenAddSpot()
              }}
              className="flex h-14 w-14 items-center justify-center rounded-full border-4 border-white dark:border-zinc-950 bg-gradient-to-br from-blue-600 dark:from-indigo-500 to-sky-500 dark:to-purple-600 text-white shadow-[0_4px_20px_rgba(37,99,235,0.4)] dark:shadow-[0_4px_20px_rgba(99,102,241,0.4)] transition-transform hover:scale-105 active:scale-95"
            >
              <Plus size={24} strokeWidth={3} />
            </button>
          </div>

          <button
            onClick={() => {
              setShowProfileModal(false)
              setShowFriendsModal(false)
              setShowAddModal(false)
              setShowExploreModal(true)
            }}
            className={cn(
              "flex w-16 flex-col items-center gap-1 p-2 transition-colors",
              showExploreModal
                ? "text-blue-600 dark:text-indigo-400"
                : "text-gray-400 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300"
            )}
          >
            <Search size={22} className={showExploreModal ? "drop-shadow-[0_0_8px_rgba(37,99,235,0.8)] dark:drop-shadow-[0_0_8px_rgba(99,102,241,0.8)]" : ""} />
            <span className="text-[10px] font-medium">Explorer</span>
          </button>

          <button
            onClick={() => {
              setShowFriendsModal(false)
              setShowAddModal(false)
              setShowExploreModal(false)
              setShowProfileModal(true)
              markLikesSeen()
            }}
            className={cn(
               "flex w-16 flex-col items-center gap-1 p-2 transition-colors",
               showProfileModal ? "text-blue-600 dark:text-indigo-400" : "text-gray-400 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300"
            )}
          >
            <div className="relative">
              <User size={22} className={showProfileModal ? "drop-shadow-[0_0_8px_rgba(37,99,235,0.8)] dark:drop-shadow-[0_0_8px_rgba(99,102,241,0.8)]" : ""} />
              {newLikesCount > 0 && (
                <div className="absolute -top-1 -right-1 flex h-[14px] w-[14px] items-center justify-center rounded-full border border-white dark:border-zinc-950 bg-red-500 text-[8px] font-bold text-white">
                  {newLikesCount > 9 ? "9+" : newLikesCount}
                </div>
              )}
            </div>
            <span className="text-[10px] font-medium">Profil</span>
          </button>
        </div>
      </div>

      {/* ── Desktop Sidebar Navigation — hidden on mobile ─────────── */}
      <div className="hidden sm:flex fixed left-0 top-0 bottom-0 z-[90] w-16 flex-col items-center border-r border-gray-200 dark:border-white/[0.06] bg-white/90 dark:bg-zinc-950/90 backdrop-blur-xl py-4 gap-1">
        {/* Logo */}
        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-500 shadow-md">
          <MapPin size={16} className="text-white" />
        </div>

        {/* Carte */}
        <button
          onClick={() => { setSelectedSpot(null); setShowProfileModal(false); setShowFriendsModal(false); setShowAddModal(false); setShowExploreModal(false) }}
          title="Carte"
          className={cn("flex h-10 w-10 flex-col items-center justify-center rounded-xl transition-colors",
            !showProfileModal && !showFriendsModal && !showAddModal && !showExploreModal
              ? "bg-blue-50 dark:bg-indigo-500/15 text-blue-600 dark:text-indigo-400"
              : "text-gray-400 dark:text-zinc-500 hover:bg-gray-100 dark:hover:bg-zinc-800 hover:text-gray-700 dark:hover:text-zinc-300")}
        >
          <MapPin size={20} />
        </button>

        {/* Amis */}
        <button
          onClick={() => { fetchFollowing(); setShowProfileModal(false); setShowAddModal(false); setShowExploreModal(false); setShowFriendsModal(true); setIncomingCount(0); if (user) { try { localStorage.setItem(`friendspot_notif_seen_${user.id}`, new Date().toISOString()) } catch {} } }}
          title="Amis"
          className={cn("relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors",
            showFriendsModal
              ? "bg-blue-50 dark:bg-indigo-500/15 text-blue-600 dark:text-indigo-400"
              : "text-gray-400 dark:text-zinc-500 hover:bg-gray-100 dark:hover:bg-zinc-800 hover:text-gray-700 dark:hover:text-zinc-300")}
        >
          <Users size={20} />
          {incomingCount > 0 && (
            <div className="absolute top-1 right-1 flex h-[14px] w-[14px] items-center justify-center rounded-full bg-red-500 text-[8px] font-bold text-white border border-white dark:border-zinc-950">
              {incomingCount > 9 ? "9+" : incomingCount}
            </div>
          )}
        </button>

        {/* Ajouter */}
        <button
          onClick={() => { setShowProfileModal(false); setShowFriendsModal(false); setShowExploreModal(false); handleOpenAddSpot() }}
          title="Ajouter un spot"
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 dark:from-indigo-500 to-sky-500 dark:to-purple-600 text-white shadow-md transition-transform hover:scale-105 active:scale-95"
        >
          <Plus size={20} strokeWidth={2.5} />
        </button>

        {/* Explorer */}
        <button
          onClick={() => { setShowProfileModal(false); setShowFriendsModal(false); setShowAddModal(false); setShowExploreModal(true) }}
          title="Explorer"
          className={cn("flex h-10 w-10 items-center justify-center rounded-xl transition-colors",
            showExploreModal
              ? "bg-blue-50 dark:bg-indigo-500/15 text-blue-600 dark:text-indigo-400"
              : "text-gray-400 dark:text-zinc-500 hover:bg-gray-100 dark:hover:bg-zinc-800 hover:text-gray-700 dark:hover:text-zinc-300")}
        >
          <Search size={20} />
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Profil */}
        <button
          onClick={() => { setShowFriendsModal(false); setShowAddModal(false); setShowExploreModal(false); setShowProfileModal(true); markLikesSeen() }}
          title="Profil"
          className={cn("relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors",
            showProfileModal
              ? "bg-blue-50 dark:bg-indigo-500/15 text-blue-600 dark:text-indigo-400"
              : "text-gray-400 dark:text-zinc-500 hover:bg-gray-100 dark:hover:bg-zinc-800 hover:text-gray-700 dark:hover:text-zinc-300")}
        >
          {userProfile?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={userProfile.avatar_url} alt="" className="h-8 w-8 rounded-lg object-cover" />
          ) : (
            <User size={20} />
          )}
          {newLikesCount > 0 && (
            <div className="absolute top-1 right-1 flex h-[14px] w-[14px] items-center justify-center rounded-full bg-red-500 text-[8px] font-bold text-white border border-white dark:border-zinc-950">
              {newLikesCount > 9 ? "9+" : newLikesCount}
            </div>
          )}
        </button>
      </div>

      {editingSpot && (
        <EditSpotModal
          spot={editingSpot}
          onClose={() => setEditingSpot(null)}
          onUpdate={handleUpdateSpot}
          groups={groups}
          currentUserId={user?.id}
        />
      )}

      <ExploreModal
        isOpen={showExploreModal}
        onClose={() => setShowExploreModal(false)}
        spots={spots}
        allSpots={spots}
        spotsLoaded={spotsLoaded}
        onAddSpot={() => { setShowExploreModal(false); setShowAddModal(true) }}
        onOpenFriends={() => { setShowExploreModal(false); setShowFriendsModal(true) }}
        userLocation={userLocation}
        currentUserId={user?.id ?? null}
        followingIds={followingIds}
        surprisePin={surprisePin}
        likeCountsBySpotId={likeCountsBySpotId}
        onSelectUser={(id) => { setShowExploreModal(false); setPublicProfileUserId(id) }}
        onSelectSpot={(spot) => {
          setShowExploreModal(false)
          setSelectedSpot(spot)
          mapRef.current?.flyTo({
            center: [spot.lng, spot.lat],
            zoom: 15.5,
            offset: [0, 100],
            duration: 800,
          })
        }}
        onSurprise={(spot) => {
          setSurprisePin({ spot })
          setFilter("friends")
          setVisibleFriendIds(followingIds)
          setFriendFilterIds(new Set())
          setShowExploreModal(false)
          setSelectedSpot(spot)
          mapRef.current?.flyTo({ center: [spot.lng, spot.lat], zoom: 15.5, offset: [0, 100], duration: 900 })
        }}
      />

      <AddSpotModal
        isOpen={showAddModal}
        initialUrl={initialAddUrl}
        userLat={userLocation?.lat}
        userLng={userLocation?.lng}
        groups={groups}
        onClose={() => setShowAddModal(false)}
        onAdd={(spotData) => {
          const promise = handleAddSpot(spotData)
          toast.promise(promise, {
            loading: "Ajout du spot en cours...",
            success: "Spot ajouté avec succès ! 🎉",
            error: "Erreur lors de l'ajout du spot.",
          })
          return promise
        }}
      />
      <FriendsModal
        isOpen={showFriendsModal}
        onClose={() => setShowFriendsModal(false)}
        currentUser={user}
        followingIds={followingIds}
        onFollowingChange={(newIds) => {
          setFollowingIds(newIds)
          setVisibleFriendIds((prev) => [...new Set([...prev, ...newIds])])
        }}
        onRefreshFollowing={fetchFollowing}
        onGroupJoined={async (groupId) => {
          await loadGroups()
          setFilter("groups")
          setActiveGroupId(groupId)
          setShowFriendsModal(false)
        }}
        visibleFriendIds={visibleFriendIds}
        setVisibleFriendIds={setVisibleFriendIds}
        onLocateFriend={(lat, lng) => {
          setShowFriendsModal(false)
          mapRef.current?.flyTo({
            center: [lng, lat],
            zoom: 15,
            duration: 1400,
          })
        }}
        onSelectUser={setPublicProfileUserId}
        onSelectSpot={(spotId) => {
          const spot = spots.find(s => s.id === spotId)
          if (!spot) return
          setShowFriendsModal(false)
          setSelectedSpot(spot)
          mapRef.current?.flyTo({ center: [spot.lng, spot.lat], zoom: 15.5, offset: [0, 100], duration: 800 })
        }}
        spots={spots}
        userProfile={userProfile}
        groups={groups}
        onCreateGroup={async (name, emoji) => {
          if (!user) return
          const { data: group, error } = await supabaseRef.current
            .from("spot_groups")
            .insert({ creator_id: user.id, name: name.trim(), emoji })
            .select()
            .single()
          if (error) throw error
          await supabaseRef.current
            .from("spot_group_members")
            .insert({ group_id: group.id, user_id: user.id })
          setGroups(prev => [...prev, group as SpotGroup])
        }}
        proposeOutingSpot={proposeOutingSpot}
        onProposeConsumed={() => setProposeOutingSpot(null)}
        onOpenGroupSettings={(group) => setSelectedGroupForSettings(group as SpotGroup)}
        onLocateOuting={(lat, lng) => {
          setShowFriendsModal(false)
          mapRef.current?.flyTo({ center: [lng, lat], zoom: 15, duration: 1000 })
        }}
      />
      <ProfileModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        user={user}
        spotsCount={spots.filter((s) => s.user_id === user?.id).length}
        userSpots={spots
          .filter((s) => s.user_id === user?.id)
          .map((s) => ({
            id: s.id,
            title: s.title,
            category: s.category ?? undefined,
            address: s.address,
            lat: s.lat,
            lng: s.lng,
          }))}
        followingIds={followingIds}
        onProfileUpdate={(username, avatarUrl) => {
          const updated = { username: username || "moi", avatar_url: avatarUrl }
          setUserProfile((prev) => ({ ...prev, ...updated }))
          if (user) try { localStorage.setItem(`friendspot_profile_${user.id}`, JSON.stringify({ data: updated, ts: Date.now() })) } catch { /* ignore */ }
        }}
        onDeleteSpot={handleDeleteSpot}
        onUnfollow={(id) => {
          setFollowingIds((prev) => prev.filter((x) => x !== id))
          setVisibleFriendIds((prev) => prev.filter((x) => x !== id))
          setFriendLocations((prev) => prev.filter((x) => x.id !== id))
        }}
        onLocateSpot={(spotId, lat, lng) => {
          setShowProfileModal(false)
          setFilter("mine")
          const spot = spots.find((s) => s.id === spotId)
          if (spot) setSelectedSpot(spot)
          mapRef.current?.flyTo({ center: [lng, lat], zoom: 15, duration: 1200 })
        }}
        onSignOut={signOut}
        onSelectUser={(id) => { setShowProfileModal(false); setPublicProfileUserId(id) }}
        onSelectSpot={(spotId, lat, lng) => {
          setShowProfileModal(false)
          const spot = spots.find((s) => s.id === spotId)
          if (spot) setSelectedSpot(spot)
          mapRef.current?.flyTo({ center: [lng, lat], zoom: 15.5, duration: 1000 })
        }}
      />

      <PublicProfileModal
        isOpen={!!publicProfileUserId}
        onClose={() => setPublicProfileUserId(null)}
        userId={publicProfileUserId}
        onLocateSpot={(spotId, lat, lng) => {
          setPublicProfileUserId(null)
          setShowFriendsModal(false)
          setShowExploreModal(false)
          if (publicProfileUserId === user?.id) {
            setFilter("mine")
          } else {
            setFilter("friends")
            if (publicProfileUserId && !visibleFriendIds.includes(publicProfileUserId)) {
              setVisibleFriendIds((prev) => [...prev, publicProfileUserId])
            }
          }
          const spot = spots.find((s) => s.id === spotId)
          if (spot) setSelectedSpot(spot)
          mapRef.current?.flyTo({
            center: [lng, lat],
            zoom: 15,
            duration: 1200,
          })
        }}
      />

      {user && (
        <OnboardingModal
          isOpen={showOnboarding}
          user={user}
          onComplete={(username) => {
            setShowOnboarding(false)
            setUserProfile((prev) => ({
              ...prev,
              username,
              avatar_url: prev?.avatar_url || null,
            }))
          }}
        />
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

      {/* Bannière permission push notifications */}
      <AnimatePresence>
        {showPushBanner && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 w-[calc(100%-2rem)] max-w-sm"
          >
            <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 shadow-xl p-4">
              <p className="text-sm font-semibold text-gray-900 dark:text-white mb-0.5">
                🔔 Ne rate rien
              </p>
              <p className="text-xs text-gray-500 dark:text-zinc-400 mb-3">
                Active les notifications pour savoir quand tes amis ajoutent des spots.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handlePushAccept}
                  className="flex-1 rounded-xl bg-indigo-500 py-2 text-xs font-semibold text-white hover:bg-indigo-400 transition-colors"
                >
                  Activer
                </button>
                <button
                  onClick={handlePushDismiss}
                  className="rounded-xl px-3 py-2 text-xs text-gray-400 dark:text-zinc-500 hover:text-gray-600 transition-colors"
                >
                  Plus tard
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {selectedGroupForSettings && (
        <GroupSettingsModal
          group={selectedGroupForSettings}
          currentUserId={user?.id ?? ""}
          followingProfiles={friendProfiles}
          onClose={() => setSelectedGroupForSettings(null)}
          onGroupDeleted={(id) => {
            setGroups(prev => prev.filter(g => g.id !== id))
            if (activeGroupId === id) { setActiveGroupId(null); setFilter("friends") }
          }}
          onGroupUpdated={(updated) => setGroups(prev => prev.map(g => g.id === updated.id ? updated : g))}
          onSelectSpot={(spotId) => {
            const spot = spots.find(s => s.id === spotId)
            setSelectedGroupForSettings(null)
            if (spot) {
              setSelectedSpot(spot)
              mapRef.current?.flyTo({ center: [spot.lng, spot.lat], zoom: 15.5, offset: [0, 100], duration: 800 })
            }
          }}
        />
      )}
    </div>
  )
}
