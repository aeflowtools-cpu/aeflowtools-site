// CodeFlow license server: https://www.aeflowtools.com/api/codeflow  (POST JSON { action, ... })
//
// The CodeFlow After Effects panel calls this at every launch and before every build ("always online").
// Licenses are Gumroad license keys (verified with Gumroad's API) or manual keys (source 'manual',
// created in the database for giveaways / influencers / testing).
//   - 2 computers per license (cf_config.seats); a buyer can free a seat from the panel
//   - 5 free builds per computer without a license (cf_config.trial_builds), counted here
//   - every answer is signed (Ed25519): the panel rejects answers that didn't come from this server
//   - the panel can only decrypt the After Effects builder with the content key it gets from here
//
// Separate Supabase project (env CODEFLOW_SB_URL + CODEFLOW_SB_SERVICE_KEY). Secrets (signing key,
// content master key, Gumroad product id) live in table cf_config, readable only with the service key.
import crypto from 'crypto';

const SB = () => (process.env.CODEFLOW_SB_URL || '').replace(/\/$/, '');
const SVC = () => process.env.CODEFLOW_SB_SERVICE_KEY;

async function db(path, opts = {}) {
  const r = await fetch(`${SB()}/rest/v1/${path}`, {
    method: opts.method || 'GET',
    headers: Object.assign({ apikey: SVC(), Authorization: `Bearer ${SVC()}`, 'Content-Type': 'application/json' }, opts.headers || {}),
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!r.ok) throw new Error('db ' + r.status + ': ' + ((data && data.message) || text));
  return { data, count: +((r.headers.get('content-range') || '').split('/')[1] || 0) };
}
const rows = async (path) => (await db(path)).data || [];
const enc = encodeURIComponent;

let CFG = null, CFG_AT = 0;
const CFG_TTL = +(process.env.CODEFLOW_CONFIG_TTL || 60000);   // how long config (incl. the update popup) is cached
async function config() {
  if (CFG && Date.now() - CFG_AT < CFG_TTL) return CFG;
  const list = await rows('cf_config?select=k,v');
  const c = {}; for (const r of list) c[r.k] = r.v;
  CFG = {
    signingKey: crypto.createPrivateKey(c.signing_private_pem),
    master: Buffer.from(c.content_master_hex, 'hex'),
    productId: c.gumroad_product_id || '',
    seats: +(c.seats || 2),
    trialBuilds: +(c.trial_builds || 5),
    sessionHours: +(c.session_hours || 12),
    deactivationsPer30d: +(c.deactivations_per_30d || 3),
    buyUrl: c.buy_url || 'https://aeflowtools.gumroad.com',
    // SupportKori (Bangladesh shop). The product token is public by design (it ships inside software, like a Gumroad product id).
    supportkoriId: c.supportkori_product_id || 'e7yi8EbgiU7WSR74BHN-Fb0X',
    // prices shown to users: Bangladesh visitors see price_bd and buy at buy_url_bd (only once buy_url_bd is set)
    priceIntl: c.price_intl || '$20',
    priceBd: c.price_bd || '৳999',
    buyUrlBd: c.buy_url_bd || 'https://www.supportkori.com/arafatmiraz/extras/code-flow-license-key-q4ic',   // the SupportKori shop; cf_config buy_url_bd overrides it
    update: {
      latest: c.latest_version || '',
      url: c.download_url || 'https://aeflowtools.com/codeflow',
      required: String(c.update_required) === 'true',
      title: c.update_title || 'Update available',
      message: c.update_message || '',
    },
  };
  CFG_AT = Date.now();
  return CFG;
}

// is the running extension older than the latest released version? (semver compare, missing = no update)
function updateInfo(cfg, extVersion) {
  const u = cfg.update;
  if (!u.latest) return null;
  const parse = (v) => String(v).split('.').map(n => parseInt(n, 10) || 0);
  const [a, b] = [parse(u.latest), parse(extVersion)];
  let older = false;
  for (let i = 0; i < 3; i++) { if ((b[i] || 0) < (a[i] || 0)) { older = true; break; } if ((b[i] || 0) > (a[i] || 0)) break; }
  if (!older) return null;
  return { latest: u.latest, url: u.url, required: u.required, title: u.title, message: u.message };
}

// signed token: base64url(JSON) + '.' + base64url(Ed25519 signature)
const b64u = (b) => Buffer.from(b).toString('base64url');
function sign(cfg, payload) { const body = b64u(JSON.stringify(payload)); return body + '.' + b64u(crypto.sign(null, Buffer.from(body), cfg.signingKey)); }
function readToken(cfg, tok) {
  const [body, sig] = String(tok || '').split('.');
  if (!body || !sig) return null;
  const pub = crypto.createPublicKey(cfg.signingKey);
  if (!crypto.verify(null, Buffer.from(body), pub, Buffer.from(sig, 'base64url'))) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (e) { return null; }
}
// the AES key of the encrypted builder (host/core.bin) for one extension version
function contentKey(cfg, version) { return crypto.createHmac('sha256', cfg.master).update('codeflow-core|' + version).digest('base64'); }

const normKey = (k) => String(k || '').trim().toUpperCase();
const mask = (k) => (k ? '••••-' + k.slice(-4) : '');
const MACHINE_RE = /^[a-f0-9]{64}$/, NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/, VERSION_RE = /^\d+\.\d+\.\d+$/;
const clean = (s, n) => String(s || '').replace(/[^\w .()+@:/-]/g, '').slice(0, n);

async function gumroadVerify(cfg, key) {
  if (!cfg.productId) return null;
  const r = await fetch('https://api.gumroad.com/v2/licenses/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ product_id: cfg.productId, license_key: key, increment_uses_count: 'false' }),
  });
  const j = await r.json().catch(() => null);
  if (!j || !j.success || !j.purchase) return null;
  return j.purchase;
}
const badPurchase = (p) => !!(p.refunded || p.chargebacked || p.disputed || p.subscription_cancelled_at || p.subscription_failed_at);

