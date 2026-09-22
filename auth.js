// Lightweight passwordless auth. No external auth service required.
// A "login token" (15 min) is emailed as a magic link. Clicking it sets a
// signed "session" cookie (30 days) that identifies the user from then on.
// Swap this for Clerk/Auth0 later if you want more (social login, 2FA, etc).
const crypto = require("crypto");

const SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";
if (!process.env.SESSION_SECRET) {
  console.warn("WARNING: SESSION_SECRET is not set in .env. Using a fixed dev value; set a real random secret before going live.");
}

function sign(payloadObj) {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  return payload + "." + sig;
}
function verify(token) {
  if (!token || typeof token !== "string" || token.indexOf(".") === -1) return null;
  const [payload, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  // constant-time compare
  const a = Buffer.from(sig || "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const obj = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (obj.exp && Date.now() > obj.exp) return null;
    return obj;
  } catch (e) { return null; }
}

function makeLoginToken(email) {
  return sign({ email, purpose: "login", exp: Date.now() + 15 * 60 * 1000 });
}
function readLoginToken(token) {
  const obj = verify(token);
  if (!obj || obj.purpose !== "login") return null;
  return obj.email;
}
function makeSessionToken(email) {
  return sign({ email, purpose: "session", exp: Date.now() + 30 * 24 * 60 * 60 * 1000 });
}
function readSessionToken(token) {
  const obj = verify(token);
  if (!obj || obj.purpose !== "session") return null;
  return obj.email;
}

const COOKIE = "tl_session";
function setSessionCookie(res, email) {
  res.cookie(COOKIE, makeSessionToken(email), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}
function clearSessionCookie(res) { res.clearCookie(COOKIE); }
function currentEmail(req) { return readSessionToken(req.cookies && req.cookies[COOKIE]); }

module.exports = { makeLoginToken, readLoginToken, setSessionCookie, clearSessionCookie, currentEmail, COOKIE };
