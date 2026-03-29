-- Grant missing on spot_visits
GRANT SELECT ON public.spot_visits TO anon;
GRANT SELECT, INSERT, DELETE ON public.spot_visits TO authenticated;

-- Re-grant spot_reactions in case the previous migration wasn't run
GRANT SELECT ON public.spot_reactions TO anon;
GRANT SELECT, INSERT, DELETE ON public.spot_reactions TO authenticated;
