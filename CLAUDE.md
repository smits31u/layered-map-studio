## What this is

Layered Map Studio is a React + MapLibre GL tool that generates manufacturing-precision SVGs for Old Glory Flags & Decor's layered lake map product line: laser-cut/CNC-cut nested shoreline panels for physical lake maps, built to real millimeter dimensions rather than screen pixels.

## Architecture

- **Geography layer**: React + MapLibre GL — navigation, crop-corner selection, and geographic vector source features (roads, places, water). MapLibre pixels never leak into manufacturing geometry.
- **Geometry engine** (`src/geometry/`) — independent of the map UI, works entirely in projected millimeters:
  - `projection/cropProjection.ts` — bilinear Web Mercator crop projection; maps lng/lat to millimeter coordinates within the selected crop rectangle.
  - `projection/cropSnapshot.ts` — serializable snapshot of the map's center/zoom/bearing/crop/dimensions for reproducible regeneration.
  - `shoreline/polygonEngine.ts` — core polygon boolean ops: water-fragment union/crop-intersection (`polygon-clipping`) and closed-polygon offsets (`clipper-lib`, integer-scaled to 0.001mm precision); builds the water model and derives panels (`panel = product rect − water opening`).
  - `shoreline/artisticDepth.ts` — the Artistic Depth erosion model: named presets (xfine/fine/narrow/normal/wide/custom) of normalized inward offsets, `normal` being the measured/calibrated preset.
  - `roads/roads.ts` — thin but real (6 lines): filters roads by class (`all` vs `main`: motorway/trunk/primary/secondary) and projects surviving points into crop-bounded millimeter coordinates. Not a stub — this is the complete road-inclusion logic; the "buffering"/presentation work lives in `scene/roadLabels.ts` instead.
  - `scene/compass.ts` — Classic Rose compass geometry with minimum-feature-size floors (a laser-engraving manufacturing constraint, not a UI concern).
  - `scene/keepOut.ts` — non-destructive keep-out clipping so road/label geometry avoids compass/marker footprints.
  - `scene/roadLabels.ts`, `scene/placeLabels.ts` — candidate generation and placement resolution for road/place labels.
  - `scene/titleBacker.ts` — title/subtitle backer geometry as real manufacturing paths (not CSS).
  - `scene/markerRegistry.ts`, `scene/markers.ts` — marker types, minimum size floor, per-marker placement (recomputed from lat/lng every time, never stored, so it survives crop changes).
  - `scene/overrides.ts` — merges generated default placement with manual per-object overrides; absent fields fall back to defaults.
  - `scene/viewport.ts` — editor-only pan/zoom state, explicitly never part of `MapProject` or export geometry.
- **Text layer** (`src/text/`) — every string in manufacturing output is glyph outlines, never a live `<text>` element:
  - `fontRegistry.ts` — the three bundled SIL OFL fonts (Inter, Cinzel, Great Vibes) in `public/fonts/`, parsed with opentype.js. Fonts are local by design: export must never depend on a font installed on the destination machine, and never fetches at export time. Loading is async but the manufacturing pipeline is not, so `getLoadedFont()` is a sync accessor and `buildScene` raises a clear "still loading" error rather than dropping the text.
  - `textVector.ts` — `textPathData()` converts a string to path data at physical mm size, anchored left/center/right with the baseline at the local origin; callers position and rotate via an SVG group transform so path data stays reusable. opentype.js 2.x leaves contours geometrically closed but emits no `Z`, so this appends explicit closes — a Z-less subpath reads as an open polyline to CAM importers and loses kerf compensation.
- **Export layer** (`src/export/`):
  - `buildScene.ts` (214 lines, the core) — assembles the full manufacturing scene: water model, artistic-depth openings, roads, bathymetry depth regions, labels, compass, overrides.
  - `geometryCache.ts` — caches the expensive polygon-boolean output keyed only on inputs that affect geometry, so presentation-only changes (label settings, overrides) don't invalidate it.
  - `scene.ts` — core `Shape`/`Operation` (`cut`/`engrave`/`annotation`) types for the UI-independent manufacturing scene.
  - `svg/exportSvg.ts` — manufacturing SVG serializer; named sub-groups (roads-major/minor, labels, title, compass) in fixed order.
  - `svg/previewSvg.ts` — separate preview-mode renderer (individual/composite/exploded) with editor-only hit targets that are guaranteed never to leak into `exportSvg.ts` output.
- **SVG serializer** — three export modes: Production Sheet (panels side-by-side, deterministic gaps), Registered Layers (all panels at origin 0,0), Individual Files (one SVG per panel, delivered as a single `.zip`). The zip is built with `fflate` (chosen over jszip for tree-shaking: named ESM exports, ~8kB vs ~100kB of untreeshakeable UMD) and pins its entry timestamps, so re-exporting an unchanged scene produces byte-identical archive bytes that can be diffed against whatever went to the cutter. `individualSvgs()` still returns the raw per-panel strings, and both paths run through `assertManufacturingSceneUsable()`.

