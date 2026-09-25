# Topographic map builder — implementation status

Tracks `docs/CLAUDE_TOPO_MAP_BUILD_PLAN.md` against this repository.

| Phase | State |
|---|---|
| 0 — assessment and decision log | complete: this document plus ADR 0004 |
| 1 — map / search / size / GPX | built and tested; **not wired into the running app** |
| 2 — terrain preview | built and tested; proxy **deployed** (image `c9c7c59a627c`); builder UI **not wired into the running app** |
| 3 — vector features and editing | not started |
| 4 — laser-ready SVG | not started |
| 5 — hardening | not started |

## Repository shape: a feature area, not a monorepo

The plan recommends npm workspaces: `apps/web`, `apps/server`, `packages/geometry`, and
`packages/domain`. This repository does not adopt that. The topo builder lives in `src/topo/`,
beside `src/ornament/`, and reuses shared modules directly, as every earlier feature did: the lake
tool, the ornament, bathymetry, and procedural terrain. The ornament's status document records the
same decision against its own plan.

Every structural need the topo plan names fits the existing layout. The one open question, where
the terrain-tile proxy runs, is decided in ADR 0004: it extends the existing Node server. That ADR
also lists what the proxy genuinely needs that no earlier feature did: a persistent, writable cache
volume in the container, binary responses, and strict tile-path validation. None of those needs a
new server or package.

The plan's own Phase 0 is a scaffold: workspace, lint, Playwright, a health route, and a Vite
proxy. The first four already exist or do not apply. Playwright is still not set up in this
repository (the ornament noted the same gap). Its end-to-end items are covered by jsdom component
tests with the shared fake MapLibre, as the ornament's are.

## Phase 0 — what is reusable, and what is new

### Reused as-is

