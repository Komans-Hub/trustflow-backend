/**
 * TrustFlow — Escrow FSM (Finite State Machine)
 *
 * CREATED → PAID → SHIPPED → DELIVERED → RELEASED
 *                                       → DISPUTED
 *
 * This is the single source of truth for valid state transitions.
 * Any controller that changes transaction state MUST go through canTransition().
 */

const TRANSITIONS = {
  CREATED:   ['PAID'],
  PAID:      ['SHIPPED'],
  SHIPPED:   ['DELIVERED'],
  DELIVERED: ['RELEASED', 'DISPUTED'],
  RELEASED:  [],   // terminal
  DISPUTED:  [],   // terminal (for MVP — no resolution flow)
};

/**
 * Returns true if moving from `current` → `next` is a valid FSM transition.
 * @param {string} current
 * @param {string} next
 * @returns {boolean}
 */
function canTransition(current, next) {
  return TRANSITIONS[current]?.includes(next) ?? false;
}

/**
 * Asserts a transition is valid, throws a structured error if not.
 * Use this inside controllers for clean error handling.
 * @param {string} current
 * @param {string} next
 */
function assertTransition(current, next) {
  if (!canTransition(current, next)) {
    const err = new Error(
      `Invalid state transition: ${current} → ${next}. ` +
      `Allowed from ${current}: [${TRANSITIONS[current]?.join(', ') || 'none'}]`
    );
    err.statusCode = 409;
    err.code = 'FSM_INVALID_TRANSITION';
    throw err;
  }
}

/**
 * The timestamp column to set for each target state.
 */
const STATE_TIMESTAMP_COLUMN = {
  PAID:      'paid_at',
  SHIPPED:   'shipped_at',
  DELIVERED: 'delivered_at',
  RELEASED:  'released_at',
  DISPUTED:  'disputed_at',
};

module.exports = { TRANSITIONS, canTransition, assertTransition, STATE_TIMESTAMP_COLUMN };
