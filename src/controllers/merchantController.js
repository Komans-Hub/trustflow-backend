const pool = require('../db/pool');
const { getTierMeta, nextTierProgress, calculateTrustScore } = require('../utils/trustEngine');

// ─── GET /merchants/:id/profile ───────────────────────────────────────────────
// Public endpoint — anyone can view a merchant's trust profile.

async function getMerchantProfile(req, res) {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT u.id, u.full_name, u.created_at,
              tp.tier, tp.trust_score, tp.transaction_count,
              tp.dispute_count, tp.total_volume
       FROM users u
       JOIN trust_profiles tp ON tp.user_id = u.id
       WHERE u.id = $1 AND u.role = 'merchant'`,
      [id]
    );

    const merchant = result.rows[0];
    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found' });
    }

    // Fetch last 5 reviews for the profile card
    const reviewsResult = await pool.query(
      `SELECT r.rating, r.comment, r.created_at, u.full_name AS reviewer_name
       FROM reviews r
       JOIN users u ON u.id = r.reviewer_id
       WHERE r.merchant_id = $1
       ORDER BY r.created_at DESC
       LIMIT 5`,
      [id]
    );

    const tierMeta = getTierMeta(merchant.tier);
    const progress = nextTierProgress(merchant.transaction_count);

    return res.status(200).json({
      merchant: {
        id:                merchant.id,
        full_name:         merchant.full_name,
        member_since:      merchant.created_at,
        tier:              merchant.tier,
        tier_color:        tierMeta.color,
        trust_score:       parseFloat(merchant.trust_score),
        transaction_count: merchant.transaction_count,
        dispute_count:     merchant.dispute_count,
        total_volume:      merchant.total_volume,
        next_tier:         progress.nextTier,
        remaining_to_next: progress.remaining,
      },
      recent_reviews: reviewsResult.rows,
    });
  } catch (err) {
    console.error('getMerchantProfile error:', err);
    return res.status(500).json({ error: 'Failed to load merchant profile' });
  }
}

module.exports = { getMerchantProfile };
