-- Niveau 3 — RPC + PostGIS

-- 1. RPC : count_likes_on_my_spots
-- Remplace 2 roundtrips séquentiels (spots → spot_reactions) par 1 JOIN SQL.
-- Utilisé par checkNewLikes et markLikesSeen dans MapView.tsx.
CREATE OR REPLACE FUNCTION public.count_likes_on_my_spots(p_user_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COUNT(*)
  FROM public.spot_reactions sr
  JOIN public.spots s ON s.id = sr.spot_id
  WHERE s.user_id = p_user_id
    AND sr.type = 'love'
    AND sr.user_id != p_user_id;
$$;

GRANT EXECUTE ON FUNCTION public.count_likes_on_my_spots(uuid) TO authenticated;

-- 2. PostGIS — index géo sur profiles (positions amis)
-- Prérequis : extension PostGIS activée dans Supabase (Dashboard → Database → Extensions → postgis)
-- Si PostGIS n'est pas activé, commenter ce bloc.

-- Ajouter une colonne geometry pour les positions des profils
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS location geography(Point, 4326);

-- Mettre à jour la colonne à partir des colonnes numériques existantes
UPDATE public.profiles
  SET location = ST_SetSRID(ST_MakePoint(last_lng, last_lat), 4326)::geography
  WHERE last_lat IS NOT NULL AND last_lng IS NOT NULL;

-- Index GIST pour les requêtes de proximité
CREATE INDEX IF NOT EXISTS idx_profiles_location_gist
  ON public.profiles USING GIST (location);

-- Trigger : maintenir la colonne location synchronisée avec last_lat/last_lng
CREATE OR REPLACE FUNCTION public.sync_profile_location()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.last_lat IS NOT NULL AND NEW.last_lng IS NOT NULL THEN
    NEW.location := ST_SetSRID(ST_MakePoint(NEW.last_lng, NEW.last_lat), 4326)::geography;
  ELSE
    NEW.location := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_location ON public.profiles;
CREATE TRIGGER trg_sync_profile_location
  BEFORE INSERT OR UPDATE OF last_lat, last_lng ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_location();
