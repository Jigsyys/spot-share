export interface Profile {
  id: string
  username: string | null
  avatar_url: string | null
  created_at: string
}

export interface SpotGroup {
  id: string
  creator_id: string
  name: string
  emoji: string
  created_at: string
}

export interface SpotGroupInvitation {
  id: string
  group_id: string
  invitee_id: string
  inviter_id: string
  status: 'pending' | 'accepted' | 'declined'
  created_at: string
  spot_groups?: SpotGroup & {
    profiles?: { username: string | null; avatar_url: string | null }
  }
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
  price_range: string | null
  created_at: string
  expires_at?: string | null
  visibility?: 'friends' | 'group' | 'private'
  group_id?: string | null
  profiles?: Profile
}

export type FilterMode = "all" | "friends" | "mine" | "groups"

export interface GeocodingResult {
  id: string
  place_name: string
  center: [number, number]
}
