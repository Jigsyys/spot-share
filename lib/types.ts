export interface Profile {
  id: string
  username: string | null
  avatar_url: string | null
  created_at: string
}

export interface Spot {
  id: string
  user_id: string
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
  created_at: string
  expires_at: string | null
  profiles?: Profile
}


export type FilterMode = "all" | "friends" | "mine"

export interface GeocodingResult {
  id: string
  place_name: string
  center: [number, number]
}