## Depth data strategy

(Summarized from `docs/bathymetry.md` and `docs/artistic-depth.md` — read those directly for full detail.)

- **Real bathymetry** is V1-architected but not automated: the app accepts user-supplied, georeferenced GeoJSON `Polygon`/`MultiPolygon` depth regions (each feature carrying `depth`/`depth_value` + a unit). It does not fetch or generate this data itself.
- **Why no automated DNR/NOAA/USGS ingestion**: researched and rejected as impractical for now. Wisconsin DNR contour products are mostly scanned historical PDFs, not georeferenced GIS. The reference lake, Caldron Falls (WBIC 545400), only has a June 1967 scanned sonar survey PDF — two 72-DPI raster sheets, no vector contours, no embedded georeferencing. NOAA/NCEI has real Great Lakes vector/grid bathymetry (practical for a future Great Lakes provider) but that doesn't cover inland lakes like Caldron Falls. USGS's inland inventory is real but per-dataset and non-uniform, not a universal API.
- **Fallback: Artistic Depth** — the shipped default, not a placeholder. Deterministic, explicitly non-bathymetric shoreline erosion via Clipper inward offsets at normalized steps (`3, 9, 20, 25, 30` for the `normal` preset). Calibrated against real reference geometry for 4 lakes (Caldron Falls, High Falls, Lake Noquebay, Wind Pudding Lake) in `tests/fixtures/artisticDepthReferences.ts`. Every result is intersected with the original shoreline (`W0`) to guarantee nesting/ancestry; collapsed openings (≤0.01mm²) block manufacturing export until resolved.

## Known gaps

- No `TODO`/`FIXME`/stub markers exist anywhere in `src/` — everything present is real, working logic, not scaffolding.
- **The README is stale and should not be trusted over `src/`.** It still lists text outlining and ZIP packaging as unimplemented; both ship today (see the Text layer and Export layer above). An earlier revision of this file repeated those claims because it summarized the README rather than the code.

## Deployment

- Docker, single service, `docker-compose.yml`:
  ```yaml
  services:
    layered-map-studio:
      build: .
      ports: ["8088:8080"]
      restart: unless-stopped
  ```
- No volumes and no `.env` wired in via compose, despite `.env.example` existing in the repo (map style / Photon endpoint config). **Flagging this as a likely gap, not confirmed intentional** — worth checking the `Dockerfile` for whether env vars are baked in at build time instead, before assuming this is broken.
- This is the first `CLAUDE.md` for this repo. `.claude/` and `.codex/` project-cache directories both exist, meaning the repo has previously been worked on with both Claude Code and Codex.

## Status as of this write (2026-09-24)

- Last commit: `cb1624c` (2026-09-17), "Fix silent generate/rebuild failures: visible error styling, error surfaced next to Generate button and in workspace nav, …". 856 tests passing at that commit. `master` is the only branch; all phases below are committed on it.
- Ornament generator (see `docs/ornament-implementation-status.md`): Phases 0-5 built — domain model/SVG shell, the original ornament editor, MapLibre map/search/crop, feature geometry (capture, dedupe, road/water buffering, land-island detection, off-main-thread Web Worker pipeline with golden-fixture regression coverage), SVG export with preflight, and Phase 5 hardening (`e372834`: stale-capture guards, capture/worker timeouts, capacity limits and simplification in `src/ornament/limits.ts`, accessibility fixes). Phase 4 is still not exit-criteria-complete — see the xTool Studio note below.
- Since the ornament phases: bathymetry golden-fixture SVG export test and a distinct `unsupported` status (`dd57a36`), and generate/rebuild failures surfaced in the UI (`cb1624c`).
- **`CLAUDE_MAP_ORNAMENT_BUILD_PLAN.md` does not exist in this repository.** Earlier revisions of
  this file and of the status document cite it as though it were checked in; it is not on disk, not
  in any commit reachable from any ref, and not in the `.claude` or `.codex` session caches. Treat
  every reference to it as a citation of a document held outside the repository. `docs/ornament-implementation-status.md` is the nearest thing to a written spec that is actually here.
- **The ornament generator has no marker.** Removed entirely at Ben's direction — markers are added
  by hand in xTool Studio per order. There is no marker piece, no `piece/marker/*` export group, no
  marker controls and no keep-out. Do not reintroduce one without asking. `src/geometry/scene/keepOut.ts`
  is still the compass's and is untouched; `src/geometry/scene/markerRegistry.ts` is the *lake* tool's
  marker artwork and is unrelated to the ornament.
