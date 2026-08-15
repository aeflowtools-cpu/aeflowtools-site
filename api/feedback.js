// Receives bug reports and reviews from the public forms and stores them in
// Supabase (bug_reports / reviews tables) via the service_role key, server-side.
// The tables have RLS on with no anon access, so only this function (and the
// admin panel) can read them.

const SB_URL = 'https://zomjnvryqmotggdkseag.supabase.co';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SOCIAL_RE = /^(https?:\/\/)?([a-z0-9-]+\.)?(facebook\.com|fb\.com|fb\.me|instagram\.com|instagr\.am|linkedin\.com)\/[^\s]{2,}$/i;

async function insert(table, row) {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(row),
  });
  if (!r.ok) { const e = await r.text(); throw new Error(e || 'Could not save'); }
}

// Optional Telegram notification (fires only if the bot env vars are set).
async function telegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: text, disable_web_page_preview: true }),
    });
  } catch (e) {}
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (x) { b = {}; } }
  b = b || {};

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'Not configured (missing service key).' });

  // honeypot — pretend success, store nothing
  if (b.botcheck || b.company) return res.status(200).json({ success: true });

  try {
    if (b.type === 'bug') {
      const email = (b.email || '').trim();
      const description = (b.description || '').trim();
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email.' });
      if (!description) return res.status(400).json({ error: 'Please describe the bug.' });
      await insert('bug_reports', {
        email: email,
        os: (b.os || '').trim() || null,
        ae_version: (b.ae_version || '').trim() || null,
        description: description,
        video_link: (b.video_link || '').trim() || null,
      });
      await telegram('🐞 New bug report\nFrom: ' + email +
        '\nOS: ' + ((b.os || '').trim() || '—') + '  ·  AE: ' + ((b.ae_version || '').trim() || '—') +
        ((b.video_link || '').trim() ? '\n🎥 ' + (b.video_link || '').trim() : '') +
        '\n\n' + description);
      return res.status(200).json({ success: true });
    }

    if (b.type === 'review') {
      const name = (b.name || '').trim();
      const social = (b.social_profile || '').trim();
      const review = (b.review || '').trim();
      if (!name) return res.status(400).json({ error: 'Please enter your name.' });
      if (!SOCIAL_RE.test(social)) return res.status(400).json({ error: 'Please enter a valid Facebook, Instagram, or LinkedIn profile link.' });
      if (!review) return res.status(400).json({ error: 'Please write your review.' });
      await insert('reviews', {
        name: name,
        role: (b.role || '').trim() || null,
        rating: (b.rating || '').trim() || null,
        social_profile: social,
        review: review,
      });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown submission type.' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Something went wrong.' });
  }
}
