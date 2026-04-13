const express = require('express');
const crypto = require('crypto');
const { signToken } = require('../middleware/auth');

const router = express.Router();

const bcrypt = require('bcryptjs');
const db = require('../db/database');

/**
 * POST /api/auth/verify
 * Body: { pin: "1234" }
 * Returns: { token, role } or 401
 */
router.post('/verify', async (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN required' });

  let isAdmin = false;
  let isBouncer = false;

  // Try bcrypt hashes first if configured
  if (process.env.ADMIN_PIN_HASH && process.env.BOUNCER_PIN_HASH) {
    isAdmin = await bcrypt.compare(pin.toString().trim(), process.env.ADMIN_PIN_HASH);
    isBouncer = await bcrypt.compare(pin.toString().trim(), process.env.BOUNCER_PIN_HASH);
  } else {
    // Fallback to plain text for dev mode
    const adminPin = process.env.ADMIN_PIN || '1234';
    const bouncerPin = process.env.BOUNCER_PIN || '9999';
    if (pin.toString().trim() === adminPin) isAdmin = true;
    else if (pin.toString().trim() === bouncerPin) isBouncer = true;
  }

  if (!isAdmin && !isBouncer) {
    try { await db.logAction('auth_fail', { ip: req.ip }, null, req.ip); } catch (_) {}
    return res.status(401).json({ error: 'Incorrect PIN' });
  }

  const role = isAdmin ? 'admin' : 'bouncer';
  const token = signToken(role);
  return res.json({ token, role });
});

/**
 * GET /api/auth/config
 * Returns public config (no secrets)
 */
router.get('/config', (req, res) => {
  res.json({
    clubName: process.env.CLUB_NAME || 'VOIDCLUB',
    eventName: process.env.EVENT_NAME || 'NEON NIGHT — SATURDAY',
    maxCapacity: parseInt(process.env.MAX_CAPACITY) || 300,
    maxPartySize: parseInt(process.env.MAX_PARTY_SIZE) || 5,
    devMode: process.env.DEV_MODE === 'true',
    doorsOpen: process.env.DOORS_OPEN || '21:00',
    doorsClose: process.env.DOORS_CLOSE || '03:00',
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
    tickets: [
      { id: 'general', name: 'General', desc: 'Standard entry', price: 500, color: '#888' },
      { id: 'vip', name: 'VIP', desc: 'Priority lane + drinks', price: 1500, color: '#FFD700' },
      { id: 'guestlist', name: 'Guest List', desc: 'Pre-approved guests only', price: 200, color: '#00E676' }
    ]
  });
});

module.exports = router;