| Plan need | Existing module | Notes |
|---|---|---|
| Geocoding: proxy, 1 req/s, User-Agent, cache, up to 5 results, swappable providers, search on submit | `src/server/geocode/*`, `/api/geocode`, `ProxyGeocoder`, `src/ornament/ui/PlaceSearch.tsx` | Fully satisfies the plan's §Geocoding. Phase 1 reuses `PlaceSearch` unchanged; there is no second geocoder. |
| MapLibre runtime and types | `src/ornament/map/maplibreGlobal.ts` (ADR 0003: pinned CDN script plus a typed facade) | Used by `TopoMap.tsx`. |
| OpenFreeMap basemap | `VITE_MAP_STYLE_URL` (the lake tool's style) | The plan's provider. The ornament's `provider.ts` holds the OpenMapTiles source-layer names that Phase 3 capture will need. |
| Crop frame at the output aspect ratio | the lake tool's `.crop-frame` CSS (`--ratio`) | Reused class; the topo map sets the ratio. |
| mm/in conversion | `src/utils/units.ts` | `validateDimensionMm` is the lake tool's 50–1220 mm range, not the topo plan's, so topo has its own limits. |
| Text to path | `src/text/textVector.ts`, `fontRegistry.ts` | Bundled OFL fonts (ADR 0002). Covers the plan's "bundled, redistributable fonts; convert glyphs to paths". |
| Polygon engine | Clipper (`clipper-lib`) and `polygon-clipping`, ADR 0001 | The plan's Phase 0 asks for this ADR; it exists. Phase B of the procedural terrain found `polygon-clipping` throws on shared-edge input, so contour booleans use Clipper (`docs/depth-terrain.md`). |

### Reusable as a pattern (adapt, don't import)

| Plan need | Existing module | Why not as-is |
|---|---|---|
| Serializable state, reducer, persistence with a schema version | `src/ornament/{types,defaults,validation,store,persistence}.ts` | Ornament-shaped. Topo has its own files built on the same pattern: clamp everything, merge stored records over defaults. |
| Web Worker pipeline with cancellation and timeout (plan Phases 2, 5) | `src/ornament/worker/geometryRunner.ts`, `protocol.ts` | The pattern fits: a worker with terminate-on-cancel, a timeout, and an inline fallback for tests. The payload is ornament geometry. |
| Frozen-viewport capture, dedupe, projection to mm (plan Phase 3) | `src/ornament/capture/*`, `snapshot.ts`, `geometry/mapProjection.ts` | These are the plan's §1 steps: freeze, `queryRenderedFeatures`, dedupe by a stable key, pixels to mm. They are tied to the ornament's circular crop, so they need generalizing to a rectangle. |
| SVG export, semantic groups, preflight (plan Phase 4) | `src/ornament/export/*`; also the lake tool's `export/svg/exportSvg.ts` | The topo board is a rectangle, which the lake tool's `ManufacturingScene` path assumes and the ornament's does not. The best basis is decided in Phase 4. |

### Genuinely new

- **Elevation ingestion.** Nothing in the repository fetches Terrarium PNGs or decodes elevation.
  New work: XYZ coverage with a padding ring, tile mosaic, crop and resample, and the decode
  `R·256 + G + B/256 − 32768`. Missing tiles must be an explicit error. Also a pixel budget and
  smoothing.
- **The terrain-tile proxy.** See ADR 0004.
- **GPX parsing.** Done in Phase 1 (`src/topo/gpx.ts`).
- **Terrain band and contour UI.** Phase 2 and later.

### Is the procedural terrain's contour code reusable on real elevation grids?

I investigated this rather than assuming. **Partly: the core is generic, and it needs two
generalizations first.**

**Generic already (`src/geometry/terrain/marchingSquares.ts`):**
- the 16-case table;
- the asymptotic decider for cases 5 and 10, which the plan explicitly prefers;
- linear edge interpolation;
- edge-identity stitching.

It takes any `ArrayLike<number>` grid. Nothing in it knows about depth, water bodies or 0–1 values.

**Depth-specific assumptions to generalize before Phase 2 can use it:**

1. **Out-of-grid samples read as 0, and thresholds must be > 0.** That is right for a depth grid,
   whose outside is shore. It is wrong for elevation: a threshold can be 0 or negative (sea level,
   Death Valley). Needed: make the treatment of out-of-grid samples a parameter — "below every
   threshold" symbolically, rather than the value 0.
2. **Every contour is a closed ring.** The virtual border closes every contour, which is right for
   filled bands. The plan's contour lines are *score lines*: open polylines that end where they
   leave the board. Closing them would score along the board edge. Needed: an open-chain mode
   that stops a chain at the grid edge.

**Specific to depth terrain: `src/geometry/terrain/depthContours.ts`.** It is built around
`DepthTerrain`: per-body water labels, dropped bodies, clipping to the shoreline, and thresholds
restricted to (0, 1]. Its machinery is exactly what the plan's nested bands need:
- ring simplify and smooth with crossing-checked fallback;
- hole assignment from raw topology;
- a Clipper clip with an erosion margin, which gives exact nesting;
- an independent nesting assertion.

Needed: extract that machinery into a generic "nested bands from a grid, thresholds, and a
container polygon" function. `extractDepthContours` then becomes a thin wrapper over it; its
pinned fingerprints show that refactor changed nothing. A cell size in mm on each axis also needs
supporting, since the plan scales X and Y independently.

The plan's band thresholds are quantiles of the elevation samples. They are not the procedural
terrain's fixed fractions. That is new but small: sort once and pick percentiles.

## Phase 1 — built

`src/topo/`:
- **`types.ts`**: the domain model and limits.
- **`defaults.ts`**: the plan's observed initial settings: a 9 × 9 in board, zoom 14, one layer at
  50/25/12% coverage, and contours at Normal (8).
- **`validation.ts`**: everything is clamped; stored input is untrusted.
- **`store.ts`**: the reducer.
- **`persistence.ts`**: localStorage with `schemaVersion: 1`.
- **`gpx.ts`**: the parser, plus route bounds.
- **`ui/TopoPage.tsx`, `ui/TopoMap.tsx`, `ui/topo.css`**: the map-mode page.

Tests are `tests/unit/topoGpx.test.ts`, `topoDomain.test.ts` and `topoPage.test.tsx`, 44 in all.

- [x] MapLibre with a visible crop frame at the board's aspect ratio. Bearing and pitch are locked
      at 0: rotation gestures are disabled, not merely started at 0.
- [x] Serializable state, mm/in conversion, dimension validation, and zoom sync. The zoom control
      moves the map in 0.5 steps; a map gesture moves the control and keeps the map's own zoom,
      unsnapped.
- [x] Geocoding through the existing proxy, choosing among up to 5 results, and fit to the result.
- [x] GPX:
  - fallback order: tracks, then routes, then waypoints;
  - strict rejection with reasons;
  - size and point limits;
  - fit to route, replace, clear, and a route preview overlay.
- [x] Exit criteria, tested through the page: select a place, set a board size, pan and zoom, load
      a GPX, reload, and recover non-file state.
- [ ] Wired into the running app. This is deliberately not done: `App.tsx` does not import
      `TopoPage`, so it is absent from the production bundle. `topo.css` is imported only by the
      page, so the live CSS is unchanged as well.

### Decisions and deviations to review

- **Board range: 50–600 mm.** The plan says "2–24 in or 50–600 mm", which disagree (24 in is
  609.6 mm). The stored unit is mm, so the mm range holds, which is about 1.97–23.62 in. This is
  the ornament's precedent.
- **Route stored as segments.** The plan's `route.coordinates` is stored as `route.segments`. A GPX
  track can be several segments, and joining them would draw a line across a gap nobody walked. A
  one-segment route is the plan's shape, nested once.
- **The route is not persisted.** It is file state, and Phase 1's criterion is recovering
  *non-file* state. It is also a detailed location history that should not outlive the user
  closing the file. Everything else is restored.
- **GPX parsing is strict and whole-file.** One bad point anywhere, even in a source that would not
  be used, rejects the file. So does a DOCTYPE or entity declaration. A failed load never disturbs
  a route already loaded.
- **Added fields.** `displayUnit` and `viewport.selectedPlaceLabel` were added to the plan's model,
  because a unit toggle or place that forgets itself on reload fails Phase 1's exit criterion.
- **Default location.** The lake tool's default, since the plan names none.

### Known limitations

- A GPX route that crosses the antimeridian is fitted around its extremes, the long way round. No
  map of a single place can hit this.
- The route overlay is re-projected on every map move. At the GPX point limit (250,000) that is
  heavy; simplifying the overlay for display is Phase 5 hardening.

Ben reviewed Phase 0/1 and raised no objection to the two flagged decisions: the route is not
persisted, and GPX validation is strict. Both stand as built.

## Phase 2 — built

### Terrain-tile proxy (ADR 0004)

`src/server/terrain/` holds the proxy:
- `tilePath.ts`: strict z/x/y validation;
- `handler.ts`: disk cache, a concurrency cap of 6, a timeout, and in-flight dedupe;
- `httpRoute.ts`: a separate binary route type;
- `tileCache.ts`: the tile cache.

It is mounted in `server/index.ts` and in the Vite dev and preview servers. The geocode route is
untouched. A missing upstream tile is a 404 `missing-tile`, never a substitute tile. The container
gains a `terrain-cache` named volume at `/app/cache/terrain`, owned by `node`. See ADR 0004's
Implementation section.

### Generalized contour code

`src/geometry/terrain/`:
- **`marchingSquares.ts`.** `traceContourRings` takes an `outside` value, default 0. At 0 its
  behaviour and error messages are the old ones exactly. `−∞` means the grid is closed with nothing
  special about any elevation, so thresholds of zero or below work. `traceContourLines` is new: it
  produces open polylines that end on the grid boundary, and closed loops that stay inside.
- **`nestedBands.ts`** (new). The nesting and stitching machinery was *moved* out of
  `depthContours.ts`, not copied: simplify, smooth with crossing fallback, hole assignment, and the
  eroded Clipper clip and chain assertion. `extractNestedBands(grid, thresholds, container, …,
  outside)` is the generic entry point. `depthContours.ts` is now a thin wrapper over it.
- **`contourLines.ts`** (new). Centerlines: trace, simplify (the ornament's Douglas–Peucker),
  one endpoint-preserving Chaikin pass, then a clip to the land as Clipper open paths. Fragments
  under 1 mm are dropped.
- **Isolation proof.** Every pre-existing pin passes unchanged after the refactor:
  - depth terrain fingerprint;
  - depth contours fingerprint `3029795f…`;
  - the procedural-terrain production SVG `a0c2adae…`;
  - all six Artistic Depth and True Bathymetry pins in `depthModeIsolation.test.ts`.

  A client build with only `marchingSquares.ts` and `depthContours.ts` reverted to HEAD hashes to
  the live bundle (`index-CcineeI6.js`). So the refactor is the only change in the running app's
  bundle, and the pins show it computes the same output.

### Terrain pipeline (`src/topo/terrain/`)

- **`tiles.ts`.** Web Mercator and XYZ tile math:
  - the terrain zoom is `clamp(floor(mapZoom), 5, 14)`;
  - frame bounds are computed from the frozen centre, zoom and frame size;
  - coverage adds a one-tile padding ring;
  - x wraps across the antimeridian, and y is clamped at the poles;
  - a budget of 64 tiles.
- **`png.ts`.** A pure PNG decoder (fflate inflate; filters 0–4; 8-bit grey, RGB, palette,
  grey+alpha and RGBA). The browser's image decoder may colour-manage or premultiply, which would
  shift every elevation. This decoder is exact and runs in a worker without OffscreenCanvas. It
  matches PIL byte for byte on a real tile.
- **`terrarium.ts`.** `R·256 + G + B/256 − 32768` into Float32 (exact at 1/256 m). Samples below
  −11,500 m or above 9,000 m are clamped and counted, and the count becomes a warning.
- **`elevationGrid.ts`.** Mosaic, then crop and resample:
  - The board maps linearly onto the frozen bounds in Mercator. Resampling is bilinear.
  - The working grid's long side is `900·√(perimeter / 914.4 mm)`: 900 for the default 9 in
    square, under a 2 M-sample budget.
  - The grid extends one cell past each board edge, so bands meet the board edge exactly.
  - A tile absent from the input is a `missing-tile` error naming the tile.
- **`smooth.ts`.** A separable Gaussian with clamped edges; σ = radius/2 and the kernel is
  normalized. Radius is set in grid samples; 0 turns it off. The default is 3; the UI offers 0–8.
- **`bands.ts`.**
  - Layer 1 is the board minus water.
  - Layers 2–4 use quantile thresholds over the land samples: `t` is the ⌈p·n⌉-th largest, so
    p% of the land is at or above `t`. They come from `extractNestedBands`, with the outside at −∞
    and chained from layer 1. So water is subtracted from every layer, and 4 ⊂ 3 ⊂ 2 ⊂ 1 is
    asserted.
  - Contours sit at `min + i·range/(n+1)`.
  - A "Very flat area" warning is given when the range is under 30 m; export is still allowed.
- **`pipeline.ts`.** `freezeTerrainView` and `generateTerrain`: one pure function from the frozen
  view, the tile bytes, water and settings to the result.
- **`fetchTiles.ts`.** Page-side downloads through `/api/terrain`: a pool of 6, a per-tile
  timeout, one AbortSignal, and a stop at the first failure. A 404 becomes `missing-tile`.
- **`worker/`.** The protocol, the worker, and `terrainRunner.ts`. The runner follows the
  ornament's runner point for point:
  - cancelling terminates the worker;
  - job ids drop stale results;
  - a timeout;
  - an inline fallback;
  - plus stage progress, and error codes carried across the worker boundary.

  It is a sibling of the ornament's runner, not a generalization, so ornament code is untouched.

### UI (`src/topo/ui/`)

- **Map mode.** "Generate terrain" freezes the centre, zoom and crop-frame width. The frame height
  comes from the board's proportions.
- **Edit mode.**
  - an SVG preview (`TerrainPreview.tsx`): layers in board mm with contours on top;
  - progress by stage, including "Downloading elevation tiles (k/N)";
  - Cancel, and Back to map (which also cancels);
  - the flat-area and clamped-sample warnings;
  - a missing-tile error that says so plainly, with Try again;
  - a banner if the board size changed after generation;
  - elevation, threshold and coverage details;
  - Terrain Tiles attribution.
- **Terrain controls.** Layer count (1–4), coverage for layers 2–4, contours on/off, contour density
  (3/5/8/12/18), and smoothing. Changing a setting reruns the pipeline on the tiles already
  downloaded, with no new downloads. Smoothing is page state and is not saved: the plan's domain
  model has no field for it.
- **Store.** `setTerrain` was added to the reducer; it is clamped by the existing validation.

### Tests

Seven new files; 1,192 tests in the full suite, all passing.

- `topoTerrainDecode.test.ts`:
  - hand-worked Terrarium fixtures, including below sea level, zero, and the extremes;
  - PNG filters 0–4 and every colour type;
  - refusal cases;
  - the real Rib Mountain tile (`tests/fixtures/terrain/`) matched against PIL's decode, with
    summit 586.18 m at pixel (120, 181).
- `topoTerrainTiles.test.ts`: zoom clamp, Mercator round trip and pole clamp, frame bounds,
  padding, antimeridian wrap, the pole edge, the tile budget, and working-grid sizing.
- `terrainTileProxy.test.ts`:
  - 19 path-traversal and out-of-range paths rejected;
  - cache miss then hit;
  - in-flight dedupe and the concurrency cap;
  - 403/404 as missing, then 502/504 and non-PNG;
  - cache write failure;
  - the route's headers, 400/405/HEAD;
  - disk-cache persistence across instances, and eviction.
- `contourLines.test.ts`:
  - open lines ending on the grid boundary, and closed loops;
  - mixed levels;
  - thresholds below sea level and at zero, and an all-zero field;
  - saddle topology matching the band tracer;
  - outside = −∞ rings;
  - the old error message preserved;
  - nested bands across negative, zero and positive thresholds;
  - Chaikin endpoints and open-path clipping.
- `topoTerrainPipeline.test.ts`:
  - smoothing, quantiles and contour spacing;
  - the **golden fixtures**, which are synthetic Terrarium tiles with known elevations. Each is
    pinned by fingerprint and checked for nesting by independent point-in-polygon:
    - **mountain** — four distinct nested bands, coverage within 2% of target, and two summits in
      the top band;
    - **coast** — sea polygon with an island: zero overlap with the water in every layer; the
      island kept as its own component; quantiles from the land only, including land below sea
      level;
    - **flat** — the warning, plus a valid one-layer result, and still valid with four layers;
  - a missing tile and an undecodable tile as explicit errors;
  - the download pool: cap, 404 → missing, timeout and cancel.
- `topoTerrainRunner.test.ts`: worker path (stages, supersede and cancel by terminate, stale-result
  drop, error code, timeout, crash) and the inline fallback matching `generateTerrain` exactly.
- `topoTerrainUi.test.tsx`: generate → preview; settings rerun with no new downloads; the flat
  warning; the missing-tile alert; Back to map cancelling a download in flight.

On real AWS tiles for a 9 in board, generation (4 layers, 8 contours) took 0.7–0.9 s per location
in Node. The locations were Rib Mountain WI, the San Francisco coast and central Illinois, and
coverage landed on target: 50.0 / 25.0 / 12.0%.

### Decisions and deviations to review

- **No water yet.** The UI passes no water polygons: vector water capture is Phase 3. So a coastal
  view currently layers the sea floor, because Terrarium includes bathymetry. The pipeline takes
  water as a parameter, and the coast golden shows masking works once Phase 3 supplies it.
- **SVG preview, not canvas.** The geometry is already vector. SVG scales without resampling, and
  the tests can inspect the layers. The plan allows "canvas/SVG preview".
- **The golden fixtures are synthetic.** Checking real-location tiles into the repository would be
  several MB per location. Instead, the real-data check is the Rib Mountain decode fixture plus the
  real-tile smoke run above.
- **Band thresholds are quantiles of the smoothed working grid**, restricted to land samples inside
  the board. Coverage is measured after shaping and clipping and reported beside the target.
- **Contour lines are not crossing-checked.** Unlike bands, simplification and smoothing could
  bring two very close centerlines into contact. For score lines that is cosmetic. The band
  pipeline's crossing fallback was not applied to them.

## Data attribution

- **Basemap:** © OpenStreetMap contributors, via OpenFreeMap. This is shown in the map pane.
- **Geocoding:** whichever provider answered (Nominatim, Photon or US Census). `PlaceSearch` names
  it, per the existing proxy.
- **Elevation:** Terrain Tiles, Mapzen / AWS Open Data Registry. This is shown in edit mode. The
  test fixture's provenance is in `tests/fixtures/terrain/README.md`. Export metadata comes with
  Phase 4.

## Next phase

Phase 3 — vector features and editing:
- capture roads, water and labels from the frozen view (generalizing the ornament's capture to a
  rectangle);
- feed water into `generateTerrain`;
- the dense-city golden fixture;
- the GPX-crossing-the-crop fixture.
