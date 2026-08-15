// Fires from a Supabase Database Webhook on INSERT into `license_keys`.
// If the new key is a paid Pro license, sends a Telegram notification.
//
// Supabase → Database → Webhooks → create:
//   Table: license_keys · Events: Insert · Type: HTTP Request · Method: POST
//   URL: https://www.aeflowtools.com/api/new-license   (optionally ?token=YOURSECRET)

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
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  // optional shared-secret (add ?token=... to the webhook URL + set WEBHOOK_TOKEN)
  if (process.env.WEBHOOK_TOKEN && (req.query.token || '') !== process.env.WEBHOOK_TOKEN) {
    return res.status(401).send('unauthorized');
  }

  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }

  // Supabase webhook payload: { type:'INSERT', table, schema, record, old_record }
  if (b.type && b.type !== 'INSERT') return res.status(200).send('ignored');
  const rec = b.record || b;

  // only notify for PAID (pro) licenses
  if (!rec || rec.plan !== 'pro') return res.status(200).send('ignored');

  const text = '💰 New Pro license!' +
    '\nKey: ' + (rec.key || '—') +
    (rec.email ? '\nEmail: ' + rec.email : '') +
    (rec.license_type ? '\nType: ' + rec.license_type : '') +
    (rec.total_clicks ? '\nClicks: ' + rec.total_clicks : '');

  await telegram(text);
  return res.status(200).send('ok');
}
