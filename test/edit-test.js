/* Suite 8 — editing a show (the conductor's show editing, 11-27).

   Two promises the editing screens make, checked on the pure core:
   1. A show edited after it was published keeps the code its pilots joined
      with: showCode() honours a pinned `code`, validateShow() keeps it (and
      drops a malformed one), and every pack goes out under it.
   2. "Yours stays yours": choreograph() with keepCues (Rebuild the rest)
      returns the conductor's move exactly as it was, builds the app's moves
      around it, and the result passes the same checks.
   The screens themselves (stretch picking, fixes, undo, publish) were checked
   in a real browser at phone size; see the project CLAUDE.md.

   Run: node test/extract.js && node test/choreo-extract.js && node test/edit-test.js */
const fs = require('fs');
const path = require('path');
const P = require('./pure-core.js');
const C = require('./choreo.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '   -> ' + JSON.stringify(extra).slice(0, 600) : '')); }
}
function section(s) { console.log('\n== ' + s); }

const LS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'shows', 'havasu-lightning-storm.json'), 'utf8'));

section('a pinned show code survives edits');
{
  const v = P.validateShow(LS);
  ok('the Lightning Storm show validates', v.ok, v.errors);
  const orig = P.showCode(v.show);
  ok('its content code is UKL7 (the code on the board)', orig === 'UKL7', orig);
  const edited = JSON.parse(JSON.stringify(LS));
  edited.cues[0].t += 500;
  const ve = P.validateShow(edited);
  ok('an edit changes the content code', ve.ok && P.showCode(ve.show) !== orig, P.showCode(ve.show));
  edited.code = orig;
  const vp = P.validateShow(edited);
  ok('validateShow keeps a pinned code', vp.ok && vp.show.code === orig, vp.show && vp.show.code);
  ok('showCode returns the pinned code', P.showCode(vp.show) === orig);
  const tl = P.compileShow(vp.show);
  const packs = P.compileShowPacks(tl);
  ok('the bundle goes out under the pinned code', packs.code === orig, packs.code);
  ok('every pack carries the pinned code', Object.keys(packs.packs).every(k => packs.packs[k].code === orig));
  ok('every balloon gets a pack', packs.keys.length === (LS.balloons || []).length, packs.keys.length);
  ['ukl7', 'UKL', 'UKL77', 7, null, 'U-L7'].forEach(bad => {
    const s = JSON.parse(JSON.stringify(LS));
    s.code = bad;
    const r = P.validateShow(s);
    ok('a malformed code (' + JSON.stringify(bad) + ') is dropped, not kept', r.ok && r.show.code === undefined && P.showCode(r.show) === orig);
  });
  ok('a show with no code is byte-for-byte what it was', !('code' in v.show));
}

section('rebuild the rest keeps the conductor\'s move exactly');
{
  const v = P.validateShow(LS);
  const show = v.show;
  const bpm = show.audio.bpm, beat = 60000 / bpm;
  const members = show.balloons.map(b => b.n);
  const mine = { t: 71529, dur: 1000, type: 'pattern', target: { all: true }, label: 'Sweep left → right', pattern: 'sweep', dir: 'lr',
                 bandCount: 5, stepMs: Math.round(2 * beat), burnMs: Math.round(3 * beat), bands: [] };
  mine.bands = C.patternBands({ pattern: 'sweep', dir: 'lr', bandCount: 5, members: members }, show.balloons);
  mine.dur = C.patternDur(mine);
  ok('the hand-made wave has 5 bands', mine.bands.length === 5, mine.bands.length);
  const sum = { durationMs: show.audio.durationMs, bpm: bpm, beatOffsetMs: show.audio.beatOffsetMs || 0 };
  [0.6, 0.8, 1].forEach(intensity => {
    const opts = { groups: show.groups, balloons: show.balloons, field: show.field || null, sets: show.sets || [], intensity: intensity,
                   keepCues: [JSON.parse(JSON.stringify(mine))] };
    const r = C.choreograph(sum, opts);
    ok('busy ' + Math.round(intensity * 100) + '%: the rebuilt show validates', r.ok, r.errors);
    const kept = r.cues.filter(c => c.t === mine.t && c.pattern === 'sweep' && c.label === mine.label);
    ok('busy ' + Math.round(intensity * 100) + '%: the wave is still there, once', kept.length === 1, kept.length);
    const k = kept[0] || {};
    ok('busy ' + Math.round(intensity * 100) + '%: same start, length and bands', k.dur === mine.dur && JSON.stringify(k.bands) === JSON.stringify(mine.bands),
       { dur: k.dur, want: mine.dur });
    ok('busy ' + Math.round(intensity * 100) + '%: the app built moves around it', r.cues.length > 5, r.cues.length);
    const audit = C.chAudit(r.cues, opts, sum.durationMs);
    const ki = r.cues.indexOf(k);
    ok('busy ' + Math.round(intensity * 100) + '%: nothing red on the wave after the rebuild', !(audit.perCue[ki] || []).some(x => x.severity === 'block'), audit.perCue[ki]);
    ok('busy ' + Math.round(intensity * 100) + '%: nothing red anywhere', audit.blocking === 0, audit.blocking);
  });
}

console.log('\n================  ' + pass + ' passed, ' + fail + ' failed  ================');
process.exit(fail ? 1 : 0);
