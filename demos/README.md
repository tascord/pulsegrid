# demos/ — single source of truth for demo sessions

One file per demo. The filename is the display name:

- UPPERCASE, `_` renders as a space → `STRUDEL_DEMO.js` shows as **STRUDEL DEMO**.

The file body is the track-DSL session code, evaluated as-is. Set the
tempo with a top-level `cpm(N)` (or legacy `setcpm`/`bpm`) call — the
preset loader, server seeds, and CLI tools all parse it from the code,
so there is no second place to keep in sync.

Consumers (all read this folder, nothing is duplicated):

- `src/App.tsx` pulls the files in through Vite
  (`import.meta.glob` with `?raw`, eager) for the preset buttons and the
  default session.
- `server.ts` reads them with `fs` for the seeded community gallery.
- `tools/bounce`, `tools/parity`, `tools/compare-audio` read them with
  `fs` for offline renders and event dumps.
- `src/demos.ts` holds the shared filename/cpm parsing.
