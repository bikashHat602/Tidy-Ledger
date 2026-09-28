// Tiny file-based store for accounts and usage. Good enough to start;
// swap for a real database (Postgres, SQLite) once you have real traffic.
const fs = require("fs");
const path = require("path");
const FILE = path.join(__dirname, "data.json");

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) { return { users: {} }; }
}
function write(db) { fs.writeFileSync(FILE, JSON.stringify(db, null, 2)); }
function today() { return new Date().toISOString().slice(0, 10); }

// Free plan: 50 invoices per calendar month (so someone can process a whole
// month-start batch at once), plus a daily burst cap so one person can't burn
// through the shared AI quota in a single sitting. Both are overridable in .env.
const FREE_MONTHLY = Number(process.env.FREE_MONTHLY_LIMIT || 50);
const FREE_DAILY = Number(process.env.FREE_DAILY_LIMIT || 20);
const PLAN_LIMITS = { free: FREE_MONTHLY, pro: Infinity, business: Infinity };

function getUser(email) {
  const db = read();
  email = String(email || "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (!db.users[email]) db.users[email] = { email, plan: "free", usage: {} };
  write(db);
  return db.users[email];
}
function usageToday(user) { return (user.usage && user.usage[today()]) || 0; }
function usageMonth(user) {
  const prefix = today().slice(0, 7); // YYYY-MM
  return Object.keys(user.usage || {}).reduce((n, day) => (day.startsWith(prefix) ? n + user.usage[day] : n), 0);
}
// How many more invoices this person can process, and what (if anything) is blocking them.
function quota(user) {
  if (user.plan === "pro" || user.plan === "business") return { unlimited: true, left: Infinity, monthLeft: Infinity, dayLeft: Infinity, blockedBy: null };
  const monthLeft = Math.max(0, FREE_MONTHLY - usageMonth(user));
  const dayLeft = Math.max(0, FREE_DAILY - usageToday(user));
  const left = Math.min(monthLeft, dayLeft);
  const blockedBy = left > 0 ? null : monthLeft === 0 ? "month" : "day";
  return { unlimited: false, left, monthLeft, dayLeft, blockedBy };
}
function remaining(user) { return quota(user).left; }
function recordUse(email) {
  const db = read();
  email = String(email).trim().toLowerCase();
  const u = db.users[email];
  if (!u) return;
  u.usage[today()] = (u.usage[today()] || 0) + 1;
  write(db);
}
function setPlan(email, plan) {
  const db = read();
  email = String(email).trim().toLowerCase();
  if (!db.users[email]) db.users[email] = { email, plan: "free", usage: {} };
  db.users[email].plan = plan;
  write(db);
  return db.users[email];
}
// Per-supplier corrections the user chose to remember ("correct once, improve future invoices").
const HINT_FIELDS = ["invoice_no", "supplier", "bill_to", "invoice_date", "due_date", "currency", "subtotal", "tax", "total", "payment_terms"];
const MAX_HINTS = 60;
const clean = (v, n) => String(v == null ? "" : v).replace(/[\r\n]+/g, " ").trim().slice(0, n);
function getHints(email) {
  const u = read().users[String(email || "").trim().toLowerCase()];
  return (u && u.hints) || [];
}
function addHint(email, h) {
  if (!h || !HINT_FIELDS.includes(h.field)) return null;
  const entry = { supplier: clean(h.supplier, 80), field: h.field, wrong: clean(h.wrong, 60), right: clean(h.right, 60), note: clean(h.note, 120), at: today() };
  if (!entry.supplier || !entry.right) return null;
  const db = read();
  const u = db.users[String(email || "").trim().toLowerCase()];
  if (!u) return null;
  u.hints = u.hints || [];
  const same = (x) => x.supplier.toLowerCase() === entry.supplier.toLowerCase() && x.field === entry.field;
  const i = u.hints.findIndex(same);
  if (i >= 0) u.hints[i] = entry; else u.hints.push(entry);
  if (u.hints.length > MAX_HINTS) u.hints = u.hints.slice(-MAX_HINTS);
  write(db);
  return entry;
}
module.exports = { getHints, addHint, getUser, usageToday, usageMonth, quota, remaining, recordUse, setPlan, PLAN_LIMITS, FREE_MONTHLY, FREE_DAILY };
