// Vercel serverless function: claim a free Bangladesh UI Flow license key and
// email it to the user via Resend. The key is NEVER returned to the browser —
// it only ever lands in the registered email's inbox, which prevents anyone
// from retrieving someone else's key.

const SB_URL = 'https://zomjnvryqmotggdkseag.supabase.co';
// Public anon key (safe). RPCs are SECURITY DEFINER and granted to anon.
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpvbWpudnJ5cW1vdGdnZGtzZWFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3MjQxMjcsImV4cCI6MjA5MTMwMDEyN30.R4z2Knbz9Bv6JU7ilXq47MJck7kMbnHWbe71UMYuwRE';

const PHONE_RE = /^(?:\+?8801|01)[3-9]\d{8}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function rpc(fn, args) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}` },
    body: JSON.stringify(args),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error((data && data.message) || 'Supabase error');
  return data;
}

function keyEmailHtml(key) {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:auto;color:#1a1a1a;">
    <h2 style="margin:0 0 12px;">Your UI Flow license key 🔑</h2>
    <p>Thanks for using UI Flow! Here is your <strong>lifetime free</strong> license key:</p>
    <div style="font-size:20px;font-weight:bold;letter-spacing:1px;background:#f4f6ff;border:1px solid #cdd7ff;border-radius:10px;padding:16px;text-align:center;font-family:monospace;margin:8px 0 20px;">${key}</div>
    <p style="margin:0 0 6px;"><strong>How to activate:</strong></p>
    <ol style="color:#333;line-height:1.7;padding-left:20px;margin:0 0 18px;">
      <li>Open the UI Flow plugin in Figma.</li>
      <li>Click the key icon (top-right of the panel).</li>
      <li>Paste your key and click Activate.</li>
      <li>Done — unlimited free exports. 🎉</li>
    </ol>
    <p style="color:#888;font-size:13px;margin:0;">Need help? Email contact@aeflowtools.com</p>
  </div>`;
}

async function sendEmail(to, key) {
  const FROM = process.env.RESEND_FROM || 'UI Flow <noreply@contact.aeflowtools.com>';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject: 'Your UI Flow lifetime license key 🔑',
      html: keyEmailHtml(key),
    }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e && e.message) || 'Email send failed');
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (x) { body = {}; } }
  body = body || {};

  // Honeypot — bots fill this hidden field. Pretend success, do nothing.
  if (body.company) return res.status(200).json({ status: 'new' });

  const name = (body.name || '').trim();
  const email = (body.email || '').trim();
  const whatsapp = (body.whatsapp || '').replace(/[\s-]/g, '');

  if (!name) return res.status(400).json({ error: 'Please enter your full name.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (!PHONE_RE.test(whatsapp)) return res.status(400).json({ error: 'Please enter a valid Bangladeshi WhatsApp number.' });

  // Optional: verify Cloudflare Turnstile server-side (only if TURNSTILE_SECRET is set)
  if (process.env.TURNSTILE_SECRET) {
    try {
      const tr = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET, response: body.token || '' }),
      });
      const tv = await tr.json();
      if (!tv.success) return res.status(400).json({ error: 'Verification failed. Please try again.' });
    } catch (x) {
      return res.status(400).json({ error: 'Verification failed. Please try again.' });
    }
  }

  if (!process.env.RESEND_API_KEY) return res.status(500).json({ error: 'Email service not configured yet.' });

  try {
    let status = 'new';
    let key = await rpc('get_bd_free_key_by_email', { p_email: email });
    if (key) {
      status = 'existing';
    } else {
      key = await rpc('claim_bd_free_key', { p_name: name, p_email: email, p_whatsapp: whatsapp });
    }
    if (!key) return res.status(500).json({ error: 'Could not generate a key. Please try again.' });

    await sendEmail(email, key);
    return res.status(200).json({ status });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Something went wrong. Please try again.' });
  }
}

// redeploy trigger to pick up RESEND_API_KEY env var
