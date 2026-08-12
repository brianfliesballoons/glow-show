const fs = require('fs');
const path = require('path');
const C = require('./pure-core.js');
const SHOW_PATH = '/Users/bcl/Library/Mobile Documents/com~apple~CloudDocs/BCL/CODING/glow-show/shows/demo-show.json';
const SCRIPT_PATH = path.join(__dirname, 'script-0.js');   // written by extract.js
const raw = () => JSON.parse(fs.readFileSync(SHOW_PATH, 'utf8'));
const r4 = v => Math.round(v * 10000) / 10000;

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

/* ==========================================================================
   THE INLINE DEMO MIRROR
   index.html carries a copy of shows/demo-show.json as DEMO_SHOW so the demo
   works from file:// and offline. The two are only useful if they are the
   same show — this pulls the literal straight out of the page and compares.
   ========================================================================== */
section('INLINE DEMO_SHOW MIRROR');
let inlineShow = null, mirrorErr = null;
try {
  const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
  const a = src.indexOf('const DEMO_SHOW = {');
  const open = src.indexOf('{', a);
  const close = src.indexOf('\n};', open);        // the only `};` at column 0
  if (a < 0 || close < 0) throw new Error('DEMO_SHOW literal not found in the extracted script');
  inlineShow = new Function('return (' + src.slice(open, close + 2) + ')')();
} catch (e) { mirrorErr = e.message; }
ok('DEMO_SHOW literal extracts out of index.html', inlineShow !== null, mirrorErr);
if (inlineShow) {
  const vi = C.validateShow(inlineShow);
  ok('the inline DEMO_SHOW mirror validates clean', vi.ok, vi.errors);
  ok('inline DEMO_SHOW === shows/demo-show.json after validation',
     vi.ok && JSON.stringify(vi.show) === JSON.stringify(show),
     { inline: vi.ok && JSON.stringify(vi.show), file: JSON.stringify(show) });
}

/* ==========================================================================
   THE BEAT GRID  (audio.bpm / audio.beatOffsetMs -> beatAt)
   ========================================================================== */
section('BEAT GRID — beatAt()');
eq('demo show carries a 120 BPM grid', [show.audio.bpm, show.audio.beatOffsetMs], [120, 0]);
eq('compiled timeline exposes the grid', [tl.beat.bpm, tl.beat.beatMs, tl.beat.beatsPerBar], [120, 500, 4]);
const B = t => C.beatAt(tl, t);
eq('t=0      beat 0, bar 0, downbeat, phase 0', [B(0).beat, B(0).bar, B(0).beatInBar, B(0).downbeat, B(0).phase], [0, 0, 0, true, 0]);
eq('t=250    half way through beat 0',          [B(250).beat, r4(B(250).phase)], [0, 0.5]);
eq('t=499.9  still beat 0 (ring nearly full)',  [B(499.9).beat, r4(B(499.9).phase)], [0, 0.9998]);
eq('t=500    beat 1, ring snapped empty',       [B(500).beat, B(500).phase, B(500).downbeat], [1, 0, false]);
eq('t=2000   beat 4 = bar 1 downbeat',          [B(2000).beat, B(2000).bar, B(2000).beatInBar, B(2000).downbeat], [4, 1, 0, true]);
eq('t=2600   bar 1, beat 2 of 4',               [B(2600).bar, B(2600).beatInBar, B(2600).downbeat], [1, 1, false]);
eq('t=15000  the opening all-burn lands on a beat', [B(15000).beat, B(15000).phase], [30, 0]);
ok('every demo cue starts exactly on a beat', show.cues.every(c => B(c.t).phase === 0), show.cues.filter(c => B(c.t).phase !== 0).map(c => c.t));
// the grid runs backwards through T0 — that is what the armed countdown ring uses
eq('t=-500   beat -1, bar -1, 4th beat of that bar', [B(-500).beat, B(-500).bar, B(-500).beatInBar, B(-500).downbeat], [-1, -1, 3, false]);
eq('t=-250   phase 0.5 — phases are never negative', [B(-250).beat, r4(B(-250).phase)], [-1, 0.5]);
eq('t=-2000  a downbeat four beats before T0',  [B(-2000).beat, B(-2000).bar, B(-2000).downbeat], [-4, -1, true]);
let phaseBad = null;
for (let t = -12000; t < 92000; t += 3) { const b = B(t); if (!(b.phase >= 0 && b.phase < 1)) { phaseBad = [t, b.phase]; break; } }
ok('phase stays in [0,1) across the whole show, before and after T0', phaseBad === null, phaseBad);

