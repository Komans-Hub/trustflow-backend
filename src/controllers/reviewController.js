const pool = require('../db/pool');
const { calculateTrustScore } = require('../utils/trustEngine');

// ─── POST /transactions/:id/review ───────────────────────────────────────────
// Buyer submits a review after transaction is RELEASED.
// One review per transaction (enforced by DB UNIQUE constraint on transaction_id).

async function createReview(req, res) {
  const { id } = req.params;
  const { rating, comment, buyer_email } = req.body;

  if (!rating) {
    return res.status(400).json({ error: 'Rating (1–5) is required' });
  }

  const parsedRating = parseInt(rating, 10);
  if (isNaN(parsedRating) || parsedRating < 1 || parsedRating > 5) {
    return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const txResult = await client.query(
      'SELECT * FROM transactions WHERE id = $1 FOR UPDATE',
      [id]
    );
    const tx = txResult.rows[0];

    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    if (tx.state !== 'RELEASED') {
      return res.status(409).json({
        error: `Reviews can only be submitted for RELEASED transactions. Current state: ${tx.state}`,
      });
    }

    // Verify the reviewer is the buyer
    const isBuyer =
      (req.user && req.user.id === tx.buyer_id) ||
      (!req.user && buyer_email && buyer_email === tx.buyer_email);

    if (!isBuyer) {
      return res.status(403).json({ error: 'Only the buyer can submit a review' });
    }

    // reviewer_id: use authenticated user or a placeholder lookup by email
    let reviewer_id = req.user?.id || null;
    if (!reviewer_id && tx.buyer_id) reviewer_id = tx.buyer_id;

    if (!reviewer_id) {
      return res.status(400).json({ error: 'Could not identify reviewer. Please log in to submit a review.' });
    }

    // Insert review (DB UNIQUE on transaction_id prevents duplicates)
    const reviewResult = await client.query(
      `INSERT INTO reviews (transaction_id, reviewer_id, merchant_id, rating, comment)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, rating, comment, created_at`,
      [id, reviewer_id, tx.seller_id, parsedRating, comment || null]
    );

    // Recalculate trust score from ALL reviews for this merchant
    const allRatings = await client.query(
      'SELECT rating FROM reviews WHERE merchant_id = $1',
      [tx.seller_id]
    );

    const ratings    = allRatings.rows.map(r => r.rating);
    const newScore   = calculateTrustScore(ratings);

    await client.query(
      `UPDATE trust_profiles
       SET trust_score = $1, updated_at = NOW()
       WHERE user_id = $2`,
      [newScore, tx.seller_id]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Review submitted. Thank you!',
      review: reviewResult.rows[0],
      merchant_new_score: newScore,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    // PostgreSQL unique violation code
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A review for this transaction already exists' });
    }
    console.error('createReview error:', err);
    return res.status(500).json({ error: 'Failed to submit review' });
  } finally {
    client.release();
  }
}

module.exports = { createReview };
