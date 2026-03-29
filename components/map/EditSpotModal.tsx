"use client"

import { useState, useRef } from "react"
import { motion, AnimatePresence, useDragControls } from "framer-motion"
import { X, UploadCloud, LoaderCircle, ChevronLeft, ChevronRight, Pencil } from "lucide-react"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import type { Spot } from "@/lib/types"
import { CATEGORIES } from "@/lib/categories"

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
  const [isEphemeral, setIsEphemeral] = useState(!!spot.expires_at)
  const [ephemeralDate, setEphemeralDate] = useState(
    spot.expires_at ? new Date(spot.expires_at).toISOString().split("T")[0] : ""
  )
  const fileInputRef = useRef<HTMLInputElement>(null)
  const supabase = useRef(createClient())
  const dragControls = useDragControls()

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
    const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]
    const MAX_SIZE = 10 * 1024 * 1024
    for (let i = 0; i < files.length; i++) {
      if (!ALLOWED_TYPES.includes(files[i].type)) {
        toast.error(`Fichier non supporté : ${files[i].name}. Formats acceptés : JPG, PNG, WebP.`)
        return
      }
      if (files[i].size > MAX_SIZE) {
        toast.error(`${files[i].name} dépasse la limite de 10 Mo.`)
        return
      }
    }
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
        expires_at: isEphemeral && ephemeralDate ? new Date(ephemeralDate).toISOString() : null,
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
          className="relative z-10 flex w-full flex-col rounded-t-3xl sm:rounded-3xl sm:max-w-lg bg-white dark:bg-zinc-950 border border-gray-200 dark:border-white/10 text-gray-900 dark:text-white"
          style={{ maxHeight: "90dvh" }}
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 28 }}
          drag="y"
          dragControls={dragControls}
          dragListener={false}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.5 }}
          dragMomentum={false}
          onDragEnd={(_e, { offset, velocity }) => {
            if (offset.y > 100 || velocity.y > 400) onClose()
          }}
        >
          {/* Header + handle — glisser vers le bas pour fermer */}
          <div
            className="flex-shrink-0 touch-none cursor-grab border-b border-gray-200 dark:border-white/10"
            onPointerDown={(e) => dragControls.start(e)}
          >
            <div className="flex justify-center pt-3 pb-1 sm:hidden">
              <div className="h-1.5 w-12 rounded-full bg-gray-300 dark:bg-white/20" />
            </div>
            <div className="flex items-center justify-between px-5 py-4">
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <Pencil size={18} className="text-blue-600 dark:text-indigo-400" /> Modifier le spot
              </h2>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto space-y-5 px-5 pt-5 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-5">
            {/* Photos */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-500 dark:text-zinc-400">Photos</label>
              {photos.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {photos.map((url, idx) => (
                    <div
                      key={idx}
                      className="group relative h-24 w-24 overflow-hidden rounded-2xl border border-gray-200 dark:border-white/10"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" className="h-full w-full object-cover" />
                      {/* Badge position */}
                      {idx === 0 && (
                        <span className="absolute left-1 top-1 rounded-full bg-blue-600 dark:bg-indigo-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          1ère
                        </span>
                      )}
                      {/* Delete */}
                      <button
                        onClick={() => handlePhotoDelete(idx)}
                        className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white"
                      >
                        <X size={12} />
                      </button>
                      {/* Reorder arrows — toujours visibles (mobile friendly) */}
                      <div className="absolute bottom-1 left-0 right-0 flex justify-center gap-1">
                        <button
                          onClick={() => handlePhotoMove(idx, -1)}
                          disabled={idx === 0}
                          className="flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white disabled:opacity-30"
                        >
                          <ChevronLeft size={11} />
                        </button>
                        <button
                          onClick={() => handlePhotoMove(idx, 1)}
                          disabled={idx === photos.length - 1}
                          className="flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white disabled:opacity-30"
                        >
                          <ChevronRight size={11} />
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
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-300 dark:border-white/20 bg-gray-50 dark:bg-white/5 py-3 text-sm text-gray-500 dark:text-zinc-400 transition-colors hover:bg-gray-100 dark:hover:bg-white/10 disabled:opacity-50"
              >
                {uploadingImage
                  ? <LoaderCircle size={16} className="animate-spin" />
                  : <UploadCloud size={16} />}
                {uploadingImage ? "Upload en cours..." : "Ajouter des photos"}
              </button>
            </div>

            {/* Title */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-500 dark:text-zinc-400">Titre</label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="w-full rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-4 py-3 text-sm text-gray-900 dark:text-white outline-none focus:border-blue-600 dark:focus:border-indigo-500 focus:ring-1 focus:ring-blue-600/50 dark:focus:ring-indigo-500/50"
              />
            </div>

            {/* Description */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-500 dark:text-zinc-400">Description</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={3}
                className="w-full resize-none rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-4 py-3 text-sm text-gray-900 dark:text-white outline-none focus:border-blue-600 dark:focus:border-indigo-500 focus:ring-1 focus:ring-blue-600/50 dark:focus:ring-indigo-500/50"
              />
            </div>

            {/* Category */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-500 dark:text-zinc-400">Catégorie</label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map(c => (
                  <button
                    key={c.key}
                    onClick={() => setCategory(c.key)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-2xl border px-3 py-1.5 text-sm font-medium transition-colors",
                      category === c.key
                        ? "border-blue-600 bg-blue-50 text-blue-700 dark:border-indigo-500 dark:bg-indigo-500/20 dark:text-indigo-300"
                        : "border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-white/10"
                    )}
                  >
                    {c.emoji} {c.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Spot éphémère */}
            <div className="rounded-2xl border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 p-4 space-y-3">
              <button
                type="button"
                onClick={() => setIsEphemeral(v => !v)}
                className="flex w-full items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">⏳</span>
                  <div className="text-left">
                    <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Spot éphémère</p>
                    <p className="text-xs text-amber-600 dark:text-amber-500">Ce lieu disparaîtra à la date choisie</p>
                  </div>
                </div>
                <div className={cn(
                  "relative h-6 w-11 rounded-full transition-colors",
                  isEphemeral ? "bg-amber-500" : "bg-gray-200 dark:bg-zinc-700"
                )}>
                  <div className={cn(
                    "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                    isEphemeral ? "translate-x-5" : "translate-x-0.5"
                  )} />
                </div>
              </button>
              {isEphemeral && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}>
                  <label className="mb-1 block text-xs font-medium text-amber-700 dark:text-amber-400">Date de fin</label>
                  <input
                    type="date"
                    value={ephemeralDate}
                    min={new Date().toISOString().split("T")[0]}
                    onChange={e => setEphemeralDate(e.target.value)}
                    className="w-full rounded-xl border border-amber-300 dark:border-amber-500/30 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm text-gray-900 dark:text-white outline-none focus:border-amber-500/60 focus:ring-2 focus:ring-amber-500/20"
                  />
                </motion.div>
              )}
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={submitting || !title.trim()}
              className="w-full rounded-2xl bg-blue-600 dark:bg-indigo-500 py-3 text-sm font-bold text-white transition-colors hover:bg-blue-500 dark:hover:bg-indigo-400 disabled:opacity-50"
            >
              {submitting ? "Enregistrement..." : "Enregistrer les modifications"}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
