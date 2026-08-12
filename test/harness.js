const fs = require('fs');
const C = require('./pure-core.js');
const SHOW_PATH = '/Users/bcl/Library/Mobile Documents/com~apple~CloudDocs/BCL/CODING/glow-show/shows/demo-show.json';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '   -> ' + JSON.stringify(extra) : '')); }
}
function eq(name, got, want) { ok(name + '  [' + JSON.stringify(got) + ']', JSON.stringify(got) === JSON.stringify(want), {got, want}); }
function section(s){ console.log('\n== ' + s); }

// ---------------------------------------------------------------- validator
section('VALIDATOR');
const parsed = C.parseShowText(fs.readFileSync(SHOW_PATH, 'utf8'));
ok('demo-show.json validates clean', parsed.ok, parsed.errors);
if (!parsed.ok) process.exit(1);
const show = parsed.show;
const tl = C.compileShow(show);

const bad = (mut, label, needle) => {
  const s = JSON.parse(fs.readFileSync(SHOW_PATH, 'utf8'));
  mut(s);
  const r = C.validateShow(s);
  ok(label, !r.ok && r.errors.some(e => e.includes(needle)), r.errors);
};
bad(s => s.format = 'glow-show/2', 'rejects wrong format version', 'format must be');
bad(s => s.cues[0].groups = ['nope'], 'rejects unknown group id', 'unknown group');
bad(s => { const t = s.cues[1].t; s.cues[1].t = s.cues[2].t + 1; }, 'rejects unsorted cues', 'out of order');
bad(s => { s.cues[0].groups = ['north']; s.cues.splice(1, 0, {t:16000,dur:1000,type:'burn',groups:['north'],label:'clash'}); }, 'rejects overlap even when cues are sorted', 'overlapping cues');
bad(s => s.cues[1].dur = 999999, 'rejects cue past audio.durationMs', 'past audio.durationMs');
bad(s => s.groups[0].id = 'all', 'rejects a group literally named "all"', 'reserved');
bad(s => s.cues[4].bpm = undefined, 'rejects pulse without bpm', 'bpm must be');
bad(s => s.cues[5].periodMs = undefined, 'rejects alternate without periodMs', 'periodMs must be');
bad(s => s.cues[0].groups = ['all','north'], 'rejects "all" mixed with named groups', 'mixes');
// direct overlap inside one group
bad(s => s.cues.splice(2, 0, {t:25000,dur:1000,type:'burn',groups:['north'],label:'clash'}), 'rejects overlapping cues within a group', 'overlapping cues');
bad(s => s.cues.splice(1, 0, {t:16000,dur:1000,type:'burn',groups:['south'],label:'clash-with-all'}), 'rejects a group cue overlapping an ALL cue', 'overlapping cues');

// ------------------------------------------------------------ compile shape
section('COMPILE / DERIVATION');
eq('groups', tl.groupIds, ['north','south','shapes']);
eq('segment count (10 cues, alternate -> 6 legs)', tl.segments.length, 15);
const altLegs = tl.segments.filter(s => s.fromAlternate);
eq('alternate expanded into 6 legs of 1000ms', altLegs.map(s => [s.t, s.end, s.groups[0]]),
   [[52000,53000,'north'],[53000,54000,'south'],[54000,55000,'north'],[55000,56000,'south'],[56000,57000,'north'],[57000,58000,'south']]);
