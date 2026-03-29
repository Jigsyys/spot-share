-- Add expires_at column to spots table for ephemeral spots feature
ALTER TABLE spots
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NULL;

-- Optional: index for efficient filtering of expired spots
CREATE INDEX IF NOT EXISTS spots_expires_at_idx ON spots (expires_at)
  WHERE expires_at IS NOT NULL;
