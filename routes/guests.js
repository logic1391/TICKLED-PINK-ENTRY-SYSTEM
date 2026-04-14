const express = require('express');
const db = require('../db/database');
const { verifyToken, requireRole } = require('../middleware/auth');
const whatsapp = require('../services/whatsapp');
const jwt = require('jsonwebtoken');

const router = express.Router();

/**
 * POST /api/guests/checkin
 * Public — creates a guest record after payment verification
 */
router.post('/checkin', async (req, res) => {
  try {
    const { name, wa, aadhar, type, typeName, party, ages, pricePerPerson, priceTotal, paymentId, orderId } = req.body;

    if (!name || !name.trim()) return res.status(400).json({ error: 'Enter your full name.' });
    if (!wa || wa.length !== 10) return res.status(400).json({ error: 'Enter a valid 10-digit WhatsApp number.' });
    if (!aadhar || !/^[2-9]\d{11}$/.test(aadhar)) return res.status(400).json({ error: 'Invalid Aadhaar — 12 digits, first digit 2-9.' });
    if (!type || !typeName) return res.status(400).json({ error: 'Select a ticket type.' });

    const sz = parseInt(party) || 1;
    const maxParty = parseInt(process.env.MAX_PARTY_SIZE) || 5;
    if (sz < 1 || sz > maxParty) return res.status(400).json({ error: `Party size must be 1–${maxParty}.` });

    const guestList = Array.isArray(ages) ? ages : [];
    if (guestList.length !== sz) return res.status(400).json({ error: 'Guest details do not match party size.' });
    for (let i = 0; i < sz; i++) {
      const { name: pName, age } = guestList[i];
      if (i > 0 && (!pName || !pName.trim())) return res.status(400).json({ error: `Enter full name for person ${i + 1}.` });
      
      const v = parseInt(age);
      if (!Number.isInteger(v) || v < 1) return res.status(400).json({ error: `Enter a valid age for person ${i + 1}.` });
      if (v < 18) return res.status(400).json({ error: `Person ${i + 1} must be 18+. Entire group denied.` });
      if (v > 99) return res.status(400).json({ error: `Age cannot exceed 99 for person ${i + 1}.` });
    }

    const stats = await db.getStats();
    const maxCap = parseInt(process.env.MAX_CAPACITY) || 300;
    if (stats.totalPeople + sz > maxCap) {
      return res.status(400).json({ error: `Venue at capacity — cannot add ${sz} more.` });
    }

    const foundWa = await db.findGuestByWa(wa);
    if (foundWa) {
      await db.logDuplicate(`Duplicate WA: ${wa}`);
      return res.status(400).json({ error: 'This WhatsApp is already checked in.' });
    }
    const foundAadhar = await db.findGuestByAadhar(aadhar);
    if (foundAadhar) {
      await db.logDuplicate(`Duplicate Aadhaar: ${aadhar.slice(-4)}`);
      return res.status(400).json({ error: 'This Aadhaar is already checked in.' });
    }

    if (type === 'guestlist') {
      const glEntry = await db.verifyGuestList(wa, name);
      if (!glEntry) return res.status(400).json({ error: 'Not on the guest list.' });
      if (glEntry.status === 'checked-in') return res.status(400).json({ error: 'Guest list entry already used.' });
      if (sz > glEntry.party_allowed) return res.status(400).json({ error: `Party of ${sz} exceeds allowed ${glEntry.party_allowed}.` });
      await db.markGuestListArrived(glEntry.id);
    }

    const guest = await db.createGuest({
      name: name.trim(), wa, aadhar, type, typeName, party: sz,
      ages: guestList,
      pricePerPerson: parseInt(pricePerPerson) || 0,
      priceTotal: parseInt(priceTotal) || 0,
      paymentId: paymentId || null,
      orderId: orderId || null
    });

    await db.logAction('checkin', `${name} (${typeName}, ${sz} pax, ₹${priceTotal})`, null, req.ip);
    const waResult = await whatsapp.sendEntryPass(guest);

    res.json({
      success: true, guest,
      waStatus: waResult.mock ? 'mock' : waResult.success ? 'sent' : 'failed'
    });
  } catch (e) {
    console.error('[CHECKIN]', e);
    res.status(500).json({ error: 'Server error during check-in.' });
  }
});

