const express = require('express');
const db = require('../db/database');
const { verifyToken, requireRole } = require('../middleware/auth');
const jwt = require('jsonwebtoken');

const router = express.Router();

/**
 * GET /api/guestlist
 * Admin — get all guest list entries
 */
router.get('/', verifyToken, requireRole('admin'), async (req, res) => {
  const list = await db.getGuestList();
  const stats = await db.getGuestListStats();
  res.json({ list, ...stats });
});

/**
 * POST /api/guestlist
 * Admin — add to guest list
 */
router.post('/', verifyToken, requireRole('admin'), async (req, res) => {
  const { name, wa, partyAllowed } = req.body;
  const maxParty = parseInt(process.env.MAX_PARTY_SIZE) || 5;

  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required.' });
  if (!wa || wa.length !== 10) return res.status(400).json({ error: 'Valid 10-digit WhatsApp number required.' });

  const ps = parseInt(partyAllowed) || 1;
  if (ps < 1 || ps > maxParty) return res.status(400).json({ error: `Party size must be 1–${maxParty}.` });

  // Check for duplicates
  const gl = await db.getGuestList();
  const existing = gl.find(g => g.wa === wa);
  if (existing) return res.status(400).json({ error: 'This number is already on the list.' });

  try {
    const entry = await db.addToGuestList({ name: name.trim(), wa, partyAllowed: ps });
    await db.logAction('guestlist_add', `${name} (${wa})`, req.user.role, req.ip);
    res.json({ success: true, entry });
  } catch (e) {
    if (e.message.includes('UNIQUE') || e.message.includes('duplicate key')) return res.status(400).json({ error: 'This number is already on the list.' });
    throw e;
  }
});

/**
 * POST /api/guestlist/verify
 * Public — verify name + wa match at check-in
 * NOTE: Must be BEFORE /:id wildcard routes
 */
router.post('/verify', async (req, res) => {
  const { wa, name } = req.body;
  if (!wa || !name) return res.status(400).json({ error: 'Enter both WhatsApp and name.' });

  const entry = await db.verifyGuestList(wa, name.trim());
  if (!entry) return res.status(404).json({ error: 'No match — check exact name and number.' });
  if (entry.status === 'checked-in') return res.status(400).json({ error: 'This guest already checked in.' });

  res.json({ success: true, entry });
});

/**
 * GET /api/guestlist/export
 * Admin — CSV download
 * NOTE: Must be BEFORE /:id wildcard routes
 */
router.get('/export', async (req, res) => {
  // Accept token from query param for window.open
  try {
    const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'voidclub_fallback_secret');
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
  } catch (e) { return res.status(401).json({ error: 'Unauthorized' }); }

  const list = await db.getGuestList();
  const rows = [['Name', 'WhatsApp', 'Party Allowed', 'Status']];

  for (const g of list) {
    rows.push([
      g.name,
      '••••••' + g.wa.slice(-4),
      g.party_allowed,
      g.status
    ]);
  }

  const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=guestlist-${process.env.CLUB_NAME || 'VOIDCLUB'}.csv`);
  res.send(csv);
});

/**
 * DELETE /api/guestlist/:id
 * Admin — remove from guest list
 * NOTE: Wildcard — must be AFTER all named routes
 */
router.delete('/:id', verifyToken, requireRole('admin'), async (req, res) => {
  const result = await db.removeFromGuestList(parseInt(req.params.id));
  if (result.error) return res.status(400).json(result);
  await db.logAction('guestlist_remove', `ID ${req.params.id}`, req.user.role, req.ip);
  res.json(result);
});

/**
 * POST /api/guestlist/:id/arrive
 * Admin — mark as arrived
 * NOTE: Wildcard — must be AFTER all named routes
 */
router.post('/:id/arrive', verifyToken, requireRole('admin'), async (req, res) => {
  const entry = await db.markGuestListArrived(parseInt(req.params.id));
  if (!entry) return res.status(404).json({ error: 'Not found' });
  await db.logAction('guestlist_arrive', `${entry.name}`, req.user.role, req.ip);
  res.json({ success: true, entry });
});

module.exports = router;
