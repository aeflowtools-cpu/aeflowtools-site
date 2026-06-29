// Password-gated notes API. The password and the Supabase service key live ONLY
// in Vercel environment variables (never in the repo), and the notes table has
// RLS on with no public policies — so notes are reachable ONLY through this
// function after the correct password is supplied.

const SB_URL = 'https://zomjnvryqmotggdkseag.supabase.co';

function sbHeaders(extra) {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return Object.assign({ 'Content-Type': 'application/json', apikey: k, Authorization: `Bearer ${k}` }, extra || {});
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (x) { body = {}; } }
  body = body || {};

  if (!process.env.NOTES_PASSWORD || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Notes are not configured yet.' });
  }
  if ((body.password || '') !== process.env.NOTES_PASSWORD) {
    return res.status(401).json({ error: 'Wrong password.' });
  }

  const action = body.action;
  try {
    if (action === 'list') {
      const r = await fetch(`${SB_URL}/rest/v1/notes?select=id,content,created_at,updated_at&order=updated_at.desc`, { headers: sbHeaders() });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'Could not load notes');
      return res.status(200).json({ notes: data });
    }

    if (action === 'add') {
      const content = (body.content || '').toString();
      const r = await fetch(`${SB_URL}/rest/v1/notes`, {
        method: 'POST', headers: sbHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({ content }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'Could not add note');
      return res.status(200).json({ note: data[0] });
    }

    if (action === 'update') {
      const id = body.id;
      const content = (body.content || '').toString();
      const r = await fetch(`${SB_URL}/rest/v1/notes?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: sbHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({ content, updated_at: new Date().toISOString() }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'Could not save note');
      return res.status(200).json({ note: data[0] });
    }

    if (action === 'delete') {
      const id = body.id;
      const r = await fetch(`${SB_URL}/rest/v1/notes?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: sbHeaders() });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message || 'Could not delete note'); }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Something went wrong.' });
  }
}