// SupportKori: POST {product_id, license_key} -> { valid, reason?, test? }. A plain check never uses a seat (we keep our own seats).
async function supportkoriVerify(cfg, key) {
  const r = await fetch('https://supportkori.com/api/licenses/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product_id: cfg.supportkoriId, license_key: key }),
  });
  return await r.json().catch(() => null);
}
const SK_RE = /^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/;           // SupportKori keys look like FE3Z8-667GV-WNZ3G-8K34Y

// Asks the stores whether a key is a genuine, still-valid purchase. `only` = just that store (used when re-checking a known license).
//   -> { source, email, saleId } | { error: 'refunded' | 'revoked' | 'invalid_key' | 'verify_unavailable' }
async function verifyKey(cfg, key, only) {
  const order = only ? [only] : (SK_RE.test(key) ? ['supportkori', 'gumroad'] : ['gumroad', 'supportkori']);
  let definite = null, unreachable = 0;
  for (const src of order) {
    try {
      if (src === 'gumroad') {
        const p = await gumroadVerify(cfg, key);
        if (p) return badPurchase(p) ? { error: 'refunded' } : { source: 'gumroad', email: p.email, saleId: p.sale_id };
      } else {
        const j = await supportkoriVerify(cfg, key);
        if (j && j.valid && !j.test) return { source: 'supportkori', email: j.email || '', saleId: j.order_id || '' };   // the dashboard test key is not a sale
        if (j && j.reason === 'refunded') definite = { error: 'refunded' };
        else if (j && j.reason === 'disabled') definite = { error: 'revoked' };
        else if (!j) unreachable++;
      }
    } catch (e) { unreachable++; }
  }
  if (definite) return definite;
  return unreachable === order.length ? { error: 'verify_unavailable' } : { error: 'invalid_key' };
}

// Bangladesh visitors (Vercel's geo header) see the BD price and the SupportKori shop, once buy_url_bd is configured
const isBD = (req) => String(req.headers['x-vercel-ip-country'] || '').toUpperCase() === 'BD';
function buyInfo(cfg, req) {
  return isBD(req) && cfg.buyUrlBd
    ? { region: 'BD', buyUrl: cfg.buyUrlBd, price: cfg.priceBd }
    : { region: 'INT', buyUrl: cfg.buyUrl, price: cfg.priceIntl };
}

async function log(kind, ip, extra) {
  try { await db('cf_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: Object.assign({ kind, ip }, extra) }); } catch (e) {}
}
async function recentCount(filter, minutes) {
  const since = new Date(Date.now() - minutes * 60000).toISOString();
  return (await db(`cf_events?select=id&${filter}&at=gt.${enc(since)}`, { headers: { Prefer: 'count=exact', Range: '0-0' } })).count;
}
async function telegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  try { await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }) }); } catch (e) {}
}

