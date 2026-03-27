"use client"

import { useEffect, useRef, useState, useCallback, useMemo } from "react"
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
  Bookmark,
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import useSupercluster from "use-supercluster"
import { cn, getOpeningStatus, getGoogleOpeningStatus } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/useAuth"
import { useTheme } from "next-themes"
import UserMenu from "./UserMenu"
import AddSpotModal from "./AddSpotModal"
import EditSpotModal from "./EditSpotModal"
import FriendsModal from "./FriendsModal"
import PublicProfileModal from "./PublicProfileModal"
import ProfileModal from "./ProfileModal"
import OnboardingModal from "./OnboardingModal"
import ExploreModal from "./ExploreModal"
import type { Spot, FilterMode } from "@/lib/types"
import { CATEGORY_EMOJIS as CAT_EMOJIS } from "@/lib/categories"

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ""
const DARK_STYLE = "mapbox://styles/mapbox/dark-v11"
const LIGHT_STYLE = "mapbox://styles/mapbox/outdoors-v12"

// Couches à masquer complètement (géométrie autoroutes + POIs)
const LIGHT_HIDDEN_LAYERS = ["motorway", "trunk", "poi", "landmark", "monument", "tourism", "transit-label", "airport-label"]
// Classes de route à exclure des labels (numéros A1, A4…)
const LIGHT_HIDDEN_ROAD_CLASSES = ["motorway", "motorway_link", "trunk", "trunk_link"]

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

  const [filter, setFilter] = useState<FilterMode>("mine")
  const [filterFriendId, setFilterFriendId] = useState<string | null>(null)
  const [selectedSpot, setSelectedSpot] = useState<Spot | null>(null)
  const [editingSpot, setEditingSpot] = useState<Spot | null>(null)
  const [carouselIdx, setCarouselIdx] = useState(0)
  const [descExpanded, setDescExpanded] = useState(false)
  const carouselRef = useRef<HTMLDivElement>(null)
  const touchStartX = useRef<number | null>(null)
  const [isLocating, setIsLocating] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showFriendsModal, setShowFriendsModal] = useState(false)
  const [showExploreModal, setShowExploreModal] = useState(false)
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [publicProfileUserId, setPublicProfileUserId] = useState<string | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [spots, setSpots] = useState<Spot[]>([])
  const [followingIds, setFollowingIds] = useState<string[]>([])
  const [visibleFriendIds, setVisibleFriendIds] = useState<string[]>([])
  const visibleFriendIdsRef = useRef<string[]>([])
  const [incomingCount, setIncomingCount] = useState(0)
  const [mapError, setMapError] = useState<string | null>(null)
  const [userLocation, setUserLocation] = useState<{
    lat: number
    lng: number
  } | null>(null)
  const [userProfile, setUserProfile] = useState<{
    username: string
    avatar_url: string | null
    is_ghost_mode?: boolean
  } | null>(null)
  const [initialAddUrl, setInitialAddUrl] = useState<string>("")
  const [visits, setVisits] = useState<{ user_id: string; username: string | null; avatar_url: string | null }[]>([])
  const [reactions, setReactions] = useState<{ user_id: string; type: "love" | "save"; username: string | null; avatar_url: string | null }[]>([])
  const [savedSpotIds, setSavedSpotIds] = useState<Set<string>>(new Set())
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

  const themeRef = useRef(resolvedTheme)
  useEffect(() => { themeRef.current = resolvedTheme }, [resolvedTheme])

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

  const fetchSpots = useCallback(async () => {
    const PAGE_SIZE = 100
    try {
      // Première tranche — s'affiche immédiatement
      const { data, error } = await supabaseRef.current
        .from("spots")
        .select("*, profiles(id, username, avatar_url, created_at)")
        .order("created_at", { ascending: false })
        .range(0, PAGE_SIZE - 1)

      if (error) {
        // Fallback progressif si la colonne avatar_url n'existe pas encore dans la DB
        if (
          error.message?.includes("avatar_url") ||
          error.code === "PGRST204"
        ) {
          const { data: fallbackData } = await supabaseRef.current
            .from("spots")
            .select("*, profiles(id, username, created_at)")
            .order("created_at", { ascending: false })
            .range(0, PAGE_SIZE - 1)
          setSpots(
            fallbackData && fallbackData.length > 0
              ? (fallbackData as Spot[])
              : DEMO_SPOTS
          )
          return
        }
        throw error
      }

      const firstPage = data && data.length > 0 ? (data as Spot[]) : DEMO_SPOTS
      setSpots(firstPage)

      // Charger les pages suivantes en arrière-plan si la première tranche était pleine
      if (data && data.length === PAGE_SIZE) {
        let offset = PAGE_SIZE
        let hasMore = true
        while (hasMore) {
          const { data: more } = await supabaseRef.current
            .from("spots")
            .select("*, profiles(id, username, avatar_url, created_at)")
            .order("created_at", { ascending: false })
            .range(offset, offset + PAGE_SIZE - 1)
          if (!more || more.length === 0) { hasMore = false; break }
          setSpots(prev => {
            const existingIds = new Set(prev.map(s => s.id))
            const fresh = (more as Spot[]).filter(s => !existingIds.has(s.id))
            return fresh.length > 0 ? [...prev, ...fresh] : prev
          })
          offset += PAGE_SIZE
          if (more.length < PAGE_SIZE) hasMore = false
        }
      }
    } catch (_e) {
      console.error("fetchSpots error:", _e)
      setSpots(DEMO_SPOTS)
    }

    // Pré-récupérer le profil de l'utilisateur pour la photo de profil sur la map
    if (user) {
      try {
        const { data, error } = await supabaseRef.current
          .from("profiles")
          .select("username, avatar_url, is_ghost_mode")
          .eq("id", user.id)
          .single()
        if (error) {
          if (error.code === "PGRST116") {
            // Profil non trouvé = nouveau compte
            setShowOnboarding(true)
          } else {
            throw error
          }
        } else if (data) {
          setUserProfile(data)
          if (!data.username) {
            setShowOnboarding(true)
          }
        }
      } catch (err: unknown) {
        const e = err as { message?: string; code?: string }
        if (e.message?.includes("avatar_url") || e.code === "PGRST204") {
          const { data } = await supabaseRef.current
            .from("profiles")
            .select("username")
            .eq("id", user.id)
            .single()
          if (data) {
            setUserProfile({ username: data.username, avatar_url: null })
            if (!data.username) setShowOnboarding(true)
          }
        }
      }
    }
  }, [user])

  const fetchFollowing = useCallback(async () => {
    if (!user) return
    try {
      const { data } = await supabaseRef.current
        .from("followers")
        .select("following_id")
        .eq("follower_id", user.id)
      if (data) {
        const ids = data.map((f: { following_id: string }) => f.following_id)
        setFollowingIds(ids)
        setVisibleFriendIds((prev) => [...new Set([...prev, ...ids])])
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

  const checkIncomingRequests = useCallback(async () => {
    if (!user) return
    try {
      const { count } = await supabaseRef.current
        .from("friend_requests")
        .select("*", { count: "exact", head: true })
        .eq("to_id", user.id)
        .eq("status", "pending")
      setIncomingCount(count || 0)
    } catch {
      /* ignore */
    }
  }, [user])

  // Garde le ref à jour pour les closures realtime
  useEffect(() => { visibleFriendIdsRef.current = visibleFriendIds }, [visibleFriendIds])

  useEffect(() => {
    fetchSpots()
    fetchFollowing()
  }, [fetchSpots, fetchFollowing])

  useEffect(() => {
    fetchFriendLocations()
  }, [fetchFriendLocations])

  useEffect(() => {
    if (!user) return
    checkIncomingRequests()

    const channel = supabaseRef.current
      .channel("global_incoming_req")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "friend_requests",
          filter: `to_id=eq.${user.id}`,
        },
        () => {
          checkIncomingRequests()
          toast("🔔 Nouvelle demande !", {
            description: "Quelqu'un veut s'abonner à toi.",
            action: {
              label: "Voir",
              onClick: () => setShowFriendsModal(true),
            },
          })
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "friend_requests",
          filter: `to_id=eq.${user.id}`,
        },
        () => checkIncomingRequests()
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "friend_requests",
          filter: `to_id=eq.${user.id}`,
        },
        () => checkIncomingRequests()
      )
      // Quand une relation follower est créée pour moi → ami accepté, on rafraîchit
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "followers",
          filter: `follower_id=eq.${user.id}`,
        },
        async (payload) => {
          const newId = (payload.new as { following_id: string }).following_id
          setFollowingIds((prev) =>
            prev.includes(newId) ? prev : [...prev, newId]
          )
          setVisibleFriendIds((prev) =>
            prev.includes(newId) ? prev : [...prev, newId]
          )
          toast("✅ Ami accepté !", {
            description: "Ses spots apparaissent maintenant sur ta carte.",
          })
        }
      )
      .subscribe()

    return () => {
      supabaseRef.current.removeChannel(channel)
    }
  }, [user, checkIncomingRequests])

  // ── Realtime : nouveaux spots d'amis visibles instantanément ────────────
  useEffect(() => {
    if (!user) return
    const channel = supabaseRef.current
      .channel("realtime-spots-global")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "spots" },
        async (payload) => {
          const raw = payload.new as Spot
          // Nos propres spots sont déjà ajoutés en optimiste — on ignore
          if (raw.user_id === user.id) return
          // On n'ajoute que les spots de nos amis visibles
          if (!visibleFriendIdsRef.current.includes(raw.user_id)) return
          // Récupère le spot complet avec le profil
          const { data } = await supabaseRef.current
            .from("spots")
            .select("*, profiles(id, username, avatar_url, created_at)")
            .eq("id", raw.id)
            .single()
          if (data) {
            setSpots((prev) =>
              prev.some((s) => s.id === data.id) ? prev : [data, ...prev]
            )
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "spots" },
        (payload) => {
          const updated = payload.new as Spot
          setSpots((prev) =>
            prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s))
          )
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

  const friendProfiles = useMemo(() => {
    const seen = new Set<string>()
    const result: { id: string; username: string | null; avatar_url: string | null }[] = []
    for (const s of spots) {
      if (s.user_id !== user?.id && visibleFriendIds.includes(s.user_id) && !seen.has(s.user_id)) {
        seen.add(s.user_id)
        result.push({ id: s.user_id, username: s.profiles?.username ?? null, avatar_url: s.profiles?.avatar_url ?? null })
      }
    }
    return result
  }, [spots, user?.id, visibleFriendIds])

  const visibleSpots = useMemo(() => {
    if (filter === "mine") return spots.filter((s) => s.user_id === user?.id)
    const base = spots.filter((s) => s.user_id === user?.id || visibleFriendIds.includes(s.user_id))
    if (filterFriendId) return base.filter((s) => s.user_id === filterFriendId)
    return base
  }, [spots, filter, user?.id, visibleFriendIds, filterFriendId])

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
      () => setIsLocating(false),
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

  // Interception du Web Share Target (PWA)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search)
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
    if (carouselRef.current) carouselRef.current.scrollLeft = 0
  }, [selectedSpot?.id])


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
  }) => {
    if (!user) throw new Error("Tu dois être connecté !")

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
      ...spotData,
      created_at: new Date().toISOString(),
      profiles: profileSnap,
    }

    setSpots((prev) => [optimisticSpot, ...prev])

    try {
      // Tenter insert avec tous les champs, dont maps_url
      const { data: inserted, error } = await supabaseRef.current
        .from("spots")
        .insert({ user_id: user.id, ...spotData })
        .select()
        .single()

      if (error) {
        // Colonne inconnue (42703) → retry sans les champs optionnels non migrés
        if (error.code === "42703" || error.code === "PGRST204") {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { maps_url, weekday_descriptions, image_url, ...core } = spotData
          const { data: fallback, error: fallbackError } = await supabaseRef.current
            .from("spots")
            .insert({ user_id: user.id, ...core, image_url })
            .select()
            .single()
          if (fallbackError) throw new Error(fallbackError.message)
          if (fallback) {
            const realSpot: Spot = {
              ...fallback,
              maps_url: spotData.maps_url,
              weekday_descriptions: spotData.weekday_descriptions,
              profiles: profileSnap,
            }
            setSpots((prev) => [realSpot, ...prev.filter((s) => s.id !== tempId)])
            setSelectedSpot(realSpot)
            mapRef.current?.flyTo({ center: [spotData.lng, spotData.lat], zoom: 15, duration: 1200 })
          } else {
            await fetchSpots()
          }
          return
        }
        throw new Error(error.message || "Erreur Supabase RLS")
      }

      // Succès : remplacer le spot optimiste par le vrai et l'ouvrir
      const realSpot: Spot = {
        ...inserted,
        maps_url: spotData.maps_url,
        weekday_descriptions: spotData.weekday_descriptions,
        profiles: profileSnap,
      }
      setSpots((prev) => [realSpot, ...prev.filter((s) => s.id !== tempId)])
      setSelectedSpot(realSpot)
      mapRef.current?.flyTo({ center: [spotData.lng, spotData.lat], zoom: 15, duration: 1200 })
    } catch (e: unknown) {
      const err = e as { message?: string }
      console.error("Insert error:", err)
      setSpots((prev) => prev.filter((s) => s.id !== tempId))
      toast.error("Erreur serveur : ton lieu n'a pas pu être sauvegardé.")
      throw err
    }
  }

  const handleDeleteSpot = async (spotId: string) => {
    if (!user) return
    try {
      const { error } = await supabaseRef.current
        .from("spots")
        .delete()
        .eq("id", spotId)
        .eq("user_id", user.id)
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
    try {
      const { data } = await supabaseRef.current
        .from("spot_visits")
        .select("user_id, profiles(username, avatar_url)")
        .eq("spot_id", spotId)
      if (data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setVisits(data.map((v: any) => {
          const p = Array.isArray(v.profiles) ? v.profiles[0] : v.profiles
          return {
            user_id: v.user_id as string,
            username: (p?.username ?? null) as string | null,
            avatar_url: (p?.avatar_url ?? null) as string | null,
          }
        }))
      }
    } catch {
      setVisits([])
    }
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
        await supabaseRef.current
          .from("spot_visits")
          .upsert({ spot_id: selectedSpot.id, user_id: user.id })
      }
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
    try {
      const { data } = await supabaseRef.current
        .from("spot_reactions")
        .select("user_id, type, profiles(username, avatar_url)")
        .eq("spot_id", spotId)
      if (data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setReactions(data.map((r: any) => {
          const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles
          return { user_id: r.user_id, type: r.type as "love" | "save", username: p?.username ?? null, avatar_url: p?.avatar_url ?? null }
        }))
      }
    } catch { setReactions([]) }
  }, [])

  const fetchSavedSpots = useCallback(async () => {
    if (!user) return
    try {
      const { data } = await supabaseRef.current
        .from("spot_reactions")
        .select("spot_id")
        .eq("user_id", user.id)
        .eq("type", "save")
      if (data) setSavedSpotIds(new Set(data.map((r: { spot_id: string }) => r.spot_id)))
    } catch { /* table might not exist yet */ }
  }, [user])

  const handleToggleReaction = useCallback(async (type: "love" | "save") => {
    if (!user || !selectedSpot) return
    const hasReaction = reactions.some(r => r.user_id === user.id && r.type === type)
    const myReaction = { user_id: user.id, type, username: userProfile?.username ?? null, avatar_url: userProfile?.avatar_url ?? null }
    // Optimistic update
    if (hasReaction) {
      setReactions(prev => prev.filter(r => !(r.user_id === user.id && r.type === type)))
      if (type === "save") setSavedSpotIds(prev => { const n = new Set(prev); n.delete(selectedSpot.id); return n })
    } else {
      setReactions(prev => [...prev, myReaction])
      if (type === "save") setSavedSpotIds(prev => new Set([...prev, selectedSpot.id]))
    }
    try {
      if (hasReaction) {
        await supabaseRef.current.from("spot_reactions").delete()
          .eq("spot_id", selectedSpot.id).eq("user_id", user.id).eq("type", type)
      } else {
        await supabaseRef.current.from("spot_reactions")
          .upsert({ spot_id: selectedSpot.id, user_id: user.id, type })
      }
    } catch {
      // Rollback
      if (hasReaction) {
        setReactions(prev => [...prev, myReaction])
        if (type === "save") setSavedSpotIds(prev => new Set([...prev, selectedSpot.id]))
      } else {
        setReactions(prev => prev.filter(r => !(r.user_id === user.id && r.type === type)))
        if (type === "save") setSavedSpotIds(prev => { const n = new Set(prev); n.delete(selectedSpot.id); return n })
      }
      toast.error("Erreur lors de la mise à jour.")
    }
  }, [user, selectedSpot, reactions, userProfile])

  // Fetch visits + realtime subscription when a spot is selected
  useEffect(() => {
    if (!selectedSpot) {
      setVisits([])
      return
    }
    fetchVisits(selectedSpot.id)
    const channel = supabaseRef.current
      .channel(`spot-visits-${selectedSpot.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "spot_visits", filter: `spot_id=eq.${selectedSpot.id}` },
        () => fetchVisits(selectedSpot.id)
      )
      .subscribe()
    return () => { supabaseRef.current.removeChannel(channel) }
  }, [selectedSpot?.id, fetchVisits])

  // Fetch reactions + realtime when a spot is selected
  useEffect(() => {
    if (!selectedSpot) { setReactions([]); return }
    fetchReactions(selectedSpot.id)
    const channel = supabaseRef.current
      .channel(`spot-reactions-${selectedSpot.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "spot_reactions", filter: `spot_id=eq.${selectedSpot.id}` },
        () => fetchReactions(selectedSpot.id)
      )
      .subscribe()
    return () => { supabaseRef.current.removeChannel(channel) }
  }, [selectedSpot?.id, fetchReactions])

  // Load saved spots once on mount
  useEffect(() => { fetchSavedSpots() }, [fetchSavedSpots])

  const points = visibleSpots.map((spot) => ({
    type: "Feature" as const,
    properties: { cluster: false, spotId: spot.id, category: spot.category },
    geometry: { type: "Point" as const, coordinates: [spot.lng, spot.lat] },
  }))

  const { clusters, supercluster } = useSupercluster({
    points,
    bounds,
    zoom,
    options: { radius: 60, maxZoom: 16 },
  })

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
            if (mapRef.current) {
              const b = mapRef.current.getBounds()?.toArray().flat()
              if (b) setBounds(b as [number, number, number, number])
              setZoom(mapRef.current.getZoom())
            }
          }}
          style={{ width: "100%", height: "100%" }}
        >
          {clusters.map((cluster) => {
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
                        supercluster.getClusterExpansionZoom(
                          cluster.id as number
                        ),
                        20
                      )
                      mapRef.current?.flyTo({
                        center: [longitude, latitude],
                        zoom: expansionZoom,
                        speed: 1.2,
                      })
                    }}
                  >
                    {pointCount}
                  </div>
                </MapMarker>
              )
            }

            const spotId = cluster.properties.spotId
            const spot = visibleSpots.find((s) => s.id === spotId)
            if (!spot) return null

            const color =
              CATEGORY_COLORS[spot.category ?? "default"] ??
              CATEGORY_COLORS.default
            const emoji = CATEGORY_EMOJIS[spot.category ?? "other"] ?? "📍"
            const isMine = spot.user_id === user?.id
            const friendAvatar = !isMine ? (spot.profiles?.avatar_url ?? null) : null
            const friendInitial = !isMine ? (spot.profiles?.username ?? "?")[0].toUpperCase() : ""

            return (
              <MapMarker
                key={`spot-${spot.id}`}
                longitude={spot.lng}
                latitude={spot.lat}
                anchor="bottom"
                onClick={(e) => {
                  e.originalEvent.stopPropagation()
                  setSelectedSpot(spot)
                  mapRef.current?.flyTo({
                    center: [spot.lng, spot.lat],
                    zoom: 15.5,
                    offset: [0, 100],
                    duration: 800,
                  })
                }}
              >
                <div className="relative cursor-pointer transition-transform hover:scale-110">
                  {/* Mini avatar de l'ami */}
                  {!isMine && (
                    <div className="absolute -top-2.5 -right-2.5 z-10 flex h-5 w-5 items-center justify-center overflow-hidden rounded-full border-2 border-white dark:border-zinc-900 bg-gradient-to-br from-indigo-500 to-purple-600 text-[8px] font-bold text-white shadow-md">
                      {friendAvatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={friendAvatar} alt="" className="h-full w-full object-cover" />
                      ) : (
                        friendInitial
                      )}
                    </div>
                  )}
                  {/* Pin losange */}
                  <div
                    style={{
                      background: color,
                      boxShadow: `0 4px 16px ${color}55`,
                    }}
                    className={cn(
                      "-rotate-45 flex items-center justify-center rounded-[50%_50%_50%_0]",
                      isMine
                        ? "h-10 w-10 border-2 border-white/90 dark:border-white/70"
                        : "h-9 w-9 border-2 border-indigo-400 dark:border-indigo-300"
                    )}
                  >
                    <div className={cn("rotate-45 leading-none", isMine ? "text-base" : "text-sm")}>
                      {emoji}
                    </div>
                  </div>
                </div>
              </MapMarker>
            )
          })}

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
        <div className="pointer-events-auto hidden sm:block">
          <UserMenu
            user={user}
            userProfile={userProfile}
            incomingCount={incomingCount}
            onSignOut={signOut}
            onOpenProfile={() => setShowProfileModal(true)}
            onOpenFriends={() => {
              fetchFollowing()
              setShowFriendsModal(true)
            }}
          />
        </div>
      </div>

      <div className="absolute top-[calc(env(safe-area-inset-top)+1.5rem)] left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-3">
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-1 rounded-full border border-gray-200 dark:border-white/10 bg-white/80 dark:bg-zinc-900/80 p-1 shadow-lg backdrop-blur-md">
            {filterButtons.map(({ key, label, icon }) => (
              <motion.button
                key={key}
                onClick={() => { setFilter(key); if (key === "mine") setFilterFriendId(null) }}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold whitespace-nowrap transition-colors",
                  filter === key
                    ? "bg-blue-600 dark:bg-indigo-500 text-white shadow-[0_2px_10px_rgba(37,99,235,0.5)] dark:shadow-[0_2px_10px_rgba(99,102,241,0.5)]"
                    : "text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white"
                )}
                whileTap={{ scale: 0.95 }}
              >
                {icon} {label}
              </motion.button>
            ))}
          </div>

          {/* Chips amis — visibles uniquement en mode Amis */}
          {filter === "friends" && friendProfiles.length > 0 && (
            <div className="flex max-w-[90vw] gap-1.5 overflow-x-auto px-1 pb-0.5" style={{ scrollbarWidth: "none" }}>
              <button
                onClick={() => setFilterFriendId(null)}
                className={cn(
                  "flex shrink-0 items-center rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap shadow backdrop-blur-md transition-colors",
                  filterFriendId === null
                    ? "border-blue-600 dark:border-indigo-500 bg-blue-600 dark:bg-indigo-500 text-white"
                    : "border-gray-200 dark:border-white/10 bg-white/80 dark:bg-zinc-900/80 text-gray-600 dark:text-zinc-300"
                )}
              >
                Tous
              </button>
              {friendProfiles.map((fp) => (
                <button
                  key={fp.id}
                  onClick={() => setFilterFriendId(fp.id === filterFriendId ? null : fp.id)}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap shadow backdrop-blur-md transition-colors",
                    filterFriendId === fp.id
                      ? "border-blue-600 dark:border-indigo-500 bg-blue-600 dark:bg-indigo-500 text-white"
                      : "border-gray-200 dark:border-white/10 bg-white/80 dark:bg-zinc-900/80 text-gray-600 dark:text-zinc-300"
                  )}
                >
                  {fp.avatar_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={fp.avatar_url} alt="" className="h-5 w-5 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-[9px] font-bold text-white">
                      {(fp.username ?? "?")[0].toUpperCase()}
                    </div>
                  )}
                  @{fp.username ?? "ami"}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Empty State Onboarding */}
        <AnimatePresence>
          {visibleSpots.length === 0 && !authLoading && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="mt-4 w-full max-w-xs rounded-2xl border border-gray-200 dark:border-white/10 bg-white/90 dark:bg-zinc-900/90 px-4 py-3 text-center shadow-xl backdrop-blur-md"
            >
              <p className="mb-1 text-sm font-semibold text-gray-900 dark:text-white">
                C&apos;est un peu vide par ici...
              </p>
              <p className="text-xs text-gray-500 dark:text-zinc-400">
                Ajoute ton premier lieu favori ou recherche des amis !
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Floating Action Buttons (Desktop overrides & Locate) */}
      <div className="pointer-events-none absolute right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-10 flex flex-col items-end gap-3 sm:bottom-8">
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={() => setShowExploreModal(true)}
          className="pointer-events-auto hidden rounded-2xl border border-gray-200 dark:border-white/10 bg-white/90 dark:bg-zinc-900/90 p-3 text-gray-700 dark:text-white shadow-lg backdrop-blur-md transition-all hover:bg-gray-100 dark:hover:bg-zinc-800 sm:flex"
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
            "pointer-events-auto hidden items-center gap-2 rounded-2xl bg-blue-600 dark:bg-indigo-500 px-5 py-3.5 text-sm font-semibold text-white shadow-xl shadow-blue-600/30 dark:shadow-indigo-500/30 transition-all hover:bg-blue-500 dark:hover:bg-indigo-400 sm:flex",
            visibleSpots.length === 0 &&
              "animate-pulse ring-4 ring-blue-600/20 dark:ring-indigo-500/20"
          )}
        >
          <Plus size={18} /> Ajouter un spot
        </motion.button>
      </div>

      {/* Bouton 3D (En bas à gauche) */}
      <div className="pointer-events-none absolute bottom-[calc(5rem+env(safe-area-inset-bottom))] left-4 z-10 sm:bottom-8">
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
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_e, info) => {
              if (info.offset.y > 60 || info.velocity.y > 500) setSelectedSpot(null)
            }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            className="absolute right-2 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] left-2 z-20 flex max-h-[78vh] cursor-grab flex-col overflow-hidden rounded-[2.5rem] border border-gray-200 dark:border-white/10 bg-white/95 dark:bg-zinc-950/95 text-gray-900 dark:text-white shadow-[0_-10px_50px_rgba(0,0,0,0.2)] dark:shadow-[0_-10px_50px_rgba(0,0,0,0.5)] backdrop-blur-2xl active:cursor-grabbing sm:right-auto sm:bottom-6 sm:left-6 sm:max-h-[88vh] sm:w-[440px] sm:rounded-3xl sm:shadow-2xl"
          >
            {/* Drag Handle Mobile — au-dessus de la photo */}
            <div className="absolute top-3 left-1/2 z-30 -translate-x-1/2 sm:hidden">
              <div className="h-1.5 w-12 rounded-full bg-white/30" />
            </div>

            <button
              className="absolute top-4 right-4 z-30 flex h-8 w-8 items-center justify-center rounded-full bg-gray-200/80 dark:bg-black/60 text-gray-600 dark:text-zinc-300 backdrop-blur-md transition-colors hover:text-gray-900 dark:hover:text-white"
              onClick={() => setSelectedSpot(null)}
            >
              <X size={16} />
            </button>

            {/* Tout le contenu est scrollable, photo incluse */}
            <div className="flex-1 overflow-y-auto">

            {selectedSpot.image_url ? (() => {
              const photos = selectedSpot.image_url!.split(",").map(s => s.trim()).filter(Boolean)
              return (
                <div className="relative h-60 w-full overflow-hidden rounded-t-[2.5rem] sm:h-72 sm:rounded-t-3xl">
                  <div
                    ref={carouselRef}
                    className="relative h-full w-full"
                    onPointerDown={(e) => e.stopPropagation()}
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
              <h3 className="line-clamp-2 text-2xl leading-tight font-extrabold">
                {selectedSpot.title}
              </h3>
              {selectedSpot.address && (
                <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-zinc-400">
                  <MapPin size={14} className="text-blue-600 dark:text-indigo-400" />{" "}
                  {selectedSpot.address}
                </p>
              )}

              <OpeningHoursBlock
                weekdays={selectedSpot.weekday_descriptions}
                openingHours={selectedSpot.opening_hours}
              />

              {selectedSpot.description && cleanDescription(selectedSpot.description) && (
                <div className="mt-4 rounded-2xl border border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-zinc-900/60 p-4">
                  <p className={cn(
                    "text-[15px] leading-relaxed whitespace-pre-wrap text-gray-600 dark:text-zinc-300",
                    !descExpanded && "line-clamp-2"
                  )}>
                    {cleanDescription(selectedSpot.description)}
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
                    const mapsLink = selectedSpot.maps_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([selectedSpot.title, selectedSpot.address].filter(Boolean).join(" "))}`
                    const text = `📍 ${selectedSpot.title}${selectedSpot.address ? ` · ${selectedSpot.address}` : ""}`
                    if (navigator.share) {
                      try {
                        await navigator.share({ title: selectedSpot.title, text, url: mapsLink })
                      } catch {
                        /* user cancelled */
                      }
                    } else {
                      await navigator.clipboard.writeText(`${text}\n${mapsLink}`)
                      toast.success("Lien copié dans le presse-papier !")
                    }
                  }}
                  className="flex items-center justify-center gap-2 rounded-2xl bg-gray-100 dark:bg-white/10 px-5 py-3 text-sm font-bold text-gray-700 dark:text-white transition-colors hover:bg-gray-200 dark:hover:bg-white/20"
                >
                  <Share size={16} /> Partager
                </button>
                {selectedSpot.user_id === user?.id && (
                  <>
                    <button
                      onClick={() => {
                        if (window.confirm("Es-tu sûr de vouloir supprimer ce lieu ?")) {
                          toast.promise(handleDeleteSpot(selectedSpot.id), {
                            loading: "Suppression du spot...",
                            success: "Adieu petit spot ! Supprimé avec succès.",
                            error: "Erreur lors de la suppression.",
                          })
                        }
                      }}
                      className="flex items-center justify-center rounded-2xl bg-red-500/10 p-3 text-red-500 transition-colors hover:bg-red-500/20"
                      title="Supprimer ce spot"
                    >
                      <X size={18} />
                    </button>
                  </>
                )}
              </div>

              {/* ── Reactions : ❤️ J'adore (public) + 🔖 Enregistrer (privé) ── */}
              {user && (() => {
                const loveList   = reactions.filter(r => r.type === "love")
                const hasLoved   = loveList.some(r => r.user_id === user.id)
                const hasSaved   = reactions.some(r => r.user_id === user.id && r.type === "save")
                const friendSaves = hasSaved
                  ? reactions.filter(r => r.type === "save" && r.user_id !== user.id && followingIds.includes(r.user_id))
                  : []
                return (
                  <div className="mt-4 flex items-center gap-2">
                    {/* ❤️ Love button — public, shows friend avatars */}
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => handleToggleReaction("love")}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-2 rounded-2xl py-2.5 text-sm font-semibold transition-colors",
                        hasLoved
                          ? "bg-red-50 dark:bg-red-500/15 text-red-500 dark:text-red-400"
                          : "bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-zinc-400 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-500"
                      )}
                    >
                      <Heart size={16} className={hasLoved ? "fill-current" : ""} />
                      {loveList.length > 0 ? (
                        <div className="flex items-center gap-1">
                          <div className="flex -space-x-1.5">
                            {loveList.slice(0, 4).map(r => (
                              <button
                                key={r.user_id}
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => { e.stopPropagation(); if (r.user_id !== user.id) setPublicProfileUserId(r.user_id) }}
                                title={`@${r.username ?? "utilisateur"}`}
                                className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border-2 border-white dark:border-zinc-950 bg-gradient-to-br from-pink-400 to-red-500 text-[9px] font-bold text-white hover:scale-110 transition-transform"
                              >
                                {r.avatar_url
                                  /* eslint-disable-next-line @next/next/no-img-element */
                                  ? <img src={r.avatar_url} alt="" className="h-full w-full object-cover" />
                                  : (r.username ?? "?")[0].toUpperCase()}
                              </button>
                            ))}
                          </div>
                          {loveList.length > 4 && <span className="text-xs">+{loveList.length - 4}</span>}
                        </div>
                      ) : "J'adore"}
                    </button>

                    {/* 🔖 Save button — privé, match silencieux si un ami a aussi enregistré */}
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => handleToggleReaction("save")}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-2 rounded-2xl py-2.5 text-sm font-semibold transition-colors",
                        hasSaved
                          ? "bg-amber-50 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400"
                          : "bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-zinc-400 hover:bg-amber-50 dark:hover:bg-amber-500/10 hover:text-amber-600"
                      )}
                    >
                      <Bookmark size={16} className={hasSaved ? "fill-current" : ""} />
                      {hasSaved && friendSaves.length > 0 ? (
                        <div className="flex items-center gap-1">
                          <div className="flex -space-x-1.5">
                            {friendSaves.slice(0, 3).map(r => (
                              <div
                                key={r.user_id}
                                title={`@${r.username ?? ""} a aussi enregistré`}
                                className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border-2 border-white dark:border-zinc-950 bg-gradient-to-br from-indigo-400 to-purple-500 text-[9px] font-bold text-white"
                              >
                                {r.avatar_url
                                  /* eslint-disable-next-line @next/next/no-img-element */
                                  ? <img src={r.avatar_url} alt="" className="h-full w-full object-cover" />
                                  : (r.username ?? "?")[0].toUpperCase()}
                              </div>
                            ))}
                          </div>
                          <span className="text-xs">aussi</span>
                        </div>
                      ) : (hasSaved ? "Enregistré" : "Enregistrer")}
                    </button>
                  </div>
                )
              })()}

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

      {/* Mobile Bottom Navigation Bar */}
      <div
        className="fixed right-0 bottom-0 left-0 z-[60] border-t border-gray-200 dark:border-white/10 bg-white/90 dark:bg-zinc-950/90 backdrop-blur-xl sm:hidden"
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
            }}
            className={cn(
               "flex w-16 flex-col items-center gap-1 p-2 transition-colors",
               showProfileModal ? "text-blue-600 dark:text-indigo-400" : "text-gray-400 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300"
            )}
          >
            <User size={22} className={showProfileModal ? "drop-shadow-[0_0_8px_rgba(37,99,235,0.8)] dark:drop-shadow-[0_0_8px_rgba(99,102,241,0.8)]" : ""} />
            <span className="text-[10px] font-medium">Profil</span>
          </button>
        </div>
      </div>

      {editingSpot && (
        <EditSpotModal
          spot={editingSpot}
          onClose={() => setEditingSpot(null)}
          onUpdate={handleUpdateSpot}
        />
      )}

      <ExploreModal
        isOpen={showExploreModal}
        onClose={() => setShowExploreModal(false)}
        spots={visibleSpots}
        allSpots={spots}
        userLocation={userLocation}
        currentUserId={user?.id ?? null}
        savedSpotIds={savedSpotIds}
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
      />

      <AddSpotModal
        isOpen={showAddModal}
        initialUrl={initialAddUrl}
        userLat={userLocation?.lat}
        userLng={userLocation?.lng}
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
          setUserProfile((prev) => ({
            ...prev,
            username: username || "moi",
            avatar_url: avatarUrl,
          }))
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
      />

      <PublicProfileModal
        isOpen={!!publicProfileUserId}
        onClose={() => setPublicProfileUserId(null)}
        userId={publicProfileUserId}
        onLocateSpot={(spotId, lat, lng) => {
          setPublicProfileUserId(null)
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
    </div>
  )
}
