/* Suite 6 — cue packs (glow-pack/1): one balloon's whole show, worked out
   once by the web, played by a phone.

   The property everything rests on: for every shipped show and every balloon
   (or group), packPlan(pack, t) — the small reference player the Swift and
   Kotlin pilot apps port line for line — answers EXACTLY what pilotPlan(tl,
   n, gid, t) answers today, the function the live web pilot view draws from.
   Checked on the pack after a JSON round trip (what a phone actually holds),
   at every segment boundary ±1 ms, at both sides of every raw engine edge
   (windows, GET READY, STOP, VENT, pulse half-beats — taken from the lanes,
   not from the pack, so a boundary the compiler missed would still be hit),
   and on a 50 ms grid across the whole song.

   Then the golden vectors: test/golden/*.json, a few packs plus
   [t, expected packPlan, expected beat phase] rows. The native apps' unit
   tests load these same files. This suite fails if they go stale; rewrite
   them on purpose with:   node test/pack-test.js --write-golden            */
const fs = require('fs');
const path = require('path');
const C = require('./pure-core.js');
const ROOT = path.join(__dirname, '..');
const GOLDEN = path.join(__dirname, 'golden');
const WRITE = process.argv.indexOf('--write-golden') !== -1;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '   -> ' + JSON.stringify(extra).slice(0, 900) : '')); }
}
function section(s) { console.log('\n== ' + s); }

/* key-order-independent JSON: the comparison the native ports also make */
function canon(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
}
/* every number finite, nothing undefined: JSON would silently turn NaN/Infinity into null */
function jsonSafe(v, at) {
  if (v === undefined) return at;
  if (typeof v === 'number') return isFinite(v) ? null : at;
  if (v === null || typeof v !== 'object') return null;
  for (const k of Object.keys(v)) { const r = jsonSafe(v[k], at + '.' + k); if (r) return r; }
  return null;
}

/* ------------------------------------------------------------ the shows */
const shows = [];
['demo-show.json', 'havasu-lightning-storm.json', 'havasu-forest-for-the-trees.json'].forEach(fn => {
  const r = C.parseShowText(fs.readFileSync(path.join(ROOT, 'shows', fn), 'utf8'));
  if (!r.ok) throw new Error(fn + ' does not validate');
  shows.push({ name: fn.replace(/\.json$/, ''), show: r.show });
});
{ // the built-in demo, exactly as the page loads it (validateShow(DEMO_SHOW))
  const src = fs.readFileSync(path.join(__dirname, 'script-0.js'), 'utf8');
  const a = src.indexOf('const DEMO_SHOW = {');
  const open = src.indexOf('{', a), close = src.indexOf('\n};', open);
  const lit = new Function('return (' + src.slice(open, close + 2) + ')')();
  const v = C.validateShow(lit);
  if (!v.ok) throw new Error('inline DEMO_SHOW does not validate');
  shows.push({ name: 'builtin-demo', show: v.show });
}
{ // a show with no balloon numbers: packs by group (the demo with its balloons taken off)
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'shows', 'demo-show.json'), 'utf8'));
  delete raw.balloons;
  const v = C.validateShow(raw);
  if (!v.ok) throw new Error('demo without balloons does not validate');
  shows.push({ name: 'demo-groups', show: v.show });
}

/* the moments to check for one lane: raw engine edges from the timeline itself */
function laneTimes(tl, n, gid) {
  const out = new Set();
  const lane = (tl.hasBalloonCues && n != null && tl.balloonOf[n]) ? (tl.perBalloon[n] || tl.perGroup[tl.balloonOf[n].group]) : tl.perGroup[gid];
  const edge = x => { if (!isFinite(x)) return; const f = Math.floor(x); [f - 1, f, f + 1, f + 2].forEach(v => out.add(v)); };
  [0, tl.audioMs, tl.endMs].forEach(edge);
  if (lane) {
    ['windows', 'readies', 'stops', 'vents'].forEach(k => lane[k].forEach(w => { edge(w.t); edge(w.end); if (w.cueT != null) edge(w.cueT); }));
    lane.windows.forEach(w => {
      if (w.type !== 'pulse' || !w.bpm) return;
      const beatMs = 60000 / w.bpm;
      for (let j = 0; j * beatMs / 2 <= w.dur + beatMs; j++) edge(w.t + j * beatMs / 2);
    });
  }
  return out;
}

