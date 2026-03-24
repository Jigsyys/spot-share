"use client"

export const dynamic = "force-dynamic"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import {
  MapPin,
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  LoaderCircle,
} from "lucide-react"
import { motion } from "framer-motion"
import Map from "react-map-gl/mapbox"
import "mapbox-gl/dist/mapbox-gl.css"

type AuthMode = "login" | "signup"

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ""
const DARK_STYLE = "mapbox://styles/mapbox/dark-v11"

export default function LoginPage() {
  const [mode, setMode] = useState<AuthMode>("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  const supabase = createClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setLoading(true)

    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })
        if (error) throw error
        // Redirect to home on success
        window.location.href = "/"
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        })
        if (error) throw error
        setSuccess("Vérifie ta boîte mail pour confirmer ton compte ! 📬")
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Une erreur est survenue"
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  const handleOAuth = async (provider: "google" | "github") => {
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) setError(error.message)
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-zinc-950">
      {/* Map Background */}
      <div className="pointer-events-none absolute inset-0 z-0 opacity-30 transition-opacity duration-1000">
        {mounted && (
          <Map
            mapboxAccessToken={MAPBOX_TOKEN}
            initialViewState={{
              longitude: 2.3522,
              latitude: 48.8566,
              zoom: 12,
              pitch: 45,
              bearing: -17.6,
            }}
            mapStyle={DARK_STYLE}
            interactive={false}
            attributionControl={false}
          />
        )}
      </div>

      {/* Animated background gradients */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden mix-blend-screen">
        <div className="absolute -top-1/2 -left-1/2 h-full w-full animate-pulse rounded-full bg-indigo-500/15 blur-[120px]" />
        <div className="absolute -right-1/2 -bottom-1/2 h-full w-full animate-pulse rounded-full bg-purple-500/10 blur-[120px] [animation-delay:1s]" />
        <div className="absolute top-1/4 right-1/4 h-1/2 w-1/2 animate-pulse rounded-full bg-blue-500/8 blur-[100px] [animation-delay:2s]" />
      </div>

      {/* Subtle grid overlay */}
      <div
        className="pointer-events-none absolute inset-0 z-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative z-10 mx-4 w-full max-w-md"
      >
        {/* Card */}
        <div className="rounded-3xl border border-white/10 bg-zinc-900/70 p-8 shadow-2xl shadow-black/40 backdrop-blur-xl">
          {/* Logo & Branding */}
          <div className="mb-8 text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{
                type: "spring",
                stiffness: 260,
                damping: 20,
                delay: 0.1,
              }}
              className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/25"
            >
              <MapPin size={28} className="text-white" />
            </motion.div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              SpotShare
            </h1>
            <p className="mt-1 text-sm text-zinc-400">
              {mode === "login"
                ? "Content de te revoir 👋"
                : "Rejoins la communauté 🌍"}
            </p>
          </div>

          {/* Error / Success messages */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-center text-sm text-red-400"
            >
              {error}
            </motion.div>
          )}
          {success && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-center text-sm text-emerald-400"
            >
              {success}
            </motion.div>
          )}

          {/* Auth form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div className="group relative">
              <Mail
                size={16}
                className="absolute top-1/2 left-3.5 -translate-y-1/2 text-zinc-500 transition-colors group-focus-within:text-indigo-400"
              />
              <input
                id="email-input"
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded-xl border border-white/10 bg-zinc-800/60 py-3 pr-4 pl-10 text-sm text-white transition-all outline-none placeholder:text-zinc-500 focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            {/* Password */}
            <div className="group relative">
              <Lock
                size={16}
                className="absolute top-1/2 left-3.5 -translate-y-1/2 text-zinc-500 transition-colors group-focus-within:text-indigo-400"
              />
              <input
                id="password-input"
                type={showPassword ? "text" : "password"}
                placeholder="Mot de passe"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full rounded-xl border border-white/10 bg-zinc-800/60 py-3 pr-12 pl-10 text-sm text-white transition-all outline-none placeholder:text-zinc-500 focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute top-1/2 right-3.5 -translate-y-1/2 text-zinc-500 transition-colors hover:text-zinc-300"
                aria-label="Toggle password visibility"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            {/* Submit button */}
            <motion.button
              whileTap={{ scale: 0.98 }}
              type="submit"
              disabled={loading}
              id="submit-button"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:from-indigo-400 hover:to-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <LoaderCircle size={18} className="animate-spin" />
              ) : (
                <>
                  {mode === "login" ? "Se connecter" : "Créer un compte"}
                  <ArrowRight size={16} />
                </>
              )}
            </motion.button>
          </form>

          {/* Divider */}
          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-white/10" />
            <span className="text-xs text-zinc-500">ou continuer avec</span>
            <div className="h-px flex-1 bg-white/10" />
          </div>

          {/* OAuth buttons */}
          <div className="flex flex-col gap-3">
            <button
              onClick={() => handleOAuth("google")}
              id="google-oauth-button"
              className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-zinc-800/60 py-2.5 text-sm font-medium text-zinc-300 transition-all hover:border-white/20 hover:bg-zinc-700/60"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Google
            </button>
          </div>

          {/* Toggle mode */}
          <div className="mt-6 text-center">
            <button
              onClick={() => {
                setMode(mode === "login" ? "signup" : "login")
                setError(null)
                setSuccess(null)
              }}
              id="toggle-mode-button"
              className="text-sm text-zinc-400 transition-colors hover:text-white"
            >
              {mode === "login" ? (
                <>
                  Pas encore de compte ?{" "}
                  <span className="font-medium text-indigo-400">
                    Inscris-toi
                  </span>
                </>
              ) : (
                <>
                  Déjà un compte ?{" "}
                  <span className="font-medium text-indigo-400">
                    Connecte-toi
                  </span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-zinc-600">
          En continuant, tu acceptes nos conditions d&apos;utilisation
        </p>
      </motion.div>
    </div>
  )
}