// ---- license + seat check (shared by session and build) ----
async function checkLicense(cfg, key, machine, info, ip, { register }) {
  let lic = (await rows(`cf_licenses?key=eq.${enc(key)}&select=*`))[0];
  if (!lic) {
    const v = await verifyKey(cfg, key);                 // Gumroad (international) or SupportKori (Bangladesh)
    if (v.error) return { error: v.error };
    lic = (await db('cf_licenses', { method: 'POST', headers: { Prefer: 'return=representation' }, body: {
      key, source: v.source, email: clean(v.email, 120), sale_id: clean(v.saleId, 60), seats: cfg.seats, last_checked: new Date().toISOString(),
    } })).data[0];
    telegram(`🎬 New CodeFlow license activated (${v.source})\nKey: ${mask(key)}\nEmail: ${lic.email || '-'}\nPC: ${info.name || '-'}`);
  } else if ((lic.source === 'gumroad' || lic.source === 'supportkori') && lic.status === 'active' && (!lic.last_checked || Date.now() - Date.parse(lic.last_checked) > 6 * 3600e3)) {
    // re-check with the store every 6 h: a refund / disabled key stops working; a store that is down never locks anyone out
    const v = await verifyKey(cfg, key, lic.source);
    const patch = { last_checked: new Date().toISOString() };
    if (v.error === 'refunded') patch.status = 'refunded';
    else if (v.error === 'revoked') patch.status = 'revoked';
    await db(`cf_licenses?key=eq.${enc(key)}`, { method: 'PATCH', body: patch });
    if (patch.status) lic.status = patch.status;
  }
  if (lic.status !== 'active') return { error: lic.status === 'refunded' ? 'refunded' : 'revoked' };

  const acts = await rows(`cf_activations?license_key=eq.${enc(key)}&active=eq.true&select=id,machine,machine_name,last_seen&order=last_seen.desc`);
  const mine = acts.find(a => a.machine === machine);
  const now = new Date().toISOString();
  if (mine) {
    await db(`cf_activations?id=eq.${mine.id}`, { method: 'PATCH', body: { last_seen: now, ae_version: info.ae, ext_version: info.ext, machine_name: info.name } });
    return { lic };
  }
  if (!register) return { error: 'not_activated' };
  if (acts.length >= (lic.seats || cfg.seats)) {
    return { error: 'seats_full', seats: acts.map(a => ({ id: a.id, name: a.machine_name || 'Computer', lastSeen: a.last_seen })) };
  }
  await db('cf_activations?on_conflict=license_key,machine', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: { license_key: key, machine, machine_name: info.name, ae_version: info.ae, ext_version: info.ext, active: true, activated_at: now, last_seen: now },
  });
  await log('activate', ip, { license_key: key, machine });
  return { lic };
}

