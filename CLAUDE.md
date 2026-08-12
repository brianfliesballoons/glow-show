# Glow Show — synchronized balloon-glow choreography app (music-timed burns, cued on every pilot's phone)

> **Reading protocol:** the parent [CLAUDE.md](../CLAUDE.md) routes here. This file is authoritative inside this folder — read it before editing anything here.

## Active to-do

*Live state, not a log (workspace convention — root CLAUDE.md, "status report" protocol): add items as work opens them, **delete** them when done, update after every meaningful unit of work. **Numbered, in priority order** — Brian references items by number. A "status report" scoped to this project reads exactly this list.*

1. **Build v1 — the app is feature-complete (2026-08-12).** Approved plan: `~/.claude/plans/i-have-an-idea-hidden-scone.md`. Build order: scaffolding ✓ → Worker files ✓ (deploy pending, item 2) → playback core ✓ → **audio analysis ✓ · auto-choreographer ✓ · tweak editor ✓ (2026-08-12: all three shipped, 270 node assertions green across 4 suites; verified in a real browser end to end on a synthesised 128 BPM test song — detected 128.05 BPM and all seven section boundaries within 0.4 s, generated a valid show, edited it, exported it, loaded it back into PILOT)** → **GitHub Pages live (the one build step left)**. Still untested on real hardware: iOS wake lock, Web Audio against a PA, the live Worker, and the editor on Brian's phone/tablet. Design judgments made in build (revisit with Brian if a demo feels wrong) are listed under "Design judgments" below.
2. **Cloudflare Worker deploy (needs Brian once):** Brian has no CF account/login on record. When ready: `cd worker/`, `npx wrangler login` (interactive — Brian types `! npx wrangler login` in a session), `npx wrangler kv namespace create GLOW` (paste the id into `wrangler.toml`), `npx wrangler deploy`. Until deployed, the app runs in wall-clock fallback mode (yellow "UNVERIFIED CLOCK" banner) — fully testable locally.
3. **Pick 1–2 candidate songs** for the first auto-choreographed demo show (Brian). Rhythmic/strong-beat material analyzes best.
4. **Havasu 2027 pitch angle (target):** working demo → pitch to Havasu organizers for the night glow (event Jan 21–24, 2027; Brian is applying as a pilot — see workspace to-do #4 / `BALLOONING/Havasu 2027/`).

## What this is

A web app (single URL, no install) that lets dozens-to-hundreds of balloon pilots perform a **music-choreographed night glow with synchronized burns** — replacing PA calls of "left side... now right side." Every pilot's phone shows a full-screen color-coded cue display (BURN / STOP / get-ready countdown / VENT warning before long burns); a conductor device plays the music and arms the start; shows are **auto-choreographed from the song's audio** (beat/bass/section analysis) and tweaked in a built-in editor. Done = a bench-tested demo (multiple phones burning in visual lockstep to a real song) good enough to pitch Havasu 2027. Nobody has built this — Albuquerque/Bristol still hand-call glows.

**Core architecture (do not re-litigate without reading the plan):** synced clocks + preloaded timeline + PA-announced start — **NOT mesh networking**. Each phone NTP-syncs against a tiny Cloudflare Worker once (at the pilot briefing, ~10s of any connectivity — bring a hotspot to the briefing if the field is a dead zone), preloads the show JSON, then runs **fully offline at showtime**. Conductor pushes play with a short fuse ("START +2:00"); T0 reaches pilots automatically (Worker poll, if signal) or via PA announcement + one tap on a giant minute-mark button (zero connectivity needed — clocks already agree to ±tens of ms). Error budget: sync ±5–40ms, drift ±72ms/hr, vs. pilot+burner reaction 500–1500ms — **the pilots are the sync limit, not the tech.** Mesh rejected: browsers can't do BLE mesh (no Web Bluetooth on iOS Safari), native mesh degrades near ~100 nodes, and it's a live showtime single-point-of-failure.

## The files

| File | Status | What it is |
|---|---|---|
| `index.html` | primary copy | The entire app, one self-contained vanilla-JS file (~5,400 lines): role picker (PILOT / CONDUCTOR / EDITOR), NTP-style sync engine, timeline engine, pilot cue display, conductor (Web Audio + T0 arming + QR), audio analysis (FFT → onsets → tempo → sections), auto-choreographer, tweak editor |
| `shows/demo-show.json` | working | Demo show + schema reference (`glow-show/1` format). ⚠ Mirrored inline in `index.html` as `DEMO_SHOW` (so the demo works offline/file://) — change both together |
| `test/` | working | 4 node suites, 270 assertions, extracted live from `index.html` (no duplicated logic) — see `test/CLAUDE.md`; run after any core edit |
| `worker/time.js` | primary copy | The only backend: Cloudflare Worker — `GET /time` (ms server clock for sync), `GET/POST /t0` (armed start + hold flag, KV-backed) |
| `worker/wrangler.toml` | working | Worker config; KV namespace id filled at first deploy (to-do 2) |

## Conventions specific to this project

- **Single self-contained HTML file, vanilla JS, no frameworks, no build tools** (workspace CODING pattern). Deploy = GitHub Pages, repo in this folder, live URL will be `brianfliesballoons.github.io/glow-show/` — noted in `CODING/CLAUDE.md` once live.
- **Failure modes are loud, never silent** (Brian's widget rule, doubly critical here): sync state is always visible (green SYNCED ±Xms / yellow STALE or UNVERIFIED / red NOT SYNCED); backgrounding the app mid-show triggers a red full-screen warning state.
- **Pilot display rule:** state = background color (orange BURN / amber GET READY / violet VENT / deep-blue STOP / near-black idle), group identity = accent color from the show file. Glance-readable at arm's length at night; huge type (the widget's density-via-spacing rule does NOT apply — this is a glance display, not a data display).
- **Run in a normal browser tab, not add-to-homescreen** — iOS wake lock was broken in installed PWAs until iOS 18.4; a plain Safari/Chrome tab is the supported mode.
- **Vent warnings are a first-class cue state** (Brian's buoyancy heads-up), auto-derived before any long burn — never dropped from generated shows.
- **Showtime abort convention: "music stops = stop burning"** (PA is the backstop channel, as at every existing glow) + Worker-pushed HOLD for devices with signal. Document this in any pilot-facing material.
- Timing code uses `performance.now()` (monotonic) mapped to server epoch — never raw `Date.now()` except as the labeled fallback path.
- **The maths lives in pure blocks, the UI is thin.** Three regions of `index.html` (`PURE CORE`, `AUDIO ANALYSIS (PURE DSP)`, `CHOREOGRAPHER (PURE)`) hold every rule and every calculation with no DOM reference, and the test suites slice them out of the shipping file rather than copying them. Anything that can be a pure function of its inputs goes in there — that is what makes it testable in node, and it is why the editor's preview is trustworthy (it calls the same `stateAt()` the phones do).
- **The song never leaves the device.** Analysis is `OfflineAudioContext` + an inline FFT in the page. No upload, no service, no API key, works offline.

## How the EDITOR works (2026-08-12)

Pick an audio file → it is decoded, mixed to mono and resampled to 22.05 kHz, then a 2048-sample Hann-windowed FFT at a 512 hop yields per-frame bass/mid/high/RMS and spectral flux. Flux → onset envelope → autocorrelation with a log-normal tempo prior → beat grid + bar phase. Coarse band energies → self-similarity → checkerboard novelty (plus a plain energy-step term) → section boundaries, labelled `intro/verse/build/chorus/drop/breakdown/outro` from position, relative energy, bass share and whether the section rises. The choreographer then maps sections to patterns (drop → ALL burns on the bass hits; chorus → pulse on the beat grid; verse → ping-pong; build → accelerating wave; intro/outro/breakdown → rest or sparse accents), tiling each pattern across its section, and every candidate cue goes through a constraint scheduler before it is allowed to land. Cues it cannot place become plain-English advisories the editor shows. Then the timeline workspace: canvas waveform + beat ticks + section bands, one lane per group plus ALL, drag to move, drag an edge to stretch, tap empty space to add, tap a section band to relabel and regenerate just that stretch, scrub with audio, and a live mini pilot-view. EXPORT downloads the JSON; the project auto-saves to localStorage.

### Design judgments made in build — revisit with Brian if a demo feels wrong

- **Vent warnings fire on *sustained* burn length** (a pulse's blips never trigger one), and get-ready windows clamp to whatever room the previous cue leaves. *(from the playback core)*
- **`minRestMs` is rest between a group's CUES; the legs inside one `alternate` cue are exempt.** A ping-pong is one instruction to the pilot and the timeline engine already treats it as one. Without this exemption the 8-second default would forbid every wave and every ping-pong in the app.
- **A long burn needs `stopMs + ventLeadMs + getReadyMs` (12 s by default) of clear air in front of it** — the VENT warning is outranked by STOP and GET READY, so without that gap the pilot never actually sees it. This is the rule that costs the most musical cues, and the advisory list says so every time.
- **`intensity` is a pure density dial**: it takes a longer prefix of one fixed, value-ordered list of optional cues. That is *why* "more intensity is never less show" holds — it is true by construction, not by tuning.
- **A pulse counts as half a burn** against the per-group budget (the display is "on" half of each beat).
- **Tempo is octave-ambiguous by nature.** Detection prefers 90–180 BPM, and a 60 BPM track reads as 120. HALVE / DOUBLE buttons on the setup screen are the fix, and they rebuild the grid.
- **Amber vs red in the editor**: red blocks export and means either the app itself would reject the show or a pilot would get a long burn with no warning; amber means "tighter than your current sliders" and still exports. The generator holds itself to the strict rules regardless.
- **Section labels are heuristic and one tap to override.** Every section keeps its confidence and its raw features, and relabel-then-regenerate rewrites only that stretch.

## Delegation notes

*Workspace tiering applies (Sonnet fetches · Opus makes · Fable judges — see root CLAUDE.md).*

- Bulk build of `index.html` stages → `make`; the audio-analysis + auto-choreographer DSP work is pre-judged hardest-class → `make-max` from the start (main loop reviews all of it). **That call paid off (2026-08-12):** the analysis/choreographer/editor stage went to `make-max` and the depth showed up in the failure modes it caught in its own work — z-scored features inventing sections on a flat track, a 2% coarse-frame timing drift, frame timestamps taken at the window start instead of its centre, and background-tab `setTimeout` throttling turning a 3-second analysis into 17. Keep DSP and constraint-engine work at that tier.
- **Any change to the DSP or the choreographer must keep the pure blocks pure** (no DOM, no timers, no randomness) or the node suites cannot slice them out, and the safety constraints lose their independent check.