const vOf = ci => tl.vents.find(v => v.cueIndex === ci);
eq('vent warnings derived for exactly 2 cues', tl.vents.map(v => v.cueIndex), [1, 9]);
eq('north long burn vent warn window ("vent": true)', [vOf(1).t, vOf(1).end], [4000, 24000]);
eq('finale vent warn window (dur 14000 >= longBurnMs)', [vOf(9).t, vOf(9).end], [50000, 70000]);
ok('6s alternate does NOT trigger a vent (sustained leg = periodMs 1000)', !vOf(5));
ok('8s pulse does NOT trigger a vent (blips, not a held burn)', !vOf(4));
ok('4s pulse does NOT trigger a vent', !vOf(7));
eq('north get-ready for opening all-burn starts at 10000', tl.perGroup.north.readies[0].t, 10000);
let readyBad = null;
tl.groupIds.forEach(g => tl.perGroup[g].windows.forEach((w, i) => {
  const r = tl.perGroup[g].readies.find(x => x.seg === w);
  const prevEnd = i > 0 ? tl.perGroup[g].windows[i-1].end : -Infinity;
  const want = Math.max(w.t - tl.defaults.getReadyMs, prevEnd);
  if (!r || r.t !== want || r.end !== w.t) readyBad = [g, w.t, r && [r.t, r.end], want];
}));
ok('every cue has a get-ready, clamped to max(t-getReadyMs, previous cue end)', readyBad === null, readyBad);
eq('north clamped get-ready windows', tl.perGroup.north.readies.map(r => [r.t, r.end]),
   [[10000,15000],[19000,24000],[36000,40000],[48000,52000],[53000,54000],[55000,56000],[57000,61000],[65000,70000]]);
eq('stop after opening all-burn', [tl.perGroup.north.stops[0].t, tl.perGroup.north.stops[0].end], [18000, 20000]);
const legStop = tl.perGroup.north.stops.find(s => s.seg.fromAlternate && s.seg.t === 52000);
eq('ping-pong stop truncated at north next leg (no 2s spill)', [legStop.t, legStop.end], [53000, 54000]);

// --------------------------------------------------------------- stateAt
section('STATE SEQUENCE — pilot in NORTH');
const N = t => C.stateAt(tl, ['north'], t);
const S = t => C.stateAt(tl, ['south'], t);
const H = t => C.stateAt(tl, ['shapes'], t);

eq('t=-6000  pre-show',                       N(-6000).phase, 'PRESHOW');
eq('t=+3999  idle (before vent window)',      N(3999).phase, 'IDLE');
eq('t=+4000  VENT warning opens (20s before the 12s burn)', N(4000).phase, 'VENT');
eq('t=+4000  vent text numbers',              [C.fmtSecs(N(4000).vent.cueDur), C.fmtMMSS(N(4000).vent.msUntil)], [12, '0:20']);
eq('t=+9999  still VENT (get-ready not open)', N(9999).phase, 'VENT');
eq('t=+10000 GET READY (5s before the all-burn)', N(10000).phase, 'GETREADY');
eq('t=+10000 get-ready shows 5s countdown',   C.fmtSecs(N(10000).countdownMs), 5);
eq('t=+14999 GET READY, 1s left',             [N(14999).phase, C.fmtSecs(N(14999).countdownMs)], ['GETREADY', 1]);
eq('t=+15000 BURN begins on the exact ms',    N(15000).phase, 'BURN');
eq('t=+15500 BURN (spec probe)',              N(15500).phase, 'BURN');
eq('t=+15500 all three groups burning',       [N(15500).phase, S(15500).phase, H(15500).phase], ['BURN','BURN','BURN']);
ok('t=+15500 vent warning does NOT interrupt the burn — corner chip instead',
   N(15500).phase === 'BURN' && N(15500).ventChip === true && N(15500).vent.cueT === 24000);
