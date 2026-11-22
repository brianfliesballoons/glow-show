// Glow Show — Cloudflare Worker backend (the only server component). Free tier: KV allows
// 1,000 writes a day, so only the conductor ever writes (a publish, an arm, a hold).
// Endpoints:
//   GET  /time               -> { t }  server epoch ms, read at request arrival (accurate; CF freezes
//                               Date.now() between I/O, but it is correct at handler entry)
//   GET  /t0?code=K7QF       -> { t0, hold, updated } | { t0: null, ... }  armed start for a show code
//   GET  /t0?showId=slug     -> the same, for pages from before show codes (read only, legacy)
//   POST /t0                 body { code, t0, hold }, header X-Glow-Pin -> { ok, t0, hold, updated }
//   PUT  /pack/:code         body = compileShowPacks() output, header X-Glow-Pin -> { ok, code, keys }
//   GET  /pack/:code         -> { code, title, by, keys }   the balloon numbers (or groups) on offer
//   GET  /pack/:code/:key    -> one balloon's (or group's) glow-pack/1, with the show's display-only
//                               fieldView added as its last key when the show has one (phonePack())
// Storage: ONE KV value per show (one write a publish): a header line, then every pack's JSON text and
// the field's, end to end. A GET slices one pack out (and the field) without parsing the whole show,
// so a pilot's download costs the same CPU for a 300-balloon show as for a 21-balloon one.
// The conductor PIN: the first PUT /pack or POST /t0 for a code claims it; the Worker keeps only
// a salted SHA-256 of it. Every later write for that code must carry the same PIN.
// Spec of the pack: docs/PACK.md. Deploy: npx wrangler deploy --config worker/wrangler.toml

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Glow-Pin',
  'Cache-Control': 'no-store',
};

const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/; // showCode()'s alphabet: no 0/O, no 1/I
const PIN_MIN = 6;
const PIN_MAX = 64;
const KEEP_S = 180 * 86400;          // packs and PIN claims live 180 days
const T0_KEEP_S = 86400;             // an armed start lives a day
// A whole show's packs: each balloon's own pack is ~11 KB (Havasu), plus the field ONCE (~0.3 KB a
// balloon), so a 300-balloon show is ~3.4 MB. KV holds up to 25 MiB a value.
const MAX_BODY = 8000000;
const STORE_FORMAT = 'glow-packs-kv/1';   // the stored value: header line + pack texts + field text

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function hex(buf) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(text) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

function sameText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// The PIN gate for every write. Returns null when the write may go ahead, else the refusal.
async function pinGate(request, env, code, now) {
  const pin = request.headers.get('X-Glow-Pin') || '';
  if (pin.length < PIN_MIN || pin.length > PIN_MAX) {
    return json({ error: 'conductor PIN required (' + PIN_MIN + ' to ' + PIN_MAX + ' characters) in X-Glow-Pin' }, 401);
  }
  const raw = await env.GLOW.get('pin:' + code);
  if (!raw) {
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    const rec = { salt, hash: await sha256(salt + ':' + code + ':' + pin), claimed: now };
    await env.GLOW.put('pin:' + code, JSON.stringify(rec), { expirationTtl: KEEP_S });
    return null;
  }
  let rec;
  try { rec = JSON.parse(raw); } catch { return json({ error: 'PIN record unreadable' }, 500); }
  const hash = await sha256(rec.salt + ':' + code + ':' + pin);
  if (!sameText(hash, rec.hash)) return json({ error: 'wrong PIN for show ' + code }, 403);
  return null;
}

function packProblem(body, code) {
  if (!body || typeof body !== 'object') return 'body is not an object';
  if (body.code !== code) return 'body.code does not match the URL';
  if (body.by !== 'balloon' && body.by !== 'group') return 'by must be balloon or group';
  if (!body.packs || typeof body.packs !== 'object' || Array.isArray(body.packs)) return 'packs missing';
  if (!Array.isArray(body.keys) || body.keys.length === 0) return 'keys missing';
  const names = Object.keys(body.packs);
  if (names.length !== body.keys.length || !body.keys.every((k) => typeof k === 'string' && names.indexOf(k) !== -1)) {
    return 'keys do not match packs';
  }
  for (const k of body.keys) {
    const p = body.packs[k];
    if (!p || p.format !== 'glow-pack/1') return 'pack ' + k + ' is not glow-pack/1';
    if (p.code !== code || p.key !== k) return 'pack ' + k + ' has the wrong code or key';
    if (!Array.isArray(p.segments) || p.segments.length === 0 || !Array.isArray(p.tasks)) return 'pack ' + k + ' has no segments';
  }
  if (body.fieldView !== undefined && (!body.fieldView || typeof body.fieldView !== 'object' || Array.isArray(body.fieldView))) {
    return 'fieldView must be an object';
  }
  return null;
}

