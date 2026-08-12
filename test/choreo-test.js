/* Suite 4 — audio analysis (pure DSP) + auto-choreographer.
   Everything under test is sliced live out of ../index.html by
   choreo-extract.js: FFT, onset envelope, tempo, sections, and the
   choreographer, plus PURE CORE (which the choreographer calls).

   The analysis half is exercised on SYNTHESISED PCM generated here — kick /
   snare / hat / bass / pad arranged into labelled sections — so tempo and
   section detection are checked against a known ground truth without needing a
   browser or an audio file. The constraint checks deliberately re-derive the
   timeline with compileShow() instead of asking the choreographer's own
   scheduler, so a bug in the scheduler cannot mark its own homework. */
const fs = require('fs');
const path = require('path');
const C = require('./choreo.js');
const DEMO_PATH = path.join(__dirname, '..', 'shows', 'demo-show.json');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '   -> ' + JSON.stringify(extra) : '')); }
}
function eq(name, got, want) { ok(name + '  [' + JSON.stringify(got) + ']', JSON.stringify(got) === JSON.stringify(want), { got, want }); }
function near(name, got, want, tol) { ok(name + '  [' + got + ' vs ' + want + ' +/-' + tol + ']', Math.abs(got - want) <= tol, { got, want }); }
function section(s) { console.log('\n== ' + s); }

/* ------------------------------------------------------------- synthesiser */
function lcg(seed) { let s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; }; }
const KINDS = {
  intro:     { kick: 0.0,  snare: 0.0,  hat: 0.35, bass: 0.0,  pad: 0.25, gain: 0.30 },
  verse:     { kick: 0.75, snare: 0.55, hat: 0.45, bass: 0.45, pad: 0.20, gain: 0.62 },
  build:     { kick: 0.12, snare: 0.25, hat: 1.00, bass: 0.08, pad: 0.60, gain: 0.72, ramp: true },
  drop:      { kick: 1.00, snare: 0.80, hat: 0.75, bass: 1.00, pad: 0.30, gain: 1.00 },
  chorus:    { kick: 0.95, snare: 0.75, hat: 0.70, bass: 0.90, pad: 0.35, gain: 0.95 },
  breakdown: { kick: 0.10, snare: 0.10, hat: 0.30, bass: 0.05, pad: 0.55, gain: 0.34 },
  outro:     { kick: 0.20, snare: 0.10, hat: 0.25, bass: 0.10, pad: 0.30, gain: 0.28 }
};
function synthSong(cfg) {
  const bpm = cfg.bpm || 120, sr = cfg.sampleRate || 22050, seconds = cfg.seconds || 60;
  const n = Math.round(seconds * sr), pcm = new Float32Array(n), rnd = lcg(cfg.seed || 12345);
  const noise = new Float32Array(4096);
  for (let i = 0; i < noise.length; i++) noise[i] = rnd();
  const beatSec = 60 / bpm, secs = cfg.sections || [{ at: 0, kind: 'verse' }], offsetSec = cfg.offsetSec || 0;
  const kindAt = function (t) {
    let k = secs[0];
    for (let i = 0; i < secs.length; i++) if (t >= secs[i].at) k = secs[i];
    return { p: KINDS[k.kind] || KINDS.verse, start: k.at, next: (secs[secs.indexOf(k) + 1] || { at: seconds }).at };
  };
  const add = function (start, dur, fn) {
    const i0 = Math.max(0, Math.round(start * sr)), i1 = Math.min(n, Math.round((start + dur) * sr));
    for (let i = i0; i < i1; i++) pcm[i] += fn((i - i0) / sr);
  };
  const nz = function (x, k) { return noise[(Math.round(x * sr * (k || 1)) % noise.length + noise.length) % noise.length]; };
  for (let b = 0; b < Math.floor((seconds - offsetSec) / beatSec); b++) {
    const t = offsetSec + b * beatSec, info = kindAt(t), p = info.p;
    let g = p.gain;
    if (p.ramp) g *= 0.55 + 0.75 * Math.min(1, (t - info.start) / Math.max(1e-6, info.next - info.start));
    const inBar = b % 4;
    if (p.kick > 0) add(t, 0.16, function (x) { return p.kick * g * Math.exp(-x * 28) * Math.sin(2 * Math.PI * (55 + 70 * Math.exp(-x * 40)) * x); });
    if (p.snare > 0 && (inBar === 1 || inBar === 3)) add(t, 0.13, function (x) { return p.snare * g * Math.exp(-x * 24) * nz(x) * 0.85; });
    if (p.hat > 0) for (let h = 0; h < 2; h++) add(t + h * beatSec / 2, 0.04, function (x) { return p.hat * g * 0.4 * Math.exp(-x * 90) * nz(x, 3.1); });
    if (p.bass > 0) add(t, beatSec * 0.9, function (x) { return p.bass * g * 0.35 * Math.exp(-x * 3) * Math.sin(2 * Math.PI * 82.4 * x); });
    if (p.pad > 0) add(t, beatSec, function (x) { return p.pad * g * 0.12 * (Math.sin(2 * Math.PI * 330 * x) + Math.sin(2 * Math.PI * 495 * x) + 0.6 * Math.sin(2 * Math.PI * 1320 * x)); });
  }
  for (let i = 0; i < n; i++) pcm[i] = Math.max(-1, Math.min(1, pcm[i] * 0.8));
  return { pcm: pcm, sr: sr, bpm: bpm, seconds: seconds };
}
function tone(hz, seconds, sr, amp) {
  const n = Math.round(seconds * sr), out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (amp === undefined ? 0.5 : amp) * Math.sin(2 * Math.PI * hz * i / sr);
  return out;
}

