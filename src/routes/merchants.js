const express = require('express');
const router  = express.Router();
const { getMerchantProfile }       = require('../controllers/merchantController');
const { getMerchantTransactions }  = require('../controllers/transactionController');
const { authenticate }             = require('../middleware/auth');

// Public: anyone can view a merchant's trust profile
router.get('/:id/profile', getMerchantProfile);

// Private: only the merchant themselves can view their transaction list
router.get('/:id/transactions', authenticate, getMerchantTransactions);

module.exports = router;