// --- offset handling ---
const offRaw = raw();
offRaw.audio.bpm = 150; offRaw.audio.beatOffsetMs = 120;      // beatMs = 400
const offTl = C.compileShow(C.validateShow(offRaw).show);
eq('offset grid: beat 0 sits at beatOffsetMs',      [C.beatAt(offTl, 120).beat, C.beatAt(offTl, 120).phase], [0, 0]);
eq('offset grid: 1ms earlier is still beat -1',     C.beatAt(offTl, 119).beat, -1);
eq('offset grid: bar 1 downbeat is 4 beats later', [C.beatAt(offTl, 1720).beat, C.beatAt(offTl, 1720).downbeat], [4, true]);
eq('offset grid: beatMs from 150 BPM',              offTl.beat.beatMs, 400);

// --- absent / partial fields ---
const noBeat = raw();
delete noBeat.audio.bpm; delete noBeat.audio.beatOffsetMs;
const noBeatV = C.validateShow(noBeat);
const noBeatTl = C.compileShow(noBeatV.show);
ok('no bpm -> tl.beat is null', noBeatTl.beat === null);
ok('no bpm -> beatAt returns null (no ring anywhere)', C.beatAt(noBeatTl, 1234) === null);
ok('no bpm -> the audio block gains no beat keys', !('bpm' in noBeatV.show.audio) && !('beatOffsetMs' in noBeatV.show.audio));
const defOff = raw();
delete defOff.audio.beatOffsetMs;
eq('bpm without an offset defaults beatOffsetMs to 0', C.validateShow(defOff).show.audio.beatOffsetMs, 0);
const orphanOff = raw();
delete orphanOff.audio.bpm;
const orphanV = C.validateShow(orphanOff);
ok('an offset with no bpm validates but warns', orphanV.ok && orphanV.warnings.some(w => w.includes('beatOffsetMs')), orphanV.warnings);
ok('...and is dropped from the show (no half a grid)', !('beatOffsetMs' in orphanV.show.audio));
const edge = raw();
edge.audio.bpm = 40;
ok('accepts bpm at the low edge (40)', C.validateShow(edge).ok);
edge.audio.bpm = 250;
ok('accepts bpm at the high edge (250)', C.validateShow(edge).ok);
edge.audio.bpm = 128.5;
ok('accepts a fractional bpm', C.validateShow(edge).ok);
bad(s => s.audio.bpm = 39.9,  'rejects bpm below 40', 'audio.bpm must be');
bad(s => s.audio.bpm = 251,   'rejects bpm above 250', 'audio.bpm must be');
bad(s => s.audio.bpm = '128', 'rejects a string bpm', 'audio.bpm must be');
bad(s => s.audio.beatOffsetMs = -1, 'rejects a negative beat offset', 'beatOffsetMs must be');
bad(s => s.audio.beatOffsetMs = 'x', 'rejects a non-numeric beat offset', 'beatOffsetMs must be');

/* --- the property the ring depends on: same grid as the pulse flashes ----- */
section('BEAT GRID vs THE PULSE FLASH GRID');
const co = raw();
co.audio.bpm = 128;
co.audio.beatOffsetMs = 40000 % (60000 / 128);     // 156.25 — puts the pulse cue on beat 85
const coTl = C.compileShow(C.validateShow(co).show);
eq('the 128 BPM pulse cue starts exactly on a show beat',
   [C.beatAt(coTl, 40000).beat, C.beatAt(coTl, 40000).phase], [85, 0]);
let worstPhase = 0, worstAt = null, flashBad = null, sampled = 0;
for (let t = 40000; t < 48000; t += 3) {
  const st = C.stateAt(coTl, ['north'], t);
  if (st.phase !== 'PULSE') continue;
  sampled++;
  const b = C.beatAt(coTl, t);
  const d = Math.abs(st.pulse.beatPhase - b.phase);
  if (d > worstPhase) { worstPhase = d; worstAt = t; }
  if (st.pulse.on !== (b.phase < 0.5) && flashBad === null) flashBad = [t, st.pulse.beatPhase, b.phase];
}
ok('sampled the whole 8s pulse (' + sampled + ' points)', sampled > 2600, sampled);
ok('a pulse at the show bpm rides the SAME grid the ring does [max phase error ' + worstPhase + ']', worstPhase === 0, worstAt);
ok('the screen flash is ON exactly while the ring is in its first half', flashBad === null, flashBad);
const co2 = raw();
co2.audio.bpm = 120;                               // the 128 BPM cue is now off-grid on purpose
const co2Tl = C.compileShow(C.validateShow(co2).show);
ok('a pulse at a DIFFERENT bpm keeps its own grid (they are allowed to differ)',
   Math.abs(C.stateAt(co2Tl, ['north'], 41000).pulse.beatPhase - C.beatAt(co2Tl, 41000).phase) > 0.01);

/* ==========================================================================
   BALLOONS — numbers, groups, field placement
   ========================================================================== */