ok('t=+15500 SOUTH has no vent chip (not their cue)', S(15500).ventChip === false);
eq('t=+17999 BURN, 1s left, bar ~2/3 through', [N(17999).phase, C.fmtSecs(N(17999).remainMs)], ['BURN', 1]);
eq('t=+18000 STOP the instant the burn ends', N(18000).phase, 'STOP');
eq('t=+19000 still STOP (2s window)',          N(19000).phase, 'STOP');
eq('t=+19000..24000 GET READY outranks the vent warning', N(20000).phase, 'GETREADY');
ok('t=+20000 vent still reported as a chip under the get-ready', N(20000).ventChip === true);
eq('t=+19000 SHAPES also STOP',                H(19000).phase, 'STOP');
eq('t=+20000 SHAPES idle (the north vent is not theirs)',  H(20000).phase, 'IDLE');
ok('t=+20000 SHAPES has no vent chip', H(20000).ventChip === false);
eq('t=+23000 north GET READY for the long burn', N(23000).phase, 'GETREADY');
eq('t=+24000 north long BURN starts',          N(24000).phase, 'BURN');
eq('t=+30000 north BURN, 6s left',             [N(30000).phase, C.fmtSecs(N(30000).remainMs)], ['BURN', 6]);
eq('t=+30000 shapes STOP (accent ended at 29000)', H(30000).phase, 'STOP');
eq('t=+31500 shapes IDLE, south BURN',         [H(31500).phase, S(31500).phase], ['IDLE','BURN']);
eq('t=+36000 north STOP',                      N(36000).phase, 'STOP');
eq('t=+38001 north GET READY for the pulse (clamped window, after STOP)', N(38001).phase, 'GETREADY');
ok('t=+38001 north has NO vent chip — an 8s pulse is not a held burn', N(38001).ventChip === false);

section('PULSE');
const p41 = N(41000);
eq('t=+41000 PULSE',                           p41.phase, 'PULSE');
eq('t=+41000 beat grid @128bpm (468.75ms)',    [p41.pulse.beatIndex, +p41.pulse.beatPhase.toFixed(4), p41.pulse.on], [2, 0.1333, true]);
eq('t=+41000 total beats in an 8s pulse',      p41.pulse.totalBeats, 18);
const p41b = N(40000 + 468.75 * 2 + 300);      // 300ms into beat 2 -> phase .64 -> off
eq('flash goes OFF in the back half of the beat', p41b.pulse.on, false);
eq('flash back ON at the next beat',           N(40000 + 468.75 * 3 + 1).pulse.on, true);
eq('beat 0 at the very start of the pulse',    N(40000).pulse.beatIndex, 0);

section('ALTERNATE HANDOFF');
eq('t=+52000 north BURN (leg 1)',              N(52000).phase, 'BURN');
eq('t=+52500 south GET READY for its leg',     S(52500).phase, 'GETREADY');
eq('t=+53500 north STOP, not get-ready spam between legs', N(53500).phase, 'STOP');
eq('t=+52999 north still BURN',                N(52999).phase, 'BURN');
eq('t=+53000 handoff: north STOP / south BURN', [N(53000).phase, S(53000).phase], ['STOP','BURN']);
eq('t=+53999 north STOP right up to its next leg', N(53999).phase, 'STOP');
eq('t=+54000 handoff back: north BURN / south STOP', [N(54000).phase, S(54000).phase], ['BURN','STOP']);
eq('t=+58000 last leg ends, south STOP',       S(58000).phase, 'STOP');

section('VENT vs LIVE CUES (finale, warn opens at 50000)');
eq('t=+49999 north STOP (post-pulse)',         N(49999).phase, 'STOP');
eq('t=+51000 north GET READY (ping-pong) with the finale vent chipped, never hijacking it',
   [N(51000).phase, N(51000).ventChip, C.fmtMMSS(N(51000).vent.msUntil)], ['GETREADY', true, '0:19']);
eq('t=+51000 SHAPES are idle, so they DO get the full-screen finale VENT', H(51000).phase, 'VENT');
eq('t=+51000 shapes vent text', [C.fmtSecs(H(51000).vent.cueDur), H(51000).vent.cueType, C.fmtMMSS(H(51000).vent.msUntil)], [14, 'burn', '0:19']);
ok('a vent warning NEVER interrupts a live burn/pulse for any group at any time',
   Array.from({length: 1010}, (_, i) => -10000 + i * 100)
     .every(t => tl.groupIds.every(g => { const s = C.stateAt(tl, [g], t); return !(s.phase === 'VENT' && s.seg); })));