/* ------------------------------------- independent constraint verification */
const CUE_LOAD_PULSE = 0.5;   // must match CH_DEFAULTS.pulseDuty
function restNeed(opt, sustained) {
  return sustained >= opt.longBurnMs ? Math.max(opt.minRestMs, opt.stopMs + opt.ventLeadMs + opt.getReadyMs) : opt.minRestMs;
}
/* Re-derives per-group occupancy from the compiled timeline (NOT from the
   choreographer's scheduler) and re-checks every hard constraint. */
function verifyConstraints(show, opt, label) {
  const v = C.validateShow(show);
  ok(label + ': validateShow clean', v.ok, v.errors);
  if (!v.ok) return null;
  const tl = C.compileShow(v.show);
  const problems = [];
  const loads = {};
  tl.groupIds.forEach(function (gid) {
    const wins = tl.perGroup[gid].windows;
    const blocks = [];
    wins.forEach(function (w) {
      const isPulse = w.type === 'pulse';
      const last = blocks[blocks.length - 1];
      if (last && last.cueIndex === w.cueIndex) {
        last.end = Math.max(last.end, w.end);
        last.sustained = Math.max(last.sustained, isPulse ? 0 : w.dur);
        last.load += isPulse ? w.dur * CUE_LOAD_PULSE : w.dur;
      } else {
        blocks.push({ cueIndex: w.cueIndex, t: w.t, end: w.end, label: w.baseLabel,
                      sustained: isPulse ? 0 : w.dur, load: isPulse ? w.dur * CUE_LOAD_PULSE : w.dur });
      }
    });
    let total = 0;
    blocks.forEach(function (b, i) {
      total += b.load;
      if (b.sustained > opt.maxBurnMs + 0.5) problems.push(gid + ' burns ' + b.sustained + 'ms continuous in "' + b.label + '" (max ' + opt.maxBurnMs + ')');
      if (i > 0) {
        const gap = b.t - blocks[i - 1].end, need = restNeed(opt, b.sustained);
        if (gap < need - 0.5) problems.push(gid + ' gets ' + gap + 'ms before "' + b.label + '" (needs ' + need + ')');
      }
    });
    loads[gid] = total;
    if (total > opt.burnBudgetMs + 0.5) problems.push(gid + ' burns ' + total + 'ms total (budget ' + opt.burnBudgetMs + ')');
  });
  const vals = Object.keys(loads).map(function (k) { return loads[k]; });
  const mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
  if (mx > 0 && mn / mx < opt.fairness - 1e-9) problems.push('fairness ' + (mn / mx).toFixed(3) + ' below ' + opt.fairness + ' — ' + JSON.stringify(loads));
  ok(label + ': all hard constraints hold (re-derived from compileShow)', problems.length === 0, problems);
  return { tl: tl, loads: loads, blocks: null };
}
function onBeatGrid(show, A, tolMs) {
  const beatMs = 60000 / A.bpm;
  return show.cues.every(function (c) {
    const k = (c.t - A.beatOffsetMs) / beatMs;
    return Math.abs(k - Math.round(k)) * beatMs <= (tolMs === undefined ? 2 : tolMs);
  });
}