/**
 * GET /api/guests/stats
 * Admin — dashboard statistics
 * NOTE: Must be before /:token routes
 */
router.get('/stats', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const stats = await db.getStats();
    stats.dupCount = await db.getDupCount();
    stats.maxCapacity = parseInt(process.env.MAX_CAPACITY) || 300;
    res.json(stats);
  } catch (e) {
    console.error('[STATS]', e);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

/**
 * GET /api/guests
 * Admin — all guest records with optional search
 * NOTE: Must be before /:token routes
 */
router.get('/', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const search = req.query.q || '';
    const guests = await db.getAllGuests(search);
    res.json(guests);
  } catch (e) {
    console.error('[GUESTS]', e);
    res.status(500).json({ error: 'Failed to fetch guests' });
  }
});

/**
 * GET /api/guests/export
 * Admin — CSV download (force download via Content-Disposition)
 * NOTE: Must be before /:token routes
 */
router.get('/export', async (req, res) => {
  try {
    const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No token provided' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'voidclub_fallback_secret');
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
  } catch (e) {
    return res.status(401).json({ error: 'Unauthorized or session expired' });
  }

  try {
    const guests = await db.getAllGuests();
    const clubName = (process.env.CLUB_NAME || 'VOIDCLUB').replace(/\s+/g, '_');
    const dateStr = new Date().toISOString().split('T')[0];

    const rows = [['Token', 'Name', 'WhatsApp', 'Aadhaar', 'Type', 'Party', 'Price/Person', 'Total Paid', 'Check-In Time', 'Status', 'Kicked Out']];

    for (const g of guests) {
      rows.push([
        g.token,
        g.name,
        '••••••' + g.wa.slice(-4),
        g.aadhar.length === 12 ? 'XXXX XXXX ' + g.aadhar.slice(-4) : '—',
        g.type_name,
        g.party,
        g.price_per_person,
        g.price_total,
        new Date(g.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
        g.kicked_out ? 'Kicked Out' : (g.scanned ? 'Entered' : 'Waiting'),
        g.kicked_out ? 'YES' : 'NO'
      ]);
    }

    const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    const filename = `checkins-${clubName}-${dateStr}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');
    res.send('\uFEFF' + csv); // BOM for Excel compatibility
  } catch (e) {
    console.error('[EXPORT]', e);
    res.status(500).json({ error: 'Export failed' });
  }
});

/**
 * DELETE /api/guests/clear
 * Admin — clear tonight's check-in data
 * NOTE: Must be before /:token routes
 */
router.delete('/clear', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const deleted = await db.clearTodayGuests();
    await db.logAction('clear_event', `Cleared ${deleted} records`, req.user.role, req.ip);
    res.json({ success: true, deleted });
  } catch (e) {
    console.error('[CLEAR]', e);
    res.status(500).json({ error: 'Failed to clear event data' });
  }
});

/**
 * GET /api/guests/verify/:token
 * Bouncer — look up token without marking scanned
 */
router.get('/verify/:token', verifyToken, requireRole('admin', 'bouncer'), async (req, res) => {
  try {
    const guest = await db.getGuestByToken(req.params.token.toUpperCase());
    if (!guest) return res.status(404).json({ error: 'Token not found' });
    res.json({ guest });
  } catch (e) {
    res.status(500).json({ error: 'Lookup failed' });
  }
});

/**
 * POST /api/guests/scan/:token
 * Bouncer — mark token as scanned (entry)
 */
router.post('/scan/:token', verifyToken, requireRole('admin', 'bouncer'), async (req, res) => {
  const token = req.params.token.toUpperCase();
  const reentry = req.body.reentry === true;

  const devMode = process.env.DEV_MODE === 'true';
  if (!devMode && !inWindow()) {
    return res.status(400).json({ error: 'closed', message: `Entry window: ${process.env.DOORS_OPEN}–${process.env.DOORS_CLOSE}` });
  }

  const guest = await db.getGuestByToken(token);
  if (!guest) return res.status(404).json({ error: 'invalid', message: 'Token not found in system' });

  if (guest.kicked_out) {
    return res.status(403).json({ error: 'banned', message: `BANNED: This guest was kicked out and is not allowed entry.` });
  }

  const getLocalYMD = (d) => {
    const tzOffset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tzOffset).toISOString().split('T')[0];
  };

  const guestDateStr = guest.event_date && typeof guest.event_date === 'object'
    ? getLocalYMD(guest.event_date)
    : guest.event_date;
  const todayStr = getLocalYMD(new Date());

  if (guestDateStr !== todayStr) {
    return res.status(400).json({ error: 'expired', message: `Pass from a different date. Tonight's passes only.` });
  }

  if (guest.scanned) {
    if (reentry) {
      await db.logAction('reentry', `${guest.name} (${token})`, req.user.role, req.ip);
      return res.json({ status: 'reentry', guest });
    }
    return res.status(400).json({ error: 'duplicate', message: `${guest.name} — already scanned`, guest });
  }

  const updated = await db.markScanned(token);
  await db.logAction('scan', `${guest.name} (${token})`, req.user.role, req.ip);
  res.json({ status: 'ok', guest: updated });
});

/**
 * POST /api/guests/resend/:token
 * Public — resend WhatsApp pass
 */
router.post('/resend/:token', async (req, res) => {
  try {
    const guest = await db.getGuestByToken(req.params.token.toUpperCase());
    if (!guest) return res.status(404).json({ error: 'Token not found' });
    const result = await whatsapp.resendEntryPass(guest);
    if (result && (result.success || result.mock)) {
      return res.json({ success: true, wa: guest.wa, ...result });
    } else {
      return res.status(500).json({ error: 'Failed to send' });
    }
  } catch (e) {
    res.status(500).json({ error: 'Resend failed' });
  }
});

/**
 * POST /api/guests/:token/force-entry
 * Admin — bypass scanner, mark as entered manually
 * NOTE: Wildcard — must be AFTER all named routes
 */
router.post('/:token/force-entry', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const token = req.params.token.toUpperCase();
    const guest = await db.getGuestByToken(token);
    if (!guest) return res.status(404).json({ error: 'Token not found' });
    const updated = await db.forceCheckIn(token);
    await db.logAction('force_entry', `Manual let-in: ${guest.name} (${token})`, req.user.role, req.ip);
    res.json({ success: true, guest: updated });
  } catch (e) {
    console.error('[FORCE-ENTRY]', e);
    res.status(500).json({ error: 'Failed to force entry', details: e.message });
  }
});

