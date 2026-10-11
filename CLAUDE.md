## What this is

Layered Map Studio is a React + MapLibre GL tool that generates manufacturing-precision SVGs for Old Glory Flags & Decor's layered lake map product line: laser-cut/CNC-cut nested shoreline panels for physical lake maps, built to real millimeter dimensions rather than screen pixels.

## Architecture

- **Geography layer**: React + MapLibre GL — navigation, crop-corner selection, and geographic vector source features (roads, places, water). MapLibre pixels never leak into manufacturing geometry.
- **Geometry engine** (`src/geometry/`) — independent of the map UI, works entirely in projected millimeters:
  - `projection/cropProjection.ts` — bilinear Web Mercator crop projection; maps lng/lat to millimeter coordinates within the selected crop rectangle.
  - `projection/cropSnapshot.ts` — serializable snapshot of the map's center/zoom/bearing/crop/dimensions for reproducible regeneration.
  - `shoreline/polygonEngine.ts` — core polygon boolean ops: water-fragment union/crop-intersection (`polygon-clipping`) and closed-polygon offsets (`clipper-lib`, integer-scaled to 0.001mm precision); builds the water model and derives panels (`panel = product rect − water opening`).
  - `shoreline/artisticDepth.ts` — the Artistic Depth erosion model: named presets (xfine/fine/narrow/normal/wide/custom) of normalized inward offsets, `normal` being the measured/calibrated preset.
  - `terrain/` — procedural depth-terrain engine, reached from the app only through `shoreline/proceduralDepth.ts` (the **Procedural Terrain** depth mode, `bathymetry.mode:'procedural-terrain'`, alongside Artistic Depth and True Bathymetry). Phase A: rasterized shoreline → chamfer distance → per-body seeded noise/profile shaping → depth grid. Phase B (`marchingSquares.ts`, `depthContours.ts`): marching squares with asymptotic decider → simplify/Chaikin → Clipper clip into exactly nested contour polygons per threshold per body. Pure and deterministic; see `docs/depth-terrain.md`. Contour booleans use Clipper, not `polygon-clipping`, which throws on polygons sharing edges with their container.
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
- **Topographic map builder** (`src/topo/`, plan `docs/CLAUDE_TOPO_MAP_BUILD_PLAN.md`, status `docs/topo-implementation-status.md`) — a third product built as a feature area like `src/ornament/`, **not** the plan's `apps/*`/`packages/*` monorepo. Phase 1 (map mode: place search via the existing `/api/geocode` proxy and `PlaceSearch`, board size, zoom sync, GPX track→route→waypoint parsing, localStorage persistence) and Phase 2 (terrain preview: `/api/terrain/:z/:x/:y.png` proxy in `src/server/terrain/` with a disk cache, Terrarium decode/mosaic/resample/smoothing and quantile bands + contour lines in `src/topo/terrain/`, run in a worker) and Phase 3 (vector features: `src/topo/capture/` captures water/roads/labels from the live map by source-layer, reusing the ornament's capture/dedupe; `src/topo/features/` cuts water out of every terrain layer, and builds roads, labels, frame, title and the GPX route as an overlay cached apart from terrain — `regeneration.ts`'s `terrainRunKey` is the only terrain rerun trigger) are reachable from the lake tool's nav (“Topo Map Builder →”), the way the ornament was introduced: `App.tsx`'s `tool` state switches to `TopoPage`, whose `onExit` returns. ADR 0004: the terrain proxy extends `server/index.ts` rather than adding a server. The band machinery is shared with depth contours via `src/geometry/terrain/nestedBands.ts`; open contour lines are `traceContourLines` / `contourLines.ts`.

## Depth data strategy

(Summarized from `docs/bathymetry.md` and `docs/artistic-depth.md` — read those directly for full detail.)

