const nodemailer = require("nodemailer");

const hasSmtp = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
let transporter = null;
if (hasSmtp) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function sendLoginLink(email, url) {
  if (!transporter) {
    // Dev fallback: no SMTP configured, so print the link instead of emailing it.
    console.log("\n[DEV LOGIN LINK] No SMTP configured. Log in as " + email + " by opening:\n" + url + "\n");
    return { dev: true, url };
  }
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: "Your TidyLedger login link",
    text: "Click this link to log in (it expires in 15 minutes):\n\n" + url,
    html: '<p>Click this link to log in (it expires in 15 minutes):</p><p><a href="' + url + '">' + url + "</a></p>",
  });
  return { dev: false };
}

module.exports = { sendLoginLink, hasSmtp };
