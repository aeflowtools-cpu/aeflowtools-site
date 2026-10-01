// Vercel Edge Middleware.
//  1. /uiflow/bangladesh is only for Bangladesh visitors (uses Vercel's geo header; others go to the Pro page).
//  2. /codeflow is HIDDEN until launch: only a visitor who opened the private preview link once
//     (https://www.aeflowtools.com/codeflow?preview=TOKEN, which sets a 30-day cookie) can see it;
//     everyone else is sent to the home page. To launch, delete the CodeFlow block below and its matcher entries.

export const config = {
  matcher: ['/uiflow/bangladesh', '/uiflow/bangladesh.html', '/codeflow', '/codeflow/', '/codeflow/index.html'],
};

const CODEFLOW_PREVIEW = 'eab6ed1780239548fa93382b';

export default function middleware(request) {
  const url = new URL(request.url);

  if (url.pathname.startsWith('/codeflow')) {
    const cookies = (request.headers.get('cookie') || '').split(/;\s*/);
    if (cookies.indexOf('cf_preview=' + CODEFLOW_PREVIEW) >= 0) return;          // you: let the page through
    if (url.searchParams.get('preview') === CODEFLOW_PREVIEW) {                  // you, first time: set the cookie
      return new Response(null, { status: 307, headers: {
        Location: '/codeflow',
        'Set-Cookie': 'cf_preview=' + CODEFLOW_PREVIEW + '; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax',
        'Cache-Control': 'no-store',
      } });
    }
    return new Response(null, { status: 307, headers: { Location: '/', 'Cache-Control': 'no-store' } });   // everyone else
  }

  const country = request.headers.get('x-vercel-ip-country') || '';
  // Fail-closed: only confirmed Bangladesh (BD) visitors may continue.
  if (country !== 'BD') {
    return Response.redirect(new URL('/uiflow/pro', request.url), 307);
  }
  // BD visitors fall through and get the page.
}