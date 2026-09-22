// Tiny file-based store for accounts and daily usage. Good enough to start;
// swap for a real database (Postgres, SQLite) once you have real traffic.
const fs = require("fs");
const path = require("path");
const FILE = path.join(__dirname, "data.json");

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) { return { users: {} }; }
}
function write(db) { fs.writeFileSync(FILE, JSON.stringify(db, null, 2)); }
function today() { return new Date().toISOString().slice(0, 10); }

const PLAN_LIMITS = { free: 5, pro: Infinity, business: Infinity };

function getUser(email) {
  const db = read();
  email = String(email || "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (!db.users[email]) db.users[email] = { email, plan: "free", usage: {} };
  write(db);
  return db.users[email];
}
function usageToday(user) { return (user.usage && user.usage[today()]) || 0; }
function remaining(user) {
  const limit = PLAN_LIMITS[user.plan] || PLAN_LIMITS.free;
  return limit === Infinity ? Infinity : Math.max(0, limit - usageToday(user));
}
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
module.exports = { getUser, usageToday, remaining, recordUse, setPlan, PLAN_LIMITS };
