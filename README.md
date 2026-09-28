# TidyLedger – invoice cleaner

Upload invoices (photo, PDF, TXT, CSV) → pick and rename your columns → download Excel.

## No money for API credits? Use the free option

This app can read invoices with either **Google Gemini** (free tier, no card needed) or
**Anthropic** (paid). If `GEMINI_API_KEY` is set, it's used automatically — you never need to
add a card to try this for real.

1. Go to https://aistudio.google.com/app/apikey
2. Sign in with any Google account (no billing setup needed for the free tier)
3. Click "Create API key," copy it
4. Put it in `.env` as `GEMINI_API_KEY=your-key-here` (locally) or as an environment
   variable named `GEMINI_API_KEY` on your host (e.g. Render's Environment tab)

The free tier has a request-per-minute limit, which is normal — for a small/testing app it's
plenty. If you outgrow it later, either wait for the quota to reset or switch to Anthropic by
removing `GEMINI_API_KEY` and setting `ANTHROPIC_API_KEY` instead.

## Run it on your computer

1. Install Node.js 18 or newer from https://nodejs.org
2. Open a terminal in this folder and run:
   ```
   npm install
   ```

### Try the screens first (no API key, fake data)
```
npm run demo
```
Open http://localhost:3000 . Every upload returns fake demo invoice data. Use this to test
headings, editing and the Excel download.

### Read real invoices
1. Get an API key at https://console.anthropic.com
2. Copy `.env.example` to `.env` and paste your key after `ANTHROPIC_API_KEY=`
3. Run:
   ```
   npm start
   ```
4. Open http://localhost:3000 and upload a real invoice.

Pages: `/` is the tool, `/landing.html` is the sales page.

## Accounts (real login, no password to manage)

Visitors log in with an emailed magic link — no passwords to store or leak. The flow:

1. They type their email and click "Send login link."
2. They get an email with a link that logs them in for 30 days (a secure cookie, not a
   plain-text email like before). Only someone with access to that inbox can log in as them.
3. Free plan: 50 invoices per calendar month per account, with a daily burst cap of 20 (change with FREE_MONTHLY_LIMIT / FREE_DAILY_LIMIT in .env). Pro and Business are unlimited.

**Sending the login emails.** Pick one (set in `.env`, or in your host's Environment tab):

- **Brevo HTTPS API (recommended, and the only free option on Render):** Render's free plan blocks
  all outbound SMTP ports (25/465/587), so Gmail/SMTP cannot work there. Brevo's free plan sends 300
  emails/day over HTTPS. Set `BREVO_API_KEY` and `MAIL_FROM_EMAIL` (an address you have verified
  in Brevo under *Senders & IP > Senders*, e.g. your Gmail).
- **SMTP:** `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` — fine on your own computer or a paid host.
- **Neither set (testing only):** the login link is shown directly on the page, so anyone can log in
  as any email. Never leave it like this once real users sign up.

The server prints which mode it is in when it starts.

**Before going live**, set `SESSION_SECRET` in `.env` to a long random string (this signs the
login/session tokens — treat it like a password). Usage and accounts are stored in `data.json`
in this folder; swap for a real database once you have real traffic.

## Accepting payments (optional, off by default)

1. Create a Stripe account at https://stripe.com and turn on test mode.
2. Create two recurring Prices (e.g. Pro $12/month, Business $39/month) and copy their Price IDs.
3. In `.env`, set `STRIPE_SECRET_KEY`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_BUSINESS`.
4. For the free-plan limit to lift automatically after payment, set up a webhook:
   - In Stripe, add an endpoint pointing to `https://yourdomain.com/api/stripe-webhook`
     for the `checkout.session.completed` event, and copy its signing secret into
     `STRIPE_WEBHOOK_SECRET` in `.env`.
   - Locally, use the Stripe CLI (`stripe listen --forward-to localhost:3000/api/stripe-webhook`)
     to test this before going live.
5. Restart the server. The "Upgrade to Pro" button in the tool will now open real Stripe checkout.

Until Stripe is configured, the Upgrade button shows a clear message instead of failing silently.

## Notes
- Files are processed in memory and never saved to disk.
- Each invoice uploaded is one paid API call. Watch your usage in the console.
- Limits: 10 MB per file, 30 requests per minute per visitor.
- Before charging customers, add: user accounts, payments (Stripe), per-user usage limits,
  and HTTPS hosting (Render, Railway, Fly.io or a VPS).
- Always check extracted numbers before using them for accounting.
