// Glow Show — Cloudflare Worker backend (the only server component).
// Endpoints:
//   GET  /time            -> { t }  server epoch ms, read at request arrival (accurate; CF freezes
//                            Date.now() between I/O, but it is correct at handler entry)
//   GET  /t0?showId=X     -> { t0, hold, updated } | { t0: null }  armed start time for a show
//   POST /t0              body { showId, t0, hold } -> { ok }  conductor arms/holds a show (KV, 24h TTL)
// Deploy (one-time setup in worker/): npx wrangler login ; npx wrangler kv namespace create GLOW
// (paste id into wrangler.toml) ; npx wrangler deploy

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request, env) {
    const now = Date.now(); // must be first — accurate at request arrival
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);

    if (url.pathname === '/time') {
      return json({ t: now });
    }

    if (url.pathname === '/t0') {
      if (request.method === 'POST') {
        let body;
        try {
          body = await request.json();
        } catch {
          return json({ error: 'bad json' }, 400);
        }
        const showId = String(body.showId || 'default').slice(0, 64);
        const record = {
          t0: Number.isFinite(body.t0) ? body.t0 : null,
          hold: !!body.hold,
          updated: now,
        };
        await env.GLOW.put('t0:' + showId, JSON.stringify(record), { expirationTtl: 86400 });
        return json({ ok: true, ...record });
      }
      const showId = String(url.searchParams.get('showId') || 'default').slice(0, 64);
      const raw = await env.GLOW.get('t0:' + showId);
      return json(raw ? JSON.parse(raw) : { t0: null, hold: false, updated: null });
    }

    return json({ error: 'not found' }, 404);
  },
};