/* ------------------------------------------------------------ lockstep */
section('LOCKSTEP — packPlan(pack) == pilotPlan(timeline) for every balloon / group');
const compiled = {};
let totalMoments = 0;
shows.forEach(({ name, show }) => {
  const tl = C.compileShow(show);
  let P, err = null;
  try { P = C.compileShowPacks(tl); } catch (e) { err = e.message; }
  ok(name + ': compileShowPacks runs', !err, err);
  if (err) return;
  compiled[name] = { tl, P };
  const wantKeys = tl.balloons.length ? tl.balloons.map(b => String(b.n)) : tl.groupIds.slice();
  ok(name + ': one pack per ' + (tl.balloons.length ? 'balloon' : 'group') + ' (' + wantKeys.length + ')',
     canon(P.keys) === canon(wantKeys) && canon(Object.keys(P.packs).sort()) === canon(wantKeys.slice().sort()) && P.by === (tl.balloons.length ? 'balloon' : 'group'));
  ok(name + ': show code is the web\'s showCode() (' + P.code + ')', P.code === C.showCode(show) && Object.values(P.packs).every(p => p.code === P.code));
  const unsafe = jsonSafe(P, 'packs');
  ok(name + ': every value is plain JSON (no NaN, Infinity or undefined)', !unsafe, unsafe);
  const text = JSON.stringify(P);
  const RT = JSON.parse(text);
  ok(name + ': JSON round trip is lossless', canon(RT) === canon(P) && JSON.stringify(RT) === text);

  P.keys.forEach(key => {
    const pk = RT.packs[key];
    const n = P.by === 'balloon' ? Number(key) : null;
    const gid = n != null ? tl.balloonOf[n].group : key;
    ok(name + ' ' + key + ': pack header', pk.format === 'glow-pack/1' && pk.key === key && pk.balloon === n && pk.group === gid &&
       pk.lenMs === tl.audioMs && pk.title === show.title && pk.segments.length > 0 && pk.segments[0].phase === 'PRESHOW' &&
       pk.segments[pk.segments.length - 1].phase === 'ENDED' &&
       pk.segments.every((s, i) => i === 0 || (s.at > pk.segments[i - 1].at && Number.isInteger(s.at))),
       { key, n, gid, first: pk.segments[0], last: pk.segments[pk.segments.length - 1] });
    ok(name + ' ' + key + ': tasks are pilotTasks()', canon(pk.tasks) === canon(C.pilotTasks(tl, n, gid)));

    const times = laneTimes(tl, n, gid);
    pk.segments.forEach(s => { times.add(s.at - 1); times.add(s.at); times.add(s.at + 1); });
    for (let t = -3000; t <= tl.endMs + 3000; t += 50) times.add(t);
    [-86400000, -60000, -1, 86400000].forEach(t => times.add(t));
    let bad = null, nT = 0;
    for (const t of times) {
      nT++;
      const want = canon(C.pilotPlan(tl, n, gid, t));
      const got = canon(C.packPlan(pk, t));
      if (want !== got) { bad = { t, want: JSON.parse(want).now, got: JSON.parse(got).now, wantPhase: JSON.parse(want).phase }; break; }
      const bw = C.beatAt(tl, t), bg = C.packBeatPhase(pk, t);
      if ((bw ? bw.phase : null) !== bg) { bad = { t, beat: [bw && bw.phase, bg] }; break; }
    }
    totalMoments += nT;
    ok(name + ' ' + key + ': packPlan == pilotPlan + beat phase at ' + nT + ' moments', bad === null, bad);
  });
});

/* one balloon per shipped show, EVERY whole millisecond from -3 s to the end + 3 s:
   no sampling at all, so no boundary can hide between two checked moments */
