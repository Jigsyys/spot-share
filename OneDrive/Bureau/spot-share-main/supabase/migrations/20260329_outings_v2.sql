-- Add geocoded coordinates to outings
ALTER TABLE public.outings ADD COLUMN IF NOT EXISTS lat numeric;
ALTER TABLE public.outings ADD COLUMN IF NOT EXISTS lng numeric;