async function main() {
  /* ====================================================================== */
  section('FFT / WINDOW');
  const fft64 = C._fftFor(64);
  const re = new Float64Array(64), im = new Float64Array(64);
  const rnd = lcg(7);
  const sig = [];
  for (let i = 0; i < 64; i++) { sig.push(rnd()); re[i] = sig[i]; im[i] = 0; }
  fft64(re, im);
  let maxErr = 0;
  for (let k = 0; k < 64; k++) {
    let sr2 = 0, si2 = 0;
    for (let t = 0; t < 64; t++) { const a = 2 * Math.PI * k * t / 64; sr2 += sig[t] * Math.cos(a); si2 -= sig[t] * Math.sin(a); }
    maxErr = Math.max(maxErr, Math.abs(sr2 - re[k]), Math.abs(si2 - im[k]));
  }
  ok('radix-2 FFT matches a naive DFT to 1e-9  [' + maxErr.toExponential(2) + ']', maxErr < 1e-9, maxErr);

  const re2 = new Float64Array(256), im2 = new Float64Array(256);
  for (let i = 0; i < 256; i++) { re2[i] = Math.cos(2 * Math.PI * 5 * i / 256); im2[i] = 0; }
  C._fftFor(256)(re2, im2);
  let peakBin = 0, peakMag = 0;
  for (let b = 0; b < 128; b++) { const m = Math.hypot(re2[b], im2[b]); if (m > peakMag) { peakMag = m; peakBin = b; } }
  eq('FFT of a cosine at bin 5 peaks at bin 5', peakBin, 5);
  near('peak magnitude is n/2', peakMag, 128, 1e-6);
  let threw = false;
  try { C._fftFor(100); } catch (e) { threw = true; }
  ok('FFT rejects a non-power-of-two size', threw);
  const win = C._hannWindow(8);
  ok('Hann window starts at 0 and is symmetric', win[0] === 0 && Math.abs(win[1] - win[7]) < 1e-12, Array.from(win));
  let wsum = 0;
  for (let i = 0; i < 8; i++) wsum += win[i];
  near('Hann window sums to n/2', wsum, 4, 1e-9);

  /* ====================================================================== */
  section('FRAMES / BANDS / ONSET ENVELOPE');
  const sr = 22050;
  const fLow = await C.computeFrames(tone(100, 2, sr), sr, {});
  const fHigh = await C.computeFrames(tone(5000, 2, sr), sr, {});
  eq('frame rate is sampleRate/hop', Math.round(fLow.fps * 100) / 100, Math.round(sr / 512 * 100) / 100);
  eq('frame count for a 2s tone', fLow.count, Math.floor((2 * sr - 2048) / 512) + 1);
  ok('a 100 Hz tone lands in the LOW band, not HIGH', fLow.low[20] > 10 * fLow.high[20], [fLow.low[20], fLow.high[20]]);
  ok('a 5 kHz tone lands in the HIGH band, not LOW', fHigh.high[20] > 10 * fHigh.low[20], [fHigh.low[20], fHigh.high[20]]);
  near('RMS of a 0.5-amplitude sine is 0.354', fLow.rms[20], 0.3536, 0.002);
  const flat = new Float32Array(200).fill(0.4);
  const envFlat = C.onsetEnvelope(flat, 43);
  ok('a constant flux gives a zero onset envelope', Array.from(envFlat).every(function (v) { return v === 0; }));
  const spiky = new Float32Array(200).fill(0.1);
  spiky[100] = 2;
  const envSpiky = C.onsetEnvelope(spiky, 43);
  ok('a flux spike survives the adaptive threshold and normalises to 1', envSpiky[100] === 1 && envSpiky[50] === 0, [envSpiky[100], envSpiky[50]]);

  /* ====================================================================== */
  section('TEMPO — synthetic songs with known BPM');
  const tempoOf = async function (bpm, offsetSec) {
    const s = synthSong({ bpm: bpm, seconds: 60, sampleRate: sr, offsetSec: offsetSec || 0 });
    const fr = await C.computeFrames(s.pcm, sr, {});
    const on = C.onsetEnvelope(fr.flux, fr.fps);
    return { t: C.estimateTempo(on, fr.fps, {}), fr: fr, on: on };
  };
  for (const bpm of [90, 120, 128, 150]) {
    const r = await tempoOf(bpm);
    near('detects ' + bpm + ' BPM', r.t.bpm, bpm, 1.5);
    ok('  ' + bpm + ' BPM: confidence reported (0..1)', r.t.confidence >= 0 && r.t.confidence <= 1, r.t.confidence);
  }
  const phased = await tempoOf(120, 0.25);
  near('finds the beat PHASE of a 120 BPM track offset by 250 ms', phased.t.beatOffsetMs, 250, 40);
  const slow = await tempoOf(60);
  const oct = Math.abs(Math.log2(slow.t.bpm / 60));
  ok('a 60 BPM track reads as an octave of 60 (' + slow.t.bpm + ') — the 90-180 preference doubles it', Math.abs(oct - Math.round(oct)) < 0.03 && slow.t.bpm >= 60, slow.t.bpm);
  const again = C.estimateTempo(phased.on, phased.fr.fps, {});
  eq('tempo estimation is deterministic', [again.bpm, again.beatOffsetMs], [phased.t.bpm, phased.t.beatOffsetMs]);
  const beats = C.buildBeats(phased.on, phased.on, phased.fr.fps, phased.t, 60000);
  const spacing = beats.slice(1).map(function (b, i) { return b.t - beats[i].t; });
  ok('beat grid is evenly spaced at 60000/bpm', spacing.every(function (d) { return Math.abs(d - 60000 / phased.t.bpm) <= 1; }), spacing.slice(0, 4));
  eq('first beat sits at the detected offset', beats[0].t, phased.t.beatOffsetMs);
  ok('beat strengths are normalised 0..1 with a 1', beats.every(function (b) { return b.strength >= 0 && b.strength <= 1; }) && beats.some(function (b) { return b.strength === 1; }));
  const bp = C.estimateBarPhase(beats, 4);
  ok('bar phase is a beat index inside the bar', bp >= 0 && bp <= 3, bp);

  /* ====================================================================== */
  section('SECTIONS — structure detection');
  const structured = synthSong({
    bpm: 128, seconds: 180, sampleRate: sr,
    sections: [{ at: 0, kind: 'intro' }, { at: 24, kind: 'verse' }, { at: 56, kind: 'build' },
               { at: 80, kind: 'drop' }, { at: 112, kind: 'breakdown' }, { at: 136, kind: 'chorus' }, { at: 164, kind: 'outro' }]
  });
  const A = await C.analyzePCM(structured.pcm, sr);
  near('structured song: tempo', A.bpm, 128, 1.5);
  const truth = [24000, 56000, 80000, 112000, 136000, 164000];
  const found = A.sections.slice(1).map(function (s) { return s.startMs; });
  eq('finds exactly 6 section boundaries', found.length, 6);
  truth.forEach(function (t, i) {
    ok('boundary ' + (i + 1) + ' within 2.5s of ' + (t / 1000) + 's  [' + (found[i] / 1000).toFixed(1) + 's]',
      found[i] !== undefined && Math.abs(found[i] - t) <= 2500, found[i]);
  });
  eq('labels the run intro/verse/build/drop/breakdown/chorus/outro',
    A.sections.map(function (s) { return s.label; }),
    ['intro', 'verse', 'build', 'drop', 'breakdown', 'chorus', 'outro']);
  ok('sections are contiguous and cover the whole track',
    A.sections[0].startMs === 0 && A.sections[A.sections.length - 1].endMs === A.durationMs &&
    A.sections.every(function (s, i) { return i === 0 || s.startMs === A.sections[i - 1].endMs; }));
  ok('every section carries confidence, energy and raw features',
    A.sections.every(function (s) { return s.confidence > 0 && s.confidence <= 1 && s.energy >= 0 && s.energy <= 1 && typeof s.features.rms === 'number'; }));
  ok('the drop is the highest-energy section', A.sections[3].energy === 1, A.sections.map(function (s) { return s.energy; }));

  const uniform = synthSong({ bpm: 120, seconds: 100, sampleRate: sr });
  const U = await C.analyzePCM(uniform.pcm, sr);
  eq('a uniform track yields ONE section (no invented structure)', U.sections.length, 1);

  const sum = C.analysisSummary(A);
  const round = JSON.parse(JSON.stringify(sum));
  ok('analysisSummary survives a JSON round trip (localStorage-safe)',
    round.beats.length === sum.beats.length && round.sections.length === sum.sections.length && round.wave.length === sum.wave.length);
  ok('the summary carries no typed arrays', !(sum.wave instanceof Float32Array) && Array.isArray(sum.wave));
  eq('silhouette is normalised to a 1', Math.max.apply(null, sum.wave), 1);

  /* ====================================================================== */
  section('CHOREOGRAPHER — the real 3-minute fixture');
  const opt = C.chOptions({ audioTitle: 'fixture', title: 'Fixture glow' });
  const r = C.choreograph(sum, { audioTitle: 'fixture', title: 'Fixture glow' });
  ok('choreographs cleanly', r.ok, r.errors);
  ok('emits cues', r.cues.length >= 4, r.cues.length);
  verifyConstraints(r.show, opt, 'default run');
  ok('cues are sorted by t', r.cues.every(function (c, i) { return i === 0 || c.t >= r.cues[i - 1].t; }));
  ok('every cue start sits on the beat grid', onBeatGrid(r.show, sum));
  ok('cue types are drawn from the schema', r.cues.every(function (c) { return ['burn', 'pulse', 'alternate'].indexOf(c.type) !== -1; }));
  ok('pulses carry a bpm, alternates a periodMs',
    r.cues.every(function (c) { return (c.type !== 'pulse' || c.bpm >= 20) && (c.type !== 'alternate' || c.periodMs > 0); }));
  ok('a drop section produced an ALL burn',
    r.cues.some(function (c) { return c.groups[0] === 'all' && c.type === 'burn' && /Drop/.test(c.label); }), r.cues.map(function (c) { return c.label; }));
  ok('a chorus section produced an ALL pulse',
    r.cues.some(function (c) { return c.type === 'pulse' && /Chorus/.test(c.label); }));
  ok('a verse produced a ping-pong across the groups',
    r.cues.some(function (c) { return c.type === 'alternate' && /Verse/.test(c.label); }));
  ok('a build produced a wave', r.cues.some(function (c) { return /Build/.test(c.label); }));
  ok('the show fits inside the audio', r.cues.every(function (c) { return c.t >= 0 && c.t + c.dur <= sum.durationMs; }));
  ok('long burns get a vent warning derived by the timeline engine',
    C.compileShow(C.validateShow(r.show).show).vents.length >= 1);

  section('CHOREOGRAPHER — determinism, advisories, intensity');
  const r2 = C.choreograph(sum, { audioTitle: 'fixture', title: 'Fixture glow' });
  eq('same input twice -> identical show', JSON.stringify(r2.show), JSON.stringify(r.show));
  const rDeep = C.choreograph(JSON.parse(JSON.stringify(sum)), { audioTitle: 'fixture', title: 'Fixture glow' });
  eq('deep-copied input -> identical show', JSON.stringify(rDeep.show), JSON.stringify(r.show));
  ok('constraint-forced drops are reported as readable advisories',
    r.advisories.length > 0 && r.advisories.every(function (a) { return typeof a.text === 'string' && a.text.length > 10 && typeof a.reason === 'string'; }),
    r.advisories.slice(0, 2));
  ok('an advisory names what was wanted and why it was skipped',
    r.advisories.some(function (a) { return /wanted /.test(a.text) && /skipped: /.test(a.text); }), r.advisories[0]);

  let prev = -1, mono = true, series = [];
  [0, 0.25, 0.5, 0.75, 1].forEach(function (i) {
    const ri = C.choreograph(sum, { intensity: i });
    series.push(ri.stats.totalCueMs);
    if (ri.stats.totalCueMs < prev) mono = false;
    prev = ri.stats.totalCueMs;
    verifyConstraints(ri.show, C.chOptions({ intensity: i }), 'intensity ' + i);
  });
  ok('total cue time is monotone in intensity  ' + JSON.stringify(series), mono, series);
  ok('intensity 0 still produces the skeleton of the show', series[0] > 0);
  ok('intensity 1 produces more than intensity 0', series[4] > series[0], series);

  section('CHOREOGRAPHER — option ranges');
  [
    ['tight rest (2s)', { minRestMs: 2000 }],
    ['no rest at all', { minRestMs: 0 }],
    ['short max burn (3s)', { maxBurnMs: 3000 }],
    ['tiny budget (12s)', { burnBudgetMs: 12000 }],
    ['huge budget, dense', { burnBudgetMs: 600000, intensity: 1, minRestMs: 3000 }],
    ['long vent lead', { ventLeadMs: 15000 }],
    ['6 groups', { groups: [1, 2, 3, 4, 5, 6].map(function (n) { return { id: 'g' + n, label: 'GROUP ' + n, color: '#00c8ff' }; }) }],
    ['2 groups', { groups: [{ id: 'a', label: 'A', color: '#00c8ff' }, { id: 'b', label: 'B', color: '#ff3ea5' }] }],
    ['3/4 time', { beatsPerBar: 3 }]
  ].forEach(function (pair) {
    const o = C.chOptions(pair[1]);
    const rr = C.choreograph(sum, pair[1]);
    verifyConstraints(rr.show, o, pair[0]);
  });

  section('CHOREOGRAPHER — edge cases');
  const oneGroup = C.choreograph(sum, { groups: [{ id: 'solo', label: 'EVERYONE', color: '#00c8ff' }] });
  verifyConstraints(oneGroup.show, C.chOptions({ groups: [{ id: 'solo', label: 'EVERYONE', color: '#00c8ff' }] }), 'one group');
  ok('one group: no alternate cues (nothing to alternate with)',
    oneGroup.cues.every(function (c) { return c.type !== 'alternate'; }), oneGroup.cues.map(function (c) { return c.type; }));

  const shortA = { durationMs: 20000, bpm: 120, beatOffsetMs: 0, barPhase: 0,
                   beats: [], sections: [{ startMs: 0, endMs: 20000, label: 'chorus', confidence: 0.5, energy: 1 }] };
  for (let t = 0; t <= 20000; t += 500) shortA.beats.push({ t: t, strength: (t / 500) % 4 === 0 ? 1 : 0.4, low: (t / 500) % 4 === 0 ? 1 : 0.2 });
  const rShort = C.choreograph(shortA, {});
  verifyConstraints(rShort.show, C.chOptions({}), '20-second song');
  ok('20-second song: nothing runs past the end', rShort.cues.every(function (c) { return c.t + c.dur <= 20000; }));

  [60, 200].forEach(function (bpm) {
    const beatMs = 60000 / bpm, aa = { durationMs: 150000, bpm: bpm, beatOffsetMs: 137, barPhase: 0, beats: [], sections: [
      { startMs: 0, endMs: 40000, label: 'intro', confidence: 0.6, energy: 0.2 },
      { startMs: 40000, endMs: 90000, label: 'verse', confidence: 0.6, energy: 0.6 },
      { startMs: 90000, endMs: 150000, label: 'drop', confidence: 0.9, energy: 1 }] };
    for (let t = 137; t <= 150000; t += beatMs) aa.beats.push({ t: Math.round(t), strength: 0.8, low: 0.9 });
    const rb = C.choreograph(aa, {});
    verifyConstraints(rb.show, C.chOptions({}), bpm + ' BPM song');
    ok(bpm + ' BPM: cue starts stay on the beat grid', onBeatGrid(rb.show, aa));
    ok(bpm + ' BPM: no alternate leg is shorter than minPeriodMs',
      rb.cues.every(function (c) { return c.type !== 'alternate' || c.periodMs >= C.CH_DEFAULTS.minPeriodMs; }),
      rb.cues.filter(function (c) { return c.type === 'alternate'; }).map(function (c) { return c.periodMs; }));
  });

  const junk = C.choreograph({}, {});
  ok('an empty analysis still yields a valid show', junk.ok && junk.show.cues.length >= 1, junk.errors);
  const nasty = C.choreograph(sum, { groups: [{ id: 'all', label: '', color: 'nope' }, { id: 'North Row!', label: 'N', color: '#00c8ff' }] });
  ok('bad group ids/colours are sanitised into a valid show', nasty.ok, nasty.errors);
  ok('  the reserved id "all" is never emitted as a group', nasty.show.groups.every(function (g) { return g.id !== 'all'; }), nasty.show.groups);

  section('CHOREOGRAPHER — per-section regeneration + audit');
  const keep = r.cues.filter(function (c) { return c.t < A.sections[3].startMs; });
  const regen = C.choreograph(sum, { keepCues: keep, onlySections: [3] });
  ok('regenerating one section keeps every cue outside it',
    keep.every(function (k) { return regen.cues.some(function (c) { return c.t === k.t && c.label === k.label; }); }));
  ok('regenerating one section only adds cues inside it',
    regen.cues.filter(function (c) { return !keep.some(function (k) { return k.t === c.t && k.label === c.label; }); })
      .every(function (c) { return c.t >= A.sections[3].startMs - 1 && c.t < A.sections[3].endMs; }));
  verifyConstraints(regen.show, opt, 'section 4 regenerated');

  const audit = C.chAudit(r.cues, {}, sum.durationMs);
  eq('a generated show audits clean (no blocking issues)', audit.blocking, 0);
  const broken = r.cues.slice();
  broken.push({ t: r.cues[0].t + 10, dur: 4000, type: 'burn', groups: ['all'], label: 'CLASH' });
  const auditBad = C.chAudit(broken, {}, sum.durationMs);
  ok('an overlapping hand edit is caught with a reason', auditBad.blocking > 0 &&
    auditBad.perCue[auditBad.perCue.length - 1].some(function (i) { return i.code === 'overlap'; }),
    auditBad.perCue[auditBad.perCue.length - 1]);
  const auditLong = C.chAudit([{ t: 30000, dur: 30000, type: 'burn', groups: ['all'], label: 'TOO LONG' }], {}, sum.durationMs);
  ok('a hand-edited over-long burn is caught', auditLong.perCue[0].some(function (i) { return i.code === 'maxburn'; }), auditLong.perCue[0]);
  const auditRunway = C.chAudit([
    { t: 20000, dur: 2000, type: 'burn', groups: ['all'], label: 'short' },
    { t: 30000, dur: 10000, type: 'burn', groups: ['all'], label: 'long' }
  ], {}, sum.durationMs);
  ok('a long burn with only 8s of runway is caught (needs 12s to vent + get ready)',
    auditRunway.perCue[1].some(function (i) { return i.code === 'runway'; }), auditRunway.perCue[1]);
  ok('  …but 8s of runway is amber, not a veto — it is tight, not dangerous',
    auditRunway.perCue[1].every(function (i) { return i.severity === 'warn'; }), auditRunway.perCue[1]);
  const auditNoWarning = C.chAudit([
    { t: 10000, dur: 2000, type: 'burn', groups: ['all'], label: 'stab' },
    { t: 13000, dur: 14000, type: 'burn', groups: ['all'], label: '14s finale' }
  ], {}, sum.durationMs);
  ok('a 14s burn with a 1s warning IS a hard stop (the reviewer\'s scenario)',
    auditNoWarning.perCue[1].some(function (i) { return i.code === 'runway' && i.severity === 'block'; }), auditNoWarning.perCue[1]);
  ok('identical problems across every group collapse into one line',
    auditNoWarning.perCue[1].filter(function (i) { return i.code === 'runway'; }).length === 1 &&
    /Every group/.test(auditNoWarning.perCue[1].filter(function (i) { return i.code === 'runway'; })[0].text),
    auditNoWarning.perCue[1]);
  // the hand-authored demo show is the schema reference: it is deliberately
  // tighter than the generator's own rules and must still import and re-export
  const demo = JSON.parse(fs.readFileSync(DEMO_PATH, 'utf8'));
  const auditDemo = C.chAudit(demo.cues, { groups: demo.groups }, demo.audio.durationMs);
  eq('the hand-authored demo show imports with zero blocking problems', auditDemo.blocking, 0);
  ok('  …and does raise advisory warnings about its tight spacing', auditDemo.warnings > 5, auditDemo.warnings);

  /* ====================================================================== */
  section('BEAT RING — the analysis tempo travels with the show');
  const AA = C.chAnalysis(sum, opt);
  eq('the generated show carries the analysed tempo',
     r.show.audio.bpm, Math.round(AA.bpm * 100) / 100);
  eq('  …and where beat one falls', r.show.audio.beatOffsetMs, Math.round(AA.beatOffsetMs));
  ok('the bpm it exports is inside the schema range',
     r.show.audio.bpm >= C.BPM_MIN && r.show.audio.bpm <= C.BPM_MAX, r.show.audio.bpm);
  ok('the beat offset it exports is a non-negative integer',
     Number.isInteger(r.show.audio.beatOffsetMs) && r.show.audio.beatOffsetMs >= 0, r.show.audio.beatOffsetMs);
  const rTl = C.compileShow(C.validateShow(r.show).show);
  ok('the compiled show therefore has a beat grid', !!rTl.beat && rTl.beat.bpm === r.show.audio.bpm, rTl.beat);
  /* The whole point of shipping the grid: the cues were PLACED on it, so the
     ring agrees with them. Both cue times and the exported offset are whole
     ms while the true grid spacing is fractional, so the residual is pure
     rounding — assert it in MILLISECONDS, where it has to be under one. */
  const beatErrMs = function (t) { const b = C.beatAt(rTl, t); return Math.min(b.phase, 1 - b.phase) * b.beatMs; };
  let worstCue = 0, worstLabel = null;
  r.show.cues.forEach(function (c) {
    const e = beatErrMs(c.t);
    if (e > worstCue) { worstCue = e; worstLabel = [c.label, c.t]; }
  });
  ok('every generated cue starts on a ring beat [worst ' + worstCue.toFixed(4) + ' ms]', worstCue <= 1, worstLabel);
  const pulses = r.show.cues.filter(function (c) { return c.type === 'pulse'; });
  ok('generated pulse cues carry exactly the show tempo (same grid, no slide)',
     pulses.length > 0 && pulses.every(function (c) { return c.bpm === r.show.audio.bpm; }),
     pulses.map(function (c) { return c.bpm; }).concat([r.show.audio.bpm]));
  let pulseDriftMs = 0, pulseSamples = 0;
  pulses.forEach(function (c) {
    const gid = c.groups[0] === 'all' ? rTl.groupIds[0] : c.groups[0];
    for (let t = c.t; t < c.t + c.dur; t += 11) {
      const st = C.stateAt(rTl, [gid], t);
      if (st.phase !== 'PULSE' || !st.pulse) continue;
      pulseSamples++;
      const b = C.beatAt(rTl, t);
      let d = Math.abs(st.pulse.beatPhase - b.phase);
      if (d > 0.5) d = 1 - d;                       // wrap: 0.999 vs 0.001 is 2 thou apart
      pulseDriftMs = Math.max(pulseDriftMs, d * b.beatMs);
    }
  });
  ok('sampled the generated pulses (' + pulseSamples + ' points)', pulseSamples > 100, pulseSamples);
  ok('a generated pulse flashes on the ring beats, end to end [worst ' + pulseDriftMs.toFixed(4) + ' ms]',
     pulseDriftMs <= 1, pulseDriftMs);
  // out of range => left out rather than octave-shifted onto a different grid
  const slowA = JSON.parse(JSON.stringify(sum));
  slowA.bpm = 30;
  const rSlow = C.choreograph(slowA, {});
  ok('a tempo below the schema range is omitted, not shifted onto another grid',
     !('bpm' in rSlow.show.audio) && rSlow.ok, rSlow.show.audio);
  ok('  …and such a show still validates and simply has no ring',
     C.beatAt(C.compileShow(C.validateShow(rSlow.show).show), 5000) === null);
  const noTempoShow = C.chBuildShow([{ t: 0, dur: 2000, type: 'burn', groups: ['all'], label: 'x' }],
                                    C.chOptions({}), { durationMs: 10000 });
  ok('chBuildShow with no analysed tempo emits no beat keys at all',
     !('bpm' in noTempoShow.audio) && !('beatOffsetMs' in noTempoShow.audio), noTempoShow.audio);

  /* ====================================================================== */
  section('BALLOONS — identity rides out with the choreography');
  const bGroups = [{ id: 'north', label: 'NORTH ROW', color: '#00c8ff' },
                   { id: 'south', label: 'SOUTH ROW', color: '#ff3ea5' }];
  const bal = C.makeBalloons(['north', 'south'], 9);
  const optB = C.chOptions({ audioTitle: 'fixture', groups: bGroups, balloons: bal });
  const rB = C.choreograph(sum, { audioTitle: 'fixture', groups: bGroups, balloons: bal });
  ok('a show generated with balloons is valid', rB.ok, rB.errors);
  eq('all 9 balloons are exported with it', rB.show.balloons.length, 9);
  eq('numbers survive the round trip', rB.show.balloons.map(function (b) { return b.n; }), [1,2,3,4,5,6,7,8,9]);
  ok('every exported balloon references a group the show defines',
     rB.show.balloons.every(function (b) { return rB.show.groups.some(function (g) { return g.id === b.group; }); }));
  verifyConstraints(rB.show, optB, 'with balloons');
  const rbTl = C.compileShow(C.validateShow(rB.show).show);
  eq('a pilot picking #5 is put in the right group', C.groupOfBalloon(rbTl, 5), bal.filter(function (b) { return b.n === 5; })[0].group);
  ok('every balloon number resolves to a group that actually gets cues',
     rbTl.balloons.every(function (b) { return rbTl.perGroup[b.group] && rbTl.perGroup[b.group].windows.length > 0; }));
  eq('choreography is unaffected by balloons — same cues either way',
     JSON.stringify(rB.show.cues),
     JSON.stringify(C.choreograph(sum, { audioTitle: 'fixture', groups: bGroups }).show.cues));
  const rNoBal = C.choreograph(sum, { audioTitle: 'fixture', groups: bGroups });
  ok('no balloons in -> no balloons key out', !('balloons' in rNoBal.show), rNoBal.show.balloons);
  const rJunk = C.choreograph(sum, { audioTitle: 'fixture', groups: bGroups,
    balloons: [{ n: 1, group: 'north', x: 0.2, y: 0.2 }, { n: 1, group: 'south', x: 0.5, y: 0.5 },
               { n: 2, group: 'ghost', x: 0.5, y: 0.5 }, { n: 3, group: 'south', x: 9, y: -9 }, 'nope'] });
  ok('junk balloons are dropped or clamped rather than poisoning the show', rJunk.ok, rJunk.errors);
  eq('  …leaving only the legal ones', rJunk.show.balloons.map(function (b) { return [b.n, b.group, b.x, b.y]; }),
     [[1, 'north', 0.2, 0.2], [3, 'south', 1, 0]]);

  section('END TO END — generated show runs through the pilot engine');
  const parsed = C.parseShowText(JSON.stringify(r.show));
  ok('the exported JSON re-parses and re-validates', parsed.ok, parsed.errors);
  const tl = C.compileShow(parsed.show);
  let states = 0, burnRun = {}, maxRun = 0, bad = null;
  tl.groupIds.forEach(function (g) { burnRun[g] = 0; });
  for (let t = 0; t < tl.endMs; t += 100) {
    tl.groupIds.forEach(function (g) {
      const st = C.stateAt(tl, [g], t);
      states++;
      if (st.phase === 'BURN') { burnRun[g] += 100; maxRun = Math.max(maxRun, burnRun[g]); }
      else burnRun[g] = 0;
      if (['IDLE', 'PRESHOW', 'ENDED', 'BURN', 'PULSE', 'STOP', 'GETREADY', 'VENT'].indexOf(st.phase) === -1) bad = [g, t, st.phase];
    });
  }
  ok('stateAt sweep over the generated show never hits an unknown phase (' + states + ' states)', bad === null, bad);
  ok('no group ever sees a continuous BURN longer than maxBurnMs  [' + maxRun + 'ms]', maxRun <= C.CH_DEFAULTS.maxBurnMs + 100, maxRun);

  console.log('\n----------------------------------------');
  console.log('  ' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
}

main().catch(function (e) { console.error(e); process.exit(1); });
