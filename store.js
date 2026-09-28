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
module.exports = { getUser, usageToday, usageMonth, quota, remaining, recordUse, setPlan, PLAN_LIMITS, FREE_MONTHLY, FREE_DAILY };
