// UI Flow Admin API — password-gated, server-side only. Uses the Supabase
// service_role key (env var, never sent to the browser) to read/write tables
// and the "UI Flow AE Updates" storage bucket (popup/promo/offer/config JSON).

const SB_URL = 'https://zomjnvryqmotggdkseag.supabase.co';
const BUCKET = 'UI%20Flow%20AE%20Updates';

function svc() { return process.env.SUPABASE_SERVICE_ROLE_KEY; }
function h(extra) { return Object.assign({ apikey: svc(), Authorization: `Bearer ${svc()}`, 'Content-Type': 'application/json' }, extra || {}); }

async function rest(path, opts) {
  opts = opts || {};
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { method: opts.method || 'GET', headers: h(opts.headers), body: opts.body });
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!r.ok) throw new Error((data && data.message) || ('DB error (' + r.status + ')'));
  return data;
}

async function count(table, filter) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?select=*${filter ? '&' + filter : ''}`, { method: 'HEAD', headers: h({ Prefer: 'count=exact' }) });
  const cr = r.headers.get('content-range') || '*/0';
  return parseInt(cr.split('/')[1] || '0', 10);
}

async function readFile(name) {
  const r = await fetch(`${SB_URL}/storage/v1/object/public/${BUCKET}/${name}?t=${Date.now()}`, { headers: { apikey: svc(), Authorization: `Bearer ${svc()}` }, cache: 'no-store' });
  // File may not exist yet — treat any non-OK read as "empty", so the editor shows
  // defaults and creates the file on first Save. (Real errors surface on write.)
  if (!r.ok) return null;
  try { return await r.json(); } catch (e) { return null; }
}

async function writeFile(name, obj) {
  const r = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${name}`, {
    method: 'POST',
    headers: { apikey: svc(), Authorization: `Bearer ${svc()}`, 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': '0' },
    body: JSON.stringify(obj, null, 2),
  });
  if (!r.ok) { const e = await r.text(); throw new Error('Could not save ' + name + ': ' + e); }
  return true;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (x) { body = {}; } }
  body = body || {};

  if (!process.env.ADMIN_PASSWORD || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Admin panel not configured (missing ADMIN_PASSWORD or SUPABASE_SERVICE_ROLE_KEY).' });
  }
  if ((body.password || '') !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Wrong password.' });
  }

  const a = body.action;
  try {
    if (a === 'ping') return res.status(200).json({ ok: true });

    if (a === 'overview') {
      const since = new Date(Date.now() - 86400000).toISOString();
      const [users, bd, vips, paidKeys, activeToday] = await Promise.all([
        count('app_users'),
        count('bd_free_users'),
        count('vip_users'),
        count('license_keys', 'plan=eq.pro&is_revoked=eq.false'),
        count('app_users', 'last_seen=gte.' + since),
      ]);
      return res.status(200).json({ stats: { users, bd, vips, paidKeys, activeToday } });
    }

    if (a === 'users') {
      const [users, vips, keys] = await Promise.all([
        rest('app_users?select=*&order=last_seen.desc.nullslast&limit=2000'),
        rest('vip_users?select=client_id'),
        rest('license_keys?select=bound_client,plan,is_revoked&bound_client=not.is.null'),
      ]);
      const vipSet = new Set(vips.map(function (v) { return v.client_id; }));
      const paid = new Set(), bdset = new Set();
      keys.forEach(function (k) {
        if (!k.is_revoked && k.bound_client) {
          if (k.plan === 'pro') paid.add(k.bound_client);
          else if (k.plan === 'bd-free') bdset.add(k.bound_client);
        }
      });
      const rows = users.map(function (u) {
        var status = 'Free';
        if (vipSet.has(u.user_id)) status = 'VIP';
        else if (paid.has(u.user_id)) status = 'Paid';
        else if (bdset.has(u.user_id)) status = 'BD Free';
        return Object.assign({ _status: status }, u);
      });
      return res.status(200).json({ rows: rows });
    }

    if (a === 'bd_users') return res.status(200).json({ rows: await rest('bd_free_users?select=*&order=created_at.desc&limit=3000') });
    if (a === 'keys') return res.status(200).json({ rows: await rest('license_keys?select=*&order=activated_at.desc.nullslast&limit=3000') });
    if (a === 'vips') return res.status(200).json({ rows: await rest('vip_users?select=*') });

    if (a === 'create_key') {
      const row = await rest('license_keys', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body.key || {}) });
      return res.status(200).json({ row: row[0] });
    }
    if (a === 'update_key') {
      const k = encodeURIComponent(body.key);
      const row = await rest('license_keys?key=eq.' + k, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body.patch || {}) });
      return res.status(200).json({ row: row[0] });
    }
    if (a === 'delete_key') {
      await rest('license_keys?key=eq.' + encodeURIComponent(body.key), { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }

    if (a === 'add_vip') {
      await rest('vip_users', { method: 'POST', body: JSON.stringify({ client_id: (body.client_id || '').trim() }) });
      return res.status(200).json({ ok: true });
    }
    if (a === 'remove_vip') {
      await rest('vip_users?client_id=eq.' + encodeURIComponent(body.client_id), { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }

    if (a === 'issue_bd_key') {
      const key = await rest('rpc/claim_bd_free_key', { method: 'POST', body: JSON.stringify({ p_name: body.name, p_email: body.email, p_whatsapp: body.whatsapp }) });
      return res.status(200).json({ key: key });
    }

    if (a === 'get_content') return res.status(200).json({ content: await readFile(body.file) });
    if (a === 'save_content') { await writeFile(body.file, body.content); return res.status(200).json({ ok: true }); }

    return res.status(400).json({ error: 'Unknown action: ' + a });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Something went wrong.' });
  }
}
