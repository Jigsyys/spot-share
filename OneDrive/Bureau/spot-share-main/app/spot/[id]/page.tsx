import { createClient } from "@/lib/supabase/server"
import { notFound } from "next/navigation"
import { MapPin, Heart, ExternalLink } from "lucide-react"
import type { Metadata } from "next"

const CATEGORY_EMOJIS: Record<string, string> = {
  café: "☕", restaurant: "🍽️", bar: "🍸", outdoor: "🌿",
  vue: "🌅", culture: "🎭", shopping: "🛍️", other: "📍",
}

const CATEGORY_LABELS: Record<string, string> = {
  café: "Café", restaurant: "Restaurant", bar: "Bar", outdoor: "Nature",
  vue: "Vue", culture: "Culture", shopping: "Shopping", other: "Autre",
}

interface Props {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const supabase = await createClient()
  const { data: spot } = await supabase
    .from("spots")
    .select("title, description, address, image_url")
    .eq("id", id)
    .single()

  if (!spot) return { title: "Spot introuvable — FriendSpot" }

  const firstPhoto = spot.image_url?.split(",")[0]?.trim() || null
  return {
    title: `${spot.title} — FriendSpot`,
    description: spot.description || spot.address || "Découvrez ce spot sur FriendSpot",
    openGraph: {
      title: spot.title,
      description: spot.description || spot.address || "",
      images: firstPhoto ? [{ url: firstPhoto }] : [],
    },
  }
}

export default async function SpotPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  const { data: spot } = await supabase
    .from("spots")
    .select("*, profiles(username, avatar_url)")
    .eq("id", id)
    .single()

  if (!spot) notFound()

  const photos: string[] = spot.image_url
    ? spot.image_url.split(",").map((s: string) => s.trim()).filter(Boolean)
    : []

  const emoji = CATEGORY_EMOJIS[spot.category ?? "other"] ?? "📍"
  const categoryLabel = CATEGORY_LABELS[spot.category ?? "other"] ?? "Autre"
  const author = spot.profiles as { username: string | null; avatar_url: string | null } | null

  const { count: likesCount } = await supabase
    .from("spot_reactions")
    .select("*", { count: "exact", head: true })
    .eq("spot_id", id)
    .eq("type", "love")

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Hero photo */}
      <div className="relative h-72 w-full overflow-hidden bg-gray-200">
        {photos[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photos[0]} alt={spot.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-6xl">{emoji}</div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        {/* Logo */}
        <div className="absolute top-4 left-4 flex items-center gap-2">
          <div className="rounded-xl bg-white/20 px-3 py-1.5 text-sm font-bold text-white backdrop-blur-sm">
            📍 FriendSpot
          </div>
        </div>
        {/* Titre sur la photo */}
        <div className="absolute bottom-0 left-0 right-0 p-5">
          <span className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm">
            {emoji} {categoryLabel}
          </span>
          <h1 className="text-2xl font-extrabold leading-tight text-white">{spot.title}</h1>
        </div>
      </div>

      {/* Contenu */}
      <div className="mx-auto max-w-lg px-5 py-6 space-y-5">

        {/* Adresse */}
        {spot.address && (
          <div className="flex items-start gap-2 text-gray-600">
            <MapPin size={16} className="mt-0.5 flex-shrink-0 text-blue-600" />
            <span className="text-sm">{spot.address}</span>
          </div>
        )}

        {/* Stats */}
        <div className="flex items-center gap-4">
          {(likesCount ?? 0) > 0 && (
            <div className="flex items-center gap-1.5 text-sm font-semibold text-red-500">
              <Heart size={15} className="fill-current" />
              {likesCount} like{(likesCount ?? 0) > 1 ? "s" : ""}
            </div>
          )}
          {author?.username && (
            <div className="flex items-center gap-1.5 text-sm text-gray-500">
              <div className="flex h-5 w-5 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-[9px] font-bold text-white">
                {author.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={author.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  author.username[0]?.toUpperCase()
                )}
              </div>
              @{author.username}
            </div>
          )}
        </div>

        {/* Description */}
        {spot.description && (
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <p className="text-[15px] leading-relaxed text-gray-700 whitespace-pre-wrap">
              {spot.description}
            </p>
          </div>
        )}

        {/* Photos supplémentaires */}
        {photos.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {photos.slice(1).map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={url}
                alt=""
                className="h-24 w-24 flex-shrink-0 rounded-2xl object-cover"
              />
            ))}
          </div>
        )}

        {/* CTA */}
        <div className="space-y-3 pt-2">
          <a
            href="/"
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-4 text-base font-bold text-white shadow-lg shadow-blue-600/30 transition hover:bg-blue-500"
          >
            📍 Ouvrir dans FriendSpot
          </a>
          {spot.maps_url && (
            <a
              href={spot.maps_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white px-6 py-3.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
            >
              <ExternalLink size={15} /> Voir sur Google Maps
            </a>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 pt-2">
          Partagez vos spots préférés avec vos amis sur FriendSpot
        </p>
      </div>
    </div>
  )
}
