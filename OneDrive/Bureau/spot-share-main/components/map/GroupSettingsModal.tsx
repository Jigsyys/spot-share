"use client"

import { useState, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, UserPlus, Trash2, LoaderCircle } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import type { SpotGroup } from "@/lib/types"

interface Member {
  user_id: string
  profiles?: { username: string | null; avatar_url: string | null }
}

interface PendingInvite {
  id: string
  invitee_id: string
  profiles?: { username: string | null; avatar_url: string | null }
}

interface GroupSettingsModalProps {
  group: SpotGroup
  currentUserId: string
  followingProfiles: Array<{ id: string; username: string | null; avatar_url: string | null }>
  onClose: () => void
  onGroupDeleted: (groupId: string) => void
  onGroupUpdated: (group: SpotGroup) => void
}

export default function GroupSettingsModal({
  group, currentUserId, followingProfiles, onClose, onGroupDeleted, onGroupUpdated,
}: GroupSettingsModalProps) {
  const supabase = useRef(createClient())
  const [members, setMembers] = useState<Member[]>([])
  const [pending, setPending] = useState<PendingInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [invitingId, setInvitingId] = useState<string | null>(null)
  const [showInvitePicker, setShowInvitePicker] = useState(false)

  const isCreator = group.creator_id === currentUserId

  useEffect(() => {
    loadMembers()
  }, [group.id])

  const loadMembers = async () => {
    setLoading(true)
    try {
      const { data: memberData } = await supabase.current
        .from("spot_group_members")
        .select("user_id")
        .eq("group_id", group.id)

      const { data: inviteData } = await supabase.current
        .from("spot_group_invitations")
        .select("id, invitee_id")
        .eq("group_id", group.id)
        .eq("status", "pending")

      if (memberData) {
        const ids = memberData.map((m: any) => m.user_id)
        const { data: profiles } = await supabase.current
          .from("profiles").select("id, username, avatar_url").in("id", ids)
        const profileMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]))
        setMembers(memberData.map((m: any) => ({ user_id: m.user_id, profiles: profileMap[m.user_id] })))
      }

      if (inviteData) {
        const ids = inviteData.map((i: any) => i.invitee_id)
        const { data: profiles } = await supabase.current
          .from("profiles").select("id, username, avatar_url").in("id", ids)
        const profileMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]))
        setPending(inviteData.map((i: any) => ({ ...i, profiles: profileMap[i.invitee_id] })))
      }
    } catch (e) {
      console.error("loadMembers:", e)
    }
    setLoading(false)
  }

  const inviteFriend = async (friendId: string, friendUsername: string | null) => {
    setInvitingId(friendId)
    try {
      const { error } = await supabase.current
        .from("spot_group_invitations")
        .insert({ group_id: group.id, invitee_id: friendId, inviter_id: currentUserId, status: "pending" })
      if (error) throw error
      toast.success(`Invitation envoyée à @${friendUsername ?? friendId}`)
      setShowInvitePicker(false)
      loadMembers()
    } catch (e: any) {
      if (e?.code === "23505") toast.error("Déjà invité")
      else toast.error("Erreur lors de l'invitation")
    }
    setInvitingId(null)
  }

  const removeMember = async (userId: string) => {
    setRemovingId(userId)
    try {
      await supabase.current
        .from("spot_group_members")
        .delete()
        .eq("group_id", group.id)
        .eq("user_id", userId)
      setMembers(prev => prev.filter(m => m.user_id !== userId))
      toast.success("Membre retiré")
    } catch {
      toast.error("Erreur")
    }
    setRemovingId(null)
  }

  const deleteGroup = async () => {
    try {
      await supabase.current.from("spot_groups").delete().eq("id", group.id)
      onGroupDeleted(group.id)
      onClose()
      toast.success(`Groupe "${group.name}" supprimé`)
    } catch {
      toast.error("Erreur lors de la suppression")
    }
  }

  const alreadyInGroup = new Set([
    ...members.map(m => m.user_id),
    ...pending.map(p => p.invitee_id),
  ])
  const invitableFriends = followingProfiles.filter(f => !alreadyInGroup.has(f.id))

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <motion.div
          className="relative z-10 w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-zinc-900 border border-white/[0.07] overflow-hidden"
          initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-white/[0.06]">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-xl flex-shrink-0">
              {group.emoji}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-bold text-white truncate">{group.name}</p>
              <p className="text-[11px] text-zinc-500">{members.length} membre{members.length > 1 ? "s" : ""}</p>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/[0.06] flex items-center justify-center text-zinc-400 hover:text-white">
              <X size={15} />
            </button>
          </div>

          <div className="max-h-[70vh] overflow-y-auto">
            {/* Inviter */}
            {isCreator && (
              <div className="px-4 pt-3">
                <button
                  onClick={() => setShowInvitePicker(v => !v)}
                  className="flex items-center gap-2 w-full rounded-xl bg-indigo-500/10 border border-indigo-500/20 px-3 py-2.5 text-indigo-400 hover:bg-indigo-500/15 transition-colors"
                >
                  <UserPlus size={14} />
                  <span className="text-[12px] font-semibold">Inviter un ami</span>
                </button>
                {showInvitePicker && (
                  <div className="mt-2 rounded-xl border border-white/[0.07] bg-zinc-800 overflow-hidden">
                    {invitableFriends.length > 0 ? invitableFriends.map(f => (
                      <button
                        key={f.id}
                        onClick={() => inviteFriend(f.id, f.username)}
                        disabled={invitingId === f.id}
                        className="flex items-center gap-3 w-full px-3 py-2 hover:bg-white/[0.04] border-b border-white/[0.05] last:border-0 transition-colors"
                      >
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0 overflow-hidden">
                          {f.avatar_url
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={f.avatar_url} alt="" className="w-full h-full object-cover" />
                            : (f.username?.[0]?.toUpperCase() ?? "?")}
                        </div>
                        <span className="text-[12px] font-medium text-white flex-1 text-left">@{f.username ?? "?"}</span>
                        {invitingId === f.id
                          ? <LoaderCircle size={12} className="animate-spin text-zinc-500" />
                          : <span className="text-[10px] text-indigo-400 font-semibold">Inviter</span>}
                      </button>
                    )) : (
                      <p className="text-center text-[11px] text-zinc-500 py-3">Tous tes amis sont déjà dans ce groupe</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Membres */}
            <div className="px-4 pt-3 pb-1">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide mb-2">Membres</p>
              {loading ? (
                <div className="flex justify-center py-4"><LoaderCircle size={18} className="animate-spin text-zinc-600" /></div>
              ) : (
                <div className="space-y-1.5">
                  {members.map(m => (
                    <div key={m.user_id} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0 overflow-hidden">
                        {m.profiles?.avatar_url
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={m.profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                          : (m.profiles?.username?.[0]?.toUpperCase() ?? "?")}
                      </div>
                      <span className="flex-1 text-[12px] font-medium text-white">
                        @{m.profiles?.username ?? "?"}
                        {m.user_id === group.creator_id && (
                          <span className="ml-1.5 text-[10px] text-indigo-400 font-semibold">admin</span>
                        )}
                        {m.user_id === currentUserId && m.user_id !== group.creator_id && (
                          <span className="ml-1.5 text-[10px] text-zinc-500">vous</span>
                        )}
                      </span>
                      {isCreator && m.user_id !== currentUserId && (
                        <button
                          onClick={() => removeMember(m.user_id)}
                          disabled={removingId === m.user_id}
                          className="text-[10px] text-zinc-600 hover:text-red-400 transition-colors px-2 py-0.5 rounded-lg bg-white/[0.04]"
                        >
                          {removingId === m.user_id ? "..." : "Retirer"}
                        </button>
                      )}
                    </div>
                  ))}

                  {/* En attente */}
                  {pending.map(p => (
                    <div key={p.id} className="flex items-center gap-3 opacity-50">
                      <div className="w-8 h-8 rounded-full bg-zinc-700 border border-dashed border-zinc-500 flex items-center justify-center text-[11px] text-zinc-400 flex-shrink-0">
                        ?
                      </div>
                      <span className="flex-1 text-[12px] text-zinc-500">
                        @{p.profiles?.username ?? "?"}
                        <span className="ml-1.5 text-[10px] text-amber-500">· invitation envoyée</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Supprimer le groupe */}
            {isCreator && (
              <div className="px-4 py-3 mt-1 border-t border-white/[0.05]">
                <button
                  onClick={deleteGroup}
                  className="flex items-center gap-2 text-[12px] font-semibold text-red-400 hover:text-red-300 transition-colors"
                >
                  <Trash2 size={13} />
                  Supprimer le groupe
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
