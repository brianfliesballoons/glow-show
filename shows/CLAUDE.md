# glow-show/shows — show files (the choreography, one JSON per song)

> **Reading protocol:** the parent [CLAUDE.md](../CLAUDE.md) routes here and is authoritative for the project; this note only covers what lives in this folder and the file format.

## Active to-do

1. Nothing open. Real shows land here once Brian picks candidate songs (parent CLAUDE.md to-do) and runs them through the EDITOR.

## What this is

The folder of **show files** — the timeline a glow is performed from. A show file is the only thing `index.html` needs to run a glow: the app validates it, compiles it, and every pilot's phone renders the same timeline off its own synced clock.

**Shows are generated, not hand-written.** The EDITOR role analyses a song's audio (beat grid, bass/vocal/brightness bands, sections) and the auto-choreographer writes the cues; the timeline editor tweaks them; EXPORT drops the JSON here. `demo-show.json` is the exception: it is hand-authored, and it doubles as **the schema reference** — when in doubt about the format, read that file, it exercises every cue type.

### How a generated show gets here

EDITOR → pick the song → analysis (progress bar, seconds) → GENERATE → tweak → **DOWNLOAD SHOW JSON** (or COPY), then save the file into this folder under a `<song-slug>.json` name. The download is named from the show title, so title it before exporting.

### The advisory list

A generated show is the choreographer's *musical* wishes filtered through the *safety* rules, and the losses are reported rather than hidden. Every cue it wanted but could not place turns into a line in the editor's "what it wanted to do but couldn't" panel — e.g. *"wanted an ALL burn on the drop at 1:21 — skipped: NORTH ROW gets only 4.2s after 'Drop 4 — ALL burn 2' — needs 12s to vent and get ready before a long burn."* Advisories live in the editor's saved project, **not in the exported show file** (the show is just the timeline). If a generated show feels thin, read that panel first: it names the setting that is costing you the cue (usually the rest window or the burn budget), and every one of those settings is a slider on the setup screen.

## The files

| File | Status | What it is |
|---|---|---|
| `demo-show.json` | primary copy | Hand-authored ~90s / 3-group demo. Also the worked example of the `glow-show/1` schema. Mirrored inline in `index.html` as `DEMO_SHOW` so "LOAD DEMO SHOW" works from `file://` and offline — **keep the two in sync** (the app prefers this file when it can fetch it). Deliberately tighter than the choreographer's own spacing rules, which makes it the fixture for "tight is advice, dangerous is a veto" (see below). |

## The `glow-show/1` schema, in brief

```jsonc
{
  "format": "glow-show/1",              // version gate — anything else is rejected
  "title": "...",                       // also the showId (slugified) the Worker keys T0 on
  "audio": { "title": "...", "durationMs": 90000 },
  "groups": [                           // ids: letters/digits/-/_ ; "all" is RESERVED
    { "id": "north", "label": "NORTH ROW", "color": "#00c8ff" }
  ],
  "defaults": { "getReadyMs": 5000, "ventWarnMs": 20000, "longBurnMs": 6000, "stopMs": 2000 },
  "cues": [                             // MUST be sorted by t
    { "t": 15000, "dur": 3000,  "type": "burn",      "groups": ["all"],   "label": "Opening all-burn" },
    { "t": 24000, "dur": 12000, "type": "burn",      "groups": ["north"], "label": "North long burn", "vent": true },
    { "t": 40000, "dur": 8000,  "type": "pulse",     "groups": ["all"],   "bpm": 128,      "label": "Chorus pulse" },
    { "t": 52000, "dur": 6000,  "type": "alternate", "groups": ["north","south"], "periodMs": 1000, "label": "Ping-pong" }
  ]
}
```

- `t` = ms after **T0** (the armed start), not wall-clock. `dur` = ms.
- **`all`** is the implicit group meaning *every pilot*. Never define a group with that id; never mix `"all"` with named groups in one cue.
- Cue types: **`burn`** solid · **`pulse`** flashes on a `bpm` grid (pilot blips the burner per flash) · **`alternate`** groups take turns every `periodMs` (expanded internally into per-group burn windows, in list order).

**Derived by the app at load — never author these:**

- **GET READY** — `getReadyMs` before each cue that concerns the pilot's group. Suppressed when that group's previous cue ended less than `getReadyMs` earlier (a ping-pong must not spam "get ready" between its own legs).
- **STOP** — `stopMs` after every cue, truncated at that group's next cue start.
- **VENT WARNING** — `ventWarnMs` before any cue whose *sustained* burn is `>= longBurnMs`, or any cue with `"vent": true`. Sustained length for an `alternate` cue is its `periodMs` (one leg), not the whole cue.

## Conventions specific to this project

- **A show that fails validation is never rendered** — the app throws a full-screen red error listing every problem. Validation covers: format gate, group definitions/ids/colors, cue sort order, `t`+`dur` inside `audio.durationMs`, per-type requirements (`bpm`, `periodMs`), and **no overlapping cues within any one group** after `alternate` expansion and `all` resolution. A pilot can never be handed two cues at once.
- **The four safety rules the generator obeys are NOT part of the file format** (they live in the editor's sliders): no burn over `maxBurnMs`; `minRestMs` of clear air between any two of a group's cues; before any burn long enough to need venting, `stopMs + ventLeadMs + getReadyMs` of clear air so the VENT warning is actually on screen; and a per-group `burnBudgetMs` for the whole show. A hand-authored file may break them and still be perfectly valid — `demo-show.json` does.
- **Tight is advice, dangerous is a veto.** The editor paints a spacing that is merely tighter than the current sliders in amber and still exports it; it blocks export only on what the app itself would reject (overlaps, out of bounds, bad shape) or on the one genuinely unsafe case — a long burn a pilot gets less than a couple of seconds of warning about.
- **Filenames**: `<song-or-event-slug>.json`, lowercase-hyphenated. No date stamps — a show is versioned by editing it, not by accumulating copies.
- Times are **integers in ms**. Don't author fractional ms; don't author seconds.
- Keep `audio.durationMs` honest — the conductor compares it against the picked audio file and warns on a mismatch over 2s. A generated show takes it from the analysed file, so it is honest by construction.

## Delegation notes

- Hand-authoring or repairing a show file: small enough to edit inline in the main loop.
- Generating a show from a song is not an agent job at all any more — it is the EDITOR role in the app. Changing *how* it generates (the choreographer's section→pattern map or its constraint engine) is `make-max` per the parent CLAUDE.md.
