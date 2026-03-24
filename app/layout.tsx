import { Geist, Geist_Mono } from "next/font/google"

import "./globals.css"
import "mapbox-gl/dist/mapbox-gl.css"
import { ThemeProvider } from "@/components/theme-provider"
import { cn } from "@/lib/utils"
import { Toaster } from "sonner"
import type { Metadata, Viewport } from "next"

export const metadata: Metadata = {
  title: "FriendSpot",
  description: "Partagez vos meilleurs spots",
  manifest: "/manifest.json",
}

export const viewport: Viewport = {
  themeColor: "#09090b",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        geist.variable
      )}
    >
      <body suppressHydrationWarning>
        <ThemeProvider>
          {children}
          <Toaster theme="dark" position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  )
}
