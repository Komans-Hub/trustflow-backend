-- Migration 004: reviews
-- One review per completed transaction. Buyer reviews the merchant.

CREATE TABLE IF NOT EXISTS reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  UUID NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
  reviewer_id     UUID NOT NULL REFERENCES users(id),         -- buyer
  merchant_id     UUID NOT NULL REFERENCES users(id),         -- seller
  rating          SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_merchant_id    ON reviews(merchant_id);
CREATE INDEX IF NOT EXISTS idx_reviews_transaction_id ON reviews(transaction_id);
