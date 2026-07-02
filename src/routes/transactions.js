const express = require('express');
const router  = express.Router();
const {
  createTransaction,
  getCheckout,
  payTransaction,
  shipTransaction,
  confirmDelivery,
  disputeTransaction,
  getMerchantTransactions,
} = require('../controllers/transactionController');
const { createReview }       = require('../controllers/reviewController');
const { authenticate, requireRole } = require('../middleware/auth');

// ── Merchant creates a checkout link (must be authenticated + merchant role) ─
router.post('/', authenticate, requireRole('merchant'), createTransaction);

// ── Public: buyer opens checkout by token ────────────────────────────────────
router.get('/:token', getCheckout);

// ── Buyer pays (optionally authenticated) ────────────────────────────────────
router.post('/:token/pay', (req, res, next) => {
  // Soft auth: attach user if token present, but don't block unauthenticated buyers
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const { verifyAccessToken } = require('../utils/jwt');
    try {
      req.user = verifyAccessToken(authHeader.split(' ')[1]);
    } catch {
      // Unauthenticated buyer — that's fine
    }
  }
  next();
}, payTransaction);

// ── Merchant marks as shipped ─────────────────────────────────────────────────
router.post('/:id/ship', authenticate, requireRole('merchant'), shipTransaction);

// ── Buyer confirms delivery (soft auth — can confirm via email) ───────────────
router.post('/:id/confirm', (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const { verifyAccessToken } = require('../utils/jwt');
    try { req.user = verifyAccessToken(authHeader.split(' ')[1]); } catch {}
  }
  next();
}, confirmDelivery);

// ── Buyer raises a dispute (soft auth) ───────────────────────────────────────
router.post('/:id/dispute', (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const { verifyAccessToken } = require('../utils/jwt');
    try { req.user = verifyAccessToken(authHeader.split(' ')[1]); } catch {}
  }
  next();
}, disputeTransaction);

// ── Buyer submits review (soft auth) ─────────────────────────────────────────
router.post('/:id/review', (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const { verifyAccessToken } = require('../utils/jwt');
    try { req.user = verifyAccessToken(authHeader.split(' ')[1]); } catch {}
  }
  next();
}, createReview);

module.exports = router;
