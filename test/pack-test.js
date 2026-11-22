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

/* ------------------------------------------------------------ the Lane view */
section('LANE — laneFrame(tasks, t, beat) agrees with packPlan, and counts 3 · 2 · 1 on the beat');
{
  // lockstep: the Lane can never say GO when My balloon does not, nor point at a different cue
  let lanes = 0, moments = 0, bad = null;
  Object.keys(compiled).forEach(name => {
    const { tl, P } = compiled[name];
    P.keys.forEach(key => {
      if (bad) return;
      const pk = JSON.parse(JSON.stringify(P.packs[key]));
      const n = P.by === 'balloon' ? Number(key) : null;
      const gid = n != null ? tl.balloonOf[n].group : key;
      const times = laneTimes(tl, n, gid);
      for (let t = -3000; t <= tl.endMs + 3000; t += 25) times.add(t);
      lanes++;
      for (const t of times) {
        moments++;
        const fr = C.laneFrame(pk.tasks, t, pk.beat), plan = C.packPlan(pk, t);
        let cur = null;
        plan.burnMarks.forEach((m, i) => { if (m.now) cur = i; });
        const planOn = plan.now.kind === 'burn' || (plan.now.kind === 'flicker' && !!plan.now.on);
        let why = null;
        if ((fr.state === 'GO') !== (cur !== null)) why = 'GO vs the cue under way';
        else if (cur !== null && fr.task.index !== cur) why = 'a different cue under way';
        else if (cur !== null && fr.on !== planOn) why = 'burner on/off (flicker on-beats)';
        else if (cur !== null && fr.leftMs !== pk.tasks[cur].endMs - t) why = 'time left';
        else if (cur === null && plan.next && (fr.task.index !== plan.next.index || fr.msUntil !== plan.next.atMs - t)) why = 'the next cue';
        else if (cur === null && !plan.next && fr.state !== 'DONE') why = 'DONE';
        if (why) { bad = { name, key, t, why, lane: { state: fr.state, task: fr.task && fr.task.index, on: fr.on }, plan: { cur, now: plan.now.kind, on: plan.now.on, next: plan.next && plan.next.index } }; break; }
      }
    });
  });
  ok('Lane == My balloon (GO, the cue, burner on/off, time left, the next cue) on ' + lanes + ' packs at ' + moments + ' moments', bad === null, bad);
}
{
  const { tl, P } = compiled['demo-show'];
  const pk = P.packs['5'], beat = pk.beat;          // 120 BPM: a beat is 500 ms; #5's first burn is 3 s at 0:15
  const F = t => C.laneFrame(pk.tasks, t, beat);
  ok('demo #5: the first cue is a 3 s full burn at 15000 ms', pk.tasks[0].atMs === 15000 && pk.tasks[0].durMs === 3000 && C.laneKind(pk.tasks[0]) === 'full');
  const want = [[4999, 'NEXT', null], [5000, 'WARNING', null], [13499, 'WARNING', null], [13500, 'STANDBY', 3], [13999, 'STANDBY', 3],
                [14000, 'STANDBY', 2], [14499, 'STANDBY', 2], [14500, 'STANDBY', 1], [14999, 'STANDBY', 1], [15000, 'GO', null], [17999, 'GO', null]];
  const got = want.map(([t]) => { const f = F(t); return [t, f.state, f.count]; });
  ok('states at the boundaries: NEXT > 10 s · WARNING ≤ 10 s · STANDBY 3 · 2 · 1 on the last three beats · GO at the exact start', canon(got) === canon(want), got);
  ok('GO counts down: 3000 ms left at the start, 1 ms left at its last ms', F(15000).leftMs === 3000 && F(17999).leftMs === 1);
  ok('the moment it ends, the lane moves on to the next cue (NEXT, 13 s out)', F(18000).state === 'NEXT' && F(18000).task.atMs === 31000 && F(18000).msUntil === 13000);
  ok('the count-in is on the show\'s own beats (each number starts where beatAt starts a beat)', [13500, 14000, 14500].every(t => C.beatAt(tl, t).phase === 0) && C.laneCountStart(15000, beat).fromMs === 13500);
  ok('WARNING fill: the glow starts at the throat at 10 s and is full when the count-in starts', Math.abs(F(5000).fill - 0.05) < 1e-9 && F(13499).fill > 0.999 && F(9250).fill > 0.4 && F(9250).fill < 0.6 && F(4999).fill === 0);
  ok('the banner\'s "Then" is the cue after', F(10000).after.atMs === 31000 && F(16000).after.atMs === 31000);
  ok('the 10 s window: a cue is drawn from 10.8 s out to 2.5 s after it ends', F(15000 - 10800).items.some(i => i.index === 0) && !F(15000 - 10801).items.some(i => i.index === 0) &&
     F(18000 + 2500).items.some(i => i.index === 0) && !F(18000 + 2501).items.some(i => i.index === 0));
  ok('a cue\'s position is its start in seconds from now (0 = the burner)', F(10000).items[0].atS === 5 && F(15000).items[0].atS === 0 && F(16500).items[0].atS === -1.5);
  ok('only cues still to come get a label slot (upcoming)', F(10000).items[0].upcoming && !F(15000).items[0].upcoming);
  const g0 = F(0).grid;
  ok('grid: every beat for the next 10 s, bar lines on each downbeat (21 lines at 120 BPM)', g0.length === 21 && g0[0].s === 0 && g0[20].s === 10 &&
     g0.every((g, i) => g.bar === (i % 4 === 0)), g0.length);
  const g1 = F(1250).grid;
  ok('grid: lines sit on the beats as the song moves (first line at the next beat)', g1[0].s === 0.25 && g1[0].bar === false && g1[1].s === 0.75);

  // kinds: vent burn → violet, finale, flicker
  const p1 = P.packs['1'].tasks;
  ok('#1: the 12 s burn at 0:24 gets a VENT warning → kind "vent" (violet), labelled FULL 12 s', C.laneKind(p1[1]) === 'vent' && C.laneFrame(p1, 20000, beat).items.find(i => i.index === 1).word === 'FULL' && C.laneFrame(p1, 20000, beat).items.find(i => i.index === 1).len === '12 s');
  ok('#1: the finale is a vent burn too, labelled FINALE', C.laneKind(p1[5]) === 'vent' && C.laneFrame(p1, 65000, beat).items.find(i => i.index === 5).word === 'FINALE');
  ok('pulse / ping-pong → flicker', C.laneKind(p1[2]) === 'flicker' && C.laneKind(p1[3]) === 'flicker' && C.laneKind(pk.tasks[0]) === 'full');
  ok('a flicker on the beat (8 s pulse): one dot a second', canon(C.laneDots(p1[2])) === canon([0, 1, 2, 3, 4, 5, 6, 7]));
  ok('a ping-pong (legs 2 s apart): one dot per on-leg', canon(C.laneDots(p1[3])) === canon([0, 2, 4]));
  ok('a full burn has no dots', C.laneDots(p1[0]).length === 0);
  // flicker on-beats: pulse at 128 BPM (on 234.375 ms, off 234.375 ms), then the ping-pong's legs
  const on = (k, t) => C.laneFrame(p1, t, beat).on;
  const pulse = p1[2], pp = p1[3];
  ok('pulse: on for the first half of each of its own beats', on(pulse, pulse.atMs) && on(pulse, pulse.atMs + 234) && !on(pulse, pulse.atMs + 235) && !on(pulse, pulse.atMs + 468) && on(pulse, pulse.atMs + 469));
  ok('ping-pong: on during its legs, off between them, GO throughout', on(pp, 52000) && on(pp, 52999) && !on(pp, 53000) && C.laneFrame(p1, 53000, beat).state === 'GO' && on(pp, 54000) && !on(pp, 56999 + 1));
  ok('a full burn is on from its first to its last ms', on(pk.tasks[0], 15000) && C.laneFrame(pk.tasks, 17999, beat).on);
  ok('after the last cue: DONE', C.laneFrame(pk.tasks, 84000, beat).state === 'DONE' && C.laneFrame(pk.tasks, 84000, beat).task === null);

  // a cue off the beat: the count still lands on beats, "1" is the last beat at least a quarter beat before it
  const syn = [{ index: 0, kind: 'burn', atMs: 10250, endMs: 12250, durMs: 2000, onAt: [[10250, 12250]], legs: 1, vent: false, finale: false }];
  const cs = t => C.laneFrame(syn, t, { beatMs: 500, offsetMs: 0, beatsPerBar: 4 }).count;
  ok('a cue half a beat off the grid: 3 at 9000, 2 at 9500, 1 at 10000 (on the beats), GO at 10250', cs(8999) === null && cs(9000) === 3 && cs(9500) === 2 && cs(10000) === 1 && cs(10249) === 1 &&
     C.laneFrame(syn, 10250, { beatMs: 500, offsetMs: 0 }).state === 'GO');
  ok('a beat offset moves the count with the grid', C.laneCountStart(10100, { beatMs: 500, offsetMs: 100 }).fromMs === 8600);
  // purity
  const before = JSON.stringify(pk.tasks);
  const a = canon(C.laneFrame(pk.tasks, 14200, beat)), b = canon(C.laneFrame(pk.tasks, 14200, beat));
  ok('pure: the same answer twice, and the task list is not touched', a === b && JSON.stringify(pk.tasks) === before);
}
{
  // a show with no tempo: the count-in is the last 3 s, one a second, and the grid is one line a second
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'shows', 'demo-show.json'), 'utf8'));
  delete raw.audio.bpm; delete raw.audio.beatOffsetMs;
  const v = C.validateShow(raw);
  const tl = C.compileShow(v.show);
  const pk = C.compilePack(tl, 5);
  ok('no-tempo demo: the pack has no beat grid', v.ok && pk.beat === null);
  const F = t => C.laneFrame(pk.tasks, t, pk.beat);
  const got = [11999, 12000, 12999, 13000, 13999, 14000, 14999, 15000].map(t => [F(t).state, F(t).count]);
  ok('no tempo: WARNING, then 3 · 2 · 1 a second each over the last 3 s, then GO', canon(got) === canon([['WARNING', null], ['STANDBY', 3], ['STANDBY', 3], ['STANDBY', 2], ['STANDBY', 2], ['STANDBY', 1], ['STANDBY', 1], ['GO', null]]), got);
  ok('no tempo: the banner says "on the count", not "on the beat"', F(12500).onBeat === false);
  ok('no tempo: grid lines one a second, every other one stronger', F(0).grid.length === 11 && F(0).grid[1].s === 1 && F(0).grid[0].bar && !F(0).grid[1].bar);
}
{
  // labels: never on top of each other, never past the right edge
  const { P } = compiled['havasu-lightning-storm'];
  const o = { x0: 92, pxPerS: 26, lo: 184, hi: 250, gap: 92, maxX: 272 };
  let bad = null, shown = 0;
  P.keys.forEach(key => {
    const pk = P.packs[key];
    for (let t = -2000; t < pk.lenMs && !bad; t += 100) {
      const fr = C.laneFrame(pk.tasks, t, pk.beat);
      const xs = C.laneLabels(fr.items, o).filter(x => x !== null);
      shown += xs.length;
      for (let i = 0; i < xs.length; i++) {
        if (xs[i] < o.lo || xs[i] >= o.maxX || (i && xs[i] - xs[i - 1] < o.gap)) { bad = { key, t, xs }; break; }
      }
    }
  });
  ok('labels never overlap (≥ ' + o.gap + ' px apart) and stay inside the lane, every 100 ms of Lightning Storm, every balloon (' + shown + ' labels)', bad === null && shown > 0, bad);
  const its = [{ upcoming: true, atS: 1 }, { upcoming: true, atS: 1.5 }, { upcoming: true, atS: 8 }, { upcoming: false, atS: -1 }];
  ok('labels: cues close together are pushed apart, one that would run off the edge is dropped, a cue already burning gets none',
     canon(C.laneLabels(its, Object.assign({}, o, { maxX: 400 }))) === canon([184, 276, 368, null]) && canon(C.laneLabels(its, o)) === canon([184, null, null, null]));
}

