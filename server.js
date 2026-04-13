require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──
app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? process.env.ALLOWED_ORIGIN || '*'
    : '*'
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Static files (frontend) ──
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ──
const rateLimit = require('express-rate-limit');
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many PIN attempts. Wait 1 minute.' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/auth/verify', authLimiter);
app.use('/api/auth', require('./routes/auth'));
app.use('/api/guests', require('./routes/guests'));
app.use('/api/guestlist', require('./routes/guestlist'));
app.use('/api/payments', require('./routes/payments'));

// ── Health check ──
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    club: process.env.CLUB_NAME || 'VOIDCLUB',
    devMode: process.env.DEV_MODE === 'true'
  });
});

// ── Catch-all → serve frontend ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Error handler ──
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Initialize DB on startup, then start server ──
const db = require('./db/database');

(async () => {
  await db.getDb(); // triggers schema creation (async with sql.js)

  app.listen(PORT, () => {
    console.log(`\n╔════════════════════════════════════════╗`);
    console.log(`║   🎵 ${process.env.CLUB_NAME || 'VOIDCLUB'} — BACKEND RUNNING        ║`);
    console.log(`╠════════════════════════════════════════╣`);
    console.log(`║   URL:  http://localhost:${PORT}          ║`);
    console.log(`║   Mode: ${process.env.DEV_MODE === 'true' ? 'DEVELOPMENT' : 'PRODUCTION '}              ║`);
    console.log(`║   DB:   PostgreSQL (Supabase)          ║`);
    console.log(`╚════════════════════════════════════════╝\n`);
  });
})();