async function trialState(cfg, machine, info, ip) {
  let t = (await rows(`cf_trials?machine=eq.${machine}&select=*`))[0];
  if (!t) {
    // a cracked panel could invent a new machine id each launch: cap new trial computers per IP per day
    if (await recentCount(`kind=eq.trial_new&ip=eq.${enc(ip)}`, 24 * 60) >= 3) return { used: cfg.trialBuilds, blocked: true };
    await db('cf_trials', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: { machine, machine_name: info.name } });
    await log('trial_new', ip, { machine });
    t = { builds_used: 0 };
  }
  return { used: t.builds_used };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method' });
  if (!SB() || !SVC()) return res.status(503).json({ ok: false, error: 'server_not_configured' });
  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const action = String(b.action || '');
  // public: which price + shop this visitor should see (the website and the panel ask; no computer id needed)
  if (action === 'info') {
    try {
      const cfg = await config(), bi = buyInfo(cfg, req);
      return res.status(200).json({ ok: true, region: bi.region, price: bi.price, buyUrl: bi.buyUrl, intlPrice: cfg.priceIntl, bdPrice: cfg.priceBd, trial: cfg.trialBuilds });
    } catch (e) { return res.status(500).json({ ok: false, error: 'server_error' }); }
  }
  const machine = String(b.machine || '').toLowerCase(), nonce = String(b.nonce || '');
  const info = { name: clean(b.name, 60), ae: clean(b.ae, 20), ext: clean(b.ext, 20) };
  if (!MACHINE_RE.test(machine) || !NONCE_RE.test(nonce) || !VERSION_RE.test(info.ext)) return res.status(400).json({ ok: false, error: 'bad_request' });

  try {
    if (await recentCount(`ip=eq.${enc(ip)}`, 1) > 60) return res.status(429).json({ ok: false, error: 'rate_limited' });
    const cfg = await config();
    const key = normKey(b.key);
    const now = Math.floor(Date.now() / 1000);
    const bi = buyInfo(cfg, req);                         // price + shop for this visitor's country
    const reply = (payload) => res.status(200).json({ ok: true, token: sign(cfg, Object.assign({ v: 1, machine, nonce, iat: now, ext: info.ext }, payload)) });
    const fail = (error, extra) => res.status(200).json(Object.assign({ ok: false, error, buyUrl: bi.buyUrl, price: bi.price, token: sign(cfg, { v: 1, machine, nonce, iat: now, ext: info.ext, error }) }, extra || {}));

    // start of a panel / bridge session: license (or trial) check, gives the builder's content key
    if (action === 'session') {
      await log('session', ip, { license_key: key || null, machine, detail: info });
      const update = updateInfo(cfg, info.ext);
      if (key) {
        const c = await checkLicense(cfg, key, machine, info, ip, { register: true });
        if (c.error) return fail(c.error, c.seats ? { seats: c.seats } : null);
        return reply({ mode: 'licensed', key: mask(key), exp: now + cfg.sessionHours * 3600, ck: contentKey(cfg, info.ext), buyUrl: bi.buyUrl, price: bi.price, update });
      }
      const t = await trialState(cfg, machine, info, ip);
      const remaining = Math.max(0, cfg.trialBuilds - t.used);
      return reply({ mode: 'trial', remaining, limit: cfg.trialBuilds, exp: now + cfg.sessionHours * 3600, ck: remaining > 0 ? contentKey(cfg, info.ext) : null, buyUrl: bi.buyUrl, price: bi.price, update });
    }

    // before every build: licensed -> still valid on this computer; trial -> uses one free build
    if (action === 'build') {
      const s = readToken(cfg, b.session);
      if (!s || s.machine !== machine || !s.exp || s.exp < now || s.error) return fail('session_expired');
      const up = updateInfo(cfg, info.ext);               // a REQUIRED update blocks building on the old version
      if (up && up.required) return fail('update_required', { update: up });
      if (s.mode === 'licensed') {
        if (!key || mask(key) !== s.key) return fail('session_expired');
        const c = await checkLicense(cfg, key, machine, info, ip, { register: false });
        if (c.error) return fail(c.error);
        await log('build', ip, { license_key: key, machine });
        return reply({ mode: 'licensed', build: true });
      }
      const r = (await db('rpc/cf_use_trial_build', { method: 'POST', body: { p_machine: machine, p_limit: cfg.trialBuilds } })).data;
      if (r < 0) return fail('trial_over');
      await log('build_trial', ip, { machine });
      return reply({ mode: 'trial', build: true, remaining: r, limit: cfg.trialBuilds });
    }

    // the computers using a license (shown when seats are full, and in Manage license)
    if (action === 'seats') {
      if (!key) return fail('invalid_key');
      const lic = (await rows(`cf_licenses?key=eq.${enc(key)}&select=key,status,seats`))[0];
      if (!lic) return fail('invalid_key');
      const acts = await rows(`cf_activations?license_key=eq.${enc(key)}&active=eq.true&select=id,machine,machine_name,last_seen&order=last_seen.desc`);
      return reply({ seats: acts.map(a => ({ id: a.id, name: a.machine_name || 'Computer', lastSeen: a.last_seen, thisComputer: a.machine === machine })), limit: lic.seats });
    }

    // free a seat: this computer always; another computer max N times per 30 days (stops seat ping-pong sharing)
    if (action === 'deactivate') {
      if (!key) return fail('invalid_key');
      const target = b.target === 'self' ? 'self' : +b.target;
      if (target === 'self') {
        await db(`cf_activations?license_key=eq.${enc(key)}&machine=eq.${machine}`, { method: 'PATCH', body: { active: false } });
        await log('deactivate_self', ip, { license_key: key, machine });
        return reply({ deactivated: 'self' });
      }
      const act = (await rows(`cf_activations?id=eq.${target}&license_key=eq.${enc(key)}&select=id`))[0];
      if (!act) return fail('not_found');
      if (await recentCount(`kind=eq.deactivate_other&license_key=eq.${enc(key)}`, 30 * 24 * 60) >= cfg.deactivationsPer30d) return fail('deactivation_limit');
      await db(`cf_activations?id=eq.${target}`, { method: 'PATCH', body: { active: false } });
      await log('deactivate_other', ip, { license_key: key, machine, detail: { target } });
      return reply({ deactivated: target });
    }

    return res.status(400).json({ ok: false, error: 'bad_action' });
  } catch (e) {
    console.error('codeflow', action, e.message);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
}
