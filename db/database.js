const { Pool } = require('pg');

let pool = null;

async function getDb() {
  if (pool) return pool;

  if (!process.env.DATABASE_URL) {
    console.error('\n╔═════════════════════════════════════════════════════════════╗');
    console.error('║                      DATABASE ERROR                         ║');
    console.error('╠═════════════════════════════════════════════════════════════╣');
    console.error('║ DATABASE_URL is not set in .env                             ║');
    console.error('║ Please create a Supabase Postgres database and add its URL. ║');
    console.error('║ The application cannot start without a database.            ║');
    console.error('╚═════════════════════════════════════════════════════════════╝\n');
    throw new Error('DATABASE_URL is missing. Check .env');
  }

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 60000,
    connectionTimeoutMillis: 30000
  });

  try {
    const client = await pool.connect();
    client.release();
  } catch (err) {
    console.error(`[DB] Failed to connect to PostgreSQL: ${err.message}`);
    throw err;
  }

  await initSchema();
  return pool;
}

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guests (
      id               SERIAL PRIMARY KEY,
      token            VARCHAR(6)  UNIQUE NOT NULL,
      name             TEXT        NOT NULL,
      wa               VARCHAR(10) NOT NULL,
      aadhar           VARCHAR(12),
      type             VARCHAR(20) NOT NULL,
      type_name        VARCHAR(20) NOT NULL,
      party            INTEGER     NOT NULL DEFAULT 1,
      ages             JSONB       NOT NULL DEFAULT '[]',
      price_per_person INTEGER     NOT NULL,
      price_total      INTEGER     NOT NULL,
      payment_id       TEXT,
      order_id         TEXT,
      scanned          BOOLEAN     NOT NULL DEFAULT false,
      kicked_out       BOOLEAN     NOT NULL DEFAULT false,
      scan_time        TIMESTAMPTZ,
      event_date       DATE        NOT NULL DEFAULT CURRENT_DATE,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query('ALTER TABLE guests ADD COLUMN IF NOT EXISTS kicked_out BOOLEAN NOT NULL DEFAULT false;');
  await pool.query('ALTER TABLE guests ALTER COLUMN aadhar DROP NOT NULL;');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guest_list (
      id            SERIAL PRIMARY KEY,
      name          TEXT        NOT NULL,
      wa            VARCHAR(10) UNIQUE NOT NULL,
      party_allowed INTEGER     NOT NULL DEFAULT 1,
      other_guests  JSONB       NOT NULL DEFAULT '[]',
      status        VARCHAR(20) NOT NULL DEFAULT 'waiting',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query('ALTER TABLE guest_list ADD COLUMN IF NOT EXISTS other_guests JSONB NOT NULL DEFAULT \'[]\';');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id         SERIAL PRIMARY KEY,
      action     VARCHAR(50) NOT NULL,
      details    JSONB,
      role       VARCHAR(20),
      ip         TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_guests_token ON guests(token)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_guests_wa ON guests(wa)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_guests_aadhar ON guests(aadhar)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_guests_eventdate ON guests(event_date)');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_guestlist_wa ON guest_list(wa)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at)');

  const res = await pool.query('SELECT COUNT(*) as c FROM guest_list');
  if (parseInt(res.rows[0].c) === 0) {
    await pool.query(`
      INSERT INTO guest_list (name, wa, party_allowed) VALUES
        ('Arjun Mehta', '9876543210', 2),
        ('Priya Singh', '9123456789', 1),
        ('Rahul Verma', '9988776655', 3)
      ON CONFLICT (wa) DO NOTHING;
    `);
  }
}

// ── Local date helper (avoids UTC vs IST mismatch) ──
function getLocalDateStr() {
  const d = new Date();
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().split('T')[0];
}

