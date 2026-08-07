// lib/supabase/service.ts
import { createClient } from "@supabase/supabase-js"

// Client service role — bypass RLS, utilisé uniquement côté serveur (webhooks)
// Note: env var has a typo in Vercel (ROLl vs ROLE) — read both names as fallback
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLl_KEY
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis")
  return createClient(url, key)
}
