-- Add expires_at column to spots table for ephemeral spots
ALTER TABLE public.spots ADD COLUMN IF NOT EXISTS expires_at timestamptz;
