// Vercel Edge Middleware — restrict /uiflow/bangladesh to Bangladesh visitors only.
// Runs on the edge before the page is served; uses Vercel's geo header.
// Non-Bangladesh visitors are redirected to the international Pro page.

export const config = {
  matcher: ['/uiflow/bangladesh', '/uiflow/bangladesh.html'],
};

export default function middleware(request) {
  const country = request.headers.get('x-vercel-ip-country') || '';
  // Fail-closed: only confirmed Bangladesh (BD) visitors may continue.
  if (country !== 'BD') {
    return Response.redirect(new URL('/uiflow/pro', request.url), 307);
  }
  // BD visitors fall through and get the page.
}