section('BALLOONS — schema + derivation');
eq('demo show places 12 balloons', tl.balloons.length, 12);
eq('compiled balloons are sorted by number', tl.balloons.map(b => b.n), [1,2,3,4,5,6,7,8,9,10,11,12]);
eq('#7 derives its group from its number', C.groupOfBalloon(tl, 7), 'south');
eq('#1 and #12 derive theirs too', [C.groupOfBalloon(tl, 1), C.groupOfBalloon(tl, 12)], ['north', 'shapes']);
ok('an unassigned number derives no group', C.groupOfBalloon(tl, 99) === null);
ok('a null number derives no group', C.groupOfBalloon(tl, null) === null);
eq('#2 keeps its optional label', tl.balloonOf[2].label, 'Wishingstar');
ok('balloons with no label carry no label key', !('label' in tl.balloonOf[1]));
ok('every balloon belongs to a defined group', tl.balloons.every(b => tl.groupIds.indexOf(b.group) !== -1));
ok('every balloon sits inside the field', tl.balloons.every(b => b.x >= 0 && b.x <= 1 && b.y >= 0 && b.y <= 1));
eq('a balloon number always resolves to a group that has cues',
   tl.balloons.every(b => !!tl.perGroup[C.groupOfBalloon(tl, b.n)]), true);

bad(s => s.balloons[3].n = 1,            'rejects a duplicate balloon number', 'is used twice');
bad(s => s.balloons[0].n = 0,            'rejects balloon number 0', '.n must be a whole number');
bad(s => s.balloons[0].n = -3,           'rejects a negative balloon number', '.n must be a whole number');
bad(s => s.balloons[0].n = 2.5,          'rejects a fractional balloon number', '.n must be a whole number');
bad(s => s.balloons[0].n = '4',          'rejects a string balloon number', '.n must be a whole number');
bad(s => delete s.balloons[0].n,         'rejects a balloon with no number', '.n must be a whole number');
bad(s => s.balloons[0].group = 'nope',   'rejects a balloon in an unknown group', 'unknown group');
bad(s => s.balloons[0].group = 'all',    'rejects a balloon in the reserved "all" group', 'cannot be "all"');
bad(s => delete s.balloons[0].group,     'rejects a balloon with no group', '.group must be');
bad(s => s.balloons[0].x = 1.0001,       'rejects x past the right edge', '.x must be a number from 0 to 1');
bad(s => s.balloons[0].x = -0.01,        'rejects x past the left edge', '.x must be a number from 0 to 1');
bad(s => s.balloons[0].y = 1.5,          'rejects y past the back of the field', '.y must be a number from 0 to 1');
bad(s => delete s.balloons[0].y,         'rejects a balloon with no y', '.y must be a number from 0 to 1');
bad(s => s.balloons[0].label = '',       'rejects an empty label', '.label must be');
bad(s => s.balloons = {},                'rejects a non-array balloons field', 'must be an array');
bad(s => s.balloons = ['12'],            'rejects a balloon that is not an object', 'must be an object');
const edgeCoords = raw();
edgeCoords.balloons[0].x = 0; edgeCoords.balloons[0].y = 1;
ok('accepts the exact field corners (0 and 1)', C.validateShow(edgeCoords).ok, C.validateShow(edgeCoords).errors);
const emptyB = raw();
emptyB.balloons = [];
const emptyV = C.validateShow(emptyB);
ok('an empty balloons[] validates', emptyV.ok, emptyV.errors);
ok('...and leaves no balloons key on the show (same as never having one)', !('balloons' in emptyV.show));

section('BALLOON PLACEMENT (pure)');
const mk12 = C.makeBalloons(['north', 'south', 'shapes'], 12);
eq('12 over 3 groups -> contiguous blocks of 4',
   mk12.map(b => b.group), ['north','north','north','north','south','south','south','south','shapes','shapes','shapes','shapes']);
eq('numbers run 1..N in order', mk12.map(b => b.n), [1,2,3,4,5,6,7,8,9,10,11,12]);
eq('one row per group, front (crowd) to back', mk12.map(b => r4(b.y)).filter((v, i, a) => a.indexOf(v) === i), [0.18, 0.5, 0.82]);
eq('a row spreads across the field with margins', mk12.slice(0, 4).map(b => r4(b.x)), [0.08, 0.36, 0.64, 0.92]);
eq('the hand-authored demo NORTH + SOUTH rows match auto-arrange exactly',
   tl.balloons.slice(0, 8).map(b => [b.n, b.group, r4(b.x), r4(b.y)]),
   mk12.slice(0, 8).map(b => [b.n, b.group, r4(b.x), r4(b.y)]));