section('EXHAUSTIVE — every millisecond (or every 3 / 7 ms on the long Havasu songs), one balloon per show');
[['demo-show', '1', 1], ['demo-groups', 'north', 1], ['havasu-lightning-storm', '5', 3], ['havasu-forest-for-the-trees', '12', 7]].forEach(([name, key, step]) => {
  const c = compiled[name];
  if (!c) { ok(name + ' compiled', false); return; }
  const pk = JSON.parse(JSON.stringify(c.P.packs[key]));
  const n = c.P.by === 'balloon' ? Number(key) : null, gid = n != null ? c.tl.balloonOf[n].group : key;
  let bad = null, nT = 0;
  for (let t = -3000; t <= c.tl.endMs + 3000 && bad === null; t += step) {
    nT++;
    if (canon(C.packPlan(pk, t)) !== canon(C.pilotPlan(c.tl, n, gid, t))) bad = t;
  }
  totalMoments += nT;
  ok(name + ' ' + key + ': packPlan == pilotPlan at every ' + (step === 1 ? 'ms' : step + ' ms') + ' (' + nT + ' moments)', bad === null, bad);
});

/* ------------------------------------------------------------ haptics */
section('HAPTICS');
Object.keys(compiled).forEach(name => {
  const { P } = compiled[name];
  let bad = null;
  P.keys.forEach(key => {
    if (bad) return;
    const pk = P.packs[key];
    const at = {};
    pk.haptics.forEach(h => { at[h.at] = h.kind; });
    if (!pk.haptics.every(h => pk.hapticPatterns[h.kind] && pk.segments.some(s => s.at === h.at))) { bad = [key, 'unknown kind or not on a segment start']; return; }
    if (!pk.haptics.every((h, i) => i === 0 || h.at > pk.haptics[i - 1].at)) { bad = [key, 'not in time order']; return; }
    // every instruction starts with a buzz: a long one for a burn, a tick for a flicker
    pk.tasks.forEach(k => {
      if (bad) return;
      const t = Math.ceil(k.atMs);
      const want = k.kind === 'burn' ? 'burn' : 'on';
      if (at[t] !== want) bad = [key, 'task ' + k.index + ' at ' + t + ' has ' + at[t] + ', wanted ' + want];
    });
    // every GET READY / VENT / STOP span opens with its own buzz
    pk.segments.forEach((s, i) => {
      if (bad || i === 0) return;
      const a = pk.segments[i - 1];
      if (['ready', 'vent', 'stop'].indexOf(s.kind) !== -1 && a.kind !== s.kind && at[s.at] !== s.kind) bad = [key, s.kind + ' at ' + s.at + ' has ' + at[s.at]];
    });
  });
  ok(name + ': a buzz starts every burn, flicker, get-ready, vent and stop', bad === null, bad);
});
{
  const pk = compiled['demo-show'].P.packs['1'];
  ok('haptic list is short (demo #1: ' + pk.haptics.length + ' buzzes for ' + pk.tasks.length + ' tasks)', pk.haptics.length > 0 && pk.haptics.length < 12 * Math.max(1, pk.tasks.length));
  ok('pattern table is the documented one', canon(pk.hapticPatterns) === canon(C.PACK_HAPTICS) &&
     canon(Object.keys(C.PACK_HAPTICS).sort()) === canon(['burn', 'off', 'on', 'ready', 'stop', 'vent']));
}

/* ------------------------------------------------------------ cheap compile */
section('COMPILE COST');
{
  const t0 = Date.now();
  Object.keys(compiled).forEach(name => C.compileShowPacks(compiled[name].tl));
  const ms = Date.now() - t0;
  ok('all ' + Object.keys(compiled).length + ' shows compile in under 2 s (' + ms + ' ms)', ms < 2000);
  const sizes = Object.keys(compiled).map(n => JSON.stringify(compiled[n].P).length);
  ok('a whole show\'s packs stay small for the Worker (largest ' + Math.max.apply(null, sizes) + ' bytes, limit 2,000,000)', Math.max.apply(null, sizes) < 2000000);
}

/* ------------------------------------------------------------ golden vectors */
section('GOLDEN VECTORS — test/golden/');
/* expected rows carry tasks by their index (tasks[i].index), not the whole
   object: now.task, next, finale -> index or null; then -> [index]. */
