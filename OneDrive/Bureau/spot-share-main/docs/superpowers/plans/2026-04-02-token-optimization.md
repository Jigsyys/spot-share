# Token Optimization — Plugin Installation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Installer `claude-md-management` et `typescript-lsp` pour réduire les lectures répétées de gros fichiers et éliminer les cycles de build TypeScript coûteux.

**Architecture:** Deux plugins indépendants installés via la CLI Claude Code. `claude-md-management` enrichit CLAUDE.md avec des numéros de ligne précis après chaque session. `typescript-lsp` fournit des diagnostics TS en direct via le language server.

**Tech Stack:** Claude Code CLI (`/plugin install`), npm (typescript-language-server), CLAUDE.md

---

### Task 1 : Installer claude-md-management

**Files:**
- Modify: `CLAUDE.md` (enrichi automatiquement par le plugin)

- [ ] **Step 1 : Installer le plugin**

Dans le terminal Claude Code, exécuter :
```
/plugin install claude-md-management
```
Expected : message de confirmation "Plugin installed successfully"

- [ ] **Step 2 : Vérifier l'installation**

```bash
cat C:/Users/maxen/.claude/plugins/installed_plugins.json | grep claude-md-management
```
Expected : une entrée avec `"installPath"` et `"version"` pour `claude-md-management`

- [ ] **Step 3 : Lancer la mise à jour initiale de CLAUDE.md**

Dans le chat, taper :
```
/revise-claude-md
```
Expected : Claude analyse la session courante et propose des ajouts à CLAUDE.md (nouveaux composants, fonctions avec numéros de ligne, patterns découverts).

- [ ] **Step 4 : Accepter et committer les mises à jour**

```bash
cd "C:/Users/maxen/OneDrive/Bureau/spot-share-main"
git add CLAUDE.md
git commit -m "docs: enrich CLAUDE.md with session learnings via claude-md-management"
```

---

### Task 2 : Installer typescript-lsp

**Files:**
- Aucun fichier modifié — installation globale npm + plugin Claude Code

- [ ] **Step 1 : Installer le package npm global**

```bash
npm install -g typescript-language-server typescript
```
Expected : output npm sans erreur, commande `typescript-language-server --version` disponible

- [ ] **Step 2 : Vérifier que le binary est accessible**

```bash
typescript-language-server --version
```
Expected : affiche un numéro de version (ex: `4.3.3`)

- [ ] **Step 3 : Installer le plugin Claude Code**

Dans le terminal Claude Code :
```
/plugin install typescript-lsp
```
Expected : message de confirmation "Plugin installed successfully"

- [ ] **Step 4 : Vérifier les diagnostics sur un fichier du projet**

Dans le chat, demander :
```
Check TypeScript diagnostics on components/map/EditSpotModal.tsx
```
Expected : Claude utilise `getDiagnostics` et retourne une liste d'erreurs/warnings (ou "no errors") sans lancer `npx next build`

- [ ] **Step 5 : Committer l'état**

```bash
cd "C:/Users/maxen/OneDrive/Bureau/spot-share-main"
git add .
git commit -m "chore: install typescript-lsp and claude-md-management plugins"
```

---

### Task 3 : Documenter le workflow dans CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` — ajouter une section "Workflow sessions"

- [ ] **Step 1 : Ajouter la section workflow à CLAUDE.md**

Ajouter à la fin de `CLAUDE.md` :

```markdown
---

## Workflow sessions (optimisation tokens)

### Fin de session
Toujours lancer `/revise-claude-md` après une session de travail importante
pour capturer les numéros de ligne et les nouveaux composants.

### Vérification TypeScript
Utiliser `getDiagnostics` sur le fichier modifié au lieu de `npx next build`.
`npx next build` uniquement pour la vérification finale avant déploiement Vercel.

### Navigation dans les gros fichiers
MapView.tsx et FriendsModal.tsx font 2600+ lignes.
Toujours utiliser Read avec `offset` + `limit`, ou Grep ciblé.
Ne jamais lire ces fichiers en entier.
```

- [ ] **Step 2 : Committer**

```bash
cd "C:/Users/maxen/OneDrive/Bureau/spot-share-main"
git add CLAUDE.md
git commit -m "docs: add session workflow guidelines to CLAUDE.md"
```
