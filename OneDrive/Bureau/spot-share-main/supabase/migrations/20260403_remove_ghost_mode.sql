-- Supprime la colonne ghost mode devenue inutile
ALTER TABLE public.profiles DROP COLUMN IF EXISTS is_ghost_mode;
