export const config = { runtime: 'edge' };

// Returns the visitor's country using Vercel's built-in geo header.
// Same-origin, so no CORS issues and not blockable like third-party IP APIs.
export default function handler(request) {
  const country = request.headers.get('x-vercel-ip-country') || '';
  return new Response(JSON.stringify({ country: country }), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store'
    }
  });
}
