# Glow Show — synchronized balloon-glow choreography app (music-timed burns, cued on every pilot's phone)

> **Reading protocol:** the parent [CLAUDE.md](../CLAUDE.md) routes here. This file is authoritative inside this folder — read it before editing anything here.

## Active to-do

*Live state, not a log (workspace convention — root CLAUDE.md, "status report" protocol): add items as work opens them, **delete** them when done, update after every meaningful unit of work. **Numbered, in priority order** — Brian references items by number. A "status report" scoped to this project reads exactly this list.*

1. **Build v1 (IN PROGRESS — started 2026-08-12).** Approved plan: `~/.claude/plans/i-have-an-idea-hidden-scone.md`. Build order: scaffolding ✓ → Worker files ✓ (deploy pending, see item 2) → **playback core ✓ (2026-08-12: sync engine, timeline engine, pilot display, conductor w/ Web Audio + QR — 144 node assertions green, reviewed)** → audio analysis → auto-choreographer → tweak editor → GitHub Pages live. Untested on real hardware yet: iOS wake lock, Web Audio with a real song, live Worker. Design judgment made in build (revisit with Brian if the demo feels wrong): vent warnings auto-fire on *sustained* burn length (a pulse's blips don't trigger one), and get-ready windows clamp to whatever room the previous cue leaves.
2. **Cloudflare Worker deploy (needs Brian once):** Brian has no CF account/login on record. When ready: `cd worker/`, `npx wrangler login` (interactive — Brian types `! npx wrangler login` in a session), `npx wrangler kv namespace create GLOW` (paste the id into `wrangler.toml`), `npx wrangler deploy`. Until deployed, the app runs in wall-clock fallback mode (yellow "UNVERIFIED CLOCK" banner) — fully testable locally.
3. **Pick 1–2 candidate songs** for the first auto-choreographed demo show (Brian). Rhythmic/strong-beat material analyzes best.
4. **Havasu 2027 pitch angle (target):** working demo → pitch to Havasu organizers for the night glow (event Jan 21–24, 2027; Brian is applying as a pilot — see workspace to-do #4 / `BALLOONING/Havasu 2027/`).

## What this is

A web app (single URL, no install) that lets dozens-to-hundreds of balloon pilots perform a **music-choreographed night glow with synchronized burns** — replacing PA calls of "left side... now right side." Every pilot's phone shows a full-screen color-coded cue display (BURN / STOP / get-ready countdown / VENT warning before long burns); a conductor device plays the music and arms the start; shows are **auto-choreographed from the song's audio** (beat/bass/section analysis) and tweaked in a built-in editor. Done = a bench-tested demo (multiple phones burning in visual lockstep to a real song) good enough to pitch Havasu 2027. Nobody has built this — Albuquerque/Bristol still hand-call glows.

**Core architecture (do not re-litigate without reading the plan):** synced clocks + preloaded timeline + PA-announced start — **NOT mesh networking**. Each phone NTP-syncs against a tiny Cloudflare Worker once (at the pilot briefing, ~10s of any connectivity — bring a hotspot to the briefing if the field is a dead zone), preloads the show JSON, then runs **fully offline at showtime**. Conductor pushes play with a short fuse ("START +2:00"); T0 reaches pilots automatically (Worker poll, if signal) or via PA announcement + one tap on a giant minute-mark button (zero connectivity needed — clocks already agree to ±tens of ms). Error budget: sync ±5–40ms, drift ±72ms/hr, vs. pilot+burner reaction 500–1500ms — **the pilots are the sync limit, not the tech.** Mesh rejected: browsers can't do BLE mesh (no Web Bluetooth on iOS Safari), native mesh degrades near ~100 nodes, and it's a live showtime single-point-of-failure.

## The files

| File | Status | What it is |
|---|---|---|
| `index.html` | primary copy (being built) | The entire app, one self-contained vanilla-JS file: role picker (PILOT / CONDUCTOR / EDITOR), NTP-style sync engine, timeline engine, pilot cue display, conductor (Web Audio + T0 arming + QR), audio analysis, auto-choreographer, tweak editor |
| `shows/demo-show.json` | working | Demo show + schema reference (`glow-show/1` format). ⚠ Mirrored inline in `index.html` as `DEMO_SHOW` (so the demo works offline/file://) — change both together |
| `test/` | working | 3 node suites, 144 assertions, extracted live from `index.html` (no duplicated logic) — see `test/CLAUDE.md`; run after any core edit |
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

## Delegation notes

*Workspace tiering applies (Sonnet fetches · Opus makes · Fable judges — see root CLAUDE.md).*

- Bulk build of `index.html` stages → `make`; the audio-analysis + auto-choreographer DSP work is pre-judged hardest-class → `make-max` from the start (main loop reviews all of it).
