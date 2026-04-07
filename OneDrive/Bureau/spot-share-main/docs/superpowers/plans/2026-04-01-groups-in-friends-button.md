# Groups-in-Friends-Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fusionner le bouton "Groupes" dans le bouton "Amis" de la barre de filtres, et enrichir GroupSettingsModal avec rename, quitter groupe, et annuler invitation.

**Architecture:** Deux fichiers modifiés, aucune migration DB. MapView.tsx : retirer le bouton Groupes du tableau `filterButtons`, rendre le bouton Amis context-aware (label dynamique, comportement clic conditionnel, "Amis" en premier dans le dropdown). GroupSettingsModal.tsx : ajouter 3 fonctionnalités inline.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Framer Motion, Tailwind CSS, Supabase

---

### Task 1 : Retirer le bouton Groupes et rendre le bouton Amis context-aware

**Files:**
- Modify: `components/map/MapView.tsx` (lignes ~1202–1210 et ~1651–1677)

- [ ] **Step 1 : Retirer "groups" de filterButtons**

Dans `MapView.tsx` ligne ~1207-1209, remplacer :
```tsx
const filterButtons: {
  key: FilterMode
  label: string
  icon: React.ReactNode
}[] = [
  { key: "mine", label: "Moi", icon: <User size={13} /> },
  { key: "friends", label: "Amis", icon: <Users size={13} /> },
  { key: "groups", label: "Groupes", icon: <Layers size={13} /> },
]
```
Par :
```tsx
const filterButtons: {
  key: FilterMode
  label: string
  icon: React.ReactNode
}[] = [
  { key: "mine", label: "Moi", icon: <User size={13} /> },
  { key: "friends", label: "Amis", icon: <Users size={13} /> },
]
```

- [ ] **Step 2 : Rendre le label et le comportement du bouton Amis dynamiques**

Dans la boucle `filterButtons.map(...)` (ligne ~1651), remplacer le bloc `<motion.button>` existant par :

```tsx
{filterButtons.map(({ key, label, icon }) => {
  const isAmisKey = key === "friends"
  const isActive = filter === key || (isAmisKey && filter === "groups")
  const activeGroup = isAmisKey && activeGroupId ? groups.find(g => g.id === activeGroupId) : null
  const displayLabel = activeGroup ? activeGroup.name : label
  const displayIcon = activeGroup
    ? <span className="text-sm leading-none">{activeGroup.emoji}</span>
    : icon

  return (
    <motion.button
      key={key}
      onClick={() => {
        if (isAmisKey) {
          if (isActive) {
            // Déjà actif → ouvre le dropdown
            setShowGroupsDropdown(v => !v)
          } else {
            // Inactif → active directement sans dropdown
            setFilter("friends")
            setActiveGroupId(null)
            setShowGroupsDropdown(false)
          }
        } else {
          setFilter(key)
          setActiveGroupId(null)
          setShowGroupsDropdown(false)
          if (key === "mine") { setFriendFilterIds(new Set()); setFriendCategoryFilter(new Set()); setShowFriendFilter(false) }
        }
      }}
      className={cn(
        "relative flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold whitespace-nowrap transition-colors",
        isActive
          ? "bg-blue-600 dark:bg-indigo-500 text-white shadow-[0_2px_10px_rgba(37,99,235,0.5)] dark:shadow-[0_2px_10px_rgba(99,102,241,0.5)]"
          : "text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white"
      )}
      whileTap={{ scale: 0.95 }}
    >
      {displayIcon} {displayLabel}
      {isAmisKey && isActive && (
        <ChevronDown size={11} className={cn("ml-0.5 transition-transform", showGroupsDropdown && "rotate-180")} />
      )}
      {isAmisKey && activeGroupId && (
        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-indigo-300 border border-indigo-500" />
      )}
    </motion.button>
  )
})}
```

