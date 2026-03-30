/** @type {import('next').NextConfig} */
const nextConfig = {
  // Strip console.log/warn in production builds (keeps console.error)
  compiler: {
    removeConsole: process.env.NODE_ENV === "production"
      ? { exclude: ["error"] }
      : false,
  },

  images: {
    // Serve modern formats (avif > webp > original) — browser picks best
    formats: ["image/avif", "image/webp"],
    // Cache optimized images for 30 days
    minimumCacheTTL: 2592000,
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "maps.googleapis.com" },
      // Supabase Storage — avatar_url, spot images
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
}

export default nextConfig
