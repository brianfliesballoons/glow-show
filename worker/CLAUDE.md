# glow-show/worker — the app's only backend (Cloudflare Worker)

> **Reading protocol:** the parent [CLAUDE.md](../CLAUDE.md) routes here and is authoritative for the project; this note only covers deploy mechanics for this folder.

## Active to-do

1. First deploy blocked on Brian's Cloudflare login — see parent CLAUDE.md to-do 2 for the three one-liners.

## What this is

The Glow Show time/T0 endpoint: `GET /time` (ms server clock the phones sync against), `GET/POST /t0` (armed show start + hold flag, KV-backed, 24h TTL). ~60 lines, used only pre-show; showtime is fully offline by design.

## The files

| File | Status | What it is |
|---|---|---|
| `time.js` | primary copy | The whole Worker |
| `wrangler.toml` | working | Config; KV namespace id gets pasted in at first deploy |

## Conventions specific to this project

- `Date.now()` must be read at the top of the fetch handler (CF freezes it between I/O; it is accurate at request arrival). Don't move it.
- CORS stays `*` and `Cache-Control: no-store` on everything — phones fetch from the GitHub Pages origin.

## Delegation notes

- Small enough to edit inline in the main loop.
