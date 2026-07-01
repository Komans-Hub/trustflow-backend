require('dotenv').config();
const app  = require('./app');
const pool = require('./db/pool');

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    // Verify DB connectivity before accepting traffic
    await pool.query('SELECT 1');
    console.log('✓ Database connection established');

    app.listen(PORT, () => {
      console.log(`✓ TrustFlow API running on port ${PORT}`);
      console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (err) {
    console.error('✗ Failed to connect to database:', err.message);
    process.exit(1);
  }
}

start();
