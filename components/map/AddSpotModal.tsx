"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  X,
  Search,
  Instagram,
  MapPin,
  Plus,
  LoaderCircle,
  Link2,
  PenLine,
  Sparkles,
  UploadCloud,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import type { GeocodingResult } from "@/lib/types"
import { toast } from "sonner"

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ""

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

interface AddSpotModalProps {
  isOpen: boolean
  onClose: () => void
  onAdd: (spot: {
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
  }) => Promise<void>
  initialUrl?: string
  userLat?: number
  userLng?: number
}

type Tab = "instagram" | "manual"

export default function AddSpotModal({
  isOpen,
  onClose,
  onAdd,
  initialUrl,
  userLat,
  userLng,
}: AddSpotModalProps) {
  const [tab, setTab] = useState<Tab>("instagram")
  const [instagramUrl, setInstagramUrl] = useState("")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [category, setCategory] = useState("café")
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [openingHours, setOpeningHours] = useState<Record<
    string,
    string
  > | null>(null)
  const [placeQuery, setPlaceQuery] = useState("")
  const [placeResults, setPlaceResults] = useState<GeocodingResult[]>([])
  const [selectedPlace, setSelectedPlace] = useState<GeocodingResult | null>(
    null
  )
  const [searchLoading, setSearchLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mapsUrl, setMapsUrl] = useState<string | null>(null)
  const [weekdayDescriptions, setWeekdayDescriptions] = useState<string[] | null>(null)
  const [autoFillLoading, setAutoFillLoading] = useState(false)
  const [autoFillDone, setAutoFillDone] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const igDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const supabaseRef = useRef(createClient())

  // Image Upload handler for manual tab
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    setUploadingImage(true)
    try {
      const {
        data: { session },
      } = await supabaseRef.current.auth.getSession()
      const userId = session?.user?.id || "anonymous"
      const newUrls: string[] = []

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const fileExt = file.name.split(".").pop() || "jpg"
        const filePath = `spots/${userId}-${Date.now()}-${i}.${fileExt}`
        const { error } = await supabaseRef.current.storage
          .from("avatars")
          .upload(filePath, file)
        if (error) throw error
        const { data } = supabaseRef.current.storage
          .from("avatars")
          .getPublicUrl(filePath)
        newUrls.push(data.publicUrl)
      }

      setImageUrl((prev) =>
        prev ? `${prev},${newUrls.join(",")}` : newUrls.join(",")
      )
      toast.success(`${files.length} photo(s) ajoutée(s) !`)
    } catch {
      toast.error("Erreur lors de l'upload de l'image")
    } finally {
      setUploadingImage(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }



  // Instagram auto-fill
  useEffect(() => {
    if (tab !== "instagram") return
    const url = instagramUrl.trim()
    if (!url || (!url.includes("instagram.com") && !url.includes("tiktok.com"))) {
      setAutoFillDone(false)
      return
    }
    if (autoFillDone) return

    if (igDebounceRef.current) clearTimeout(igDebounceRef.current)
    igDebounceRef.current = setTimeout(async () => {
      setAutoFillLoading(true)
      try {
        const locParams = userLat != null && userLng != null ? `&lat=${userLat}&lng=${userLng}` : ""
        const res = await fetch(`/api/instagram?url=${encodeURIComponent(url)}${locParams}`)
        const data = await res.json()

        if (!res.ok || data.error) {
          toast.error(
            data.error ||
              "Impossible d'analyser le lien (compte privé ou invalide ?)"
          )
          setAutoFillDone(false)
          return
        }

        // Toujours écraser avec le nom commercial retourné par l'API (pas l'adresse)
        if (data.title) setTitle(data.title)
        if (data.description && !description) setDescription(data.description)
        if (data.category && CATEGORIES.some((c) => c.key === data.category))
          setCategory(data.category)
        // Priorité à photos[] (array), fallback sur image_url (compat)
        if (data.photos?.length) setImageUrl(data.photos.join(","))
        else if (data.image_url) setImageUrl(data.image_url)
        if (data.maps_url) setMapsUrl(data.maps_url)
        if (data.weekday_descriptions?.length) setWeekdayDescriptions(data.weekday_descriptions)
        if (data.opening_hours) setOpeningHours(data.opening_hours)

        if (data.coordinates?.lat && data.coordinates?.lng) {
          const placeName =
            data.location || data.title || "Emplacement extrait par l'IA"
          setPlaceQuery(placeName)
          setSelectedPlace({
            id: `ai-${Date.now()}`,
            place_name: placeName,
            center: [data.coordinates.lng, data.coordinates.lat],
          })
        } else if (data.location && !placeQuery) {
          // Si on a un nom mais pas les coord exactes, on cherche et on sélectionne le 1er résultat direct !
          setPlaceQuery(data.location)
          try {
            const mapboxRes = await fetch(
              `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(data.location)}.json?access_token=${MAPBOX_TOKEN}&limit=1&language=fr`
            )
            const mapboxData = await mapboxRes.json()
            if (mapboxData.features && mapboxData.features.length > 0) {
              const bestMatch = mapboxData.features[0]
              setSelectedPlace({
                id: bestMatch.id,
                place_name: bestMatch.place_name,
                center: bestMatch.center as [number, number],
              })
            } else {
              searchPlaces(data.location)
            }
          } catch {
            searchPlaces(data.location)
          }
        }
        setAutoFillDone(true)
        toast.success("Spot pré-rempli avec l'IA !")
      } catch {
        toast.error("Échec de la connexion à l'IA.")
        setAutoFillDone(false)
      } finally {
        setAutoFillLoading(false)
      }
    }, 900)

    return () => {
      if (igDebounceRef.current) clearTimeout(igDebounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instagramUrl, tab])

  // Reset autoFillDone when URL changes
  useEffect(() => {
    setAutoFillDone(false)
  }, [instagramUrl])

  const searchPlaces = useCallback(async (query: string) => {
    if (query.length < 3) {
      setPlaceResults([])
      return
    }
    setSearchLoading(true)
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&limit=5&language=fr`
      )
      const data = await res.json()
      setPlaceResults(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data.features?.map((f: any) => ({
          id: f.id,
          place_name: f.place_name,
          center: f.center as [number, number],
        })) ?? []
      )
    } catch {
      setPlaceResults([])
    } finally {
      setSearchLoading(false)
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => searchPlaces(placeQuery), 350)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [placeQuery, searchPlaces])

  useEffect(() => {
    if (!isOpen) {
      setTimeout(() => {
        setTab("instagram")
        setInstagramUrl("")
        setTitle("")
        setDescription("")
        setCategory("café")
        setImageUrl(null)
        setOpeningHours(null)
        setPlaceQuery("")
        setPlaceResults([])
        setSelectedPlace(null)
        setError(null)
        setAutoFillDone(false)
        setAutoFillLoading(false)
        setMapsUrl(null)
        setWeekdayDescriptions(null)
      }, 300)
    } else if (initialUrl && !instagramUrl) {
      setTab("instagram")
      setInstagramUrl(initialUrl)
    }
  }, [isOpen, initialUrl, instagramUrl])

  const handleSubmit = async () => {
    setError(null)
    if (!selectedPlace) {
      setError("Sélectionne un lieu !")
      return
    }
    const spotTitle = title.trim()
    if (!spotTitle) {
      setError("Ajoute un titre !")
      return
    }
    setSubmitting(true)
    try {
      await onAdd({
        title: spotTitle,
        description: description.trim() || null,
        lat: selectedPlace.center[1],
        lng: selectedPlace.center[0],
        category,
        instagram_url:
          tab === "instagram" && instagramUrl ? instagramUrl.trim() : null,
        image_url: imageUrl,
        address: selectedPlace.place_name,
        opening_hours: openingHours,
        weekday_descriptions: weekdayDescriptions,
        maps_url: mapsUrl,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de l'ajout")
    } finally {
      setSubmitting(false)
    }
  }

  const inputCls =
    "w-full px-4 py-2.5 rounded-xl border text-sm outline-none transition-all bg-zinc-800/60 border-white/10 text-white placeholder:text-zinc-500 focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20"

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
            className="fixed inset-x-0 bottom-0 z-50 sm:inset-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2"
          >
            <div className="flex max-h-[90vh] flex-col overflow-hidden rounded-t-[2.5rem] border border-white/10 bg-zinc-950 text-white shadow-2xl sm:rounded-3xl sm:bg-zinc-900">
              {/* Drag Handle Mobile */}
              <div className="mx-auto mt-4 mb-1 h-1.5 w-12 flex-shrink-0 rounded-full bg-zinc-700/50 sm:hidden" />

              {/* Header */}
              <div className="flex items-center justify-between p-5 pt-3 pb-3 sm:pt-5">
                <div>
                  <h2 className="text-lg font-bold">Ajouter un spot</h2>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    Partage un lieu avec tes amis
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="rounded-xl p-2 text-zinc-400 transition-colors hover:bg-white/10"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Tabs */}
              <div className="px-5 pb-3">
                <div className="flex rounded-xl bg-zinc-800/80 p-1">
                  {[
                    {
                      key: "instagram" as Tab,
                      label: "Lien Insta / TikTok",
                      icon: <Link2 size={14} />,
                    },
                    {
                      key: "manual" as Tab,
                      label: "Ajout manuel",
                      icon: <PenLine size={14} />,
                    },
                  ].map(({ key, label, icon }) => (
                    <button
                      key={key}
                      onClick={() => setTab(key)}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-all",
                        tab === key
                          ? "bg-indigo-500 text-white shadow-sm"
                          : "text-zinc-400 hover:text-zinc-200"
                      )}
                    >
                      {icon} {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-[calc(5rem+env(safe-area-inset-bottom))]">
                {tab === "instagram" && (
                  <div className="flex flex-col gap-4">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                        Lien Instagram / TikTok
                      </label>
                      <div className="relative">
                        <Instagram
                          size={16}
                          className="absolute top-1/2 left-3 -translate-y-1/2 text-zinc-500"
                        />
                        <input
                          type="url"
                          placeholder="Lien Instagram ou TikTok..."
                          value={instagramUrl}
                          onChange={(e) => setInstagramUrl(e.target.value)}
                          className={cn(inputCls, "!pr-10 !pl-10")}
                        />
                        {autoFillLoading && (
                          <LoaderCircle
                            size={15}
                            className="absolute top-1/2 right-3 -translate-y-1/2 animate-spin text-indigo-400"
                          />
                        )}
                        {autoFillDone && !autoFillLoading && (
                          <Sparkles
                            size={15}
                            className="absolute top-1/2 right-3 -translate-y-1/2 text-emerald-400"
                          />
                        )}
                      </div>
                      {autoFillDone && (
                        <p className="mt-1.5 flex items-center gap-1 text-xs text-emerald-400">
                          <Sparkles size={11} /> Infos récupérées
                          automatiquement
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Zone Photos */}
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="block text-xs font-medium text-zinc-400">
                      Photos
                    </label>
                  </div>

                  {tab === "manual" && (
                    <div className="mb-3">
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleImageUpload}
                        accept="image/*"
                        multiple
                        className="hidden"
                      />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadingImage}
                        className="group relative flex w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-white/20 bg-zinc-800/50 p-3 transition-colors hover:border-indigo-500/50"
                      >
                        {uploadingImage ? (
                          <div className="flex flex-col items-center gap-1.5 py-1 text-indigo-400">
                            <LoaderCircle size={20} className="animate-spin" />
                            <span className="text-[11px] font-medium">
                              Upload en cours...
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 py-1">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500/20 text-indigo-400 transition-transform group-hover:scale-110">
                              <UploadCloud size={16} />
                            </div>
                            <div className="text-left">
                              <p className="text-[13px] font-semibold text-zinc-200">
                                Ajouter des photos
                              </p>
                              <p className="text-[10px] text-zinc-500">
                                Formats acceptés : JPG, PNG, WebP
                              </p>
                            </div>
                          </div>
                        )}
                      </button>
                    </div>
                  )}

                  {imageUrl && imageUrl.trim() !== "" ? (
                    <div
                      className="relative flex h-40 snap-x snap-mandatory overflow-hidden overflow-x-auto rounded-xl border border-white/10"
                      style={{ scrollbarWidth: "none" }}
                    >
                      {imageUrl
                        .split(",")
                        .filter((url) => url.trim() !== "")
                        .map((url, i, arr) => (
                          <div
                            key={i}
                            className="relative flex w-full flex-shrink-0 snap-center items-center justify-center bg-zinc-800"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={url.trim()}
                              alt="Preview"
                              className="h-full w-full object-cover"
                            />
                            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-zinc-900/80 via-transparent to-transparent" />
                            <span className="absolute bottom-2 left-3 text-xs font-semibold text-white/90 shadow-black/50 drop-shadow-md">
                              Image {i + 1}{" "}
                              {arr.length > 1
                                ? `/ ${arr.length}`
                                : tab === "instagram"
                                  ? " extraite"
                                  : " ajoutée"}
                            </span>
                          </div>
                        ))}
                    </div>
                  ) : (
                    tab === "instagram" && (
                      <div className="flex h-24 items-center justify-center rounded-xl border border-white/10 bg-zinc-800/30">
                        <p className="flex items-center gap-2 text-xs text-zinc-500">
                          <Instagram size={14} /> La photo apparaîtra ici
                        </p>
                      </div>
                    )
                  )}
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                    Titre{" "}
                    {tab === "instagram" && (
                      <span className="text-zinc-600">
                        (optionnel si auto-rempli)
                      </span>
                    )}
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: Le meilleur café de Paris"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                    Description{" "}
                    <span className="text-zinc-600">(optionnel)</span>
                  </label>
                  <textarea
                    placeholder="Décris ce lieu..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    className={cn(inputCls, "resize-none")}
                  />
                </div>

                <div>
                  <label className="mb-2 block text-xs font-medium text-zinc-400">
                    Catégorie
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {CATEGORIES.map((cat) => (
                      <button
                        key={cat.key}
                        onClick={() => setCategory(cat.key)}
                        className={cn(
                          "flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-all",
                          category === cat.key
                            ? "bg-indigo-500 text-white shadow-sm"
                            : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                        )}
                      >
                        <span>{cat.emoji}</span> {cat.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                    📍 Rechercher le lieu
                  </label>
                  <div className="relative">
                    <Search
                      size={16}
                      className="absolute top-1/2 left-3 -translate-y-1/2 text-zinc-500"
                    />
                    <input
                      type="text"
                      placeholder="Chercher une adresse..."
                      value={placeQuery}
                      onChange={(e) => {
                        setPlaceQuery(e.target.value)
                        setSelectedPlace(null)
                      }}
                      className={cn(inputCls, "!pl-10")}
                    />
                    {searchLoading && (
                      <LoaderCircle
                        size={16}
                        className="absolute top-1/2 right-3 -translate-y-1/2 animate-spin text-indigo-400"
                      />
                    )}
                  </div>
                  {placeResults.length > 0 && !selectedPlace && (
                    <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-zinc-800/90">
                      {placeResults.map((place) => (
                        <button
                          key={place.id}
                          onClick={() => {
                            setSelectedPlace(place)
                            setPlaceQuery(place.place_name)
                            setPlaceResults([])
                          }}
                          className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left text-sm text-zinc-200 transition-colors hover:bg-white/10"
                        >
                          <MapPin
                            size={14}
                            className="mt-0.5 flex-shrink-0 text-indigo-400"
                          />
                          <span className="line-clamp-1">
                            {place.place_name}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedPlace && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-2 flex items-center gap-2 rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-3 py-2"
                    >
                      <MapPin size={14} className="text-indigo-400" />
                      <span className="truncate text-xs text-indigo-300">
                        {selectedPlace.place_name}
                      </span>
                    </motion.div>
                  )}
                </div>

                {error && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-center text-sm text-red-400"
                  >
                    {error}
                  </motion.div>
                )}

                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:from-indigo-400 hover:to-purple-500 disabled:opacity-50"
                >
                  {submitting ? (
                    <LoaderCircle size={18} className="animate-spin" />
                  ) : (
                    <>
                      <Plus size={16} /> Ajouter ce spot
                    </>
                  )}
                </motion.button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