ok('t=+53000 south BURNING with a finale vent chip', S(53000).phase === 'BURN' && S(53000).ventChip === true);
eq('t=+68000 north GET READY for the finale, vent still chipped',
   [N(68000).phase, N(68000).ventChip], ['GETREADY', true]);
eq('t=+68000 every group gets a finale get-ready (clamping fixed the gap)',
   [N(68000).phase, S(68000).phase, H(68000).phase], ['GETREADY','GETREADY','GETREADY']);
eq('t=+65500 north STOP right after the half-time pulse', N(65500).phase, 'STOP');
eq('t=+70000 FINALE burn, all groups',         [N(70000).phase, S(70000).phase, H(70000).phase], ['BURN','BURN','BURN']);
eq('t=+70000 vent chip clears once the burn starts', N(70000).ventChip, false);
eq('t=+84000 STOP after the finale',           N(84000).phase, 'STOP');
eq('t=+86000 IDLE — cues done but the track is still running', N(86000).phase, 'IDLE');
eq('t=+90000 ENDED at audio.durationMs',       N(90000).phase, 'ENDED');

section('PREVIEW STRIP');
const pv = N(0).next;
eq('preview holds 3 upcoming cues',            pv.length, 3);
eq('preview labels',                           pv.map(n => n.cue.label), ['Opening all-burn','North long burn','Shapes accent']);
eq('preview "mine" flags for a NORTH pilot',   pv.map(n => n.mine), [true, true, false]);
eq('preview "mine" flags for a SHAPES pilot',  H(0).next.map(n => n.mine), [true, false, true]);
eq('T-minus on the first preview block',       C.fmtMMSS(pv[0].msUntil), '0:15');

section('INVARIANTS — full sweep, 10ms steps, every group');
const allowed = ['PRESHOW','IDLE','GETREADY','BURN','PULSE','STOP','VENT','ENDED'];
let badPhase = null, burnMs = {north:0, south:0, shapes:0}, exc = null;
try {
  for (const g of tl.groupIds) {
    for (let t = -10000; t <= 92000; t += 10) {
      const s = C.stateAt(tl, [g], t);
      if (allowed.indexOf(s.phase) === -1) { badPhase = [g, t, s.phase]; break; }
      if (s.phase === 'BURN' || s.phase === 'PULSE') burnMs[g] += 10;
      if ((s.phase === 'BURN' || s.phase === 'PULSE') && (!s.seg || t < s.seg.t || t >= s.seg.end)) { badPhase = ['segment mismatch', g, t]; break; }
    }
  }
} catch (e) { exc = e.message; }
ok('no exceptions across the full sweep (31,500 evaluations)', exc === null, exc);
ok('every phase is a known phase', badPhase === null, badPhase);
const expect = {};
tl.groupIds.forEach(g => { expect[g] = tl.perGroup[g].windows.reduce((m,w) => m + w.dur, 0); });
eq('burn+pulse time per group matches the sum of that group\'s windows', burnMs, expect);
let readyOverlap = null;
tl.groupIds.forEach(g => tl.perGroup[g].readies.forEach(r => {
  tl.perGroup[g].windows.forEach(w => { if (r.t < w.end && r.end > w.t && w !== r.seg) readyOverlap = [g, r.t, w.t]; });
}));
ok('no get-ready window ever overlaps that group\'s own burn', readyOverlap === null, readyOverlap);
const s1 = C.stateAt(tl, ['north'], 41234), s2 = C.stateAt(tl, ['north'], 41234);
ok('stateAt is deterministic (pure)', JSON.stringify(s1) === JSON.stringify(s2));
eq('slugify(title) -> showId used for the Worker key', C.slugify(show.title), 'glow-show-demo-90-seconds');

console.log('\n================  ' + pass + ' passed, ' + fail + ' failed  ================');
process.exit(fail ? 1 : 0);
