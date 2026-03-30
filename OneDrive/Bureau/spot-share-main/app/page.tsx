"use client"

import dynamic from "next/dynamic"

const MapView = dynamic(() => import("@/components/map/MapView"), {
  ssr: false,
})

export default function Home() {
  return <MapView />
}