function goldenRow(plan) {
  const ix = k => (k ? k.index : null);
  const o = JSON.parse(JSON.stringify(plan));
  o.now.task = ix(plan.now.task);
  o.next = ix(plan.next);
  o.finale = ix(plan.finale);
  o.then = plan.then.map(ix);
  return o;
}
const GOLD = [
  ['demo-show', '1'], ['demo-groups', 'shapes'],
  ['havasu-lightning-storm', '5'], ['havasu-forest-for-the-trees', '12']
];
if (WRITE && !fs.existsSync(GOLDEN)) fs.mkdirSync(GOLDEN);
const index = { format: 'glow-pack-golden/1', note: 'Each file: { show, key, pack, rows: [[tMs, expected packPlan(pack, tMs), expected packBeatPhase(pack, tMs)], ...] }. In an expected plan, now.task / next / finale are task indexes (or null) and then is a list of task indexes; everything else is exactly packPlan\'s answer. Compare after a JSON round trip, keys in any order, numbers exactly.', files: [] };
GOLD.forEach(([name, key]) => {
  const c = compiled[name];
  if (!c) { ok('golden ' + name + ' ' + key + ': show compiled', false); return; }
  const pk = JSON.parse(JSON.stringify(c.P.packs[key]));
  const ts = new Set();
  pk.segments.forEach(s => { ts.add(s.at - 1); ts.add(s.at); });
  pk.haptics.forEach(h => ts.add(h.at));
  for (let t = -5000; t <= pk.endMs + 5000; t += 5000) ts.add(t);
  [-86400000, -1, 0, 1, 86400000].forEach(t => ts.add(t));
  const rows = Array.from(ts).sort((a, b) => a - b).map(t => [t, goldenRow(C.packPlan(pk, t)), C.packBeatPhase(pk, t)]);
  const file = name + '-' + key + '.json';
  const body = JSON.stringify({ format: 'glow-pack-golden/1', show: name, key: key, pack: pk, rows: rows });
  const fp = path.join(GOLDEN, file);
  if (WRITE) fs.writeFileSync(fp, body + '\n');
  const onDisk = fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8').trim() : null;
  ok('golden ' + file + ' (' + rows.length + ' rows, ' + Math.round(body.length / 1024) + ' KB) matches what the web computes now', onDisk === body,
     onDisk === null ? 'missing: run node test/pack-test.js --write-golden' : 'stale: the web changed; rewrite on purpose with --write-golden and re-run the native tests');
  // the golden expected rows replay through the round-tripped pack (what a port does)
  const g = onDisk ? JSON.parse(onDisk) : null;
  let bad = null;
  if (g) g.rows.forEach(([t, want, beat]) => {
    if (!bad && (canon(goldenRow(C.packPlan(g.pack, t))) !== canon(want) || C.packBeatPhase(g.pack, t) !== beat)) bad = t;
  });
  ok('golden ' + file + ': every row replays from the file\'s own pack', g && bad === null, bad);
  index.files.push({ file: file, show: name, key: key, rows: rows.length, segments: pk.segments.length, tasks: pk.tasks.length, haptics: pk.haptics.length });
});
{
  const fp = path.join(GOLDEN, 'index.json');
  const body = JSON.stringify(index, null, 2);
  if (WRITE) fs.writeFileSync(fp, body + '\n');
  const total = GOLD.reduce((s, [n, k]) => s + (fs.existsSync(path.join(GOLDEN, n + '-' + k + '.json')) ? fs.statSync(path.join(GOLDEN, n + '-' + k + '.json')).size : 0), 0);
  ok('golden index.json is current', fs.existsSync(fp) && fs.readFileSync(fp, 'utf8').trim() === body);
  ok('golden files together stay small enough to commit (' + Math.round(total / 1024) + ' KB, limit 700 KB)', total > 0 && total < 700 * 1024);
}

console.log('\n(' + totalMoments + ' moments compared in the lockstep sweep)');
console.log('\n================  ' + pass + ' passed, ' + fail + ' failed  ================');
process.exit(fail ? 1 : 0);
