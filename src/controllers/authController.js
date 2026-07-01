const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../utils/jwt');

// ─── POST /auth/register ────────────────────────────────────────────────────

async function register(req, res) {
  const { full_name, email, phone, password, role } = req.body;

  if (!full_name || !email || !phone || !password || !role) {
    return res.status(400).json({ error: 'All fields are required: full_name, email, phone, password, role' });
  }

  if (!['merchant', 'buyer'].includes(role)) {
    return res.status(400).json({ error: 'Role must be either "merchant" or "buyer"' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check for existing email or phone
    const existing = await client.query(
      'SELECT id FROM users WHERE email = $1 OR phone = $2',
      [email.toLowerCase(), phone]
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Email or phone already registered' });
    }

    const password_hash = await bcrypt.hash(password, 12);

    const userResult = await client.query(
      `INSERT INTO users (email, phone, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, phone, full_name, role, created_at`,
      [email.toLowerCase(), phone, password_hash, full_name, role]
    );

    const user = userResult.rows[0];

    // Auto-create a trust_profile for merchants
    if (role === 'merchant') {
      await client.query(
        `INSERT INTO trust_profiles (user_id) VALUES ($1)`,
        [user.id]
      );
    }

    await client.query('COMMIT');

    const tokenPayload = { id: user.id, email: user.email, role: user.role };
    const accessToken  = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    // Persist refresh token
    await pool.query('UPDATE users SET refresh_token = $1 WHERE id = $2', [refreshToken, user.id]);

    return res.status(201).json({
      message: 'Account created successfully',
      user,
      accessToken,
      refreshToken,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('register error:', err);
    return res.status(500).json({ error: 'Registration failed. Please try again.' });
  } finally {
    client.release();
  }
}

// ─── POST /auth/login ───────────────────────────────────────────────────────

async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const result = await pool.query(
      `SELECT id, email, phone, full_name, role, password_hash
       FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const tokenPayload = { id: user.id, email: user.email, role: user.role };
    const accessToken  = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    await pool.query('UPDATE users SET refresh_token = $1 WHERE id = $2', [refreshToken, user.id]);

    const { password_hash, ...safeUser } = user;

    return res.status(200).json({
      message: 'Login successful',
      user: safeUser,
      accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
}

// ─── GET /auth/me ───────────────────────────────────────────────────────────

async function me(req, res) {
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.phone, u.full_name, u.role, u.is_verified, u.created_at,
              tp.tier, tp.trust_score, tp.transaction_count, tp.dispute_count, tp.total_volume
       FROM users u
       LEFT JOIN trust_profiles tp ON tp.user_id = u.id
       WHERE u.id = $1`,
      [req.user.id]
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.status(200).json({ user });
  } catch (err) {
    console.error('me error:', err);
    return res.status(500).json({ error: 'Could not fetch user data' });
  }
}

// ─── POST /auth/refresh ─────────────────────────────────────────────────────

async function refresh(req, res) {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token is required' });
  }

  try {
    const decoded = verifyRefreshToken(refreshToken);

    const result = await pool.query(
      'SELECT id, email, role, refresh_token FROM users WHERE id = $1',
      [decoded.id]
    );

    const user = result.rows[0];
    if (!user || user.refresh_token !== refreshToken) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const tokenPayload = { id: user.id, email: user.email, role: user.role };
    const newAccessToken  = generateAccessToken(tokenPayload);
    const newRefreshToken = generateRefreshToken(tokenPayload);

    await pool.query('UPDATE users SET refresh_token = $1 WHERE id = $2', [newRefreshToken, user.id]);

    return res.status(200).json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
  } catch (err) {
    return res.status(401).json({ error: 'Refresh token expired or invalid' });
  }
}

module.exports = { register, login, me, refresh };
