# Glow Show — synchronized balloon-glow choreography app (music-timed burns, cued on every pilot's phone)

> **Reading protocol:** the parent [CLAUDE.md](../CLAUDE.md) routes here. This file is authoritative inside this folder — read it before editing anything here.

## Active to-do

*Live state, not a log (workspace convention — root CLAUDE.md, "status report" protocol): add items as work opens them, **delete** them when done, update after every meaningful unit of work. **Numbered, in priority order** — Brian references items by number. A "status report" scoped to this project reads exactly this list.*

1. **Build v1 — the app is feature-complete (2026-08-12).** Approved plan: `~/.claude/plans/i-have-an-idea-hidden-scone.md`. Build order: scaffolding ✓ → Worker files ✓ (deploy pending, item 2) → playback core ✓ → **audio analysis ✓ · auto-choreographer ✓ · tweak editor ✓ (2026-08-12: all three shipped; verified in a real browser end to end on a synthesised 128 BPM test song — detected 128.05 BPM and all seven section boundaries within 0.4 s, generated a valid show, edited it, exported it, loaded it back into PILOT)** → **beat ring ✓ + balloon numbers & field map ✓ (2026-08-12, item 5)** → **GitHub Pages LIVE at [brianfliesballoons.github.io/glow-show](https://brianfliesballoons.github.io/glow-show/)** — pushes to `main` update the public site. **391 node assertions green across 4 suites.** Still untested on real hardware: iOS wake lock, Web Audio against a PA, the live Worker, and the editor on Brian's phone/tablet. Design judgments made in build (revisit with Brian if a demo feels wrong) are listed under "Design judgments" below.
2. **Cloudflare Worker deploy (needs Brian once):** Brian has no CF account/login on record. When ready: `cd worker/`, `npx wrangler login` (interactive — Brian types `! npx wrangler login` in a session), `npx wrangler kv namespace create GLOW` (paste the id into `wrangler.toml`), `npx wrangler deploy`. Until deployed, the app runs in wall-clock fallback mode (yellow "UNVERIFIED CLOCK" banner) — fully testable locally.
3. **Pick 1–2 candidate songs** for the first auto-choreographed demo show (Brian). Rhythmic/strong-beat material analyzes best.
4. **Havasu 2027 pitch angle (target):** working demo → pitch to Havasu organizers for the night glow (event Jan 21–24, 2027; Brian is applying as a pilot — see workspace to-do #4 / `BALLOONING/Havasu 2027/`).
5. **Beat ring + balloon numbers/map — BUILT 2026-08-12, needs Brian's eyes.** Both features are in and tested (see "The beat ring" and "Balloon numbers + the field map" below). What still needs him: **(a)** eyeball the ring on a phone at night — the sizing is `min(28vh,34vw)` around the digits and `min(30vh,58vw)` around a T-minus clock or the PULSE word, and only a real screen at arm's length says whether that reads; **(b)** decide whether the ring should also run during a BURN (it is deliberately off — the pilot is holding the burner — but he may want it); **(c)** confirm the field-map orientation convention against how he actually briefs a field (crowd along the bottom, x left→right as the crowd sees it); **(d)** decide whether the demo show should ship with 12 balloons at all, since that is what makes "LOAD DEMO SHOW" open the number grid instead of the old group picker.

## What this is

A web app (single URL, no install) that lets dozens-to-hundreds of balloon pilots perform a **music-choreographed night glow with synchronized burns** — replacing PA calls of "left side... now right side." Every pilot's phone shows a full-screen color-coded cue display (BURN / STOP / get-ready countdown / VENT warning before long burns); a conductor device plays the music and arms the start; shows are **auto-choreographed from the song's audio** (beat/bass/section analysis) and tweaked in a built-in editor. Done = a bench-tested demo (multiple phones burning in visual lockstep to a real song) good enough to pitch Havasu 2027. Nobody has built this — Albuquerque/Bristol still hand-call glows.

**Core architecture (do not re-litigate without reading the plan):** synced clocks + preloaded timeline + PA-announced start — **NOT mesh networking**. Each phone NTP-syncs against a tiny Cloudflare Worker once (at the pilot briefing, ~10s of any connectivity — bring a hotspot to the briefing if the field is a dead zone), preloads the show JSON, then runs **fully offline at showtime**. Conductor pushes play with a short fuse ("START +2:00"); T0 reaches pilots automatically (Worker poll, if signal) or via PA announcement + one tap on a giant minute-mark button (zero connectivity needed — clocks already agree to ±tens of ms). Error budget: sync ±5–40ms, drift ±72ms/hr, vs. pilot+burner reaction 500–1500ms — **the pilots are the sync limit, not the tech.** Mesh rejected: browsers can't do BLE mesh (no Web Bluetooth on iOS Safari), native mesh degrades near ~100 nodes, and it's a live showtime single-point-of-failure.

## The files

| File | Status | What it is |
|---|---|---|
| `index.html` | primary copy | The entire app, one self-contained vanilla-JS file (~5,900 lines): role picker (PILOT / CONDUCTOR / EDITOR), NTP-style sync engine, timeline engine, pilot cue display + beat ring, field map, conductor (Web Audio + T0 arming + QR), audio analysis (FFT → onsets → tempo → sections), auto-choreographer, tweak editor (TIMELINE + MAP tabs) |
| `shows/demo-show.json` | working | Demo show + schema reference (`glow-show/1` format), now with a 120 BPM beat grid and 12 numbered balloons. ⚠ Mirrored inline in `index.html` as `DEMO_SHOW` (so the demo works offline/file://) — change both together; **the suite now fails if they drift** |
| `test/` | working | 4 node suites, 391 assertions, extracted live from `index.html` (no duplicated logic) — see `test/CLAUDE.md`; run after any core edit |
| `worker/time.js` | primary copy | The only backend: Cloudflare Worker — `GET /time` (ms server clock for sync), `GET/POST /t0` (armed start + hold flag, KV-backed) |
| `worker/wrangler.toml` | working | Worker config; KV namespace id filled at first deploy (to-do 2) |

## Conventions specific to this project

- **Single self-contained HTML file, vanilla JS, no frameworks, no build tools** (workspace CODING pattern). Deploy = GitHub Pages, repo in this folder, **LIVE at `brianfliesballoons.github.io/glow-show/`** — push to `main` and the public site updates in a minute or two.
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

## The beat ring (2026-08-12)

Brian's ask: *"a tempo metronome loading-circle appearance on the visual
countdown so you have a really good idea of the rhythm."*

A show may carry `audio.bpm` (40–250) and `audio.beatOffsetMs` (≥0, default 0).
`beatAt(tl, tMs)` in PURE CORE turns that into `{ phase, beat, beatInBar, bar,
downbeat }` on 4-beat bars, and returns **`null` when there is no bpm** — which
is the whole backward-compatibility story: no bpm, no ring, no layout shift, and
`harness.js` proves the compiled timeline and every rendered state are identical
either way. The grid runs backwards through T0 too, so the armed pre-show
countdown is already on the beat before bar one.

The ring itself is one SVG circle whose `stroke-dashoffset` is driven per frame
off the synced clock (never `setInterval`): it fills over each beat and snaps
empty at the next, and on each bar's downbeat a second circle flashes from
5→14 units of stroke and fades out over the first 45 % of that beat. It wraps
the **GET READY digits**, the **armed T-minus digits**, and the **PULSE
wordmark**; a small dim version sits in the footer during IDLE / STOP / VENT.

- **Sizing is content-aware.** One or two characters get a `min(28vh,34vw)` ring;
  anything wider (a `0:05` clock, the word PULSE) switches to a `ringwide` class
  with a bigger ring and much smaller type, and the ring — not the digits —
  becomes the layout box, so it can never cross the label or the sub-line.
- **The PULSE ring is locked to that cue's own flash grid**, not the show grid,
  so the ring and the screen flash are one instruction rather than two. When the
  cue's bpm equals the show's and it starts on a beat they are the same edges
  anyway, and the suite asserts that to *exact* equality.
- **The choreographer now exports pulse bpm to 2 dp** (it used to round to whole
  BPM) so a generated pulse rides the show's own grid for the length of the cue
  instead of sliding a few ms. Residual error against the ring: under 1 ms,
  purely from rounding cue times and the offset to whole milliseconds.
- **No ring during a BURN.** The pilot is holding the burner; a metronome there
  is noise, not information. (Flagged for Brian in to-do 5b.)
- An analysed tempo outside 40–250 is **omitted** from the show rather than
  octave-shifted — halving would slide the grid off the pulse cues the same run
  just placed on it. The editor's HALVE / DOUBLE buttons are the intended fix.

## Balloon numbers + the field map (2026-08-12)

Brian's ask: *"pick the number of balloons, give each a designated assignment
number, and create a map of their location so we can coordinate placement and
performance."*

Optional `balloons: [{ n, group, x, y, label? }]`. **Cues stay group-based** —
numbers and positions are identity and placement, not choreography (per-balloon
cue addressing is a future version). Coordinates are normalized and
**crowd-relative**: `x` 0→1 is left→right *as the crowd sees it*, `y` 0 is the
crowd/stage edge and 1 is the back of the field. The map is drawn from the
crowd's point of view (audience along the bottom edge with a labelled CROWD /
STAGE bar), so a pilot facing the audience is looking at the map.

- **Pilot:** a big tappable number grid replaces the group picker when the show
  has balloons — the tile shows the number over its group label, and picking a
  number derives the group automatically. The group picker is still there,
  unchanged, for shows without balloons. The footer reads `#12 · SPECIAL SHAPES`.
  A MAP button on setup and on the idle/pre-show/ended stage opens the field
  with their own balloon pulsing.
- **Conductor:** a "Field layout" card on setup (with per-group counts) and a
  `field map` link on the run screen, both opening the same map without a
  highlight.
- **Editor:** the workspace is now two tabs, **TIMELINE** and **MAP**. The map
  tab sets a count (creating balloons 1…N in *contiguous* blocks per group,
  because a briefing says "1 through 8 are NORTH ROW"), auto-arranges into rows
  with margins, adds one at a time, drags with pointer events (touch included),
  and opens a mini-inspector on tap for renumber / regroup / label / remove.
  Renumbering onto a taken number is refused with a reason rather than silently
  merging two pilots.
- **When balloons exist they define which groups are real:** generation only
  writes cues for groups that actually have balloons in them (with a note on the
  setup screen naming them), falling back to every group if the balloons cover
  none. An imported show's balloons and bpm are read back into the editor, and
  both ride out again on export and in the localStorage autosave.

### Design judgments made in build — revisit with Brian if a demo feels wrong

- **Vent warnings fire on *sustained* burn length** (a pulse's blips never trigger one), and get-ready windows clamp to whatever room the previous cue leaves. *(from the playback core)*
- **`minRestMs` is rest between a group's CUES; the legs inside one `alternate` cue are exempt.** A ping-pong is one instruction to the pilot and the timeline engine already treats it as one. Without this exemption the 8-second default would forbid every wave and every ping-pong in the app.
- **A long burn needs `stopMs + ventLeadMs + getReadyMs` (12 s by default) of clear air in front of it** — the VENT warning is outranked by STOP and GET READY, so without that gap the pilot never actually sees it. This is the rule that costs the most musical cues, and the advisory list says so every time.
- **`intensity` is a pure density dial**: it takes a longer prefix of one fixed, value-ordered list of optional cues. That is *why* "more intensity is never less show" holds — it is true by construction, not by tuning.
- **A pulse counts as half a burn** against the per-group budget (the display is "on" half of each beat).
- **Tempo is octave-ambiguous by nature.** Detection prefers 90–180 BPM, and a 60 BPM track reads as 120. HALVE / DOUBLE buttons on the setup screen are the fix, and they rebuild the grid.
- **Amber vs red in the editor**: red blocks export and means either the app itself would reject the show or a pilot would get a long burn with no warning; amber means "tighter than your current sliders" and still exports. The generator holds itself to the strict rules regardless.
- **Section labels are heuristic and one tap to override.** Every section keeps its confidence and its raw features, and relabel-then-regenerate rewrites only that stretch.
- **Bars are always 4 beats for the ring.** The choreographer has a `beatsPerBar` option, but the schema does not carry one, so `beatAt()` fixes `BEATS_PER_BAR = 4`. A 3/4 show would get its downbeat accent on the wrong beat — no balloon glow track has needed that yet, and adding it means a new optional schema field. *(from the beat ring)*
- **The demo show ships with balloons**, so "LOAD DEMO SHOW" now opens the number grid rather than the group picker. That makes both new features demoable with one tap, at the cost of changing what the demo looks like. Deleting the `balloons` block from `shows/demo-show.json` **and** its inline `DEMO_SHOW` mirror reverts it. *(from the field map — flagged as to-do 5d)*

## Delegation notes

*Workspace tiering applies (Sonnet fetches · Opus makes · Fable judges — see root CLAUDE.md).*

- Bulk build of `index.html` stages → `make`; the audio-analysis + auto-choreographer DSP work is pre-judged hardest-class → `make-max` from the start (main loop reviews all of it). **That call paid off (2026-08-12):** the analysis/choreographer/editor stage went to `make-max` and the depth showed up in the failure modes it caught in its own work — z-scored features inventing sections on a flat track, a 2% coarse-frame timing drift, frame timestamps taken at the window start instead of its centre, and background-tab `setTimeout` throttling turning a 3-second analysis into 17. Keep DSP and constraint-engine work at that tier.
- **Any change to the DSP or the choreographer must keep the pure blocks pure** (no DOM, no timers, no randomness) or the node suites cannot slice them out, and the safety constraints lose their independent check.
