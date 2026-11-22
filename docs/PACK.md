# Glow Show cue pack — `glow-pack/1`

A **cue pack** is one balloon's whole show, already worked out and checked by
the web editor, for a phone that only plays it. The pilot apps (Swift for
iPhone, Kotlin for Android) never parse a show, never compile a timeline and
never hash anything. They download one pack, keep it, and look up the current
moment in it against a synced clock, with no signal needed.

The web pilot view plays packs the same way. `renderMine()` in `index.html`
draws from `packPlan(compilePack(...))`, so the web, the iPhone and Android
apps run the same player on the same data.

| Where | What |
|---|---|
| `index.html`, PURE CORE, section *CUE PACKS* | `compilePack`, `compileShowPacks`, `packPlan`, `packBeatPhase`, `PACK_HAPTICS` (the primary copy of everything here) |
| `test/pack-test.js` | proves `packPlan(pack, t)` == `pilotPlan(timeline, n, group, t)` for every pack of every shipped show, and writes or checks the golden vectors |
| `test/golden/*.json` | golden vectors; the native unit tests load these same files |
| `worker/time.js` | stores and serves packs (`/pack/...`), under the conductor PIN |

## 1. Time

Every time in a pack is **song time in milliseconds**: `t = 0` is the first
note of the music. Before the music, `t` is negative (the armed countdown).

```
t = floor(syncedNowMs - t0)        // t0 = armed start, epoch ms, from GET /t0 or the PA
```

**Floor `t` to a whole millisecond before every lookup.** Segment boundaries
are whole milliseconds. With a floored `t`, the result is exactly what the
golden vectors expect. Other values (`endsMs`, task times) can be fractional,
and are stored as JSON numbers (IEEE doubles; they round-trip exactly).

## 2. A pack

```jsonc
{
  "format": "glow-pack/1",      // refuse anything else
  "code": "UKL7",               // the show's 4-character radio code; display it, never recompute it
  "title": "(L)ightning (S)torm in the (D)ark — glow",
  "key": "5",                   // what the pilot picked: a balloon number, or a group id (as a string)
  "balloon": 5,                 // null when the show has no balloon numbers
  "gridRef": "B4",              // field grid square, or null (no field)
  "label": null,                // the balloon's own label, or null
  "group": "north",             // group id, or null
  "groupLabel": "Front",        // ready to show ("Front", "North row"), or null
  "color": "#00c8ff",           // the group's accent colour, or null
  "lenMs": 200098,              // song length
  "endMs": 200671,              // end of the last STOP; the screen says "Show complete" from here
  "beat": { "bpm": 84, "beatMs": 714.2857142857143, "offsetMs": 100, "beatsPerBar": 4 },  // or null
  "tasks":    [ ... ],          // §3
  "segments": [ ... ],          // §4
  "haptics":  [ ... ],          // §5
  "hapticPatterns": { ... },    // §5
  "fieldView": { ... }          // §2a, optional: display only, for the Lane's field map
}
```

The Worker's `PUT /pack/:code` takes a whole show's packs (`compileShowPacks`):

```jsonc
{ "format": "glow-packs/1", "code": "UKL7", "title": "...", "by": "balloon" | "group",
  "keys": ["1", "2", ...], "packs": { "1": { pack }, "2": { pack }, ... } }
```

`by` is `"balloon"` when the show numbers its balloons (one pack per number),
otherwise `"group"` (one pack per group id).

**Versioning.** New fields may be added to `glow-pack/1`; players ignore what
they don't know. Anything that changes the meaning of an existing field, or
how `packPlan` reads it, is `glow-pack/2`, and players refuse a format they
don't know.

## 2a. `fieldView` — the field map (optional, display only)

Added 2026-11-22 for the Lane's field view (design K). A show with a field
outline **and** balloon spots gives every pack the same `fieldView`: the field
as the crowd sees it, every balloon's spot, when each balloon is lit, and the
show's moves for the map's top line. A show with no field (or no balloon
spots) leaves the key out, and the Lane looks exactly as before.

**It is display only.** A phone never plays it: its own burns, its count-in,
its NOW panel and its buzzes come only from its own `tasks`, `segments` and
`haptics`, exactly as before. `packPlan` and `laneFrame` never read it (the
suite proves the same answers with it, without it, and with a junk one). A
player that doesn't know the key ignores it, so `glow-pack/1` is unchanged.

