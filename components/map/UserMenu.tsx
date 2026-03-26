"use client"

import { useState, useRef, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { LogOut, User, Users, ChevronDown } from "lucide-react"
import type { User as SupabaseUser } from "@supabase/supabase-js"

interface UserMenuProps {
  user: SupabaseUser | null
  userProfile?: { username: string; avatar_url: string | null } | null
  incomingCount?: number
  onSignOut: () => void
  onOpenProfile: () => void
  onOpenFriends: () => void
}

export default function UserMenu({
  user,
  userProfile,
  incomingCount = 0,
  onSignOut,
  onOpenProfile,
  onOpenFriends,
}: UserMenuProps) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const avatarUrl = userProfile?.avatar_url
  const initials = userProfile?.username
    ? userProfile.username.charAt(0).toUpperCase()
    : user?.email?.charAt(0).toUpperCase() ?? "?"

  const close = () => setOpen(false)

  return (
    <div ref={menuRef} className="pointer-events-auto relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-full border border-gray-200 dark:border-white/10 bg-white/80 dark:bg-white/10 py-1 pr-2 pl-1 backdrop-blur-md transition-all hover:bg-gray-100 dark:hover:bg-white/15"
      >
        <div className="relative">
          <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-blue-600 to-sky-500 dark:from-indigo-500 dark:to-purple-600 text-xs font-bold text-white">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
            ) : (
              initials
            )}
          </div>
          {incomingCount > 0 && (
            <div className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-white dark:border-zinc-900 bg-red-500 text-[9px] font-bold text-white" />
          )}
        </div>
        <ChevronDown
          size={14}
          className={`text-gray-500 dark:text-zinc-300 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full right-0 z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-gray-200 dark:border-white/10 bg-white/95 dark:bg-zinc-900/95 shadow-2xl backdrop-blur-xl"
          >
            {/* Profile info */}
            <div className="border-b border-gray-100 dark:border-white/10 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-blue-600 to-sky-500 dark:from-indigo-500 dark:to-purple-600 text-sm font-bold text-white">
                  {avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
                  ) : (
                    initials
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                    {userProfile?.username ||
                      user?.email?.split("@")[0] ||
                      "Mon profil"}
                  </p>
                  <p className="truncate text-xs text-gray-400 dark:text-zinc-500">
                    {user?.email}
                  </p>
                </div>
              </div>
            </div>

            {/* Menu items */}
            <div className="p-1.5">
              <button
                onClick={() => {
                  onOpenProfile()
                  close()
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-gray-600 dark:text-zinc-300 transition-colors hover:bg-gray-100 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white"
              >
                <User size={16} className="text-blue-600 dark:text-indigo-400" /> Mon profil
              </button>
              <button
                onClick={() => {
                  onOpenFriends()
                  close()
                }}
                className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm text-gray-600 dark:text-zinc-300 transition-colors hover:bg-gray-100 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white"
              >
                <span className="flex items-center gap-3">
                  <Users size={16} className="text-blue-600 dark:text-indigo-400" /> Mes amis
                </span>
                {incomingCount > 0 && (
                  <span className="flex h-5 items-center justify-center rounded-full bg-red-500 px-2 text-[10px] font-bold text-white">
                    {incomingCount}
                  </span>
                )}
              </button>
              <div className="my-1 h-px bg-gray-100 dark:bg-white/10" />
              <button
                onClick={() => {
                  onSignOut()
                  close()
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-red-400 transition-colors hover:bg-red-500/10"
              >
                <LogOut size={16} /> Se déconnecter
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