const mk7 = C.makeBalloons(['a', 'b', 'c'], 7);
eq('7 over 3 -> 3/2/2, the remainder going to the earlier groups', ['a','b','c'].map(g => mk7.filter(b => b.group === g).length), [3, 2, 2]);
eq('one group sits mid-field', C.makeBalloons(['a'], 3).map(b => b.y), [0.5, 0.5, 0.5]);
eq('a lone balloon in a row is centred', C.makeBalloons(['a', 'b'], 2).map(b => b.x), [0.5, 0.5]);
eq('no groups -> no balloons', C.makeBalloons([], 10), []);
eq('count 0 -> no balloons', C.makeBalloons(['a'], 0), []);
eq('a negative count -> no balloons', C.makeBalloons(['a'], -4), []);

const scrambled = tl.balloons.map(b => Object.assign({}, b, { x: 0.99, y: 0.01 }));
const rearranged = C.arrangeBalloons(scrambled, tl.groupIds);
eq('auto-arrange rewrites only position, never identity',
   rearranged.map(b => [b.n, b.group]), tl.balloons.map(b => [b.n, b.group]));
eq('auto-arrange keeps optional labels', rearranged.filter(b => b.label).map(b => b.label), ['Wishingstar', 'Pala Spirit']);
ok('auto-arrange actually moved them off the pile', rearranged.every(b => b.x !== 0.99 || b.y !== 0.01));
eq('auto-arrange of a partly-populated field only makes rows for groups in use',
   C.arrangeBalloons([{ n: 1, group: 'south', x: 0, y: 0 }, { n: 2, group: 'south', x: 0, y: 0 }], tl.groupIds).map(b => b.y), [0.5, 0.5]);

eq('normalizeBalloons drops unknown groups, duplicates, junk and non-objects',
   C.normalizeBalloons([
     { n: 1, group: 'north', x: 0.2, y: 0.2 },
     { n: 1, group: 'south', x: 0.3, y: 0.3 },   // duplicate number
     { n: 2, group: 'ghost', x: 0.3, y: 0.3 },   // unknown group
     null, 'nope', { group: 'north', x: 0, y: 0 },
     { n: 3, group: 'south', x: 0.4, y: 0.4 }
   ], tl.groupIds).map(b => [b.n, b.group]), [[1, 'north'], [3, 'south']]);
eq('normalizeBalloons clamps coordinates into the field',
   C.normalizeBalloons([{ n: 1, group: 'north', x: 4, y: -9 }], tl.groupIds).map(b => [b.x, b.y]), [[1, 0]]);
eq('normalizeBalloons sorts by number', C.normalizeBalloons([{ n: 9, group: 'north', x: 0, y: 0 }, { n: 2, group: 'north', x: 0, y: 0 }], tl.groupIds).map(b => b.n), [2, 9]);
eq('normalizeBalloons of a non-array is empty', C.normalizeBalloons('x', tl.groupIds), []);

/* ==========================================================================
   BACKWARD COMPATIBILITY
   Every show file written before these two fields existed must load and behave
   EXACTLY as it did. This strips both back off the demo and checks that.
   ========================================================================== */
section('BACKWARD COMPATIBILITY — a show with neither field');
const old = raw();
delete old.audio.bpm; delete old.audio.beatOffsetMs; delete old.balloons;
const oldV = C.validateShow(old);
ok('a show with no bpm and no balloons validates', oldV.ok, oldV.errors);
eq('...its audio block has exactly the old two keys', Object.keys(oldV.show.audio), ['title', 'durationMs']);
ok('...and it carries no balloons key at all', !('balloons' in oldV.show));
const oldTl = C.compileShow(oldV.show);
const cueDigest = t => JSON.stringify({ segments: t.segments, vents: t.vents, perGroup: t.perGroup, previewCues: t.previewCues, endMs: t.endMs, audioMs: t.audioMs });
ok('adding bpm + balloons changes NOTHING about the compiled cue timeline', cueDigest(oldTl) === cueDigest(tl),
   { old: cueDigest(oldTl).length, now: cueDigest(tl).length });
let stateDiff = null;
for (const g of tl.groupIds) {
  for (let t = -10000; t <= 92000; t += 25) {
    if (JSON.stringify(C.stateAt(oldTl, [g], t)) !== JSON.stringify(C.stateAt(tl, [g], t))) { stateDiff = [g, t]; break; }
  }
  if (stateDiff) break;
}
ok('every stateAt() the phones render is identical with and without the new fields', stateDiff === null, stateDiff);
eq('the old show compiles with no beat grid and no balloons', [oldTl.beat, oldTl.balloons.length], [null, 0]);
ok('beatAt on it is null everywhere', [-5000, 0, 1, 40000, 89999].every(t => C.beatAt(oldTl, t) === null));
eq('groupOfBalloon on it is always null', [1, 7, 12].map(n => C.groupOfBalloon(oldTl, n)), [null, null, null]);

console.log('\n================  ' + pass + ' passed, ' + fail + ' failed  ================');
process.exit(fail ? 1 : 0);
