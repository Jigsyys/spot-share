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
  Compass,
  X,
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  Pencil,
  CheckCircle2,
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
import type { Spot } from "@/lib/types"

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ""
const DARK_STYLE = "mapbox://styles/mapbox/dark-v11"
const LIGHT_STYLE = "mapbox://styles/mapbox/light-v11"

const CATEGORIES = [
  { key: "café", label: "Café", emoji: "☕" },
  { key: "restaurant", label: "Restaurant", emoji: "🍽️" },
  { key: "bar", label: "Bar", emoji: "🍸" },
  { key: "outdoor", label: "Outdoor", emoji: "🌿" },
  { key: "vue", label: "Vue", emoji: "🌅" },
  { key: "culture", label: "Culture", emoji: "🎭" },
  { key: "shopping", label: "Shopping", emoji: "🛍️" },
  { key: "other", label: "Autre", emoji: "📍" },
]

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
const CATEGORY_EMOJIS: Record<string, string> = {
  café: "☕",
  restaurant: "🍽️",
  bar: "🍸",
  outdoor: "🌿",
  vue: "🌅",
  culture: "🎭",
  shopping: "🛍️",
  other: "📍",
}

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

  const [activeCategory, setActiveCategory] = useState<string>("all")
  const [isCategoryMenuOpen, setIsCategoryMenuOpen] = useState(false)
  const [selectedSpot, setSelectedSpot] = useState<Spot | null>(null)
  const [editingSpot, setEditingSpot] = useState<Spot | null>(null)
  const [carouselIdx, setCarouselIdx] = useState(0)
  const carouselRef = useRef<HTMLDivElement>(null)
  const filterMenuRef = useRef<HTMLDivElement>(null)
  const touchStartX = useRef<number | null>(null)
  const [isLocating, setIsLocating] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showFriendsModal, setShowFriendsModal] = useState(false)
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [publicProfileUserId, setPublicProfileUserId] = useState<string | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [spots, setSpots] = useState<Spot[]>([])
  const [followingIds, setFollowingIds] = useState<string[]>([])
  const [visibleFriendIds, setVisibleFriendIds] = useState<string[]>([])
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

  const fetchSpots = useCallback(async () => {
    try {
      const { data, error } = await supabaseRef.current
        .from("spots")
        .select("*, profiles(id, username, avatar_url, created_at)")
        .order("created_at", { ascending: false })

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
          setSpots(
            fallbackData && fallbackData.length > 0
              ? (fallbackData as Spot[])
              : DEMO_SPOTS
          )
          return
        }
        throw error
      }
      setSpots(data && data.length > 0 ? (data as Spot[]) : DEMO_SPOTS)
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
      .subscribe()

    return () => {
      supabaseRef.current.removeChannel(channel)
    }
  }, [user, checkIncomingRequests])

  const visibleSpots = useMemo(() => {
    let filtered = spots.filter(
      (s) => s.user_id === user?.id || visibleFriendIds.includes(s.user_id)
    )
    if (activeCategory !== "all") {
      filtered = filtered.filter((s) => s.category === activeCategory)
    }
    return filtered
  }, [spots, user?.id, visibleFriendIds, activeCategory])

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

  // Reset carousel index when a new spot is selected
  useEffect(() => {
    setCarouselIdx(0)
    if (carouselRef.current) carouselRef.current.scrollLeft = 0
  }, [selectedSpot?.id])

  // Close filter menu on outside click
  useEffect(() => {
    if (!isCategoryMenuOpen) return
    function handleOutside(e: MouseEvent) {
      if (filterMenuRef.current && !filterMenuRef.current.contains(e.target as Node)) {
        setIsCategoryMenuOpen(false)
      }
    }
    document.addEventListener("mousedown", handleOutside)
    return () => document.removeEventListener("mousedown", handleOutside)
  }, [isCategoryMenuOpen])

  const handleOpenAddSpot = async () => {
    let pastedUrl = ""
    try {
      if (navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText()
        if (
          text &&
          (text.includes("instagram.com") || text.includes("instagr.am") || text.includes("tiktok.com"))
        ) {
          pastedUrl = text.trim()
          toast.success("✨ Lien récupéré automatiquement !")
        }
      }
    } catch {
      // Échec silencieux (permission refusée ou non supporté sans action)
    }
    setInitialAddUrl(pastedUrl)
    setShowAddModal(true)
  }

  const handleSurprise = useCallback(() => {
    if (visibleSpots.length === 0) {
      toast.error("Aucun spot à découvrir pour le moment !")
      return
    }
    const randomSpot =
      visibleSpots[Math.floor(Math.random() * visibleSpots.length)]
    setSelectedSpot(null)
    mapRef.current?.flyTo({
      center: [randomSpot.lng, randomSpot.lat],
      zoom: 15.5,
      duration: 2500,
      pitch: 50,
      bearing: Math.random() * 60 - 30,
    })
    // Afficher la fiche juste avant la fin du vol pour l'effet "découverte"
    setTimeout(() => setSelectedSpot(randomSpot), 2200)
  }, [visibleSpots])

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

  // Fetch visits when a spot is selected
  useEffect(() => {
    if (selectedSpot) {
      fetchVisits(selectedSpot.id)
    } else {
      setVisits([])
    }
  }, [selectedSpot?.id, fetchVisits])

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
            return (
              <MapMarker
                key={`spot-${spot.id}`}
                longitude={spot.lng}
                latitude={spot.lat}
                anchor="bottom"
                onClick={(e) => {
                  e.originalEvent.stopPropagation()
                  setSelectedSpot(spot)
                  // Déplacer la carte pour que la grosse popup ait de la place (offset visuel vers le bas pour le spot)
                  mapRef.current?.flyTo({
                    center: [spot.lng, spot.lat],
                    zoom: 15.5,
                    offset: [0, 100],
                    duration: 800,
                  })
                }}
              >
                <div
                  style={{
                    background: color,
                    boxShadow: `0 4px 16px ${color}55`,
                  }}
                  className="flex h-10 w-10 -rotate-45 cursor-pointer items-center justify-center rounded-[50%_50%_50%_0] border-2 border-white/80 transition-transform hover:scale-110"
                >
                  <div className="rotate-45 text-base leading-none">
                    {emoji}
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
      <div className="pointer-events-none absolute top-[env(safe-area-inset-top)] right-0 left-0 z-30 mt-4 flex items-start justify-between px-4">
        <div className="pointer-events-auto relative" ref={filterMenuRef}>
          <button
            onClick={() => setIsCategoryMenuOpen(!isCategoryMenuOpen)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gray-200 dark:border-white/10 bg-white/80 dark:bg-zinc-900/80 text-gray-700 dark:text-white shadow-lg backdrop-blur-md transition-colors hover:bg-gray-100 dark:hover:bg-zinc-800"
          >
            {activeCategory === "all" ? (
              <Filter size={18} />
            ) : (
              <span className="text-xl leading-none">
                {CATEGORIES.find((c) => c.key === activeCategory)?.emoji}
              </span>
            )}
          </button>

          <AnimatePresence>
            {isCategoryMenuOpen && (
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="absolute left-0 top-[calc(100%+0.5rem)] w-48 overflow-hidden rounded-2xl border border-gray-200 dark:border-white/10 bg-white/95 dark:bg-zinc-900/95 shadow-2xl backdrop-blur-xl"
              >
                <div className="no-scrollbar max-h-[60vh] overflow-y-auto py-1">
                  <button
                    onClick={() => {
                      setActiveCategory("all")
                      setIsCategoryMenuOpen(false)
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-gray-100 dark:hover:bg-white/5",
                      activeCategory === "all"
                        ? "bg-blue-600/10 dark:bg-indigo-500/10 text-blue-600 dark:text-indigo-400"
                        : "text-zinc-300"
                    )}
                  >
                    <span>🌎</span> Toutes
                  </button>
                  {CATEGORIES.map((cat) => (
                    <button
                      key={cat.key}
                      onClick={() => {
                        setActiveCategory(cat.key)
                        setIsCategoryMenuOpen(false)
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 border-t border-gray-100 dark:border-white/5 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-gray-100 dark:hover:bg-white/5",
                        activeCategory === cat.key
                          ? "bg-blue-600/10 dark:bg-indigo-500/10 text-blue-600 dark:text-indigo-400"
                          : "text-zinc-300"
                      )}
                    >
                      <span>{cat.emoji}</span> {cat.label}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
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

      {/* Empty State Onboarding */}
      <div className="absolute top-[calc(env(safe-area-inset-top)+1.5rem)] left-1/2 z-10 -translate-x-1/2">
        <AnimatePresence>
          {visibleSpots.length === 0 && !authLoading && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="w-full max-w-xs rounded-2xl border border-gray-200 dark:border-white/10 bg-white/90 dark:bg-zinc-900/90 px-4 py-3 text-center shadow-xl backdrop-blur-md"
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
          onClick={handleSurprise}
          className="group pointer-events-auto relative hidden overflow-hidden rounded-2xl border border-white/20 bg-gradient-to-br from-blue-700/90 dark:from-indigo-600/90 to-sky-600/90 dark:to-purple-600/90 p-3 text-white shadow-lg backdrop-blur-md transition-all hover:from-blue-600 dark:hover:from-indigo-500 hover:to-sky-500 dark:hover:to-purple-500 sm:flex"
          title="Surprends-moi !"
        >
          <div className="absolute inset-0 bg-white/20 opacity-0 blur-xl transition-opacity group-hover:opacity-100" />
          <Compass size={20} className="relative z-10" />
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
                  <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-gray-600 dark:text-zinc-300">
                    {cleanDescription(selectedSpot.description)}
                  </p>
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
              handleSurprise()
            }}
            className="flex w-16 flex-col items-center gap-1 p-2 text-gray-400 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300"
          >
            <Compass size={22} />
            <span className="text-[10px] font-medium">Surprise</span>
          </button>

          <button
            onClick={() => {
              setShowFriendsModal(false)
              setShowAddModal(false)
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
          setActiveCategory("all")
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
          // Ensure the friend's spots are visible
          if (publicProfileUserId && publicProfileUserId !== user?.id && !visibleFriendIds.includes(publicProfileUserId)) {
            setVisibleFriendIds((prev) => [...prev, publicProfileUserId])
          }
          setActiveCategory("all")
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