// ── Token Generation ──
async function generateToken() {
  const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let tok, attempts = 0;
  do {
    tok = Array.from({ length: 6 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');
    attempts++;
    const res = await pool.query('SELECT COUNT(*) FROM guests WHERE token = $1', [tok]);
    if (parseInt(res.rows[0].count) === 0) return tok;
  } while (attempts < 200);
  throw new Error('Token generation failed');
}

// ── Guest Operations ──
async function createGuest({ name, wa, aadhar, type, typeName, party, ages, pricePerPerson, priceTotal, paymentId, orderId }) {
  const token = await generateToken();
  const eventDate = getLocalDateStr();

  await pool.query(`
    INSERT INTO guests (token, name, wa, aadhar, type, type_name, party, ages, price_per_person, price_total, payment_id, order_id, event_date)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  `, [token, name, wa, aadhar, type, typeName, party, JSON.stringify(ages), pricePerPerson, priceTotal, paymentId || null, orderId || null, eventDate]);

  return getGuestByToken(token);
}

async function getGuestByToken(token) {
  const res = await pool.query('SELECT * FROM guests WHERE token = $1', [token]);
  return res.rows[0] || null;
}

async function findGuestByWa(wa) {
  const today = getLocalDateStr();
  const res = await pool.query('SELECT * FROM guests WHERE wa = $1 AND event_date = $2', [wa, today]);
  return res.rows[0] || null;
}

async function findGuestByAadhar(aadhar) {
  const today = getLocalDateStr();
  const res = await pool.query('SELECT * FROM guests WHERE aadhar = $1 AND event_date = $2', [aadhar, today]);
  return res.rows[0] || null;
}

async function markScanned(token) {
  await pool.query('UPDATE guests SET scanned = true, scan_time = NOW(), updated_at = NOW() WHERE token = $1', [token]);
  return getGuestByToken(token);
}

async function forceCheckIn(token) {
  await pool.query('UPDATE guests SET scanned = true, kicked_out = false, scan_time = NOW(), updated_at = NOW() WHERE token = $1', [token]);
  return getGuestByToken(token);
}

async function kickOutGuest(token) {
  await pool.query('UPDATE guests SET kicked_out = true, updated_at = NOW() WHERE token = $1', [token]);
  return getGuestByToken(token);
}

async function getAllGuests(search) {
  const today = getLocalDateStr();
  if (search) {
    const q = `%${search}%`;
    const res = await pool.query('SELECT * FROM guests WHERE event_date = $1 AND (name ILIKE $2 OR token ILIKE $3 OR wa ILIKE $4) ORDER BY created_at DESC', [today, q, q, q]);
    return res.rows;
  } else {
    const res = await pool.query('SELECT * FROM guests WHERE event_date = $1 ORDER BY created_at DESC', [today]);
    return res.rows;
  }
}

async function getStats() {
  const today = getLocalDateStr();
  
  const [totalRes, scannedRes, vipRes, genRes, glInRes, glWaitRes, bookRes, revRes, waitRes] = await Promise.all([
    pool.query("SELECT COALESCE(SUM(party), 0) as s FROM guests WHERE event_date = $1 AND type != 'guestlist'", [today]),
    pool.query("SELECT COALESCE(SUM(party), 0) as s FROM guests WHERE event_date = $1 AND scanned = true AND kicked_out = false AND type != 'guestlist'", [today]),
    pool.query("SELECT COALESCE(SUM(party), 0) as s FROM guests WHERE event_date = $1 AND type = 'vip'", [today]),
    pool.query("SELECT COALESCE(SUM(party), 0) as s FROM guests WHERE event_date = $1 AND type = 'general'", [today]),
    pool.query("SELECT COALESCE(SUM(party), 0) as s FROM guests WHERE event_date = $1 AND type = 'guestlist'", [today]),
    pool.query("SELECT COALESCE(SUM(party_allowed), 0) as s FROM guest_list WHERE status = 'waiting'", []),
    pool.query('SELECT COUNT(*) as s FROM guests WHERE event_date = $1', [today]),
    pool.query('SELECT COALESCE(SUM(price_total), 0) as s FROM guests WHERE event_date = $1', [today]),
    pool.query("SELECT COALESCE(SUM(party), 0) as s FROM guests WHERE event_date = $1 AND scanned = false AND kicked_out = false AND type != 'guestlist'", [today])
  ]);

  return { 
    totalPeople: parseInt(totalRes.rows[0].s), 
    scannedIn: parseInt(scannedRes.rows[0].s), 
    vip: parseInt(vipRes.rows[0].s), 
    general: parseInt(genRes.rows[0].s), 
    guestlist: parseInt(glInRes.rows[0].s) + parseInt(glWaitRes.rows[0].s), 
    bookings: parseInt(bookRes.rows[0].s), 
    revenue: parseInt(revRes.rows[0].s), 
    waiting: parseInt(waitRes.rows[0].s) 
  };
}

async function getDupCount() {
  const res = await pool.query("SELECT COUNT(*) FROM audit_log WHERE action = 'duplicate_attempt' AND created_at > NOW() - INTERVAL '24 hours'");
  return parseInt(res.rows[0].count);
}

async function logDuplicate(details) {
  await logAction('duplicate_attempt', JSON.stringify({ message: details }), null, null);
}

async function clearTodayGuests() {
  const getLocalYMD = (d) => {
    const tzOffset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tzOffset).toISOString().split('T')[0];
  };
  const today = getLocalYMD(new Date());

  const res = await pool.query('DELETE FROM guests WHERE event_date = $1', [today]);
  await pool.query('DELETE FROM guest_list');
  await pool.query('DELETE FROM audit_log');
  return res.rowCount;
}

// ── Guest List Operations ──
async function getGuestList() {
  const res = await pool.query('SELECT * FROM guest_list ORDER BY created_at DESC');
  return res.rows;
}

async function addToGuestList({ name, wa, partyAllowed, otherGuests }) {
  await pool.query('INSERT INTO guest_list (name, wa, party_allowed, other_guests) VALUES ($1, $2, $3, $4)', 
    [name, wa, partyAllowed, JSON.stringify(otherGuests || [])]);
  const res = await pool.query('SELECT * FROM guest_list WHERE wa = $1', [wa]);
  return res.rows[0];
}

async function removeFromGuestList(id) {
  const gl = await pool.query('SELECT * FROM guest_list WHERE id = $1', [id]);
  const entry = gl.rows[0];
  if (!entry) return { error: 'Not found' };
  if (entry.status === 'checked-in') return { error: 'Cannot remove checked-in guest' };
  await pool.query('DELETE FROM guest_list WHERE id = $1', [id]);
  return { success: true };
}

async function markGuestListArrived(id, autoCreateGuest = false) {
  const gl = await pool.query('SELECT * FROM guest_list WHERE id = $1', [id]);
  const entry = gl.rows[0];
  if (!entry) return null;

  await pool.query("UPDATE guest_list SET status = 'checked-in', updated_at = NOW() WHERE id = $1", [id]);

  if (autoCreateGuest) {
    const today = getLocalDateStr();
    const existing = await pool.query('SELECT id FROM guests WHERE wa = $1 AND event_date = $2', [entry.wa, today]);
    
    if (existing.rowCount === 0) {
      const token = await generateToken();
      // Format guest names for the 'ages' JSONB field (matches check-in format)
      const partyDetails = [{ name: entry.name, age: '21' }]; // Default age if not known
      if (Array.isArray(entry.other_guests)) {
        entry.other_guests.forEach(n => partyDetails.push({ name: n, age: '21' }));
      }

      await pool.query(`
        INSERT INTO guests (token, name, wa, aadhar, type, type_name, party, ages, price_per_person, price_total, scanned, scan_time, event_date)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, NOW(), $11)
      `, [token, entry.name, entry.wa, '', 'guestlist', 'Guest List', entry.party_allowed, JSON.stringify(partyDetails), 0, 0, today]);
    } else {
      await pool.query('UPDATE guests SET scanned = true, scan_time = NOW() WHERE wa = $1 AND event_date = $2', [entry.wa, today]);
    }
  }

  const res = await pool.query('SELECT * FROM guest_list WHERE id = $1', [id]);
  return res.rows[0];
}

async function verifyGuestList(wa, name) {
  const res = await pool.query('SELECT * FROM guest_list WHERE wa = $1 AND LOWER(name) = LOWER($2)', [wa, name]);
  return res.rows[0] || null;
}

async function getGuestListStats() {
  const [totalRes, checkRes, partyRes] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM guest_list'),
    pool.query("SELECT COUNT(*) FROM guest_list WHERE status = 'checked-in'"),
    pool.query('SELECT COALESCE(SUM(party_allowed), 0) as s FROM guest_list')
  ]);
  return { 
    total: parseInt(totalRes.rows[0].count), 
    checkedIn: parseInt(checkRes.rows[0].count),
    totalPeople: parseInt(partyRes.rows[0].s)
  };
}

async function clearGuestList() {
  const res = await pool.query('DELETE FROM guest_list');
  return res.rowCount;
}

// ── Audit ──
async function logAction(action, details, role, ip) {
  await pool.query('INSERT INTO audit_log (action, details, role, ip) VALUES ($1, $2, $3, $4)',
    [action, JSON.stringify(details) || null, role || null, ip || null]);
}

module.exports = {
  getDb,
  generateToken,
  createGuest,
  getGuestByToken,
  findGuestByWa,
  findGuestByAadhar,
  markScanned,
  forceCheckIn,
  kickOutGuest,
  getAllGuests,
  getStats,
  getDupCount,
  logDuplicate,
  clearTodayGuests,
  getGuestList,
  addToGuestList,
  removeFromGuestList,
  markGuestListArrived,
  verifyGuestList,
  getGuestListStats,
  clearGuestList,
  logAction
};
