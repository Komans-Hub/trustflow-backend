/**
 * TrustFlow — Trust Tier Engine
 *
 * Single source of truth for all tier and score calculations.
 * Import this anywhere tier logic is needed — never hardcode thresholds.
 */

const TIERS = {
  BRONZE:   { label: 'BRONZE',   min: 0,  max: 4,  color: '#CD7F32' },
  SILVER:   { label: 'SILVER',   min: 5,  max: 19, color: '#A8A9AD' },
  GOLD:     { label: 'GOLD',     min: 20, max: 49, color: '#FFD700' },
  PLATINUM: { label: 'PLATINUM', min: 50, max: Infinity, color: '#E5E4E2' },
};

/**
 * Derive the correct tier from a completed transaction count.
 * @param {number} transactionCount
 * @returns {'BRONZE'|'SILVER'|'GOLD'|'PLATINUM'}
 */
function calculateTier(transactionCount) {
  if (transactionCount >= 50) return 'PLATINUM';
  if (transactionCount >= 20) return 'GOLD';
  if (transactionCount >= 5)  return 'SILVER';
  return 'BRONZE';
}

/**
 * Calculate a trust score (0.00–5.00) from review ratings.
 * Falls back to 0.00 if no reviews exist.
 * @param {number[]} ratings  — array of integers 1–5
 * @returns {number}
 */
function calculateTrustScore(ratings = []) {
  if (!ratings.length) return 0.00;
  const sum = ratings.reduce((acc, r) => acc + r, 0);
  return parseFloat((sum / ratings.length).toFixed(2));
}

/**
 * Given an updated transaction count and an array of recent review ratings,
 * return the full updated trust profile fields ready to write to the DB.
 * @param {number} transactionCount
 * @param {number} disputeCount
 * @param {number[]} ratings
 * @param {number} totalVolumeKobo
 * @returns {{ tier: string, trust_score: number, transaction_count: number, dispute_count: number, total_volume: number }}
 */
function buildUpdatedProfile(transactionCount, disputeCount, ratings, totalVolumeKobo) {
  return {
    tier:              calculateTier(transactionCount),
    trust_score:       calculateTrustScore(ratings),
    transaction_count: transactionCount,
    dispute_count:     disputeCount,
    total_volume:      totalVolumeKobo,
  };
}

/**
 * Returns full tier metadata (label, color, min/max) for display purposes.
 * @param {'BRONZE'|'SILVER'|'GOLD'|'PLATINUM'} tier
 */
function getTierMeta(tier) {
  return TIERS[tier] ?? TIERS.BRONZE;
}

/**
 * How many more transactions until the next tier, or null if at PLATINUM.
 * @param {number} transactionCount
 * @returns {{ nextTier: string|null, remaining: number|null }}
 */
function nextTierProgress(transactionCount) {
  if (transactionCount >= 50) return { nextTier: null, remaining: null };
  if (transactionCount >= 20) return { nextTier: 'PLATINUM', remaining: 50 - transactionCount };
  if (transactionCount >= 5)  return { nextTier: 'GOLD',     remaining: 20 - transactionCount };
  return { nextTier: 'SILVER', remaining: 5 - transactionCount };
}

module.exports = {
  TIERS,
  calculateTier,
  calculateTrustScore,
  buildUpdatedProfile,
  getTierMeta,
  nextTierProgress,
};
