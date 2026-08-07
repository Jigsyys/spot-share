import { type NextRequest } from "next/server"
import { updateSession } from "@/lib/supabase/middleware"

export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (images, etc.)
     * - /api/admin/* (admin endpoints protected by secret, not by session cookie)
     * - /spot/* (public sharing pages)
     */
    "/((?!_next/static|_next/image|favicon.ico|api/admin|spot/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
