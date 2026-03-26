"use client"

import { useState, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, UploadCloud, LoaderCircle, ChevronLeft, ChevronRight, Pencil } from "lucide-react"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import type { Spot } from "@/lib/types"

const CATEGORIES = [
  { key: "café", label: "Café", emoji: "☕" },
  { key: "restaurant", label: "Restaurant", emoji: "🍽️" },
  { key: "bar", label: "Bar", emoji: "🍸" },
  { key: "outdoor", label: "Outdoor", emoji: "🌿" },
  { key: "vue", label: "Vue", emoji: "🌅" },
  { key: "culture", label: "Culture", emoji: "🎭" },
  { key: "shopping", label: "Shopping", emoji: "🛍️" },
  { key: "other", label: "Autre", emoji: "📍" },
]

interface EditSpotModalProps {
  spot: Spot
  onClose: () => void
  onUpdate: (updatedSpot: Spot) => void
}

export default function EditSpotModal({ spot, onClose, onUpdate }: EditSpotModalProps) {
  const [title, setTitle] = useState(spot.title)
  const [description, setDescription] = useState(spot.description || "")
  const [category, setCategory] = useState(spot.category)
  const [photos, setPhotos] = useState<string[]>(
    spot.image_url ? spot.image_url.split(",").map(s => s.trim()).filter(Boolean) : []
  )
  const [submitting, setSubmitting] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const supabase = useRef(createClient())

  const handlePhotoDelete = (idx: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== idx))
  }

  const handlePhotoMove = (idx: number, dir: -1 | 1) => {
    setPhotos(prev => {
      const next = [...prev]
      const target = idx + dir
      if (target < 0 || target >= next.length) return prev
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return next
    })
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    setUploadingImage(true)
    try {
      const { data: { session } } = await supabase.current.auth.getSession()
      const userId = session?.user?.id || "anonymous"
      const newUrls: string[] = []
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const ext = file.name.split(".").pop() || "jpg"
        const filePath = `spots/${userId}-${Date.now()}-${i}.${ext}`
        const { error } = await supabase.current.storage.from("avatars").upload(filePath, file)
        if (error) throw error
        const { data } = supabase.current.storage.from("avatars").getPublicUrl(filePath)
        newUrls.push(data.publicUrl)
      }
      setPhotos(prev => [...prev, ...newUrls])
      toast.success(`${files.length} photo(s) ajoutée(s) !`)
    } catch {
      toast.error("Erreur lors de l'upload")
    } finally {
      setUploadingImage(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const handleSubmit = async () => {
    if (!title.trim()) return
    setSubmitting(true)
    try {
      const updates = {
        title: title.trim(),
        description: description.trim() || null,
        category,
        image_url: photos.length > 0 ? photos.join(",") : null,
      }
      const { error } = await supabase.current
        .from("spots")
        .update(updates)
        .eq("id", spot.id)
      if (error) throw error
      onUpdate({ ...spot, ...updates })
      toast.success("Spot modifié !")
      onClose()
    } catch {
      toast.error("Erreur lors de la modification.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <motion.div
          className="relative z-10 w-full max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl sm:max-w-lg bg-zinc-950 border border-white/10 text-white"
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 28 }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.5 }}
          dragMomentum={false}
          onDragEnd={(_e, { offset, velocity }) => {
            if (offset.y > 100 || velocity.y > 400) onClose()
          }}
        >
          <div className="mx-auto mt-3 mb-0 h-1.5 w-12 rounded-full bg-white/20 sm:hidden" />
          {/* Header */}
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-zinc-950 px-5 py-4">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <Pencil size={18} className="text-indigo-400" /> Modifier le spot
            </h2>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
            >
              <X size={16} />
            </button>
          </div>

          <div className="space-y-5 px-5 py-5">
            {/* Photos */}
            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-400">Photos</label>
              {photos.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {photos.map((url, idx) => (
                    <div
                      key={idx}
                      className="group relative h-24 w-24 overflow-hidden rounded-2xl border border-white/10"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" className="h-full w-full object-cover" />
                      {/* Badge position */}
                      {idx === 0 && (
                        <span className="absolute left-1 top-1 rounded-full bg-indigo-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          1ère
                        </span>
                      )}
                      {/* Delete */}
                      <button
                        onClick={() => handlePhotoDelete(idx)}
                        className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        <X size={12} />
                      </button>
                      {/* Reorder arrows */}
                      <div className="absolute bottom-1 left-0 right-0 flex justify-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          onClick={() => handlePhotoMove(idx, -1)}
                          disabled={idx === 0}
                          className="flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white disabled:opacity-30"
                        >
                          <ChevronLeft size={10} />
                        </button>
                        <button
                          onClick={() => handlePhotoMove(idx, 1)}
                          disabled={idx === photos.length - 1}
                          className="flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white disabled:opacity-30"
                        >
                          <ChevronRight size={10} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleImageUpload}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingImage}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/20 bg-white/5 py-3 text-sm text-zinc-400 transition-colors hover:bg-white/10 disabled:opacity-50"
              >
                {uploadingImage
                  ? <LoaderCircle size={16} className="animate-spin" />
                  : <UploadCloud size={16} />}
                {uploadingImage ? "Upload en cours..." : "Ajouter des photos"}
              </button>
            </div>

            {/* Title */}
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-400">Titre</label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
              />
            </div>

            {/* Description */}
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-400">Description</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={3}
                className="w-full resize-none rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
              />
            </div>

            {/* Category */}
            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-400">Catégorie</label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map(c => (
                  <button
                    key={c.key}
                    onClick={() => setCategory(c.key)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-2xl border px-3 py-1.5 text-sm font-medium transition-colors",
                      category === c.key
                        ? "border-indigo-500 bg-indigo-500/20 text-indigo-300"
                        : "border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10"
                    )}
                  >
                    {c.emoji} {c.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={submitting || !title.trim()}
              className="w-full rounded-2xl bg-indigo-500 py-3 text-sm font-bold text-white transition-colors hover:bg-indigo-400 disabled:opacity-50"
            >
              {submitting ? "Enregistrement..." : "Enregistrer les modifications"}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
