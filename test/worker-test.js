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

  section('PUT / GET /pack — a field show: the field is published ONCE and each phone gets it with its own pack');
  const src2 = fs.readFileSync(path.join(__dirname, '..', 'worker', 'time.js'), 'utf8');
  const max = Number((src2.match(/const MAX_BODY = (\d+)/) || [])[1]);
  /* the Worker's own CPU on a request: every string it hands JSON.parse, while W.fetch runs (not the test's reads) */
  const realParse = JSON.parse;
  async function spied(method, p, body, pin) {
    const seen = [];
    JSON.parse = function (t) { seen.push(String(t).length); return realParse.apply(JSON, arguments); };
    let res;
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (pin != null) headers['X-Glow-Pin'] = pin;
      res = await W.fetch(new Request(BASE + p, { method, headers, body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) }), env);
    } finally { JSON.parse = realParse; }
    const text = await res.text();
    return { status: res.status, text, parsed: seen };
  }
  {
    const hv = C.parseShowText(fs.readFileSync(path.join(__dirname, '..', 'shows', 'havasu-lightning-storm.json'), 'utf8')).show;
    const HP = C.compileShowPacks(C.compileShow(hv));
    const body = JSON.stringify(HP);
    ok('Havasu (21 balloons): the field once at the top, no pack carries its own, ' + body.length + ' bytes (limit ' + max + ')',
       max > 0 && body.length < max && !!HP.fieldView && HP.keys.every(k => !('fieldView' in HP.packs[k])));
    r = await call('PUT', '/pack/' + HP.code, HP, 'havasu-pin-1');
    ok('the Worker accepts it -> 200 (one KV write)', r.status === 200 && r.j.ok, r);
    const stored = env.GLOW.m.get('pack:' + HP.code).v;
    ok('stored as one value: a header line, then every pack\'s text and the field\'s once (' + stored.length + ' bytes)',
       stored.startsWith('{"format":"glow-packs-kv/1"') && stored.split(JSON.stringify(HP.fieldView)).length === 2 && stored.length < body.length + 2000);
    const g5 = await spied('GET', '/pack/' + HP.code + '/5');
    ok('GET /pack/:code/5 = phonePack(bundle, 5): balloon 5\'s own pack with the show\'s fieldView as its last key, text for text',
       g5.status === 200 && g5.text === JSON.stringify(C.phonePack(HP, '5')) && JSON.parse(g5.text).fieldView.balloons.length === 21);
    ok('... and it plays exactly as balloon 5\'s pack does', JSON.stringify(C.packPlan(JSON.parse(g5.text), 110000)) === JSON.stringify(C.packPlan(HP.packs['5'], 110000)));
    r = await call('GET', '/pack/' + HP.code);
    ok('GET /pack/:code -> the numbers only (no packs, no field)', r.status === 200 && r.j.keys.length === 21 && !r.j.packs && !r.j.fieldView && r.j.title === HP.title);
    r = await call('GET', '/pack/' + HP.code + '/22');
    ok('a balloon not in the show -> 404 that names it', r.status === 404 && /no balloon 22/.test(r.j.error), r.j);
    r = await call('GET', '/pack/' + HP.code + '/__proto__');
    ok('... and a prototype key -> 404', r.status === 404);
    const bad = JSON.parse(body); bad.fieldView = [1, 2];
    r = await call('PUT', '/pack/' + HP.code, bad, 'havasu-pin-1');
    ok('a fieldView that is not an object -> 400', r.status === 400 && /fieldView/.test(r.j.error), r.j);
  }
  {
    // a show stored before this change (one JSON object, the field inside every pack) is still served as it was
    const old = { format: 'glow-packs/1', code: 'XLD2', title: 'old', by: 'balloon', keys: ['5'], published: 1,
                  packs: { '5': Object.assign({}, P.packs['5'], { code: 'XLD2', fieldView: { box: [0, 0, 1, 1], balloons: [] } }) } };
    env.GLOW.m.set('pack:XLD2', { v: JSON.stringify(old) });
    r = await call('GET', '/pack/XLD2/5');
    ok('a show stored the old way still serves its packs unchanged', r.status === 200 && JSON.stringify(r.j) === JSON.stringify(old.packs['5']));
    r = await call('GET', '/pack/XLD2');
    ok('... and its numbers', r.status === 200 && JSON.stringify(r.j.keys) === '["5"]');
    // a page from before this change publishes packs that carry their own field: taken and served as they are
    const legacy = JSON.parse(JSON.stringify(P).split('"' + code + '"').join('"XLD3"'));
    legacy.packs['5'].fieldView = { box: [0, 0, 1, 1], balloons: [] };
    r = await call('PUT', '/pack/XLD3', legacy, 'legacy-pin-1');
    const l5 = await spied('GET', '/pack/XLD3/5');
    ok('an older page\'s publish (the field inside a pack) is served exactly as sent', r.status === 200 && l5.text === JSON.stringify(legacy.packs['5']));
  }

  section('PUT / GET /pack — 300 balloons: the publish grows with the balloon count, not its square');
  {
    // Lightning Storm's choreography on 300 spots of the same field: every pattern re-banded over the
    // balloons in the same part of the field (pure helpers, as the editor would)
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'shows', 'havasu-lightning-storm.json'), 'utf8'));
    const orig = C.validateShow(JSON.parse(JSON.stringify(raw))).show;
    const big = JSON.parse(JSON.stringify(raw));
    const fill = C.autofillField(big.field, 300, { groupIds: big.groups.map(g => g.id), minSpacingM: 4 });
    big.balloons = fill.balloons;
    const all = big.balloons.map(b => b.n);
    big.cues.forEach(c => {
      if (c.type !== 'pattern') return;
      let members = all;
      if (c.target && c.target.n) {
        const inSet = new Set(c.target.n);
        members = big.balloons.filter(b => {
          let best = null, bd = Infinity;
          orig.balloons.forEach(o => { const d = Math.hypot(o.x - b.x, o.y - b.y); if (d < bd) { bd = d; best = o; } });
          return inSet.has(best.n);
        }).map(b => b.n);
        c.target = { n: members };
      }
      c.bands = C.patternBands({ pattern: c.pattern, dir: c.dir, bandCount: c.bands.length, members, seed: c.seed }, big.balloons);
    });
    big.title = 'Lightning Storm on 300 balloons';
    const v = C.validateShow(big);
    ok('a 300-balloon show on the Havasu field validates (' + fill.fitted + ' spots, ' + (fill.spacingM || 0).toFixed(1) + ' m apart)', v.ok && v.show.balloons.length === 300, v.errors && v.errors.slice(0, 3));
    const BP = C.compileShowPacks(C.compileShow(v.show));
    const text = JSON.stringify(BP);
    const fvLen = JSON.stringify(BP.fieldView).length;
    const packsLen = BP.keys.reduce((n, k) => n + JSON.stringify(BP.packs[k]).length, 0);
    const oldWay = packsLen + BP.keys.length * (fvLen + 13);
    ok('its publish is ' + (text.length / 1e6).toFixed(2) + ' MB, under the Worker\'s ' + (max / 1e6).toFixed(0) + ' MB limit: 300 packs of ~' + Math.round(packsLen / 300 / 1000) + ' KB + the field once (' + Math.round(fvLen / 1000) + ' KB). With the field in every pack it would be ' + (oldWay / 1e6).toFixed(1) + ' MB',
       text.length < max && text.length - packsLen - fvLen < 20000 && oldWay > 2 * text.length);
    const t0 = Date.now();
    r = await call('PUT', '/pack/' + BP.code, BP, 'big-show-pin');
    const putMs = Date.now() - t0;
    ok('the Worker accepts it -> 200 (one KV write; ' + putMs + ' ms here)', r.status === 200 && r.j.ok && r.j.keys.length === 300, r.j);
    r = await call('GET', '/pack/' + BP.code);
    ok('GET /pack/:code -> all 300 numbers', r.status === 200 && r.j.keys.length === 300 && JSON.stringify(r.j.keys) === JSON.stringify(BP.keys));
    let badK = null, maxParsed = 0, ms = 0;
    for (const k of BP.keys) {
      const t1 = Date.now();
      const g = await spied('GET', '/pack/' + BP.code + '/' + k);
      ms += Date.now() - t1;
      maxParsed = Math.max(maxParsed, Math.max.apply(null, g.parsed.concat([0])));
      if (badK === null && (g.status !== 200 || g.text !== JSON.stringify(C.phonePack(BP, k)))) badK = k;
    }
    ok('GET /pack/:code/:n for every one of the 300 = phonePack(bundle, n): its own pack with the field, text for text (' + (ms / 300).toFixed(2) + ' ms a GET here)', badK === null, badK);
    ok('a GET never parses the whole show: the most the Worker hands JSON.parse is its header line (' + maxParsed + ' characters of ' + env.GLOW.m.get('pack:' + BP.code).v.length + ')',
       maxParsed > 0 && maxParsed < 30000);
    const one = await spied('GET', '/pack/' + BP.code + '/150');
    const pk = JSON.parse(one.text);
    ok('balloon 150\'s phone gets its own pack (' + Math.round(one.text.length / 1000) + ' KB with the field) and plays it as the bundle\'s pack plays',
       pk.balloon === 150 && pk.fieldView.balloons.length === 300 && JSON.stringify(C.packPlan(pk, 90000)) === JSON.stringify(C.packPlan(BP.packs['150'], 90000)));
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
