require("dotenv").config();
const path = require("path");
const express = require("express");
const multer = require("multer");
const Anthropic = require("@anthropic-ai/sdk");
const providers = require("./providers");
const store = require("./store");
const auth = require("./auth");
const mailer = require("./mailer");
const cookieParser = require("cookie-parser");

const PORT = process.env.PORT || 3000;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const MOCK = process.env.MOCK === "1" || process.argv.includes("--demo"); // demo mode: no API key needed, returns fake data
const MAX_MB = 10;

// Prefer Gemini: it has a genuinely free tier, no card required. Anthropic is
// used only if no Gemini key is set. Either can be swapped any time in .env.
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const anthropicClient = !MOCK && !GEMINI_KEY && process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
const PROVIDER = MOCK ? "mock" : GEMINI_KEY ? "gemini" : anthropicClient ? "anthropic" : "none";

// Stripe is optional. Without keys, upgrade requests get a clear error instead of crashing.
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  try { stripe = require("stripe")(process.env.STRIPE_SECRET_KEY); } catch (e) { console.warn("Run npm install to enable Stripe."); }
}
const PRICE_IDS = { pro: process.env.STRIPE_PRICE_PRO || "", business: process.env.STRIPE_PRICE_BUSINESS || "" };

const app = express();
app.set("trust proxy", 1);

// Files are kept in memory only and are never written to disk.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 } });

/* ---------- simple per-IP rate limit (30 requests per minute) ---------- */
const hits = new Map();
function limiter(req, res, next) {
  const now = Date.now();
  const arr = (hits.get(req.ip) || []).filter((t) => now - t < 60000);
  if (arr.length >= 30) return res.status(429).json({ error: "Too many requests. Wait a minute and try again." });
  arr.push(now);
  hits.set(req.ip, arr);
  next();
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 60000)) hits.delete(k); }, 300000).unref();

/* ---------- what we ask the model to return ---------- */
function mockInvoice(name) {
  return {
    invoice_no: "DEMO-" + (name.length * 37 % 900 + 100), supplier: "Demo Supplier Co.", bill_to: "Your Company", invoice_date: "2026-09-15",
    due_date: "2026-10-15", currency: "USD", subtotal: 300, tax: 15, total: 315, payment_terms: "Net 30",
    lines: [
      { description: "Sample item A", quantity: 2, unit_price: 100, line_total: 200 },
      { description: "Sample item B", quantity: 4, unit_price: 25, line_total: 100 },
    ],
    notes: ["Demo mode: this is fake data, not read from your file."],
  };
}

/* ---------- Stripe webhook needs the raw body, so it's registered before express.json() ---------- */
app.post("/api/stripe-webhook", express.raw({ type: "application/json" }), (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(400).send("Stripe not configured.");
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send("Webhook signature check failed: " + err.message);
  }
  if (event.type === "checkout.session.completed") {
    const s = event.data.object;
    const email = s.customer_email || (s.customer_details && s.customer_details.email);
    const plan = s.metadata && s.metadata.plan;
    if (email && plan) store.setPlan(email, plan);
  }
  if (event.type === "customer.subscription.deleted") {
    const s = event.data.object;
    if (s.metadata && s.metadata.email) store.setPlan(s.metadata.email, "free");
  }
  res.json({ received: true });
});

app.use(express.json());
app.use(cookieParser());

/* ---------- passwordless login ---------- */
const loginLimiter = (() => {
  const hits = new Map();
  return (req, res, next) => {
    const key = (req.body && req.body.email || "").toLowerCase();
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < 10 * 60 * 1000);
    if (arr.length >= 5) return res.status(429).json({ error: "Too many login requests for this email. Try again in a few minutes." });
    arr.push(now);
    hits.set(key, arr);
    next();
  };
})();

app.post("/api/login", loginLimiter, async (req, res) => {
  const email = String((req.body && req.body.email) || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  store.getUser(email); // ensures the account exists
  const token = auth.makeLoginToken(email);
  const base = process.env.APP_BASE_URL || "http://localhost:" + PORT;
  const url = base + "/api/verify?token=" + encodeURIComponent(token);
  try {
    const result = await mailer.sendLoginLink(email, url);
    if (result.dev) return res.json({ sent: true, dev: true, message: "No email server is configured yet, so here's the link directly. Check the server console too.", url });
    res.json({ sent: true });
  } catch (err) {
    console.error("login email error:", err.message);
    res.status(500).json({ error: "Could not send the login email. Check your SMTP settings in .env." });
  }
});

app.get("/api/verify", (req, res) => {
  const email = auth.readLoginToken(req.query.token);
  if (!email) return res.status(400).send("This login link is invalid or has expired. Go back and request a new one.");
  store.getUser(email);
  auth.setSessionCookie(res, email);
  res.redirect("/?loggedIn=1");
});

app.post("/api/logout", (req, res) => { auth.clearSessionCookie(res); res.json({ ok: true }); });

/* ---------- accounts ---------- */
app.get("/api/account", (req, res) => {
  const email = auth.currentEmail(req);
  if (!email) return res.status(401).json({ error: "Not logged in." });
  const user = store.getUser(email);
  const remaining = store.remaining(user);
  res.json({ email: user.email, plan: user.plan, remainingToday: remaining === Infinity ? null : remaining });
});

/* ---------- Stripe checkout (needs STRIPE_SECRET_KEY + price IDs in .env) ---------- */
app.post("/api/checkout", async (req, res) => {
  if (!stripe) return res.status(500).json({ error: "Payments aren't set up yet. Add STRIPE_SECRET_KEY to .env." });
  const email = auth.currentEmail(req);
  if (!email) return res.status(401).json({ error: "Log in first, then upgrade." });
  const plan = req.body && req.body.plan;
  if (!PRICE_IDS[plan]) return res.status(400).json({ error: "Unknown plan." });
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: email,
      line_items: [{ price: PRICE_IDS[plan], quantity: 1 }],
      metadata: { plan, email },
      success_url: (process.env.APP_BASE_URL || "http://localhost:" + PORT) + "/?upgraded=1",
      cancel_url: (process.env.APP_BASE_URL || "http://localhost:" + PORT) + "/?upgraded=0",
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error("checkout error:", err.message);
    res.status(500).json({ error: "Could not start checkout. Check your Stripe keys and price IDs." });
  }
});