/**
 * POST /api/guests/:token/kick-out
 * Admin — kick a guest out and ban re-entry
 * NOTE: Wildcard — must be AFTER all named routes
 */
router.post('/:token/kick-out', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const token = req.params.token.toUpperCase();
    const reason = req.body.reason || 'No reason provided';
    const guest = await db.getGuestByToken(token);
    if (!guest) return res.status(404).json({ error: 'Token not found' });
    const updated = await db.kickOutGuest(token);
    await db.logAction('kicked_out', `Kicked out: ${guest.name} (${token}). Reason: ${reason}`, req.user.role, req.ip);
    res.json({ success: true, guest: updated });
  } catch (e) {
    console.error('[KICK-OUT]', e);
    res.status(500).json({ error: 'Failed to kick out', details: e.message });
  }
});

// ── Helper: check entry window ──
function inWindow() {
  const now = new Date();
  const [oh, om] = (process.env.DOORS_OPEN || '21:00').split(':').map(Number);
  const [ch, cm] = (process.env.DOORS_CLOSE || '03:00').split(':').map(Number);
  const nowM = now.getHours() * 60 + now.getMinutes();
  const openM = oh * 60 + om;
  let closeM = ch * 60 + cm;
  if (closeM < openM) closeM += 1440;
  const adjNow = nowM < openM ? nowM + 1440 : nowM;
  return adjNow >= openM && adjNow <= closeM;
}

module.exports = router;
