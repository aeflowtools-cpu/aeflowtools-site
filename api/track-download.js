export const config = { runtime: 'edge' };

// Logs a download-button click to Supabase, adding the visitor's country
// from Vercel's geo header (server-side = accurate, can't be spoofed).
const SB_URL = 'https://zomjnvryqmotggdkseag.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpvbWpudnJ5cW1vdGdnZGtzZWFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3MjQxMjcsImV4cCI6MjA5MTMwMDEyN30.R4z2Knbz9Bv6JU7ilXq47MJck7kMbnHWbe71UMYuwRE';

export default async function handler(request) {
  const country = request.headers.get('x-vercel-ip-country') || null;

  let button = 'uiflow_v2.0.0';
  try {
    const b = await request.json();
    if (b && b.button) button = String(b.button);
  } catch (e) {}

  try {
    await fetch(`${SB_URL}/rest/v1/rpc/track_download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}` },
      body: JSON.stringify({ p_button: button, p_country: country }),
    });
  } catch (e) {}

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