/* ---------- routes ---------- */
app.get("/api/health", (req, res) => res.json({ ok: true, mock: MOCK, ready: PROVIDER !== "none", provider: PROVIDER, payments: !!stripe }));

// Demo mode: lets a visitor try their own file with no login and no cost.
// Always returns fake data, never calls the real Anthropic API, regardless of MOCK.
app.post("/api/demo-extract", limiter, upload.single("file"), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "No file received." });
  res.json({ invoice: mockInvoice(file.originalname), demo: true });
});

app.post("/api/extract", limiter, upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file received." });

    const email = auth.currentEmail(req);
    if (!email) return res.status(401).json({ error: "Log in first, then upload your invoice.", code: "not_logged_in" });
    const user = store.getUser(email);
    const left = store.remaining(user);
    if (left !== Infinity && left <= 0) {
      return res.status(402).json({ error: "You've used today's " + store.PLAN_LIMITS.free + " free invoices. Upgrade to Pro for unlimited invoices.", code: "limit_reached" });
    }
    if (MOCK) { store.recordUse(user.email); return res.json({ invoice: mockInvoice(file.originalname), remainingToday: store.remaining(user) }); }
    if (PROVIDER === "none") return res.status(500).json({ error: "The server has no AI provider configured. Add GEMINI_API_KEY (free) or ANTHROPIC_API_KEY to .env and restart." });
    if (!providers.fileKind(file)) return res.status(415).json({ error: "This file type isn't supported. Use JPG, PNG, WebP, PDF, TXT or CSV." });

    const invoice = PROVIDER === "gemini"
      ? await providers.extractGemini(file, GEMINI_KEY, GEMINI_MODEL)
      : await providers.extractAnthropic(file, anthropicClient, ANTHROPIC_MODEL);

    store.recordUse(user.email);
    res.json({ invoice, remainingToday: store.remaining(user), provider: PROVIDER });
  } catch (err) {
    console.error("extract error [" + PROVIDER + "]:", err && err.status, err && err.message);
    const s = err && err.status;
    if (PROVIDER === "gemini") {
      if (s === 400) return res.status(422).json({ error: "This file couldn't be processed. It may be corrupt, unsupported, or too large." });
      if (s === 403) return res.status(500).json({ error: "The Gemini API key was rejected. Check GEMINI_API_KEY in .env." });
      if (s === 404) return res.status(500).json({ error: "Gemini's model name isn't valid anymore (Google renames these sometimes). Update GEMINI_MODEL in .env to a current model name — check https://ai.google.dev/gemini-api/docs/models for the latest." });
      if (s === 429) return res.status(429).json({ error: "Gemini's free-tier limit was hit for now. Wait a minute and try again." });
      if (s === 503) return res.status(503).json({ error: "Google's servers are unusually busy right now (this is on their end, already retried a couple of times). Wait a minute and try again." });
      return res.status(500).json({ error: "Something went wrong while reading this file. " + ((err && err.message) || "") });
    }
    if (s === 401) return res.status(500).json({ error: "The API key was rejected. Check ANTHROPIC_API_KEY in .env." });
    if (s === 404) return res.status(500).json({ error: "The model name was not found. Check ANTHROPIC_MODEL in .env." });
    if (s === 429) return res.status(429).json({ error: "The AI service is busy. Try again in a moment." });
    if (s === 400) return res.status(422).json({ error: "This file couldn't be processed. It may be corrupt, password-protected, or too large." });
    res.status(500).json({ error: "Something went wrong while reading this file." });
  }
});

// multer errors (e.g. file too large)
app.use((err, req, res, next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: `File is too large. The limit is ${MAX_MB} MB.` });
  if (err) return res.status(400).json({ error: "Upload failed." });
  next();
});

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`TidyLedger running at http://localhost:${PORT}`);
  console.log(
    MOCK ? "Demo mode: fake data, no API key needed."
    : PROVIDER === "gemini" ? `Using Gemini (free tier), model ${GEMINI_MODEL}.`
    : PROVIDER === "anthropic" ? `Using Anthropic, model ${ANTHROPIC_MODEL}.`
    : "WARNING: no AI provider configured. Add GEMINI_API_KEY (free, no card needed) or ANTHROPIC_API_KEY to .env, or run with: npm run demo"
  );
});
