import { NextResponse } from "next/server"

// Endpoint de debug désactivé en production.
export async function GET() {
  return NextResponse.json({ error: "Not found." }, { status: 404 })
}