- **Real bathymetry**: user-supplied georeferenced GeoJSON `Polygon`/`MultiPolygon` depth regions (each feature carrying `depth`/`depth_value` + a unit), **or automatic Michigan DNR contours**. Check Bathymetry routes the selected water body by state (WI → WI DNR, MI → MI DNR, else "no measured source"); see "Routing and Michigan DNR ingestion" in `docs/bathymetry.md`.
- **Why Wisconsin is not automated**: Wisconsin DNR contour products are mostly scanned historical PDFs, not georeferenced GIS. The reference lake, Caldron Falls (WBIC 545400), only has a June 1967 scanned sonar survey PDF — two 72-DPI raster sheets, no vector contours, no embedded georeferencing. WI DNR is used for waterbody identity only. NOAA/NCEI has real Great Lakes vector/grid bathymetry (a possible future Great Lakes provider) but not inland lakes. USGS's inland inventory is per-dataset and non-uniform, not a universal API.
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
      environment:
        GEOCODER_CONTACT: "${GEOCODER_CONTACT:-contact not configured}"
      volumes:
        - terrain-cache:/app/cache/terrain
      restart: unless-stopped
  volumes:
    terrain-cache:
  ```
- The `terrain-cache` named volume (topo Phase 2, ADR 0004) holds the terrain proxy's tile cache so it survives rebuilds. The Dockerfile creates `/app/cache/terrain` owned by `node` and sets `TERRAIN_CACHE_DIR`; Docker seeds a new named volume from that directory, ownership included. Public elevation tiles only; `docker volume rm` is always safe. **Deployed 2026-09-24** (image `c9c7c59a627c`, volume `layered-map-studio_terrain-cache`); verified live: healthy, a tile goes cache miss → hit, lake tool and ornament smoke-checked. Rollback image: `layered-map-studio:rollback-pre-topo-terrain-proxy` (`f0e1d44d9034`) with the pre-Phase-2 `docker-compose.yml`.
- No `.env` wired in via compose, despite `.env.example` existing in the repo (map style / Photon endpoint config). **Flagging this as a likely gap, not confirmed intentional** — worth checking the `Dockerfile` for whether env vars are baked in at build time instead, before assuming this is broken.
- The container fetches terrain tiles from `s3.amazonaws.com` (AWS Open Data Terrain Tiles). Egress was verified from the host and from inside the container as `node`.
- This is the first `CLAUDE.md` for this repo. `.claude/` and `.codex/` project-cache directories both exist, meaning the repo has previously been worked on with both Claude Code and Codex.

## Status as of this write (2026-09-24)

- Last code commit (2026-09-25): `f9ec901`, topo builder Phase 4 — laser-ready SVG export (the plan's 12 semantic groups, bridge tabs cut as layer-1 material), full preflight that blocks on errors, SVG + project JSON download; plus the opentype.js NaN-rounding fix in the shared `src/text/textVector.ts` (all three export tools) and the pinched-water-ring fix in topo's water pipeline. 1312 tests passing. The running container (image `a706f8e45424`, built `--no-cache`) was built from this commit's code. `master` is the only branch; everything below is committed on it.
- Ornament generator (see `docs/ornament-implementation-status.md`): Phases 0-5 built — domain model/SVG shell, the original ornament editor, MapLibre map/search/crop, feature geometry (capture, dedupe, road/water buffering, land-island detection, off-main-thread Web Worker pipeline with golden-fixture regression coverage), SVG export with preflight, and Phase 5 hardening (`e372834`: stale-capture guards, capture/worker timeouts, capacity limits and simplification in `src/ornament/limits.ts`, accessibility fixes). Phase 4 is still not exit-criteria-complete — see the xTool Studio note below.
- Since the ornament phases: bathymetry golden-fixture SVG export test and a distinct `unsupported` status (`dd57a36`), and generate/rebuild failures surfaced in the UI (`cb1624c`).
- Procedural depth terrain Phase A (`src/geometry/terrain/`, `docs/depth-terrain.md`) is committed but **not wired into the app**: no UI, scene or export path imports it. Ben's decisions: tiny raster fragments are *dropped* below `minBodyCells` (default 16 cells), not merged. Terracing order is **decided: normalize first**, then terrace at shared global benches, so equal depths mean equal cut layers across bodies. A body shallower than the first bench stays un-terraced (never lifted), and no cell snaps past its body's target. Terracing-off output is byte-identical to the old order. See "Terracing order" in `docs/depth-terrain.md`. Verification renders are in `~/renders/depth-terrain-phase-a/` on the VM, outside the repo.
- Depth terrain Phase B (contour extraction) and the terracing-order change are committed as `2e8f251`.
- Topo builder Phases 0–2 are committed together in the "Topo builder Phase 2" commit. Ben reviewed Phase 0/1 with no objection to the flagged decisions (route not persisted, strict GPX validation), and reviewed the compose/Dockerfile diffs before the deploy. Phase 2 (terrain preview, the `/api/terrain` proxy, the compose volume, and the contour generalization) is **deployed** as image `c9c7c59a627c`. The builder UI is still unreachable from the running app (`App.tsx` does not import it); what is live is the proxy route, the cache volume, and the contour refactor (pinned byte-identical output).
- Topo builder Phase 3 (water capture and masking, roads with bridge tabs across genuine water crossings, place-name labels with points of interest as a separate toggle defaulting off, frame, title, GPX output, overlay-only redraw) is built, tested, wired into the app and **deployed for review** — with the user-adjustable road thickness (0.5×–3×, bridge tabs follow it) — as image `099657b1cb45` (2026-09-25, `--no-cache`). Rollback images: `layered-map-studio:rollback-pre-road-thickness-review` (`ee53e18d30de`, the first Phase 3 review build) and `layered-map-studio:rollback-pre-topo-phase3-review` (`c9c7c59a627c`, the Phase 2 deploy); compose unchanged. Awaiting Ben's review; details and decisions to review in `docs/topo-implementation-status.md`. Phase 2's coastal gap is fixed and verified on a real Golden Gate fixture (`tests/fixtures/topo/`, recorded through the real capture code; 1.3 MB). It made three small, behaviour-preserving changes to shared ornament modules that *are* in the live bundle: `buildWaterRegion` split into `buildWaterRegionWithin(water, clipRegion)`, `buildRoadEngraving`'s `window` option also accepting a clip function (plus `clipPolylineToRect` in `clipLine.ts`), and `sameViewport` exported from `mapCapture.ts`. Every ornament golden passes unchanged.
- Topo builder Phase 4 (laser-ready SVG: the plan's 12 semantic groups, full preflight that blocks on errors, SVG + project JSON download) is built, tested and **deployed for review** as image `a706f8e45424` (2026-09-25, `--no-cache`); rollbacks `layered-map-studio:rollback-pre-glyph-nan-fix` (`0d79a250e43e`) and `layered-map-studio:rollback-pre-topo-export-review` (`099657b1cb45`). It also fixed an opentype.js 2.0.0 bug in the shared `src/text/textVector.ts` (NaN in glyph path data for coordinates within ~1e-6 of an integer, common with Cinzel) that affected the lake tool's exports silently — see the topo status doc.
- The **Procedural Terrain** depth mode (wiring the engine into Controls/buildScene/export) is committed as `0880c6a` and deployed. Artistic Depth and True Bathymetry are pinned byte-identical to their pre-wiring output by `tests/unit/depthModeIsolation.test.ts`.
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