```jsonc
"fieldView": {
  "box": [x0, y0, x1, y1],      // the view to draw, in field units; y grows away from the crowd
  "outline": [[x, y], ...],     // the field
  "zones": [ { "kind": "nob" | "tent" | "pa" | "keepout", "poly": [[x, y], ...],
               "label": "PILOT TENT" | "PA" | null, "at": [x, y] } ],   // hatched; label written at "at"
  "lines": [ { "pts": [[x, y], ...], "label": "ACCESS LANE" | null, "at": [x, y] } ],   // dotted; x already inside the box
  "crowd": [[x, y], [x, y]] | null,   // the crowd edge, drawn green with CROWD under it
  "balloons": [ { "n": 5, "x": 0.43, "y": 0.15,
                  "legs": [[startMs, endMs, finale], ...] } ],   // finale: 1 on the show's last all-burn, else 0
  "moves": [ { "t": 1529, "end": 9388, "label": "ripple out" } ]  // one per show cue, in the show's order
}
```

- **`legs`** for balloon *n* are exactly the `onAt` spans of balloon *n*'s own
  pack's tasks, in order (the suite checks every balloon of every shipped show).
- **`moves[i]`** is show cue *i*, so a task's move is `moves[task.cueIndex]`.
  `label` is the cue's label in plain words: the generator's section name
  ("Chorus 1 — ") is dropped, any other prefix stays ("FINALE — all burn" →
  "Finale · all burn"), and a cue with no label gets its move in words.
- Size: about 8 KB a pack for 21 balloons (the 21-balloon Havasu show's whole
  publish is 0.40 MB). It grows with the square of the balloon count (every
  pack holds every balloon), so a show of about 60 balloons reaches the
  Worker's 2 MB publish limit.

The map's rules, in `index.html` PURE CORE (the Swift app ports them line for line):

| Function | Answers |
|---|---|
| `fieldPeer(legs, t)` | `{ lit, soon, fin }` for one balloon: `lit` 1 while a leg is on, then `0.6 × (1 − since / 900)` for 900 ms after one ends, else 0; `soon` = a leg starts within 1000 ms (and none is on): a thin ring; `fin` = the lit or fading leg is the finale's (violet) |
| `fieldCaption(fv, tasks, t)` | `top`: `"NOW · <MOVE>"` for the move that started last among those under way, else `"NEXT MOVE IN n s · <MOVE>"` (n = whole seconds, rounded up), else `""`; `yours`: from 10 s before your next task (and while you do it), when it is a wave of a pattern (`bands > 1`): `"Yours: <move> · wave <band + 1> of <bands>"` |
| `fieldMapGeom(box, W, H)` | `{ s, ox, oy, ew, yw }`: one scale `s` fitting the box into a W × H panel under 40 px of words; x → `ox + (x − box[0]) · s`, y → `oy + (box[3] − y) · s`; `ew` = a balloon's envelope width (11–20 px), `yw = 2.2 · ew` = yours |

## 3. Tasks — what the pilot does

One task is one instruction, exactly what `pilotTasks()` gives. Tasks are in
time order and `index` is the task's position in the list.

| Field | Meaning |
|---|---|
| `index` | position in `tasks` |
| `cueIndex` | the show cue it came from (for debugging) |
| `kind` | `"burn"` (one held burn) or `"flicker"` (on/off on a rhythm: a pulse, a ping-pong, a checkerboard) |
| `atMs`, `endMs`, `durMs` | when it starts and ends, and how long it lasts |
| `words` | the NEXT card's text, ready to show: `"Full burn for 3 s"`, `"Flicker for 10 s"` |
| `label` | the cue's label from the editor (not shown to pilots today) |
| `rhythm` | `{ onMs, offMs }` for a flicker, else `null` (drives the small on/off picture) |
| `legs`, `onAt` | how many on-spans and where they are, `[[from, to], ...]` |
| `pattern`, `band`, `bands` | for a field pattern: its name and which wave this balloon is (0-based) of how many; else `null` |
| `vent` | `true` when a VENT warning comes before this task (a long burn) |
| `finale` | `true` on the last task when it belongs to the show's last cue |

## 4. Segments — what NOW shows

`segments` cover the whole of time with no gaps: segment *i* is in force from
`segments[i].at` up to, not including, `segments[i+1].at`. **The first segment
also covers every moment before its `at`, and the last covers every moment
after.** Inside one segment, nothing on the NOW panel changes except numbers
counted off the clock (`leftMs`, `progress`, `vent.msUntil`).

