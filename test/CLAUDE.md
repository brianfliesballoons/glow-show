# glow-show/test — node test suites for the single-file app

> **Reading protocol:** the parent [CLAUDE.md](../CLAUDE.md) routes here and is authoritative for the project; this note covers how the tests work.

## Active to-do

*Nothing open — run the suites after any change to `index.html`'s PURE CORE, SYNC or QR modules.*

## What this is

Three suites (144 assertions) that test the app's logic **extracted straight out of `index.html`** — no duplicated code, the HTML stays the single source of truth. Each `*-extract.js` slices its module out of the page (the PURE CORE markers / `const SYNC` seam / QR seam) into a local `.js` file; each `*-test.js` then runs it under node. Run order matters: extract, then test.

```
cd test
node extract.js && node qr-extract.js && node sync-extract.js
node harness.js && node qr-test.js && node sync-test.js
```

## The files

| File | Status | What it is |
|---|---|---|
| `extract.js` / `qr-extract.js` / `sync-extract.js` | working | Slice modules out of `../index.html` by seam markers (writes `pure-core.js`, `qr.js`, `sync.js`, `script-0.js` here — all gitignored, regenerate freely) |
| `harness.js` | working | 94 assertions on the timeline engine: validator, cue derivation (vent/get-ready/stop), full state sequences for the demo show, pulse beat grid, alternate handoffs, invariant sweep at 10ms steps |
| `qr-test.js` | working | 21 assertions: encode → independent decode of rendered matrix, all 20 versions at exact byte capacity, spec structure checks |
| `sync-test.js` | working | 29 assertions: NTP rounds vs a simulated `/time` server, outlier filtering, reload re-anchor, stale/unverified states |

## Conventions specific to this project

- **Never edit the extracted `.js` artifacts** — fix `index.html` and re-extract. If an extract script stops finding its seam, the seam marker in the HTML moved: fix the marker, not the slicer.
- The extract seams (`PURE CORE START/END`, `const SYNC = {`, `===== T0 / ARMING =====`, QR markers) are load-bearing — renaming them breaks extraction.

## Delegation notes

- Suites are cheap to run inline (`node`, <2s total). Any agent editing `index.html` must run all three before returning.
