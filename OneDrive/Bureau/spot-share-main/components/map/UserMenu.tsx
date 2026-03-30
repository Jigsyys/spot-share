"use client"

import { useState, useRef, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { LogOut, User, Users, ChevronDown, Bell, Settings, Compass } from "lucide-react"
import type { User as SupabaseUser } from "@supabase/supabase-js"

interface UserMenuProps {
  user: SupabaseUser | null
  userProfile?: { username: string; avatar_url: string | null } | null
  incomingCount?: number
  followingCount?: number
  onSignOut: () => void
  onOpenProfile: () => void
  onOpenFriends: () => void
}

export default function UserMenu({
  user,
  userProfile,
  incomingCount = 0,
  followingCount = 0,
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
  const displayName =
    userProfile?.username || user?.email?.split("@")[0] || "Profil"
  const initials = displayName.charAt(0).toUpperCase()

  const close = () => setOpen(false)

  return (
    <div ref={menuRef} className="pointer-events-auto relative">
      {/* ── Trigger button ─────────────────────────────────────── */}
      <button
        onClick={() => setOpen(!open)}
        className="group flex items-center gap-2.5 rounded-2xl border border-gray-200/80 dark:border-white/[0.08] bg-white/90 dark:bg-zinc-900/90 py-1.5 pr-3 pl-1.5 backdrop-blur-xl shadow-sm shadow-black/[0.06] dark:shadow-black/20 transition-all hover:border-gray-300 dark:hover:border-white/[0.14] hover:shadow-md dark:hover:shadow-black/30"
      >
        {/* Avatar */}
        <div className="relative">
          <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-xs font-bold text-white ring-2 ring-white/80 dark:ring-zinc-900/80">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
            ) : (
              initials
            )}
          </div>
          {incomingCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-white dark:border-zinc-900 bg-red-500 text-[8px] font-bold text-white leading-none">
              {incomingCount > 9 ? "9+" : incomingCount}
            </span>
          )}
        </div>

        {/* Name */}
        <span className="max-w-[90px] truncate text-[13px] font-semibold text-gray-800 dark:text-zinc-100">
          {displayName}
        </span>

        <ChevronDown
          size={13}
          className={`text-gray-400 dark:text-zinc-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* ── Dropdown panel ─────────────────────────────────────── */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="absolute top-full right-0 z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-gray-200/80 dark:border-white/[0.08] bg-white/98 dark:bg-zinc-900/98 shadow-2xl shadow-black/[0.12] dark:shadow-black/50 backdrop-blur-2xl"
          >
            {/* Profile card */}
            <div className="border-b border-gray-100 dark:border-white/[0.06] p-4">
              <div className="flex items-center gap-3.5">
                <div className="relative">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-base font-bold text-white">
                    {avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
                    ) : (
                      initials
                    )}
                  </div>
                  {/* Online dot */}
                  <span className="absolute right-0 bottom-0 h-3 w-3 rounded-full border-2 border-white dark:border-zinc-900 bg-green-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-bold text-gray-900 dark:text-white leading-tight">
                    {displayName}
                  </p>
                  <p className="truncate text-[11px] text-gray-400 dark:text-zinc-600 mt-0.5">
                    {user?.email}
                  </p>
                  {/* Quick stats */}
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      onClick={() => { onOpenFriends(); close() }}
                      className="group/stat flex items-center gap-1 rounded-lg transition-colors hover:text-indigo-600 dark:hover:text-indigo-400"
                    >
                      <span className="text-[13px] font-bold text-gray-900 dark:text-white group-hover/stat:text-indigo-600 dark:group-hover/stat:text-indigo-400 transition-colors">
                        {followingCount}
                      </span>
                      <span className="text-[11px] text-gray-400 dark:text-zinc-600 group-hover/stat:text-indigo-500 dark:group-hover/stat:text-indigo-400 transition-colors">
                        amis
                      </span>
                    </button>
                    {incomingCount > 0 && (
                      <button
                        onClick={() => { onOpenFriends(); close() }}
                        className="flex items-center gap-1 rounded-full bg-red-500/10 dark:bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-600 dark:text-red-400 transition-colors hover:bg-red-500/20"
                      >
                        <Bell size={10} />
                        {incomingCount} invitation{incomingCount > 1 ? "s" : ""}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Menu items */}
            <div className="p-1.5 space-y-0.5">
              <MenuItem
                icon={<User size={15} className="text-indigo-500 dark:text-indigo-400" />}
                label="Mon profil"
                description="Voir et modifier votre profil"
                onClick={() => { onOpenProfile(); close() }}
              />
              <MenuItem
                icon={<Users size={15} className="text-violet-500 dark:text-violet-400" />}
                label="Réseau d'amis"
                description="Gérer vos amis et suggestions"
                badge={
                  incomingCount > 0 ? (
                    <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white leading-none">
                      {incomingCount}
                    </span>
                  ) : undefined
                }
                onClick={() => { onOpenFriends(); close() }}
              />
              <MenuItem
                icon={<Compass size={15} className="text-sky-500 dark:text-sky-400" />}
                label="Explorer"
                description="Découvrir de nouveaux spots"
                onClick={() => { close() }}
              />

              <div className="my-1.5 h-px bg-gray-100 dark:bg-white/[0.06]" />

              <MenuItem
                icon={<LogOut size={15} className="text-red-400" />}
                label="Se déconnecter"
                destructive
                onClick={() => { onSignOut(); close() }}
              />
            </div>

            {/* Footer */}
            <div className="border-t border-gray-100 dark:border-white/[0.06] px-4 py-2.5">
              <p className="text-[10px] text-gray-300 dark:text-zinc-700 text-center font-medium tracking-wide">
                SPOT SHARE
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MenuItem
// ─────────────────────────────────────────────────────────────────────────────
function MenuItem({
  icon,
  label,
  description,
  badge,
  destructive,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  description?: string
  badge?: React.ReactNode
  destructive?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all group/item ${
        destructive
          ? "hover:bg-red-50 dark:hover:bg-red-500/10"
          : "hover:bg-gray-50 dark:hover:bg-white/[0.05]"
      }`}
    >
      <div
        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl transition-colors ${
          destructive
            ? "bg-red-50 dark:bg-red-500/10 group-hover/item:bg-red-100 dark:group-hover/item:bg-red-500/15"
            : "bg-gray-100 dark:bg-zinc-800 group-hover/item:bg-gray-200 dark:group-hover/item:bg-zinc-700"
        }`}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={`text-[13px] font-semibold leading-tight ${
            destructive
              ? "text-red-500 dark:text-red-400"
              : "text-gray-800 dark:text-zinc-200"
          }`}
        >
          {label}
        </p>
        {description && (
          <p className="mt-0.5 text-[11px] text-gray-400 dark:text-zinc-600 truncate">
            {description}
          </p>
        )}
      </div>
      {badge}
    </button>
  )
}
