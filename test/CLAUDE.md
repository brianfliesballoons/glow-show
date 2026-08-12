# glow-show/test — node test suites for the single-file app

> **Reading protocol:** the parent [CLAUDE.md](../CLAUDE.md) routes here and is authoritative for the project; this note covers how the tests work.

## Active to-do

*Nothing open — run the suites after any change to `index.html`'s PURE CORE, AUDIO ANALYSIS, CHOREOGRAPHER, SYNC or QR modules.*

## What this is

Four suites (**270 assertions**) that test the app's logic **extracted straight out of `index.html`** — no duplicated code, the HTML stays the single source of truth. Each `*-extract.js` slices its module out of the page (the PURE CORE / PURE DSP / CHOREOGRAPHER markers, the `const SYNC` seam, the QR seam) into a local `.js` file; each `*-test.js` then runs it under node. Run order matters: extract, then test.

```
cd test
node extract.js && node qr-extract.js && node sync-extract.js && node choreo-extract.js
node harness.js && node qr-test.js && node sync-test.js && node choreo-test.js
```

## The files

| File | Status | What it is |
|---|---|---|
| `extract.js` / `qr-extract.js` / `sync-extract.js` / `choreo-extract.js` | working | Slice modules out of `../index.html` by seam markers (writes `pure-core.js`, `qr.js`, `sync.js`, `choreo.js`, `script-0.js` here — all gitignored, regenerate freely) |
| `harness.js` | working | 94 assertions on the timeline engine: validator, cue derivation (vent/get-ready/stop), full state sequences for the demo show, pulse beat grid, alternate handoffs, invariant sweep at 10ms steps |
| `qr-test.js` | working | 21 assertions: encode → independent decode of rendered matrix, all 20 versions at exact byte capacity, spec structure checks |
| `sync-test.js` | working | 29 assertions: NTP rounds vs a simulated `/time` server, outlier filtering, reload re-anchor, stale/unverified states |
| `choreo-test.js` | working | 126 assertions: FFT vs a naive DFT, band separation, onset envelope, **tempo + beat phase on synthesised songs of known BPM**, section detection against a known 7-section ground truth, then every choreographer constraint, determinism, intensity monotonicity, per-section regeneration and the editor's live audit |

## How the analysis half is tested without a browser

`choreo-test.js` **synthesises its own PCM** (kick / snare / hat / bass / pad arranged into labelled sections, deterministic LCG noise) and runs the real DSP over it, so tempo and structure detection are checked against a ground truth in plain node. Current results on the fixtures: BPM within 0.1 of truth at 90/120/128/150, beat phase within 20 ms, all six section boundaries of the 3-minute fixture within 0.4 s, labels exactly `intro/verse/build/drop/breakdown/chorus/outro`, and a deliberately featureless track yields **one** section (no invented structure). The browser half — file decode, resample, progress — is a thin wrapper with no maths in it and is verified by hand in a real browser.

## Conventions specific to this project

- **Never edit the extracted `.js` artifacts** — fix `index.html` and re-extract. If an extract script stops finding its seam, the seam marker in the HTML moved: fix the marker, not the slicer.
- The extract seams (`PURE CORE START/END`, `AUDIO ANALYSIS (PURE DSP) START/END`, `CHOREOGRAPHER (PURE) START/END`, `const SYNC = {`, `===== T0 / ARMING =====`, QR markers) are load-bearing — renaming them breaks extraction.
- **Constraint checks never ask the code that made the show.** `choreo-test.js` re-derives every group's occupancy from `compileShow()` — the same path the pilots' phones run — and re-checks max burn, rest, long-burn runway, budget and fairness against it. A bug in the choreographer's own scheduler cannot mark its own homework.
- **The demo show is a fixture, not just an example.** `shows/demo-show.json` is hand-authored deliberately tighter than the generator's own rules; the suite asserts it still imports into the editor with zero blocking problems (tight is advice, dangerous is a veto).

## Delegation notes

- Suites are cheap to run inline (~2s of CPU for all eight commands; ~11s wall, most of it node start-up against iCloud-backed storage). Any agent editing `index.html` must run all four before returning.
