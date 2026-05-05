-- Indexes spatiaux sur spots — niveau 2
-- Élimine les full table scans sur les bbox queries (fetchSpotsByBounds)

-- Index composite (lat, lng) pour les requêtes BETWEEN
CREATE INDEX IF NOT EXISTS idx_spots_lat_lng
  ON public.spots (lat, lng);

-- Index sur created_at pour ORDER BY created_at DESC (évite le filesort)
CREATE INDEX IF NOT EXISTS idx_spots_created_at
  ON public.spots (created_at DESC);

-- Index composite (lat, lng, created_at) — index couvrant pour les bbox + tri
-- Postgres peut satisfaire WHERE lat BETWEEN ... AND lng BETWEEN ... ORDER BY created_at DESC
-- en un seul Index Scan si le planner le choisit
CREATE INDEX IF NOT EXISTS idx_spots_lat_lng_created
  ON public.spots (lat, lng, created_at DESC);

-- Index sur visibility pour accélérer les vérifications RLS (policies sur visibility)
CREATE INDEX IF NOT EXISTS idx_spots_visibility
  ON public.spots (visibility);
