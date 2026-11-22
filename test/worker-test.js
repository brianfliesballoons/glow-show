/* Suite 7 — the Worker (worker/time.js), run in node against an in-memory KV.
   The real handler module is imported as is (no copy). Covers /time, the
   conductor PIN (claim, wrong PIN refused, right PIN accepted, nothing but a
   salted hash stored), PUT/GET /pack, and /t0 by show code plus the legacy
   showId read. Needs pure-core.js (node test/extract.js) for a real pack. */
const fs = require('fs');
const path = require('path');
const C = require('./pure-core.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '   -> ' + JSON.stringify(extra).slice(0, 600) : '')); }
}
function section(s) { console.log('\n== ' + s); }

function fakeKV() {
  const m = new Map(), log = [];
  return {
    m, log,
    async get(k) { return m.has(k) ? m.get(k).v : null; },
    async put(k, v, o) { log.push(['put', k, o && o.expirationTtl]); m.set(k, { v: String(v), ttl: o && o.expirationTtl }); },
    async delete(k) { m.delete(k); },
  };
}

(async () => {
  // loaded as an ES module straight from its source (worker/ has no package.json saying "module")
  const src = fs.readFileSync(path.join(__dirname, '..', 'worker', 'time.js'), 'utf8');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
  const W = mod.default;
  const env = { GLOW: fakeKV() };
  const BASE = 'https://glow-show.example';
  const call = async (method, p, body, pin) => {
    const headers = { 'Content-Type': 'application/json' };
    if (pin != null) headers['X-Glow-Pin'] = pin;
    const res = await W.fetch(new Request(BASE + p, { method, headers, body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) }), env);
    let j = null; try { j = await res.json(); } catch (e) {}
    return { status: res.status, j, h: res.headers };
  };

  section('/time stays as it was');
  const before = Date.now();
  const tm = await call('GET', '/time');
  ok('/time -> { t } at request arrival', tm.status === 200 && typeof tm.j.t === 'number' && tm.j.t >= before && tm.j.t <= Date.now() && Object.keys(tm.j).length === 1, tm.j);
  ok('CORS * and no-store on every answer', tm.h.get('access-control-allow-origin') === '*' && tm.h.get('cache-control') === 'no-store');
  const pre = await W.fetch(new Request(BASE + '/pack/TEST', { method: 'OPTIONS' }), env);
  ok('preflight allows PUT and the X-Glow-Pin header', /PUT/.test(pre.headers.get('access-control-allow-methods')) && /X-Glow-Pin/i.test(pre.headers.get('access-control-allow-headers')));

  const show = C.parseShowText(fs.readFileSync(path.join(__dirname, '..', 'shows', 'demo-show.json'), 'utf8')).show;
  const P = C.compileShowPacks(C.compileShow(show));
  const code = P.code;

  section('PUT /pack — the conductor PIN');
  let r = await call('PUT', '/pack/' + code, P);
  ok('no PIN -> 401, nothing written', r.status === 401 && env.GLOW.m.size === 0, r);
  r = await call('PUT', '/pack/' + code, P, '123');
  ok('a PIN under 6 characters -> 401', r.status === 401 && env.GLOW.m.size === 0, r);
  r = await call('PUT', '/pack/zz', P, '123456');
  ok('a malformed show code -> 400', r.status === 400);
  r = await call('PUT', '/pack/' + (code === 'TEST' ? 'TESS' : 'TEST'), P, '123456');
  ok('body for another code -> 400, no claim', r.status === 400 && env.GLOW.m.size === 0, r);
  const broken = JSON.parse(JSON.stringify(P)); broken.packs[P.keys[0]].format = 'nope';
  r = await call('PUT', '/pack/' + code, broken, '123456');
  ok('a pack that is not glow-pack/1 -> 400, no claim', r.status === 400 && env.GLOW.m.size === 0, r);
  r = await call('PUT', '/pack/' + code, P, 'right-pin-1');
  ok('first PUT claims the code -> 200', r.status === 200 && r.j.ok && r.j.code === code && r.j.keys.length === P.keys.length, r);
  const pinRec = env.GLOW.m.get('pin:' + code);
  ok('only a salted SHA-256 is stored, never the PIN', pinRec && !pinRec.v.includes('right-pin-1') && /^[0-9a-f]{64}$/.test(JSON.parse(pinRec.v).hash) && /^[0-9a-f]{32}$/.test(JSON.parse(pinRec.v).salt));
  r = await call('PUT', '/pack/' + code, P, 'wrong-pin-2');
  ok('a later PUT with the wrong PIN -> 403', r.status === 403, r);
  const writes = env.GLOW.log.length;
  r = await call('PUT', '/pack/' + code, P, 'right-pin-1');
  ok('a later PUT with the right PIN -> 200 (one KV write)', r.status === 200 && env.GLOW.log.length === writes + 1, env.GLOW.log.slice(writes));

  section('GET /pack');
  r = await call('GET', '/pack/' + code);
  ok('GET /pack/:code -> the balloon numbers only', r.status === 200 && JSON.stringify(r.j.keys) === JSON.stringify(P.keys) && r.j.by === 'balloon' && !r.j.packs, r.j);
  r = await call('GET', '/pack/' + code + '/5');
  ok('GET /pack/:code/5 -> exactly balloon 5\'s pack', r.status === 200 && JSON.stringify(r.j) === JSON.stringify(P.packs['5']));
  ok('... and it plays the same as the web', JSON.stringify(C.packPlan(r.j, 20000)) === JSON.stringify(C.packPlan(P.packs['5'], 20000)));
  r = await call('GET', '/pack/' + code + '/99');
  ok('an unknown balloon -> 404', r.status === 404);
  r = await call('GET', '/pack/' + code + '/__proto__');
  ok('a prototype key -> 404, not an object leak', r.status === 404);
  r = await call('GET', '/pack/ABCD');
  ok('an unpublished code -> 404', r.status === 404);

  section('PUT / GET /pack — a field show\'s packs carry the display-only fieldView');
  {
    const hv = C.parseShowText(fs.readFileSync(path.join(__dirname, '..', 'shows', 'havasu-lightning-storm.json'), 'utf8')).show;
    const HP = C.compileShowPacks(C.compileShow(hv));
    const body = JSON.stringify(HP);
    const src2 = fs.readFileSync(path.join(__dirname, '..', 'worker', 'time.js'), 'utf8');
    const max = Number((src2.match(/const MAX_BODY = (\d+)/) || [])[1]);
    ok('Havasu (21 balloons) with fieldView in every pack stays under the Worker\'s body limit (' + body.length + ' of ' + max + ' bytes)', max > 0 && body.length < max && !!HP.packs['5'].fieldView);
    r = await call('PUT', '/pack/' + HP.code, HP, 'havasu-pin-1');
    ok('the Worker accepts it -> 200', r.status === 200 && r.j.ok, r);
    r = await call('GET', '/pack/' + HP.code + '/5');
    ok('GET /pack/:code/5 hands back balloon 5\'s pack with its fieldView intact', r.status === 200 && JSON.stringify(r.j) === JSON.stringify(HP.packs['5']) &&
       r.j.fieldView.balloons.length === 21);
  }

  section('/t0 — arm and hold need the PIN');
  const t0 = Date.now() + 120000;
  r = await call('POST', '/t0', { code, t0, hold: false });
  ok('arm with no PIN -> 401', r.status === 401);
  r = await call('POST', '/t0', { code, t0, hold: false }, 'wrong-pin-2');
  ok('arm with the wrong PIN -> 403', r.status === 403);
  r = await call('POST', '/t0', { showId: 'demo', t0, hold: false }, 'right-pin-1');
  ok('arm with no show code -> 400 (the old showId-only POST is refused)', r.status === 400);
  r = await call('POST', '/t0', { code, t0, hold: false }, 'right-pin-1');
  ok('arm with the right PIN -> 200', r.status === 200 && r.j.ok && r.j.t0 === t0 && r.j.hold === false, r.j);
  r = await call('GET', '/t0?code=' + code);
  ok('GET /t0?code= reads it back', r.status === 200 && r.j.t0 === t0 && r.j.hold === false);
  ok('an armed start lives a day', env.GLOW.m.get('t0c:' + code).ttl === 86400);
  r = await call('POST', '/t0', { code, t0, hold: true }, 'wrong-pin-2');
  ok('hold with the wrong PIN -> 403, the start stands', r.status === 403 && JSON.parse(env.GLOW.m.get('t0c:' + code).v).hold === false);
  r = await call('POST', '/t0', { code, t0: null, hold: true }, 'right-pin-1');
  ok('hold with the right PIN -> 200', r.status === 200 && r.j.hold === true);
  r = await call('POST', '/t0', { code: 'WXYZ', t0, hold: false }, 'another-pin');
  ok('arming an unclaimed code claims it', r.status === 200 && env.GLOW.m.has('pin:WXYZ'));
  r = await call('PUT', '/pack/WXYZ', JSON.parse(JSON.stringify(P).split('"' + code + '"').join('"WXYZ"')), 'right-pin-1');
  ok('... and then its packs need that PIN, not another show\'s', r.status === 403, r);
  r = await call('POST', '/t0', 'not json', 'right-pin-1');
  ok('bad JSON -> 400', r.status === 400);
  env.GLOW.m.set('t0:old-show', { v: JSON.stringify({ t0: 5, hold: false, updated: 1 }) });
  r = await call('GET', '/t0?showId=old-show');
  ok('legacy GET /t0?showId= still reads', r.j.t0 === 5);
  r = await call('GET', '/t0?code=QQQQ');
  ok('nothing armed -> { t0: null }', r.j.t0 === null && r.j.hold === false);
  r = await call('GET', '/nope');
  ok('unknown path -> 404', r.status === 404);

  console.log('\n================  ' + pass + ' passed, ' + fail + ' failed  ================');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