- **Removing the marker did not bump `schemaVersion`.** It stays at 1, so projects saved by earlier
  builds still load; their dead `marker` key rides through inertly. See `persistence.ts`.
- **`land.islandPolicy` defaults to `bridge`** with `minIslandAreaMm2` at **2mm² (an area, Ben's
  explicit choice when asked — note this is looser than the 4mm² it replaced)**. Bridging drops only
  fragments below that threshold. Loose land warns and never blocks, under any policy.
- Ornament export lives in `src/ornament/export/` and deliberately does not go through the lake tool's `ManufacturingScene`/`exportSvg.ts` path, which assumes a rectangular product. See the status document for the reasoning.
- **The target laser software is xTool Studio, not LightBurn.** The build plan assumed LightBurn and
  Phase 4's colour preset was reasoned about in its terms. `src/ornament/export/lightburn.ts`, the
  `LIGHTBURN_PRESET` constant and the persisted `ExportPreset` value `'lightburn-colors'` are
  holdovers of that assumption, kept because renaming the stored value is a project-schema migration
  rather than a rename. The colour convention (red cut, black engrave, blue light-water-engrave,
  green registration, cyan labels) has **not** been verified against xTool Studio's import behaviour
  and must not be assumed compatible. Group ids remain the authoritative contract either way.
- Phase 4 is built and tested but **not exit-criteria-complete**: opening the output in xTool Studio
  and in Inkscape is an outstanding manual step for Ben. Neither is installed on the VM. Chrome was
  verified directly against the built container. Details and a checklist are in
  `docs/ornament-implementation-status.md`.
- The lake tool's own docs (`README.md` "Manual LightBurn acceptance", `docs/v1-milestones.md`,
  `docs/v1-architecture.md`) still say LightBurn. Those were left alone — they describe the lake
  panel product line's acceptance, not the ornament's, and nobody has said which program that
  product is cut on. Worth confirming before trusting them.

## Environment

- Deployed on an Unraid VM at `192.168.0.137` (SSH user `smits31u`).
- Container: `layered-map-studio-layered-map-studio-1`, port mapping `8088:8080`.
- Other services share this same VM — avoid port collisions: business app (8765), Zoe coordinator (8180), Ollama (11434), Zoe dashboard (3000), Zoe Wyoming voice services (10200/10300/10400/10500).
- No reverse proxy — the service is reached directly at `http://192.168.0.137:8088`.

## Future deployment

Not deployed to a public subdomain yet — currently accessed directly at
http://100.64.163.25:8088 during active development (Tailscale IP; LAN
equivalent is 192.168.0.137:8088). Do not wire up DNS, TLS, or nginx
routing until the lake depth, topo, ornament, and bathymetry modules are
consolidated and stable.

When ready to move off the bare IP:port:

- Target is its own subdomain: maps.oldglorydecor.com — NOT nested under
  tools.oldglorydecor.com (that domain's nginx routes to a separate SPA
  with its own client-side router; a path-based /maps location risks
  colliding with that app's own routes now or in the future)
- tools.oldglorydecor.com's nginx runs on the Unraid host itself
  (Tailscale 100.93.70.122 / LAN 192.168.0.10 / hostname Tower), config
  at /mnt/user/oldglory/nginx/conf.d/oldglory.conf, one server block per
  subdomain, each with its own Let's Encrypt cert (existing pattern:
  tools, www, api, checkout, analytics, vault). maps.oldglorydecor.com
  should follow the same pattern: new server block + new cert, proxying
  to this app's container on the VM (LAN 192.168.0.137:8088 — the host's
  nginx reaches the VM over LAN, not Tailscale, since both boxes sit on
  the same physical network)
- Gate it behind basic auth or an IP allowlist at the nginx layer when
  it goes live — this is personal-use tooling for now, with a real
  possibility of becoming a paid customer-facing service later. Starting
  gated costs nothing while it's single-user; removing the gate later
  when opening it up is a one-line change. Do NOT deploy it ungated
  under the assumption it'll stay internal-only forever.
- If/when it does open up to customers, geocoding calls (Photon/Nominatim)
  need to be server-side proxied and rate-limited before that happens —
  Nominatim's usage policy caps at 1 req/sec and forbids client-side
  autocomplete-style hammering. Confirm this app isn't currently firing
  geocode requests directly from the browser before that day comes.

## Remote access

- This repo lives on a machine reachable via `ssh smits31u@192.168.0.137`. SSH key auth only — no password auth. If a future session needs to connect and has no working key yet, generate one locally and have the user add it to this host's `~/.ssh/authorized_keys`.
- `node`/`npm` are installed via nvm, not on the default non-interactive PATH. Use `bash -lc 'source ~/.nvm/nvm.sh; <command>'` (or an interactive login shell) when running commands over a plain `ssh host "cmd"` invocation.
