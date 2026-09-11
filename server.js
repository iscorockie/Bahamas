/**
 * Bahamas Café · Restaurant · Lounge — Backend API
 * Node.js + Express + built-in SQLite (node:sqlite, Node >= 22.5)
 *
 * Serves the static front-end (index.html) and exposes a JSON API:
 *   GET  /api/health
 *   GET  /api/menu?category=grill|chicken|quick|drinks
 *   POST /api/orders
 *   GET  /api/orders          (admin, ?key=ADMIN_KEY)
 *   PATCH /api/orders/:ref    (admin, {status})
 *   POST /api/reservations
 *   GET  /api/reservations    (admin)
 *   PATCH /api/reservations/:ref (admin, {status})
 *   POST /api/contact
 *   POST /api/newsletter
 *   GET  /api/stats           (admin)
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'bahamas-admin-2026';
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'bahamas.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------------------------------------------------------------- DB setup
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS menu_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price INTEGER NOT NULL,
  description TEXT DEFAULT '',
  image TEXT DEFAULT '',
  badge TEXT DEFAULT '',
  popular INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_address TEXT DEFAULT '',
  order_type TEXT DEFAULT 'delivery',
  notes TEXT DEFAULT '',
  subtotal INTEGER NOT NULL,
  delivery_fee INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  qty INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT DEFAULT '',
  mobile TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  persons TEXT NOT NULL,
  notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  message TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS newsletter (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// ---------------------------------------------------------------- Seed menu
function withTransaction(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_e) { /* noop */ }
    throw e;
  }
}

function seedMenu(force = false) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM menu_items').get().c;
  if (count > 0 && !force) return { seeded: false, count };
  const menuPath = path.join(DATA_DIR, 'menu.json');
  if (!fs.existsSync(menuPath)) return { seeded: false, count, error: 'menu.json missing' };
  const items = JSON.parse(fs.readFileSync(menuPath, 'utf8'));
  const insert = db.prepare(
    'INSERT OR REPLACE INTO menu_items (id, name, category, price, description, image, badge, popular) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  withTransaction(() => {
    for (const it of items) {
      insert.run(it.id, it.name, it.category, it.price, it.description || '', it.image || '', it.badge || '', it.popular ? 1 : 0);
    }
  });
  return { seeded: true, count: items.length };
}

const seedResult = seedResultSafe();
function seedResultSafe() {
  try {
    return seedMenu(process.argv.includes('--seed'));
  } catch (e) {
    console.error('Menu seed failed:', e.message);
    return { seeded: false, error: e.message };
  }
}

// ---------------------------------------------------------------- Helpers
const CATEGORIES = ['grill', 'chicken', 'quick', 'drinks'];
const ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled'];
const RES_STATUSES = ['pending', 'confirmed', 'seated', 'completed', 'cancelled'];

