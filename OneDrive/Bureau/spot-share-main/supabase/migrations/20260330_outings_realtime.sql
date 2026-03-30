-- ============================================================
-- Activer le Realtime sur les tables outings et outing_invitations
-- Sans ça, les notifications temps réel ne fonctionnent pas
-- ============================================================

-- 1. REPLICA IDENTITY FULL = Supabase peut émettre les changements complets (old + new)
ALTER TABLE public.outings REPLICA IDENTITY FULL;
ALTER TABLE public.outing_invitations REPLICA IDENTITY FULL;

-- 2. Ajouter les tables à la publication Realtime de Supabase
--    (si déjà présentes, l'instruction est ignorée)
DO $$
BEGIN
  -- outings
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'outings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.outings;
  END IF;

  -- outing_invitations
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'outing_invitations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.outing_invitations;
  END IF;
END $$;
