# TidyLedger – invoice cleaner

Upload invoices (photo, PDF, TXT, CSV) → pick and rename your columns → download Excel.

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
3. Free plan: 5 invoices per day per account. Pro and Business are unlimited.

**Local testing without an email server:** if `SMTP_HOST` isn't set in `.env`, the login link
is shown directly in the app and printed to the server console instead of emailed, so you can
test the whole flow without setting up SMTP first. Set real SMTP details (e.g. Gmail app
password, Postmark, Resend, SendGrid) before real users sign up.

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