// The stored value: the header (its spans count from the start of the body, the text after the first
// newline), then every pack's text and the field's text. JSON never holds a raw newline, so the first
// one ends the header.
function storeText(body, code, now) {
  const at = Object.create(null), parts = [];
  let pos = 0;
  for (const k of body.keys) {
    const t = JSON.stringify(body.packs[k]);
    at[k] = [pos, t.length];
    parts.push(t);
    pos += t.length;
  }
  let fv = null;
  if (body.fieldView) {
    const t = JSON.stringify(body.fieldView);
    fv = [pos, t.length];
    parts.push(t);
  }
  const head = { format: STORE_FORMAT, code, title: String(body.title || ''), by: body.by, keys: body.keys, published: now, at, fv };
  return JSON.stringify(head) + '\n' + parts.join('');
}

// One balloon's pack as a phone receives it: its own text, and the field's added as its last key.
// Text-equal to JSON.stringify(phonePack(bundle, key)) in index.html.
function packText(raw, key) {
  const nl = raw.indexOf('\n');
  const head = JSON.parse(raw.slice(0, nl));
  const span = Object.prototype.hasOwnProperty.call(head.at, key) ? head.at[key] : null;
  if (!span) return { head, text: null };
  let text = raw.substr(nl + 1 + span[0], span[1]);
  if (head.fv) text = text.slice(0, -1) + ',"fieldView":' + raw.substr(nl + 1 + head.fv[0], head.fv[1]) + '}';
  return { head, text };
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
        const code = String(body.code || '');
        if (!CODE_RE.test(code)) return json({ error: 'show code required (4 characters)' }, 400);
        const refused = await pinGate(request, env, code, now);
        if (refused) return refused;
        const record = {
          t0: Number.isFinite(body.t0) ? body.t0 : null,
          hold: !!body.hold,
          updated: now,
        };
        await env.GLOW.put('t0c:' + code, JSON.stringify(record), { expirationTtl: T0_KEEP_S });
        return json({ ok: true, ...record });
      }
      if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
      const code = String(url.searchParams.get('code') || '');
      let raw;
      if (CODE_RE.test(code)) raw = await env.GLOW.get('t0c:' + code);
      else {
        const showId = String(url.searchParams.get('showId') || 'default').slice(0, 64);
        raw = await env.GLOW.get('t0:' + showId);
      }
      return json(raw ? JSON.parse(raw) : { t0: null, hold: false, updated: null });
    }

    const m = url.pathname.match(/^\/pack\/([^/]+)(?:\/([^/]+))?\/?$/);
    if (m) {
      const code = decodeURIComponent(m[1]);
      if (!CODE_RE.test(code)) return json({ error: 'bad show code' }, 400);
      const key = m[2] === undefined ? null : decodeURIComponent(m[2]);

      if (request.method === 'PUT') {
        if (key !== null) return json({ error: 'PUT the whole show to /pack/' + code }, 400);
        const text = await request.text();
        if (text.length > MAX_BODY) return json({ error: 'too big' }, 413);
        let body;
        try { body = JSON.parse(text); } catch { return json({ error: 'bad json' }, 400); }
        const problem = packProblem(body, code);
        if (problem) return json({ error: problem }, 400);
        const refused = await pinGate(request, env, code, now);
        if (refused) return refused;
        await env.GLOW.put('pack:' + code, storeText(body, code, now), { expirationTtl: KEEP_S });
        return json({ ok: true, code, keys: body.keys, published: now });
      }

      if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
      const raw = await env.GLOW.get('pack:' + code);
      if (!raw) return json({ error: 'no show published as ' + code }, 404);
      const missing = (by) => json({ error: (by === 'balloon' ? 'no balloon ' : 'no group ') + key + ' in show ' + code }, 404);
      if (raw.startsWith('{"format":"' + STORE_FORMAT + '"')) {
        if (key === null) {
          const head = JSON.parse(raw.slice(0, raw.indexOf('\n')));
          return json({ code, title: head.title, by: head.by, keys: head.keys, published: head.published });
        }
        const { head, text } = packText(raw, key);
        if (text === null) return missing(head.by);
        return new Response(text, { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
      // stored before 2026-11-22 (one JSON object, the field inside every pack): served as it was
      const all = JSON.parse(raw);
      if (key === null) {
        return json({ code, title: all.title, by: all.by, keys: all.keys, published: all.published });
      }
      const pack = Object.prototype.hasOwnProperty.call(all.packs, key) ? all.packs[key] : null;
      if (!pack) return missing(all.by);
      return json(pack);
    }

    return json({ error: 'not found' }, 404);
  },
};
