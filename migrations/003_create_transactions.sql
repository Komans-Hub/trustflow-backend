-- Migration 003: transactions
-- Core escrow transaction record. Enforces the FSM via a CHECK constraint.

CREATE TABLE IF NOT EXISTS transactions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_token      VARCHAR(64) UNIQUE NOT NULL,            -- public-facing link token
  seller_id           UUID NOT NULL REFERENCES users(id),
  buyer_id            UUID REFERENCES users(id),              -- null until buyer pays
  item_description    TEXT NOT NULL,
  amount              BIGINT NOT NULL,                        -- in kobo
  state               VARCHAR(20) NOT NULL DEFAULT 'CREATED'
                        CHECK (state IN ('CREATED', 'PAID', 'SHIPPED', 'DELIVERED', 'RELEASED', 'DISPUTED')),
  -- Timestamps for each FSM transition
  paid_at             TIMESTAMPTZ,
  shipped_at          TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  released_at         TIMESTAMPTZ,
  disputed_at         TIMESTAMPTZ,
  -- Optional metadata
  buyer_name          VARCHAR(255),
  buyer_email         VARCHAR(255),
  buyer_phone         VARCHAR(20),
  dispute_reason      TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_seller_id ON transactions(seller_id);
CREATE INDEX IF NOT EXISTS idx_transactions_buyer_id  ON transactions(buyer_id);
CREATE INDEX IF NOT EXISTS idx_transactions_token     ON transactions(checkout_token);
CREATE INDEX IF NOT EXISTS idx_transactions_state     ON transactions(state);
