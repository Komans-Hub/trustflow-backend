-- Migration 002: trust_profiles
-- One profile per merchant. Tracks tier, score, and transaction stats.

CREATE TABLE IF NOT EXISTS trust_profiles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  tier                VARCHAR(20) NOT NULL DEFAULT 'BRONZE' CHECK (tier IN ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM')),
  trust_score         NUMERIC(4, 2) NOT NULL DEFAULT 0.00,   -- 0.00 to 5.00
  transaction_count   INTEGER NOT NULL DEFAULT 0,
  dispute_count       INTEGER NOT NULL DEFAULT 0,
  total_volume        BIGINT NOT NULL DEFAULT 0,              -- stored in kobo (smallest unit)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trust_profiles_user_id ON trust_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_trust_profiles_tier ON trust_profiles(tier);