| Field | Meaning |
|---|---|
| `at` | start, whole ms, strictly increasing |
| `phase` | the engine's state: `PRESHOW`, `IDLE`, `GETREADY`, `BURN`, `PULSE`, `STOP`, `VENT`, `ENDED` |
| `kind` | what the NOW panel says (table below) |
| `endsMs` | what the NOW countdown counts down to, or `null` (no countdown) |
| `on` | for `kind: "flicker"`: burner on (`true`) or off (`false`). `false` for every other kind |
| `task` | index of the task this NOW refers to, or `null` |
| `band` | `{ pattern, band, bands }` while getting ready for, or burning, a wave of a field pattern; else `null` |
| `vent` | `{ atMs, durMs, type, chip }` while a VENT warning is live (`atMs` = when the long burn starts, `chip` = show it as a corner note because something else holds the main panel); else `null` |

| `kind` | NOW panel | counts down to | `task` |
|---|---|---|---|
| `start` | Starting | the music (`endsMs` = 0) | `null` |
| `cool` | Cool off | the next task | the next task |
| `ready` | Get ready (the task's `words` underneath) | the next task's start | the next task |
| `burn` | Burn | the end of this burn | this task |
| `flicker` | Flicker, *on · burn* or *off* | the end of the whole flicker | this task |
| `vent` | Vent | the long burn's start | the next task |
| `stop` | Stop | the next task, or no countdown if there is none | `null` |
| `done` | Standing by: no more burns for you | none | `null` |
| `ended` | Show complete | none | `null` |

A pulse becomes one short segment per half beat (on, off, on, …), so a phone
needs no beat arithmetic to flash.

## 5. Haptics

`haptics` is a short list of `{ at, kind }`: buzz with `hapticPatterns[kind]`
when the clock reaches `at` (a whole ms, always the `at` of a segment).
`hapticPatterns` gives each pattern in ms, as *buzz, pause, buzz, …*
(it always starts with a buzz):

| `kind` | Pattern (ms) | When |
|---|---|---|
| `ready` | 80, 120, 80 (two short) | a GET READY starts |
| `vent` | 80, 80, 80, 80, 80 (three short) | a VENT warning starts |
| `burn` | 500 (one long) | a full burn starts |
| `on` | 60 (one tick) | a flicker turns on (every on-beat of a pulse; every leg of a ping-pong) |
| `off` | 30, 60, 30 (soft double) | a flicker turns off for 1 s or more (the gaps between legs, not a pulse's off-beats) |
| `stop` | 250 (one medium) | a STOP starts, or a burn ends straight into something that is not a burn |

The patterns are suggestions for the platform: Android plays them as a
`VibrationEffect.createWaveform` timing array; iPhone maps each kind to a
Core Haptics pattern of the same shape. During a HOLD (from `GET /t0`), don't
buzz anything but the hold itself.

## 6. The player — `packPlan(pack, t)`

This is the reference player. Swift and Kotlin port it line for line (the JS
uses plain loops for that reason). It returns what the pilot screen needs:

```
{ tMs, songMs, lenMs, leftMs, phase,
  now:  { kind, endsMs, task, on?, leftMs, progress?, band, vent },
  next: task | null, then: [task, ≤ 3], more, moreAt: [ms], moreKind,
  finale: task | null, burnsLeft, total,
  burnMarks: [{ atMs, durMs, kind, finale, next, now, done }] }
```

Step by step (`t` already floored):

1. **Segment.** Binary search for the last segment with `at <= t`; if none, segment 0.
2. **Tasks.** One pass over `tasks`:
   - `cur` = the last task with `atMs <= t < endMs` (or none);
   - `next` = the first task with `atMs > t` (or none);
   - `burnsLeft` = how many tasks have `endMs > t`.
3. **Finale.** The last task, if its `finale` is true, it is neither `cur` nor `next`, and `atMs > t`; else none.
4. **THEN.** Go through `tasks` again, skipping any with `atMs <= t`, `next` and the finale. The first 3 go in `then`. Every one after that goes in `moreAt`. `moreKind` is the first of those tasks' `kind`, or `"mixed"` once two differ. `more = moreAt.length`.
5. **NOW.** `kind`, `endsMs` and `band` from the segment; `task` = `tasks[segment.task]` or none.
   - `on` = `segment.on`, only when `kind` is `"flicker"`.
   - `leftMs` = `max(0, endsMs - t)`, or none when `endsMs` is none.
   - `progress` = `max(0, min(1, (t - task.atMs) / max(1, task.durMs)))`, only for `burn` / `flicker` with a task.
   - `vent` = `{ msUntil: vent.atMs - t, durMs, type, chip }` when the segment has a `vent`, else none.
6. **Song.** `songMs = max(0, min(lenMs, t))`, `leftMs = max(0, lenMs - songMs)`.
7. **Burn marks.** One per task: `atMs, durMs, kind, finale`, plus `next` (it is `next`), `now` (it is `cur`) and `done` (`endMs <= t`).

`packBeatPhase(pack, t)` gives the beat ring's fill (0 up to 1), or `null` with no `beat`:

```
rel = t - beat.offsetMs ; n = floor(rel / beat.beatMs) ; phase = (rel - n * beat.beatMs) / beat.beatMs
if not (phase >= 0) then phase = 0 ; if phase >= 1 then phase = 0
```

The ring shows while NOW counts down to something (`start`, `cool`, `stop`, `ready`, `vent`), never during a burn.

## 7. The Worker

`https://glow-show.brianfliesballoons.workers.dev`. CORS `*`, `Cache-Control: no-store`.

| Request | Answer |
|---|---|
| `GET /time` | `{ t }`, the server clock (unchanged; phones sync against it) |
| `PUT /pack/:code` + header `X-Glow-Pin` | stores a whole show's packs (`compileShowPacks` output). 401 no PIN, 403 wrong PIN, 400 a body that is not this code's `glow-packs/1` |
| `GET /pack/:code` | `{ code, title, by, keys, published }`: the numbers (or groups) a pilot can pick, nothing else |
| `GET /pack/:code/:key` | that one balloon's (or group's) pack; 404 if there is none |
| `POST /t0` + header `X-Glow-Pin`, body `{ code, t0, hold }` | arm or hold the show. Same PIN rules |
| `GET /t0?code=:code` | `{ t0, hold, updated }`; `t0: null` when nothing is armed |

**The conductor PIN.** The first write for a show code (a publish or an arm)
claims the code with the PIN it carries. The Worker stores only a random salt
and `SHA-256(salt:code:PIN)`. Every later write for that code needs the same
PIN. PINs are 6 to 64 characters. Claims and packs are kept 180 days; an
armed start is kept for a day.

**Free tier.** KV allows 1,000 writes a day. Only the conductor writes (a
publish is one write, plus one for a first claim; an arm or a hold is one
write). Pilots only read. A new publish can take up to a minute to reach
every Cloudflare location, so publish before the briefing, not during it.

```sh
W=https://glow-show.brianfliesballoons.workers.dev
curl -s $W/pack/UKL7                     # which numbers does show UKL7 have?
curl -s $W/pack/UKL7/5 > pack-5.json     # balloon 5's pack
curl -s "$W/t0?code=UKL7"                # armed yet?
curl -s -X PUT $W/pack/UKL7 -H 'Content-Type: application/json' -H "X-Glow-Pin: $PIN" --data @packs.json
curl -s -X POST $W/t0 -H 'Content-Type: application/json' -H "X-Glow-Pin: $PIN" \
     -d '{"code":"UKL7","t0":1795126020000,"hold":false}'
```

## 8. A pilot app, start to finish

1. At the briefing (signal): sync the clock against `/time`; the pilot types
   the show code, the app lists the numbers from `GET /pack/:code`, the pilot
   picks theirs, and the app saves `GET /pack/:code/:n` to disk.
2. Show the code and the number on the screen so pilots can check them by
   radio ("show UKL7, number 5").
3. Arming: poll `GET /t0?code=` while there is signal, or the pilot taps the
   minute the MC calls over the PA.
4. Showtime, offline: every frame, `plan = packPlan(pack, floor(now - t0))`;
   draw it; fire the haptics whose `at` has just been passed.
5. HOLD (`hold: true` from `/t0`) overrides everything: Stop, wait for the conductor.

## 9. Golden vectors — `test/golden/`

`index.json` lists the files. Each file is:

```jsonc
{ "format": "glow-pack-golden/1", "show": "...", "key": "5",
  "pack": { ...a glow-pack/1 },
  "rows": [ [tMs, expectedPlan, expectedBeatPhase], ... ] }
```

In `expectedPlan`, tasks appear by **index**: `now.task`, `next` and
`finale` are a task index or `null`, and `then` is a list of indexes.
Everything else is exactly `packPlan`'s answer. Keys missing from an
expected `now` (`on`, `progress`) must be missing (nil) in yours. A port
passes when, for every row, its `packPlan(pack, tMs)`, with tasks swapped for
their indexes, equals `expectedPlan` field for field (numbers exactly, not
within a tolerance), and its `packBeatPhase` equals `expectedBeatPhase`.

Rows cover every segment boundary (`at - 1` and `at`), every haptic moment, a
5-second grid across the song, and far before and after the show. The files
cover a balloon show (demo #1), a group show (the demo without numbers,
group `shapes`) and two field-pattern shows (Havasu, Lightning Storm #5 and
Forest for the Trees #12).

Rewrite them only on purpose, when the web's answer is meant to change:

```sh
node test/extract.js && node test/pack-test.js --write-golden
```

then re-run the native tests against the new files.
