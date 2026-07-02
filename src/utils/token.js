const { randomBytes } = require('crypto');

/**
 * Generates a URL-safe random token for checkout links.
 * 32 bytes → 64 hex characters. Collision probability is negligible.
 * @returns {string}
 */
function generateCheckoutToken() {
  return randomBytes(32).toString('hex');
}

module.exports = { generateCheckoutToken };
