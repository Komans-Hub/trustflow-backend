const pool = require('../db/pool');
const { assertTransition, STATE_TIMESTAMP_COLUMN } = require('../utils/fsm');
const { generateCheckoutToken } = require('../utils/token');
const { calculateTier, calculateTrustScore, nextTierProgress, getTierMeta } = require('../utils/trustEngine');

// ─── Helper: fetch transaction by ID, with seller info ──────────────────────

async function getTransactionById(id) {
  const result = await pool.query(
    `SELECT t.*, 
            u.full_name  AS seller_name,
            u.email      AS seller_email,
            tp.tier, tp.trust_score, tp.transaction_count
     FROM transactions t
     JOIN users u         ON u.id  = t.seller_id
     LEFT JOIN trust_profiles tp ON tp.user_id = t.seller_id
     WHERE t.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

// ─── POST /transactions ──────────────────────────────────────────────────────
// Merchant creates a new checkout link.

async function createTransaction(req, res) {
  const { item_description, amount } = req.body;

  if (!item_description || !amount) {
    return res.status(400).json({ error: 'item_description and amount are required' });
  }

  const parsedAmount = parseInt(amount, 10);
  if (isNaN(parsedAmount) || parsedAmount < 1) {
    return res.status(400).json({ error: 'amount must be a positive integer (in kobo)' });
  }

  if (req.user.role !== 'merchant') {
    return res.status(403).json({ error: 'Only merchants can create transactions' });
  }

  try {
    const checkout_token = generateCheckoutToken();

    const result = await pool.query(
      `INSERT INTO transactions (checkout_token, seller_id, item_description, amount)
       VALUES ($1, $2, $3, $4)
       RETURNING id, checkout_token, item_description, amount, state, created_at`,
      [checkout_token, req.user.id, item_description, parsedAmount]
    );

    const transaction = result.rows[0];

    return res.status(201).json({
      message: 'Checkout link created',
      transaction,
      checkout_url: `/checkout/${checkout_token}`,
    });
  } catch (err) {
    console.error('createTransaction error:', err);
    return res.status(500).json({ error: 'Failed to create transaction' });
  }
}

// ─── GET /transactions/:token ────────────────────────────────────────────────
// Public endpoint — buyer opens the checkout page.

async function getCheckout(req, res) {
  const { token } = req.params;

  try {
    const result = await pool.query(
      `SELECT t.id, t.checkout_token, t.item_description, t.amount, t.state,
              t.buyer_name, t.created_at,
              u.full_name  AS seller_name,
              u.id         AS seller_id,
              tp.tier, tp.trust_score, tp.transaction_count, tp.dispute_count
       FROM transactions t
       JOIN users u              ON u.id  = t.seller_id
       LEFT JOIN trust_profiles tp ON tp.user_id = t.seller_id
       WHERE t.checkout_token = $1`,
      [token]
    );

    const tx = result.rows[0];
    if (!tx) {
      return res.status(404).json({ error: 'Checkout link not found or expired' });
    }

    // Enrich with tier metadata and progress for the UI
    const tierMeta = getTierMeta(tx.tier);
    const progress = nextTierProgress(tx.transaction_count);

    return res.status(200).json({
      transaction: tx,
      seller: {
        id:               tx.seller_id,
        name:             tx.seller_name,
        tier:             tx.tier,
        tier_color:       tierMeta.color,
        trust_score:      tx.trust_score,
        transaction_count: tx.transaction_count,
        dispute_count:    tx.dispute_count,
        next_tier:        progress.nextTier,
        remaining_to_next: progress.remaining,
      },
    });
  } catch (err) {
    console.error('getCheckout error:', err);
    return res.status(500).json({ error: 'Failed to load checkout' });
  }
}

// ─── POST /transactions/:token/pay ───────────────────────────────────────────
// Buyer pays — CREATED → PAID. Mocked: no real payment gateway.

async function payTransaction(req, res) {
  const { token } = req.params;
  const { buyer_name, buyer_email, buyer_phone } = req.body;

  if (!buyer_name || !buyer_email || !buyer_phone) {
    return res.status(400).json({ error: 'buyer_name, buyer_email, and buyer_phone are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      'SELECT * FROM transactions WHERE checkout_token = $1 FOR UPDATE',
      [token]
    );
    const tx = result.rows[0];

    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    assertTransition(tx.state, 'PAID');

    // If the buyer is authenticated, link their account
    const buyer_id = req.user?.id || null;

    const updated = await client.query(
      `UPDATE transactions
       SET state = 'PAID',
           paid_at = NOW(),
           buyer_id = $1,
           buyer_name = $2,
           buyer_email = $3,
           buyer_phone = $4,
           updated_at = NOW()
       WHERE id = $5
       RETURNING id, state, paid_at, buyer_name, amount`,
      [buyer_id, buyer_name, buyer_email, buyer_phone, tx.id]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      message: 'Payment confirmed. Funds held in escrow.',
      transaction: updated.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === 'FSM_INVALID_TRANSITION') {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error('payTransaction error:', err);
    return res.status(500).json({ error: 'Payment failed' });
  } finally {
    client.release();
  }
}

// ─── POST /transactions/:id/ship ─────────────────────────────────────────────
// Merchant marks item as shipped — PAID → SHIPPED.

async function shipTransaction(req, res) {
  const { id } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      'SELECT * FROM transactions WHERE id = $1 FOR UPDATE',
      [id]
    );
    const tx = result.rows[0];

    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    if (tx.seller_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the seller can mark this as shipped' });
    }

    assertTransition(tx.state, 'SHIPPED');

    const updated = await client.query(
      `UPDATE transactions
       SET state = 'SHIPPED', shipped_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING id, state, shipped_at`,
      [id]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      message: 'Item marked as shipped. Awaiting buyer confirmation.',
      transaction: updated.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === 'FSM_INVALID_TRANSITION') {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error('shipTransaction error:', err);
    return res.status(500).json({ error: 'Failed to update shipment status' });
  } finally {
    client.release();
  }
}

// ─── POST /transactions/:id/confirm ──────────────────────────────────────────
// Buyer confirms delivery — SHIPPED → DELIVERED → RELEASED.
// Also updates the merchant's trust profile (transaction_count, tier, volume).

async function confirmDelivery(req, res) {
  const { id } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      'SELECT * FROM transactions WHERE id = $1 FOR UPDATE',
      [id]
    );
    const tx = result.rows[0];

    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    // Allow either the authenticated buyer or match by email
    const isBuyer =
      (req.user && req.user.id === tx.buyer_id) ||
      (!req.user && req.body.buyer_email && req.body.buyer_email === tx.buyer_email);

    if (!isBuyer) {
      return res.status(403).json({ error: 'Only the buyer can confirm delivery' });
    }

    assertTransition(tx.state, 'DELIVERED');

    // Move through DELIVERED → RELEASED in one atomic operation (MVP shortcut)
    await client.query(
      `UPDATE transactions
       SET state = 'DELIVERED', delivered_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [id]
    );

    const updated = await client.query(
      `UPDATE transactions
       SET state = 'RELEASED', released_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING id, state, delivered_at, released_at, amount, seller_id`,
      [id]
    );

    const released = updated.rows[0];

    // ── Update merchant trust profile ────────────────────────────────────────
    const profileResult = await client.query(
      'SELECT * FROM trust_profiles WHERE user_id = $1 FOR UPDATE',
      [released.seller_id]
    );
    const profile = profileResult.rows[0];

    const newCount  = profile.transaction_count + 1;
    const newVolume = BigInt(profile.total_volume) + BigInt(released.amount);
    const newTier   = calculateTier(newCount);

    await client.query(
      `UPDATE trust_profiles
       SET transaction_count = $1,
           total_volume = $2,
           tier = $3,
           updated_at = NOW()
       WHERE user_id = $4`,
      [newCount, newVolume.toString(), newTier, released.seller_id]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      message: 'Delivery confirmed. Funds released to seller.',
      transaction: released,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === 'FSM_INVALID_TRANSITION') {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error('confirmDelivery error:', err);
    return res.status(500).json({ error: 'Failed to confirm delivery' });
  } finally {
    client.release();
  }
}

