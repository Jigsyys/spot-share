# Design : NavHeightContext — hauteur dynamique de la nav bar

**Date :** 2026-04-06  
**Statut :** Approuvé

---

## Problème

Sur iPhone (PWA et Safari), la barre de navigation du bas a deux bugs visuels :

1. **Trop d'espace blanc sous les icônes** — `env(safe-area-inset-bottom)` vaut ~34px sur iPhone récent, ce qui fait une barre trop haute visuellement. Fixé partiellement avec `min(env(safe-area-inset-bottom), 16px)`.
2. **Mauvais alignement des modals/panels** — Les modals (spot panel, Explorer, Amis, Profil) utilisent des valeurs hardcodées (`bottom-16`, `bottom-[calc(4.25rem+...)]`, `pb-[calc(5rem+env(safe-area-inset-bottom))]`) qui ne reflètent pas la hauteur réelle rendue de la nav bar.

Cause racine : la hauteur de la nav bar n'est pas partagée. Chaque élément recalcule sa propre valeur de façon indépendante et approximative.

---

## Solution : NavHeightContext

Un React context dans `MapView.tsx` qui mesure la hauteur réelle de la nav bar via `ResizeObserver` et la publie pour tous les composants enfants.

### Architecture

```tsx
// Dans MapView.tsx

const NavHeightContext = createContext(64) // 64px = h-16 fallback

// State + ref sur le composant MapView
const navRef = useRef<HTMLDivElement>(null)
const [navHeight, setNavHeight] = useState(64)

useEffect(() => {
  const el = navRef.current
  if (!el) return
  const ro = new ResizeObserver(() => setNavHeight(el.offsetHeight))
  ro.observe(el)
  return () => ro.disconnect()
}, [])
```

### Utilisation dans les composants enfants

```tsx
const navHeight = useContext(NavHeightContext)

// Remplace bottom-16 / bottom-[calc(...)] :
style={{ bottom: navHeight }}

// Remplace pb-[calc(5rem+env(safe-area-inset-bottom))] :
style={{ paddingBottom: navHeight + 16 }}
```

### Provider

La nav bar est wrappée dans le provider :

```tsx
<NavHeightContext.Provider value={navHeight}>
  {/* toute la UI de MapView */}
  <div ref={navRef} className="sm:hidden fixed right-0 bottom-0 left-0 z-[90] ..."
    style={{ paddingBottom: "min(env(safe-area-inset-bottom), 16px)" }}>
    {/* nav bar */}
  </div>
</NavHeightContext.Provider>
```

---

## Éléments à mettre à jour dans MapView.tsx

| Élément | Valeur actuelle | Nouvelle valeur |
|---|---|---|
| Boutons flottants droite (zoom, localise) | `bottom-[calc(9rem+env(safe-area-inset-bottom))]` | `bottom: navHeight + 80` |
| Boutons flottants gauche | `bottom-[calc(9rem+env(safe-area-inset-bottom))]` | `bottom: navHeight + 80` |
| Spot panel | `bottom-[calc(4.25rem+env(safe-area-inset-bottom))]` | `bottom: navHeight` |
| Padding contenu spot panel | `pb-[calc(5rem+env(safe-area-inset-bottom))]` | `paddingBottom: navHeight + 16` |
| Group picker overlay | `pb-[calc(5rem+env(safe-area-inset-bottom))]` | `paddingBottom: navHeight + 16` |
| Toast / snackbar | `bottom-24` | `bottom: navHeight + 16` |

## Éléments à mettre à jour dans les modals (props)

Les modals (`ExploreModal`, `FriendsModal`, `ProfileModal`, `AddSpotModal`) reçoivent déjà leurs dimensions via des classes Tailwind hardcodées. Deux options :

- **Option retenue** : passer `navHeight` en prop depuis MapView et l'utiliser en `style` inline sur le conteneur principal de chaque modal.
- Chaque modal qui positionne son conteneur à `bottom-16` ou `inset-x-0 bottom-0` utilisera `style={{ bottom: navHeight }}`.

---

## Ce qui ne change pas

- La desktop sidebar (`hidden sm:flex`) : non affectée, utilise `top-0 bottom-0` sans nav bar.
- Le padding safe area sur la nav bar elle-même : reste `min(env(safe-area-inset-bottom), 16px)`.

---

## Fichiers modifiés

- `components/map/MapView.tsx` — ajout context, ref, ResizeObserver, remplacement des valeurs hardcodées
- `components/map/ExploreModal.tsx` — prop `navHeight`, remplacement `bottom-16`
- `components/map/FriendsModal.tsx` — prop `navHeight`, remplacement `bottom-0`
- `components/map/AddSpotModal.tsx` — prop `navHeight`, remplacement `bottom-16`
- `components/map/ProfileModal.tsx` — prop `navHeight` si nécessaire
