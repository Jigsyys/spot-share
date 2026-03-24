import { createBrowserClient } from "@supabase/ssr"

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
      "https://knfprbelfybkmlojltpr.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      "SUPABASE_ANON_KEY_REMOVED"
  )
}
