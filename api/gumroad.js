// Gumroad "Ping" webhook → sends a Telegram notification on every sale.
// Set your Gumroad Ping URL to:  https://www.aeflowtools.com/api/gumroad
// (optionally add ?token=YOURSECRET and set GUMROAD_PING_TOKEN to match).

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

  // optional shared-secret check
  if (process.env.GUMROAD_PING_TOKEN && (req.query.token || '') !== process.env.GUMROAD_PING_TOKEN) {
    return res.status(401).send('unauthorized');
  }

  // Gumroad sends form-encoded fields; Vercel parses them into req.body.
  let b = req.body || {};
  if (typeof b === 'string') { try { b = Object.fromEntries(new URLSearchParams(b)); } catch (e) { b = {}; } }

  const product = b.product_name || 'a product';
  const price = b.price ? '$' + (parseInt(b.price, 10) / 100).toFixed(2) : '';
  const buyer = b.full_name || '';
  const email = b.email || '';
  const refunded = b.refunded === 'true';

  const text = (refunded ? '↩️ Refund' : '💰 New sale!') +
    '\n' + product + (price ? '  —  ' + price : '') +
    (buyer ? '\n' + buyer : '') +
    (email ? '\n' + email : '');

  await telegram(text);
  return res.status(200).send('ok'); // Gumroad expects a 200
}