// ─── POST /transactions/:id/dispute ──────────────────────────────────────────
// Buyer raises a dispute — DELIVERED is not required; SHIPPED → DISPUTED also valid.
// FSM: DELIVERED → DISPUTED (the only reachable path in MVP since confirm skips DELIVERED).
// We allow SHIPPED → DISPUTED as an escape hatch for buyers.

async function disputeTransaction(req, res) {
  const { id } = req.params;
  const { reason, buyer_email } = req.body;

  if (!reason) {
    return res.status(400).json({ error: 'A dispute reason is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      'SELECT * FROM transactions WHERE id = $1 FOR UPDATE',
      [id]
    );
    const tx = result.rows[0];

    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    const isBuyer =
      (req.user && req.user.id === tx.buyer_id) ||
      (!req.user && buyer_email && buyer_email === tx.buyer_email);

    if (!isBuyer) {
      return res.status(403).json({ error: 'Only the buyer can raise a dispute' });
    }

    // Allow dispute from PAID or SHIPPED (buyer paid but item not arrived)
    if (!['PAID', 'SHIPPED', 'DELIVERED'].includes(tx.state)) {
      return res.status(409).json({
        error: `Cannot dispute a transaction in state: ${tx.state}`,
      });
    }

    const updated = await client.query(
      `UPDATE transactions
       SET state = 'DISPUTED',
           disputed_at = NOW(),
           dispute_reason = $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING id, state, disputed_at, dispute_reason`,
      [reason, id]
    );

    // Increment merchant dispute count
    await client.query(
      `UPDATE trust_profiles
       SET dispute_count = dispute_count + 1, updated_at = NOW()
       WHERE user_id = $1`,
      [tx.seller_id]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      message: 'Dispute raised. Our team will review this transaction.',
      transaction: updated.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('disputeTransaction error:', err);
    return res.status(500).json({ error: 'Failed to raise dispute' });
  } finally {
    client.release();
  }
}

// ─── GET /merchants/:id/transactions ─────────────────────────────────────────
// Merchant dashboard — paginated transaction history.

async function getMerchantTransactions(req, res) {
  const { id } = req.params;
  const page  = Math.max(1, parseInt(req.query.page  || '1', 10));
  const limit = Math.min(50, parseInt(req.query.limit || '20', 10));
  const offset = (page - 1) * limit;
  const { state } = req.query; // optional filter

  // Only the merchant themselves can see their full list
  if (req.user.id !== id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const stateFilter = state ? `AND t.state = $4` : '';
    const params = state
      ? [id, limit, offset, state]
      : [id, limit, offset];

    const result = await pool.query(
      `SELECT t.id, t.checkout_token, t.item_description, t.amount,
              t.state, t.buyer_name, t.buyer_email,
              t.created_at, t.paid_at, t.shipped_at, t.released_at, t.disputed_at,
              (SELECT rating FROM reviews WHERE transaction_id = t.id LIMIT 1) AS review_rating
       FROM transactions t
       WHERE t.seller_id = $1 ${stateFilter}
       ORDER BY t.created_at DESC
       LIMIT $2 OFFSET $3`,
      params
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM transactions WHERE seller_id = $1 ${state ? 'AND state = $2' : ''}`,
      state ? [id, state] : [id]
    );

    const total = parseInt(countResult.rows[0].count, 10);

    return res.status(200).json({
      transactions: result.rows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('getMerchantTransactions error:', err);
    return res.status(500).json({ error: 'Failed to fetch transactions' });
  }
}

module.exports = {
  createTransaction,
  getCheckout,
  payTransaction,
  shipTransaction,
  confirmDelivery,
  disputeTransaction,
  getMerchantTransactions,
};
