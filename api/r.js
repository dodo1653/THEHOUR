// Same-origin proxy to the relay (Vercel edge), cached a couple of seconds at the CDN so the relay's free request
// budget holds however many people are watching. Submitting, voting and uploads go to the relay directly.
export const config = { runtime: 'edge' }
const RELAY = 'https://thehour-relay.vetted-relay.workers.dev/v1/'
const TTL = { hour: 2, board: 4, vamp: 2, coin: 4 }
export default async function handler(req) {
  const u = new URL(req.url), path = u.searchParams.get('path')
  if (!TTL[path]) return new Response('{"error":"unknown"}', { status: 404, headers: { 'content-type': 'application/json' } })
  u.searchParams.delete('path')
  const r = await fetch(RELAY + path + '?' + u.searchParams.toString(), { cache: 'no-store' })
  return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': `public, s-maxage=${TTL[path]}, stale-while-revalidate=${TTL[path] * 3}` } })
}
