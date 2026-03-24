"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Check, LoaderCircle, Sparkles } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import type { User as SupabaseUser } from "@supabase/supabase-js"
import { toast } from "sonner"

interface OnboardingModalProps {
  isOpen: boolean
  user: SupabaseUser
  onComplete: (username: string) => void
}

export default function OnboardingModal({ isOpen, user, onComplete }: OnboardingModalProps) {
  const [username, setUsername] = useState("")
  const [saving, setSaving] = useState(false)

  const handleSubmit = async () => {
    const trimmed = username.trim()
    if (!trimmed || trimmed.length < 2) {
      toast.error("Le nom doit faire au moins 2 caractères.")
      return
    }

    setSaving(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.from("profiles").upsert({
        id: user.id,
        username: trimmed,
      })
      if (error) throw error
      toast.success(`Bienvenue, ${trimmed} ! 🎉`)
      onComplete(trimmed)
    } catch {
      toast.error("Erreur lors de la sauvegarde.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-md"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 30 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="fixed inset-0 z-[61] flex items-center justify-center p-6"
          >
            <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-zinc-900 p-8 text-white shadow-2xl">
              <div className="mb-6 flex flex-col items-center gap-3 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/30">
                  <Sparkles size={28} className="text-white" />
                </div>
                <h2 className="text-xl font-bold">Bienvenue sur FriendSpot !</h2>
                <p className="text-sm text-zinc-400">
                  Choisis le nom que tu veux utiliser sur l&apos;app.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold tracking-wider text-zinc-500 uppercase">
                    Ton pseudo
                  </label>
                  <input
                    autoFocus
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSubmit() }}
                    placeholder="Ex : Maxence"
                    className="w-full rounded-xl border border-white/10 bg-zinc-800/80 px-4 py-3 text-[16px] text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-indigo-500/50 sm:text-sm"
                  />
                </div>

                <button
                  onClick={handleSubmit}
                  disabled={saving || username.trim().length < 2}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-500/25 transition-all hover:shadow-indigo-500/40 disabled:opacity-50"
                >
                  {saving ? (
                    <LoaderCircle size={16} className="animate-spin" />
                  ) : (
                    <>
                      <Check size={16} /> C&apos;est parti !
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
