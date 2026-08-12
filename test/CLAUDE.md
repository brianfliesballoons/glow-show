# glow-show/test — node test suites for the single-file app

> **Reading protocol:** the parent [CLAUDE.md](../CLAUDE.md) routes here and is authoritative for the project; this note covers how the tests work.

## Active to-do

*Nothing open — run the suites after any change to `index.html`'s PURE CORE, AUDIO ANALYSIS, CHOREOGRAPHER, SYNC or QR modules. (391 assertions across four suites as of 2026-08-12.)*

## What this is

Four suites (**391 assertions**) that test the app's logic **extracted straight out of `index.html`** — no duplicated code, the HTML stays the single source of truth. Each `*-extract.js` slices its module out of the page (the PURE CORE / PURE DSP / CHOREOGRAPHER markers, the `const SYNC` seam, the QR seam) into a local `.js` file; each `*-test.js` then runs it under node. Run order matters: extract, then test.

```
cd test
node extract.js && node qr-extract.js && node sync-extract.js && node choreo-extract.js
node harness.js && node qr-test.js && node sync-test.js && node choreo-test.js
```

## The files

| File | Status | What it is |
|---|---|---|
| `extract.js` / `qr-extract.js` / `sync-extract.js` / `choreo-extract.js` | working | Slice modules out of `../index.html` by seam markers (writes `pure-core.js`, `qr.js`, `sync.js`, `choreo.js`, `script-0.js` here — all gitignored, regenerate freely) |
| `harness.js` | working | 191 assertions on the timeline engine: validator, cue derivation (vent/get-ready/stop), full state sequences for the demo show, pulse beat grid, alternate handoffs, invariant sweep at 10ms steps, plus the **inline `DEMO_SHOW` mirror check**, the **beat grid** (`beatAt`), **balloons** and the **backward-compatibility sweep** (see below) |
| `qr-test.js` | working | 21 assertions: encode → independent decode of rendered matrix, all 20 versions at exact byte capacity, spec structure checks |
| `sync-test.js` | working | 29 assertions: NTP rounds vs a simulated `/time` server, outlier filtering, reload re-anchor, stale/unverified states |
| `choreo-test.js` | working | 150 assertions: FFT vs a naive DFT, band separation, onset envelope, **tempo + beat phase on synthesised songs of known BPM**, section detection against a known 7-section ground truth, then every choreographer constraint, determinism, intensity monotonicity, per-section regeneration, the editor's live audit, and the **beat-grid + balloon pass-through** into generated shows |

### What the 2026-08-12 additions cover (beat ring + balloons)

- **`harness.js` → INLINE DEMO_SHOW MIRROR.** Pulls the `DEMO_SHOW` literal out
  of the extracted page script, validates it, and asserts it is byte-identical
  to `shows/demo-show.json` after validation. The two copies can no longer
  drift silently — this was an unguarded rule until now.
- **`harness.js` → BEAT GRID.** `beatAt()` phase/beat/bar/downbeat on the demo's
  500 ms grid, an offset grid (150 BPM / 120 ms), negative time (the grid runs
  backwards through T0 for the pre-show ring), a sweep asserting phase stays in
  `[0,1)` across the whole show, the full range/type validator matrix, the
  `beatOffsetMs` default of 0, and the warn-and-drop path for an offset with no
  bpm.
- **`harness.js` → BEAT GRID vs THE PULSE FLASH GRID.** The property the ring
  rests on: with the show bpm equal to a pulse cue's bpm and the cue starting on
  the grid, `beatAt().phase` and `stateAt().pulse.beatPhase` are **exactly**
  equal at ~2 700 sample points, and the screen flash is ON exactly while the
  ring is in its first half. A companion assertion checks that a pulse at a
  *different* bpm is still free to keep its own grid.
- **`harness.js` → BALLOONS.** Number→group derivation, the validator's reject
  matrix (duplicate `n`, zero/negative/fractional/string/missing `n`, unknown
  group, the reserved `"all"`, coordinates off either end of either axis, empty
  label, non-array, non-object entries), and the pure placement helpers
  (`makeBalloons` contiguous blocks and remainder split, `arrangeBalloons`
  rewriting position but never identity, `normalizeBalloons` dropping junk and
  clamping coordinates).
- **`harness.js` → BACKWARD COMPATIBILITY.** Strips both new fields back off the
  demo and asserts the compiled timeline is identical (segments, vents,
  per-group windows, preview cues, `endMs`) **and** that every `stateAt()` the
  phones render is identical across all three groups at 25 ms steps from
  −10 s to +92 s. This is the assertion that protects every show file already
  in the wild.
- **`choreo-test.js`.** The generated show carries the analysed tempo and beat
  offset; every generated cue starts within 1 ms of a ring beat; generated pulse
  cues carry *exactly* the show bpm so their flashes ride the same grid end to
  end; an out-of-range tempo is omitted rather than octave-shifted; balloons
  pass through untouched while the choreography is bit-identical with and
  without them; junk balloons are dropped or clamped instead of poisoning the
  show.

## How the analysis half is tested without a browser

`choreo-test.js` **synthesises its own PCM** (kick / snare / hat / bass / pad arranged into labelled sections, deterministic LCG noise) and runs the real DSP over it, so tempo and structure detection are checked against a ground truth in plain node. Current results on the fixtures: BPM within 0.1 of truth at 90/120/128/150, beat phase within 20 ms, all six section boundaries of the 3-minute fixture within 0.4 s, labels exactly `intro/verse/build/drop/breakdown/chorus/outro`, and a deliberately featureless track yields **one** section (no invented structure). The browser half — file decode, resample, progress — is a thin wrapper with no maths in it and is verified by hand in a real browser.

## Conventions specific to this project

- **Never edit the extracted `.js` artifacts** — fix `index.html` and re-extract. If an extract script stops finding its seam, the seam marker in the HTML moved: fix the marker, not the slicer.
- The extract seams (`PURE CORE START/END`, `AUDIO ANALYSIS (PURE DSP) START/END`, `CHOREOGRAPHER (PURE) START/END`, `const SYNC = {`, `===== T0 / ARMING =====`, QR markers) are load-bearing — renaming them breaks extraction.
- **Constraint checks never ask the code that made the show.** `choreo-test.js` re-derives every group's occupancy from `compileShow()` — the same path the pilots' phones run — and re-checks max burn, rest, long-burn runway, budget and fairness against it. A bug in the choreographer's own scheduler cannot mark its own homework.
- **The demo show is a fixture, not just an example.** `shows/demo-show.json` is hand-authored deliberately tighter than the generator's own rules; the suite asserts it still imports into the editor with zero blocking problems (tight is advice, dangerous is a veto). It is also the fixture for the beat grid (120 BPM, every cue on a beat) and for balloons (12, three rows).
- **Every optional field gets a backward-compatibility assertion.** Anything added to the schema must come with a test that strips it back off and proves the compiled timeline and every rendered `stateAt()` are unchanged. Shows already on pilots' phones are the reason.

## Delegation notes

- Suites are cheap to run inline (~2s of CPU for all eight commands; ~11s wall, most of it node start-up against iCloud-backed storage). Any agent editing `index.html` must run all four before returning.