function makeRef(prefix) {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${ymd}-${rand}`;
}

function isValidPhone(p) {
  return /^[+\d][\d\s\-()]{6,18}$/.test(String(p || '').trim());
}
function isValidEmail(e) {
  if (!e) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e).trim());
}
function isFutureOrToday(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T00:00:00');
  return d >= today;
}

function adminAuth(req, res, next) {
  const key = req.query.key || req.headers['x-admin-key'];
  if (key !== ADMIN_KEY) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  next();
}

// Simple in-memory rate limiter (per IP, per route group)
const hits = new Map();
function rateLimit({ windowMs = 60000, max = 60 } = {}) {
  return (req, res, next) => {
    const k = `${req.ip}:${req.baseUrl}${req.path}`;
    const now = Date.now();
    const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
    arr.push(now);
    hits.set(k, arr);
    if (arr.length > max) return res.status(429).json({ ok: false, error: 'Too many requests, slow down.' });
    next();
  };
}

// ---------------------------------------------------------------- App
const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true }));

// Request log (tiny)
app.use((req, _res, next) => {
  if (req.path.startsWith('/api/')) console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// ---------------- API ----------------
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'bahamas-api', time: new Date().toISOString(), menu: seedResult });
});

app.get('/api/menu', (req, res) => {
  const { category } = req.query;
  try {
    let rows;
    if (category && CATEGORIES.includes(String(category))) {
      rows = db.prepare('SELECT * FROM menu_items WHERE category = ? ORDER BY popular DESC, name ASC').all(category);
    } else {
      rows = db.prepare('SELECT * FROM menu_items ORDER BY CASE category WHEN ? THEN 0 WHEN ? THEN 1 WHEN ? THEN 2 ELSE 3 END, popular DESC, name ASC').all('grill', 'chicken', 'quick');
    }
    res.json({ ok: true, count: rows.length, items: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Failed to load menu' });
  }
});

app.get('/api/menu/categories', (_req, res) => {
  const rows = db.prepare('SELECT category, COUNT(*) AS count FROM menu_items GROUP BY category').all();
  res.json({ ok: true, categories: rows });
});

// ---- Orders ----
app.post('/api/orders', rateLimit({ windowMs: 60000, max: 20 }), (req, res) => {
  const { customer = {}, items = [], orderType = 'delivery', notes = '' } = req.body || {};
  const name = String(customer.name || '').trim();
  const phone = String(customer.phone || '').trim();
  const address = String(customer.address || '').trim();

  if (!name || name.length < 2) return res.status(400).json({ ok: false, error: 'Please provide your name.' });
  if (!isValidPhone(phone)) return res.status(400).json({ ok: false, error: 'Please provide a valid phone number.' });
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ ok: false, error: 'Your order is empty.' });
  if (items.length > 50) return res.status(400).json({ ok: false, error: 'Too many line items.' });
  if (!['delivery', 'pickup', 'dine-in'].includes(orderType)) return res.status(400).json({ ok: false, error: 'Invalid order type.' });

  // Resolve prices server-side (never trust client totals)
  const getItem = db.prepare('SELECT * FROM menu_items WHERE id = ?');
  const lines = [];
  let subtotal = 0;
  for (const li of items) {
    const qty = Math.floor(Number(li.qty));
    if (!li.id || !qty || qty < 1 || qty > 20) return res.status(400).json({ ok: false, error: 'Invalid item quantity.' });
    const row = getItem.get(String(li.id));
    if (!row) return res.status(400).json({ ok: false, error: `Unknown menu item: ${li.id}` });
    lines.push({ item_id: row.id, name: row.name, price: row.price, qty });
    subtotal += row.price * qty;
  }

  const deliveryFee = orderType === 'delivery' ? (subtotal >= 60000 ? 0 : 5000) : 0;
  const total = subtotal + deliveryFee;
  const reference = makeRef('BHM');

  try {
    const insertOrder = db.prepare(
      'INSERT INTO orders (reference, customer_name, customer_phone, customer_address, order_type, notes, subtotal, delivery_fee, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insertLine = db.prepare('INSERT INTO order_items (order_id, item_id, name, price, qty) VALUES (?, ?, ?, ?, ?)');
    withTransaction(() => {
      const r = insertOrder.run(reference, name, phone, address, orderType, String(notes || '').slice(0, 500), subtotal, deliveryFee, total);
      for (const l of lines) insertLine.run(Number(r.lastInsertRowid), l.item_id, l.name, l.price, l.qty);
    });
    res.status(201).json({ ok: true, reference, subtotal, deliveryFee, total, orderType, itemCount: lines.reduce((a, l) => a + l.qty, 0) });
  } catch (e) {
    console.error('Order insert failed:', e.message);
    res.status(500).json({ ok: false, error: 'Could not place order. Try again.' });
  }
});

app.get('/api/orders', adminAuth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
  const status = req.query.status;
  let orders;
  if (status && ORDER_STATUSES.includes(status)) {
    orders = db.prepare('SELECT * FROM orders WHERE status = ? ORDER BY id DESC LIMIT ?').all(status, limit);
  } else {
    orders = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT ?').all(limit);
  }
  const getLines = db.prepare('SELECT item_id, name, price, qty FROM order_items WHERE order_id = ?');
  const withLines = orders.map((o) => ({ ...o, lines: getLines.all(o.id) }));
  res.json({ ok: true, count: withLines.length, orders: withLines });
});

app.get('/api/orders/:ref', (req, res) => {
  const o = db.prepare('SELECT reference, status, total, order_type, created_at FROM orders WHERE reference = ?').get(req.params.ref);
  if (!o) return res.status(404).json({ ok: false, error: 'Order not found' });
  res.json({ ok: true, order: o });
});

app.patch('/api/orders/:ref', adminAuth, (req, res) => {
  const { status } = req.body || {};
  if (!ORDER_STATUSES.includes(status)) return res.status(400).json({ ok: false, error: 'Invalid status' });
  const r = db.prepare('UPDATE orders SET status = ? WHERE reference = ?').run(status, req.params.ref);
  if (r.changes === 0) return res.status(404).json({ ok: false, error: 'Order not found' });
  res.json({ ok: true, reference: req.params.ref, status });
});

// ---- Reservations ----
app.post('/api/reservations', rateLimit({ windowMs: 60000, max: 15 }), (req, res) => {
  const { name = '', email = '', mobile = '', date = '', time = '', persons = '', notes = '' } = req.body || {};
  if (String(name).trim().length < 2) return res.status(400).json({ ok: false, error: 'Please provide your name.' });
  if (!isValidEmail(email)) return res.status(400).json({ ok: false, error: 'Invalid email address.' });
  if (!isValidPhone(mobile)) return res.status(400).json({ ok: false, error: 'Please provide a valid mobile number.' });
  if (!isFutureOrToday(date)) return res.status(400).json({ ok: false, error: 'Please choose a valid date (today or later).' });
  if (!String(time).trim()) return res.status(400).json({ ok: false, error: 'Please choose a time.' });
  if (!String(persons).trim()) return res.status(400).json({ ok: false, error: 'Please choose number of persons.' });

  // Prevent exact duplicate
  const dup = db.prepare('SELECT reference FROM reservations WHERE mobile = ? AND date = ? AND time = ?').get(String(mobile).trim(), date, String(time).trim());
  if (dup) return res.status(409).json({ ok: false, error: 'You already have a reservation at this date & time.', reference: dup.reference });

  const reference = makeRef('RSV');
  try {
    db.prepare(
      'INSERT INTO reservations (reference, name, email, mobile, date, time, persons, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      reference,
      String(name).trim(),
      String(email || '').trim(),
      String(mobile).trim(),
      date,
      String(time).trim(),
      String(persons).trim(),
      String(notes || '').slice(0, 500)
    );
    res.status(201).json({ ok: true, reference, message: 'Table reserved! We will call to confirm.' });
  } catch (e) {
    console.error('Reservation insert failed:', e.message);
    res.status(500).json({ ok: false, error: 'Could not save reservation. Try again.' });
  }
});

app.get('/api/reservations', adminAuth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10) || 100, 300);
  const rows = db.prepare('SELECT * FROM reservations ORDER BY date ASC, time ASC LIMIT ?').all(limit);
  res.json({ ok: true, count: rows.length, reservations: rows });
});

app.patch('/api/reservations/:ref', adminAuth, (req, res) => {
  const { status } = req.body || {};
  if (!RES_STATUSES.includes(status)) return res.status(400).json({ ok: false, error: 'Invalid status' });
  const r = db.prepare('UPDATE reservations SET status = ? WHERE reference = ?').run(status, req.params.ref);
  if (r.changes === 0) return res.status(404).json({ ok: false, error: 'Reservation not found' });
  res.json({ ok: true, reference: req.params.ref, status });
});

// ---- Contact & newsletter ----
app.post('/api/contact', rateLimit({ windowMs: 60000, max: 10 }), (req, res) => {
  const { name = '', email = '', phone = '', message = '' } = req.body || {};
  if (String(name).trim().length < 2) return res.status(400).json({ ok: false, error: 'Please provide your name.' });
  if (String(message).trim().length < 5) return res.status(400).json({ ok: false, error: 'Please write a message.' });
  if (email && !isValidEmail(email)) return res.status(400).json({ ok: false, error: 'Invalid email.' });
  db.prepare('INSERT INTO messages (name, email, phone, message) VALUES (?, ?, ?, ?)').run(
    String(name).trim(), String(email || '').trim(), String(phone || '').trim(), String(message).trim().slice(0, 2000)
  );
  res.status(201).json({ ok: true, message: 'Thanks! We will get back to you shortly.' });
});

app.post('/api/newsletter', rateLimit({ windowMs: 60000, max: 10 }), (req, res) => {
  const { email = '' } = req.body || {};
  if (!isValidEmail(email) || !email) return res.status(400).json({ ok: false, error: 'Enter a valid email.' });
  try {
    db.prepare('INSERT INTO newsletter (email) VALUES (?)').run(String(email).trim().toLowerCase());
    res.status(201).json({ ok: true, message: 'Subscribed! Karibu Bahamas.' });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.json({ ok: true, message: 'You are already subscribed.' });
    res.status(500).json({ ok: false, error: 'Could not subscribe.' });
  }
});

app.get('/api/stats', adminAuth, (_req, res) => {
  const orders = db.prepare("SELECT status, COUNT(*) c, COALESCE(SUM(total),0) t FROM orders GROUP BY status").all();
  const resv = db.prepare('SELECT status, COUNT(*) c FROM reservations GROUP BY status').all();
  const revenue = db.prepare("SELECT COALESCE(SUM(total),0) AS total FROM orders WHERE status != 'cancelled'").get();
  const todayOrders = db.prepare("SELECT COUNT(*) AS c FROM orders WHERE date(created_at) = date('now')").get();
  res.json({ ok: true, orders, reservations: resv, revenue: revenue.total, todayOrders: todayOrders.c });
});

// ---------------- Static front-end ----------------
app.use(express.static(path.join(__dirname), { extensions: ['html'], maxAge: '1h' }));

// SPA-ish fallback for known pages
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

app.use('/api', (_req, res) => res.status(404).json({ ok: false, error: 'Unknown API endpoint' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('Server error:', err.message);
  res.status(500).json({ ok: false, error: 'Internal server error' });
});

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  🍽️  Bahamas Café API + site running`);
    console.log(`  → http://localhost:${PORT}`);
    console.log(`  → Admin: http://localhost:${PORT}/admin.html (key: ${ADMIN_KEY.slice(0, 4)}****)`);
    console.log(`  → DB: ${DB_PATH}\n`);
  });
}

module.exports = app;