Vérifier que `ChevronDown` est importé depuis `lucide-react` (ajouter à la ligne d'import si absent).

- [ ] **Step 3 : Commit**

```bash
git add components/map/MapView.tsx
git commit -m "feat(groups): merge Groupes button into Amis — context-aware label and click"
```

---

### Task 2 : Ajouter "Amis" en tête du dropdown et étendre le bouton filtre

**Files:**
- Modify: `components/map/MapView.tsx` (lignes ~1688–1743 pour le dropdown, ~1782–1798 pour le filtre)

- [ ] **Step 1 : Ajouter l'entrée "Amis" en premier dans le dropdown**

Dans le dropdown groups (ligne ~1694, après `<div className="absolute top-full...`), ajouter avant `{groups.map(...)}` :

```tsx
{/* Entrée "Amis" — groupe par défaut */}
<div
  className="flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.04] cursor-pointer border-b border-white/[0.05]"
  onClick={() => {
    setFilter("friends")
    setActiveGroupId(null)
    setShowGroupsDropdown(false)
  }}
>
  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-base flex-shrink-0">
    <Users size={16} className="text-white" />
  </div>
  <div className="flex-1 min-w-0">
    <p className="text-[12px] font-bold text-white truncate">Amis</p>
    <p className="text-[10px] text-zinc-500">Tous tes amis</p>
  </div>
  {filter === "friends" && !activeGroupId && (
    <div className="w-4 h-4 rounded-full bg-indigo-500 flex items-center justify-center">
      <span className="text-white text-[9px] font-bold">✓</span>
    </div>
  )}
</div>
```

- [ ] **Step 2 : Étendre la condition du bouton filtre 🎚 à `filter === "groups"`**

Ligne ~1783, remplacer :
```tsx
{filter === "friends" && friendProfiles.length > 0 && (
```
Par :
```tsx
{(filter === "friends" || filter === "groups") && friendProfiles.length > 0 && (
```

- [ ] **Step 3 : Masquer la section "filtre par ami" quand `filter === "groups"`**

Dans le panneau filtre (ligne ~1820 environ), la liste des amis est dans un bloc après le champ de recherche. Wrapper ce bloc avec une condition :

```tsx
{filter === "friends" && (
  <>
    {/* Recherche */}
    <input ... />
    {/* Tout cocher / tout décocher */}
    <div className="mt-2 flex gap-1.5">...</div>
    {/* Liste des amis */}
    <div className="mt-2 max-h-44 overflow-y-auto space-y-0.5">...</div>
  </>
)}
```

Le filtre par catégorie (bloc `border-t` avec "Catégories") reste visible dans les deux modes.

- [ ] **Step 4 : Commit**

```bash
git add components/map/MapView.tsx
git commit -m "feat(groups): add Amis entry in dropdown, extend filter button to groups mode"
```

---

### Task 3 : GroupSettingsModal — renommer / changer l'emoji

**Files:**
- Modify: `components/map/GroupSettingsModal.tsx`

- [ ] **Step 1 : Ajouter le state d'édition**

Après les déclarations de state existantes (ligne ~36), ajouter :
```tsx
const [editName, setEditName] = useState(group.name)
const [editEmoji, setEditEmoji] = useState(group.emoji)
const [saving, setSaving] = useState(false)
```

- [ ] **Step 2 : Ajouter la fonction `saveGroupInfo`**

Après `deleteGroup` (ligne ~142), ajouter :
```tsx
const saveGroupInfo = async () => {
  if (!isCreator) return
  const name = editName.trim()
  if (!name || (name === group.name && editEmoji === group.emoji)) return
  setSaving(true)
  try {
    const { error } = await supabase.current
      .from("spot_groups")
      .update({ name, emoji: editEmoji })
      .eq("id", group.id)
    if (error) throw error
    onGroupUpdated({ ...group, name, emoji: editEmoji })
    toast.success("Groupe mis à jour")
  } catch {
    toast.error("Impossible de mettre à jour le groupe")
  }
  setSaving(false)
}
```

- [ ] **Step 3 : Remplacer l'en-tête statique par des champs éditables**

Dans le header du modal (ligne ~163–173), remplacer le bloc `<div className="flex-1 min-w-0">` par :

```tsx
<div className="flex-1 min-w-0 flex items-center gap-2">
  {isCreator ? (
    <>
      <input
        value={editEmoji}
        onChange={e => setEditEmoji(e.target.value)}
        onBlur={saveGroupInfo}
        className="w-9 text-center rounded-lg bg-white/[0.06] border border-white/[0.08] text-white text-base py-1 focus:outline-none focus:border-indigo-500"
        maxLength={2}
      />
      <input
        value={editName}
        onChange={e => setEditName(e.target.value)}
        onBlur={saveGroupInfo}
        onKeyDown={e => e.key === "Enter" && (e.currentTarget.blur())}
        className="flex-1 min-w-0 rounded-lg bg-white/[0.06] border border-white/[0.08] text-white text-[14px] font-bold px-2 py-1 focus:outline-none focus:border-indigo-500 truncate"
      />
      {saving && <LoaderCircle size={12} className="animate-spin text-zinc-500 flex-shrink-0" />}
    </>
  ) : (
    <>
      <p className="text-[14px] font-bold text-white truncate">{group.name}</p>
      <p className="text-[11px] text-zinc-500">{members.length} membre{members.length > 1 ? "s" : ""}</p>
    </>
  )}
</div>
```

Note : quand `isCreator`, le compte membres se met dans le sous-titre du header existant (la ligne `<p className="text-[11px] text-zinc-500">`) — la laisser uniquement pour les non-créateurs suffit, ou la garder en dehors du bloc conditionnel selon le rendu.

- [ ] **Step 4 : Commit**

```bash
git add components/map/GroupSettingsModal.tsx
git commit -m "feat(groups): add inline rename and emoji editing in GroupSettingsModal"
```

---

### Task 4 : GroupSettingsModal — quitter le groupe et annuler une invitation

**Files:**
- Modify: `components/map/GroupSettingsModal.tsx`

- [ ] **Step 1 : Ajouter la fonction `leaveGroup`**

Après `deleteGroup`, ajouter :
```tsx
const leaveGroup = async () => {
  try {
    const { error } = await supabase.current
      .from("spot_group_members")
      .delete()
      .eq("group_id", group.id)
      .eq("user_id", currentUserId)
    if (error) throw error
    onGroupDeleted(group.id) // réutilise le callback — retire le groupe de la liste locale
    onClose()
    toast.success(`Tu as quitté "${group.name}"`)
  } catch {
    toast.error("Impossible de quitter le groupe")
  }
}
```

- [ ] **Step 2 : Ajouter la fonction `cancelInvite`**

```tsx
const cancelInvite = async (inviteId: string, username: string | null) => {
  try {
    const { error } = await supabase.current
      .from("spot_group_invitations")
      .delete()
      .eq("id", inviteId)
    if (error) throw error
    setPending(prev => prev.filter(p => p.id !== inviteId))
    toast.success(`Invitation annulée${username ? ` pour @${username}` : ""}`)
  } catch {
    toast.error("Impossible d'annuler l'invitation")
  }
}
```

- [ ] **Step 3 : Ajouter le bouton "Annuler" sur chaque invitation en attente**

Dans la liste `{pending.map(p => (` (ligne ~250), ajouter un bouton à côté du badge "invitation envoyée" :

```tsx
{pending.map(p => (
  <div key={p.id} className="flex items-center gap-3 opacity-60">
    <div className="w-8 h-8 rounded-full bg-zinc-700 border border-dashed border-zinc-500 flex items-center justify-center text-[11px] text-zinc-400 flex-shrink-0">
      ?
    </div>
    <span className="flex-1 text-[12px] text-zinc-500">
      @{p.profiles?.username ?? "?"}
      <span className="ml-1.5 text-[10px] text-amber-500">· invitation envoyée</span>
    </span>
    {isCreator && (
      <button
        onClick={() => cancelInvite(p.id, p.profiles?.username ?? null)}
        className="text-[10px] text-zinc-600 hover:text-red-400 transition-colors px-2 py-0.5 rounded-lg bg-white/[0.04]"
      >
        Annuler
      </button>
    )}
  </div>
))}
```

- [ ] **Step 4 : Ajouter le bouton "Quitter le groupe" pour les non-créateurs**

Dans la zone actions en bas (ligne ~265–277), après le bloc `{isCreator && (...Supprimer le groupe...)}`, ajouter :

```tsx
{!isCreator && (
  <div className="px-4 py-3 mt-1 border-t border-white/[0.05]">
    <button
      onClick={leaveGroup}
      className="flex items-center gap-2 text-[12px] font-semibold text-red-400 hover:text-red-300 transition-colors"
    >
      <LogOut size={13} />
      Quitter le groupe
    </button>
  </div>
)}
```

Ajouter `LogOut` à l'import lucide-react en haut du fichier.

- [ ] **Step 5 : Commit**

```bash
git add components/map/GroupSettingsModal.tsx
git commit -m "feat(groups): add leave group and cancel invitation in GroupSettingsModal"
```

---

### Task 5 : Vérification finale

- [ ] **Step 1 : Build TypeScript**

```bash
npx next build 2>&1 | grep -E "error|Error" | head -20
```

Ignorer l'erreur prerender `/login` (normale en local sans env vars).

- [ ] **Step 2 : Vérifier les cas d'usage**

Checklist manuelle :
- [ ] Barre de filtres affiche `Moi | Amis` (plus de "Groupes")
- [ ] Clic "Amis" depuis "Moi" → active directement, pas de dropdown
- [ ] Clic "Amis" quand déjà actif → ouvre dropdown
- [ ] Dropdown : "Amis" en premier avec ✓ si actif
- [ ] Clic sur un groupe dans le dropdown → label devient `🗂️ NomGroupe ▾`
- [ ] Clic sur le groupe actif dans le dropdown → revient à "Amis"
- [ ] Bouton 🎚 visible en mode `friends` et `groups`
- [ ] En mode `groups`, le panneau filtre affiche seulement les catégories
- [ ] ⚙️ à côté de chaque groupe dans le dropdown ouvre GroupSettingsModal
- [ ] Créateur : peut renommer et changer l'emoji (sauvegarde on blur)
- [ ] Créateur : peut annuler une invitation en attente
- [ ] Membre non-créateur : voit "Quitter le groupe", pas "Supprimer"

- [ ] **Step 3 : Commit final si ajustements**

```bash
git add -p
git commit -m "fix(groups): polish after manual testing"
```
