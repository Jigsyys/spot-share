-- Grant read access on spot_reactions to anon and authenticated roles
-- (needed so that like counts are visible without auth, and for authenticated users)
GRANT SELECT ON public.spot_reactions TO anon;
GRANT SELECT, INSERT, DELETE ON public.spot_reactions TO authenticated;
