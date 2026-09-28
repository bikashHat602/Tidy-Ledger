// Sends the login-link email. Three modes, tried in this order:
//  1. Brevo HTTPS API  (BREVO_API_KEY)  <- use this on Render's free plan. Render blocks
//     the SMTP ports (25/465/587) on free services, but port 443 (HTTPS) is never blocked.
//  2. SMTP             (SMTP_HOST/USER/PASS) <- works on your own computer or a paid host.
//  3. Dev fallback     (nothing configured)  <- prints the link / returns it to the page, for testing only.
const nodemailer = require("nodemailer");

const BREVO_KEY = (process.env.BREVO_API_KEY || "").trim();
const BREVO_URL = process.env.BREVO_API_URL || "https://api.brevo.com/v3/smtp/email";
const FROM_EMAIL = (process.env.MAIL_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER || "").trim();
const FROM_NAME = process.env.MAIL_FROM_NAME || "TidyLedger";

const hasBrevo = !!(BREVO_KEY && FROM_EMAIL);
// Gmail app passwords are shown as "abcd efgh ijkl mnop"; spaces must be removed.
const smtpPass = (process.env.SMTP_PASS || "").replace(/\s+/g, "");
const hasSmtp = !!(process.env.SMTP_HOST && process.env.SMTP_USER && smtpPass);

let transporter = null;
if (hasSmtp && !hasBrevo) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: smtpPass },
    connectionTimeout: 10000, // fail fast (Render's blocked ports would otherwise hang)
    greetingTimeout: 10000,
  });
}

const mode = hasBrevo ? "brevo" : transporter ? "smtp" : "dev";

function subjectAndBodies(url) {
  return {
    subject: "Your TidyLedger login link",
    text: "Click this link to log in (it expires in 15 minutes):\n\n" + url + "\n\nIf you didn't ask for this, you can ignore this email.",
    html: '<p>Click the button below to log in to TidyLedger. The link expires in 15 minutes.</p>' +
      '<p><a href="' + url + '" style="display:inline-block;padding:12px 20px;background:#3547d9;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Log in to TidyLedger</a></p>' +
      '<p style="color:#666;font-size:13px">Or paste this link into your browser:<br>' + url + '</p>' +
      '<p style="color:#666;font-size:13px">If you didn\'t ask for this, you can ignore this email.</p>',
  };
}

async function sendViaBrevo(email, url) {
  const { subject, text, html } = subjectAndBodies(url);
  const resp = await fetch(BREVO_URL, {
    method: "POST",
    headers: { "api-key": BREVO_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: { name: FROM_NAME, email: FROM_EMAIL }, to: [{ email }], subject, textContent: text, htmlContent: html }),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    const err = new Error("Brevo " + resp.status + ": " + ((data && data.message) || "request failed"));
    err.status = resp.status;
    throw err;
  }
}

async function sendLoginLink(email, url) {
  if (mode === "brevo") { await sendViaBrevo(email, url); return { dev: false }; }
  if (mode === "smtp") {
    const { subject, text, html } = subjectAndBodies(url);
    await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: email, subject, text, html });
    return { dev: false };
  }
  // Dev fallback: no email provider configured, so hand the link back instead of emailing it.
  console.log("\n[DEV LOGIN LINK] No email provider configured. Log in as " + email + " by opening:\n" + url + "\n");
  return { dev: true, url };
}

module.exports = { sendLoginLink, hasSmtp, hasBrevo, mode };