/* ------------------------------------------------------------ field view (design K) */
section('FIELD VIEW — pack.fieldView is display only: everyone\'s lit times are their own packs\' legs, and nothing a phone plays changes');
{
  // which shows carry one: exactly the ones with a field and balloon spots
  Object.keys(compiled).forEach(name => {
    const { tl, P } = compiled[name];
    const want = !!(tl.field && tl.balloons.length);
    const has = P.keys.map(k => !!P.packs[k].fieldView);
    ok(name + ': ' + (want ? 'every pack carries the same fieldView' : 'no field, so no pack carries a fieldView (the key is left out)'),
       want ? has.every(Boolean) && P.keys.every(k => canon(P.packs[k].fieldView) === canon(P.packs[P.keys[0]].fieldView))
            : has.every(h => !h) && P.keys.every(k => !('fieldView' in P.packs[k])));
  });
  ['havasu-lightning-storm', 'havasu-forest-for-the-trees'].forEach(name => {
    const { tl, P } = compiled[name];
    const fv = P.packs[P.keys[0]].fieldView;
    // 1. every balloon's legs == that balloon's own pack's task onAt legs, finale flagged
    let bad = null, legs = 0;
    ok(name + ': one map balloon per pack, same number and spot', fv.balloons.length === P.keys.length &&
       fv.balloons.every(b => P.packs[String(b.n)] && tl.balloonOf[b.n].x === b.x && tl.balloonOf[b.n].y === b.y));
    fv.balloons.forEach(b => {
      if (bad) return;
      const own = [];
      P.packs[String(b.n)].tasks.forEach(k => k.onAt.forEach(l => own.push([l[0], l[1], k.finale ? 1 : 0])));
      legs += own.length;
      if (canon(own) !== canon(b.legs)) bad = { n: b.n, own: own.slice(0, 4), fv: b.legs.slice(0, 4) };
    });
    ok(name + ': the map\'s lit legs for each balloon are exactly its own pack\'s task onAt legs (' + legs + ' legs, finale flagged)', bad === null, bad);
    ok(name + ': the finale legs are flagged (the last all-burn) and only those', fv.balloons.every(b => b.legs.filter(l => l[2] === 1).length <= 1) &&
       fv.balloons.some(b => b.legs.some(l => l[2] === 1)) === P.keys.some(k => P.packs[k].tasks.some(t => t.finale)));
    // 2. nothing else in a pack moves: the pack minus fieldView == the pack compiled with no field view
    let diff = null;
    P.keys.forEach(key => {
      if (diff) return;
      const n = Number(key), with_ = JSON.parse(JSON.stringify(P.packs[key]));
      delete with_.fieldView;
      const without = C.compilePack(tl, n, tl.balloonOf[n].group, null);
      if ('fieldView' in without || canon(with_) !== canon(without)) diff = key;
    });
    ok(name + ': every pack minus its fieldView is byte-for-byte the pack compiled with none (tasks, segments, haptics)', diff === null, diff);
    // 3. packPlan never reads it: with, without, and with a scrambled one, the same answer at every moment
    const pk = JSON.parse(JSON.stringify(P.packs['5'] || P.packs['12']));
    const bare = JSON.parse(JSON.stringify(pk)); delete bare.fieldView;
    const junk = JSON.parse(JSON.stringify(pk)); junk.fieldView = { box: 'x', balloons: [{ n: 5, legs: [[0, 1e9, 1]] }], moves: null };
    let badT = null, nT = 0;
    const ts = new Set();
    pk.segments.forEach(s => { ts.add(s.at - 1); ts.add(s.at); });
    for (let t = -3000; t <= pk.endMs + 3000; t += 20) ts.add(t);
    for (const t of ts) {
      nT++;
      const a = canon(C.packPlan(pk, t));
      if (a !== canon(C.packPlan(bare, t)) || a !== canon(C.packPlan(junk, t)) ||
          C.packBeatPhase(pk, t) !== C.packBeatPhase(bare, t) ||
          canon(C.laneFrame(pk.tasks, t, pk.beat)) !== canon(C.laneFrame(bare.tasks, t, bare.beat))) { badT = t; break; }
    }
    ok(name + ' #' + pk.key + ': packPlan, packBeatPhase and laneFrame are identical with the fieldView, without it, and with a junk one (' + nT + ' moments)', badT === null, badT);
    // 4. a task's move is moves[task.cueIndex]
    let badM = null;
    P.keys.forEach(key => P.packs[key].tasks.forEach(k => {
      if (!badM && k.label && fv.moves[k.cueIndex].label !== C.fieldMoveLabel(k.label)) badM = { key, k: k.index, label: k.label, move: fv.moves[k.cueIndex] };
    }));
    ok(name + ': moves are the show\'s cues in order, so a task\'s move is moves[task.cueIndex]', fv.moves.length === tl.show.cues.length && badM === null &&
       fv.moves.every((m, i) => m.t === tl.show.cues[i].t && m.end === tl.show.cues[i].t + tl.show.cues[i].dur && m.label), badM);
    // 5. the view box holds everything drawn; zones and lines carry their words
    const [bx0, by0, bx1, by1] = fv.box;
    const inside = p => p[0] >= bx0 && p[0] <= bx1 && p[1] >= by0 && p[1] <= by1;
    ok(name + ': the view box holds the outline, zones, crowd edge, every balloon and the access lane',
       fv.outline.every(inside) && fv.zones.every(z => z.poly.every(inside)) && fv.crowd.every(inside) &&
       fv.balloons.every(b => inside([b.x, b.y])) && fv.lines.every(l => l.pts.every(inside)));
    ok(name + ': zone words PILOT TENT and PA, the access lane named, no words on the no-balloons zone',
       canon(fv.zones.map(z => [z.kind, z.label])) === canon([['nob', null], ['tent', 'PILOT TENT'], ['pa', 'PA']]) && fv.lines[0].label === 'ACCESS LANE');
  });
  {
    const { tl } = compiled['havasu-lightning-storm'];
    const before = JSON.stringify(tl.show);
    const a = canon(C.fieldViewOf(tl)), b = canon(C.fieldViewOf(tl));
    ok('fieldViewOf is pure: the same answer twice, the show untouched', a === b && JSON.stringify(tl.show) === before);
    const P = compiled['havasu-lightning-storm'].P, fvSize = JSON.stringify(P.packs['5'].fieldView).length;
    ok('the field view is small (' + fvSize + ' bytes a pack for 21 balloons)', fvSize < 12000);
  }
}
{
  // the words on the map
  ok('move words: the generator\'s section name is dropped', C.fieldMoveLabel('Chorus 1 — radial clockwise · right half') === 'radial clockwise · right half' &&
     C.fieldMoveLabel('Verse 2 — sweep front→back') === 'sweep front→back' && C.fieldMoveLabel('Outro 3 — radial clockwise') === 'radial clockwise');
  ok('move words: anything else before the dash stays, in plain case', C.fieldMoveLabel('FINALE — all burn') === 'Finale · all burn' && C.fieldMoveLabel('Opening all-burn') === 'Opening all-burn');
  ok('move words: no label falls back to the move in plain words', C.fieldMoveLabel('', { type: 'burn', dur: 3000, target: { all: true } }) === 'Everyone burns together');

  // one balloon on the map
  const L = [[10000, 12000, 0], [20000, 21000, 1]];
  const P = t => C.fieldPeer(L, t);
  ok('peer: dim at rest', canon(P(5000)) === canon({ lit: 0, soon: false, fin: false }));
  ok('peer: a thin ring from 1 s before it lights (not before)', P(8999).soon === false && P(9000).soon === true && P(9999).soon === true && P(9999).lit === 0);
  ok('peer: lit while a leg is on, the ring gone', canon(P(10000)) === canon({ lit: 1, soon: false, fin: false }) && P(11999).lit === 1);
  ok('peer: a 0.9 s fade after, from 0.6 down to nothing', P(12000).lit === 0.6 && Math.abs(P(12450).lit - 0.3) < 1e-12 && P(12900).lit === 0 && P(12899).lit > 0);
  ok('peer: the finale leg is flagged while lit and while it fades', P(20500).fin === true && P(21300).fin === true && P(22000).fin === false && P(19500).fin === false);

  // the caption, at the design's moments for #5 on Lightning Storm
  const { P: PS } = compiled['havasu-lightning-storm'];
  const pk = PS.packs['5'], fv = pk.fieldView;
  const cap = t => C.fieldCaption(fv, pk.tasks, t);
  ok('caption at 1:36 (cooling off): NOW · MIRROR IN · RIGHT HALF, no "Yours" yet (14 s out)', canon(cap(96000)) === canon({ top: 'NOW · MIRROR IN · RIGHT HALF', now: true, yours: '' }), cap(96000));
  ok('caption at 1:48 (count-in): NOW · RADIAL CLOCKWISE, Yours: radial clockwise · wave 5 of 6', canon(cap(108200)) === canon({ top: 'NOW · RADIAL CLOCKWISE', now: true, yours: 'Yours: radial clockwise · wave 5 of 6' }), cap(108200));
  ok('caption: "Yours" from exactly 10 s before your cue', (() => { const k = pk.tasks.find(x => x.atMs > 100000); return cap(k.atMs - 10001).yours === '' && cap(k.atMs - 10000).yours !== ''; })());
  ok('caption: between moves it counts to the next one, in whole seconds rounded up', cap(-1).top === 'NEXT MOVE IN 2 s · RIPPLE OUT' && cap(0).top === 'NEXT MOVE IN 2 s · RIPPLE OUT' && cap(1529).now === true && cap(500000).top === '');
  ok('caption: two moves at once names the one that started last', cap(21000).top === 'NOW · RADIAL CLOCKWISE · RIGHT HALF');

  // the map's geometry: the box fits under the words, inside the panel, one scale
  let badG = null;
  [[358, 470], [358, 360], [343, 250], [390, 600], [300, 120]].forEach(([W, H]) => {
    const g = C.fieldMapGeom(fv.box, W, H);
    const X = x => g.ox + (x - fv.box[0]) * g.s, Y = y => g.oy + (fv.box[3] - y) * g.s;
    if (X(fv.box[0]) < 9.999 || X(fv.box[2]) > W - 9.999 || Y(fv.box[3]) < C.FIELD_MAP_TOP - 1e-9 || Y(fv.box[1]) > H - 8 + 1e-9 || g.ew < 11 || g.ew > 20 || g.yw !== g.ew * 2.2) badG = [W, H, g];
  });
  ok('map geometry: the field fits under the two lines of words and inside the panel at five sizes; envelopes 11–20 px, yours 2.2×', badG === null, badG);
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
