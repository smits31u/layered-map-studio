# Topographic map builder — implementation status

Tracks `docs/CLAUDE_TOPO_MAP_BUILD_PLAN.md` against this repository.

| Phase | State |
|---|---|
| 0 — assessment and decision log | complete: this document plus ADR 0004 |
| 1 — map / search / size / GPX | built and tested; **not wired into the running app** |
| 2 — terrain preview | built and tested; proxy **deployed** (image `c9c7c59a627c`); builder UI **not wired into the running app** |
| 3 — vector features and editing | built and tested; water masking verified on real data; bridges kept as tabs; compass not built (see below); builder **wired into the app for review** (nav button “Topo Map Builder →”, as the ornament's “Ornament Studio →”); **deployed for review** as image `099657b1cb45`; rollbacks `layered-map-studio:rollback-pre-road-thickness-review` (`ee53e18d30de`) and `layered-map-studio:rollback-pre-topo-phase3-review` (`c9c7c59a627c`) |
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
  *Fixed in Phase 3, and verified on real data; see below.*
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

## Phase 3 — built

Water came first, because it is the one thing Phase 2 left broken. Then roads, labels, the frame,
the title and the GPX route, and the overlay path that redraws them without touching terrain.

### Capture (`src/topo/capture/topoCapture.ts`)

"Generate terrain" now captures first, while the map is still on screen, because edit mode unmounts
it. The terrain view is frozen from the same map read as the features.

The ornament's capture steps are reused rather than restated:
- `waitForIdle`;
- `readViewport`, which refuses a rotated map;
- `extractCapturedFeatures`, which deep-copies coordinates and dedupes with the quantised keys in
  `dedupe.ts`;
- `assessCaptureCapacity`;
- the before/after viewport comparison;
- the check of the pure projection against `map.project`.

What differs is how layers are found. The topo map shows the full OpenFreeMap basemap, so capture
layers are discovered by source-layer from the live style:
- `water` fills;
- `transportation` lines;
- `place` and `poi` symbols.

A style with no water or road layer is refused with a message that names what is missing. Every road
class is captured whatever the detail setting; detail filters the stored capture, since the map is
gone in edit mode.

The query covers the crop frame only. It is a centred rectangle; the ornament queries its disk's
bounding square.

`src/ornament/capture/mapCapture.ts` gained one change: `sameViewport` is now exported.

### 1. Water capture and masking

- **`features/water.ts`.** Captured polygons are projected into board millimetres with
  `features/projection.ts`, which is the ornament's `createMapProjection` with the origin moved to
  the frame's corner. The projection is the same Mercator mapping the terrain resampler uses, so a
  shoreline and the elevation samples under it land on the same millimetre. The polygons then go
  through the ornament's water pipeline:
  - `buildWaterRegion` was split, so `buildWaterRegionWithin(water, clipRegion)` takes any clip
    region;
  - the ornament still passes its disk;
  - the topo builder passes the board rectangle.

  The ornament's output is unchanged: all its goldens pass untouched.
- **Pipeline.** `TerrainJob.capturedWater` is projected and unioned in the worker, in a new `water`
  stage. The region goes into the water-subtraction step Phase 2 already had, which had never been
  given real water. Layer 1 is the board minus water, layers 2–4 are clipped inside it, the
  quantiles come from land samples only, and contours are clipped to land. The result carries
  `water` and `waterMetrics`. Phase 2's pinned fingerprints are unchanged.
- **The page.** It passes the captured water on the first run and on every settings rerun. If there
  is no live map to capture from (no WebGL), terrain is still generated, with a warning banner that
  says sea and lake beds will be layered as land.

**Verified on a real coast, not a synthetic one** (`tests/unit/topoCoastWater.test.ts`). The fixture
is the Golden Gate at map zoom 12 on a 9 in board: the real capture, and the nine real Terrarium
tiles byte for byte (`tests/fixtures/topo/README.md`). The same capture and tiles are run both ways:

| | Before (no water, Phase 2 behaviour) | After (water captured) |
|---|---|---|
| Water on the board | none | 65.3% (strait and bay, ocean, Mountain Lake) |
| Layer 1 | 100% of the board, sea included | land only (34.7% of the board) |
| Lowest "land" | −114.0 m (the strait bed) | −4.4 m (shoreline samples blended by the resampler) |
| Layer thresholds (50/25/12%) | −19.2 / 35.6 / 112.8 m | 77.7 / 142.8 / 193.7 m |
| Contours | 8, from −66 m, including two across the sea bed | 8, from 32 m, none in water |
| Mid-strait and open-bay points | inside layer 1 | in water, in no layer |

The test asserts:
- zero overlap between every layer and the water;
- no contour vertex in water;
- Hawk Hill kept in the top layer;
- 4 ⊂ 3 ⊂ 2 ⊂ 1 nesting by independent point-in-polygon.

The same numbers came out of the real page in headless Chromium, with the real MapLibre, real
capture and real worker (see the fast-redraw measurements below).

### 2. Roads (`features/roads.ts`)

The ornament's `buildRoadEngraving`, whole. Its clip option now also accepts a function, and the topo
builder passes the board rectangle via `clipPolylineToRect`, which was added to the ornament's
`clipLine.ts` on the same walker as its disk and chord clips. The pipeline is:
- classes filtered by the same Low/Medium/High tiers;
- centrelines clipped to the board *before* buffering;
- buffered with round caps and joins to physical widths from the ornament's millimetre table, never
  style pixels;
- unioned, simplified and repaired.

The board's shorter side stands in for the ornament's diameter. So on a 9 in board a residential
street is 0.63 mm wide and a motorway 1.35 mm; the thickness scale multiplies that, with nothing
below the 0.25 mm engravable minimum.

The result is clipped to layer 1 plus its bridge tabs (below). Minimum-feature warnings:
- classes widened to the engravable minimum;
- gaps between roads too small to stand, which are filled;
- fragments dropped;
- roads that run out over water and stop (piers, boat launches), which are left off;
- bridge tabs narrower than the ornament's minimum neck width.

### 2a. Bridges (`features/bridges.ts`) — Ben's decision: keep them connected

Water is cut out of every layer, so a road across it had nothing under it, and the Golden Gate
Bridge vanished between its shores. Now a genuine crossing keeps a **tab of material across the
gap**. This is the same structural idea as the ornament's hanging-loop neck: a physically connected
strip of material across a cut-out region. How it works:

- **The tab's width.** It is the road's own physical width, from the mm table and including the
  thickness scale — 1.35 mm for the Golden Gate's motorway on a 9 in board. It is not a constant.
  The route's tab is the route's width.
- **Finding runs.** Each road centreline, and the route, is split where it crosses the terrain's
  water region — the same water cut from layer 1. A maximal stretch over water is a run.
- **What counts as a crossing.** A run's end is a *land exit* when the line carries on over land
  there, or when it is the line's endpoint and another road carries on over land from that same point
  (a bridge mapped as its own way).
  - Runs meeting at a point over water are one crossing, and so are runs that touch within 0.01 mm.
    A road decoded by two vector tiles overlaps itself in the tiles' buffer and shares no endpoint.
  - A group of runs with **two or more land exits** is a crossing, and gets tabs.
  - A group with at most one is a **dead end**: a pier, a boat launch, a road stopping at the shore,
    or a road that leaves the board over water. It gets no tab and is reported.
  - **Tunnels** (OpenMapTiles `brunnel=tunnel`, now recorded by the capture as `tunnelRoadKeys`) are
    never bridged.
- **Fabrication** (feature worker). Tabs are the crossing runs buffered with round ends, so they reach
  onto both shores. Roads, and the route, are clipped to *land ∪ tabs* instead of land. The layer
  result carries `bridgeTabs`: Phase 4 cuts layer 1 as the land plus these.
- **Preview.** Crossing runs are drawn over the water — the tab outlined like a layer edge, the road
  engraved on it — cached by capture, detail and water. Width follows the thickness control with no
  rebuild.
- **Structural check.** A road-width tab is far thinner than the ornament's 3 mm minimum neck
  (`hangingLoop.minNeckWidthMm`). The tab is kept at the road's width, as decided, and a warning
  names the narrowest tab and the longest span. **For Ben:** at 9 in, the Golden Gate's tabs are
  1.35 mm wide and span 61 mm of water, and its footpaths are 0.39 mm. Whether that holds in the
  chosen material is a test-cut question. A wider tab (say, a minimum under the road) is a one-line
  change if wanted.

On the real Golden Gate fixture (`tests/unit/topoBridges.test.ts`):
- **Detection.** Both motorway carriageways are found as crossings, 61 mm each at 1.35 mm, along with
  the bridge's footpaths. There are no false dead ends.
- **Connected roadway.** Every 0.5 mm along both carriageways is engraved road; before, mid-channel
  was not.
- **Connected material.** Layer 1 plus the tabs is one piece joining the Marin Headlands to the
  Presidio; without the tabs they are separate.
- **Roads lost over water.** The road area lost over water fell from 103.5 mm² to 1.5 mm², the
  remainder being shoreline slivers.

Also tested:
- a road dead-ending in the bay gets no tab and is reported;
- the same road continued to the far shore does get one;
- a crossing split at a tile seam is one crossing;
- a tunnel under the strait gets no tab;
- a road leaving the board over water gets no tab;
- a GPX route walked across the bridge keeps its tab, and one ending in the water does not.

### 3. Labels (`features/labels.ts`)

Place and POI labels, as `textPathData` glyph outlines with the position baked into the path. There
are no `<text>` elements and no transforms. Placement is in board millimetres, in priority order:
- places before POIs;
- places by class (city down to hamlet), then OpenMapTiles rank;
- POIs by rank.

A label is dropped when its padded box:
- leaves the board or the frame opening;
- overlaps a placed label or the title;
- lies over water;
- repeats a name already placed.

The drop counts are reported. State and country labels are excluded. Names prefer `name:latin`,
because the bundled fonts are Latin. Labels under 3 mm, the repository's minimum engraved letter
size (`MIN_LETTER_SIZE_MM`), get a warning. Road labels are not built.

### 4. Frame, title, GPX

- **Frame (`features/frame.ts`).** The plan's outer rectangle minus the inner one, written directly
  as a ring with a hole, since two rectangles need no boolean engine. A frame that would leave less
  than a quarter of the board is refused with a warning.
- **Title (`features/title.ts`).** `textPathData` in the chosen bundled font, sanitised the way the
  ornament's text is. By default it sits bottom centre inside the frame; dx/dy move it. It warns if
  the title leaves the board, or sits over water inside the frame opening. The frame band itself is
  allowed.
- **GPX route (`features/route.ts`).** This is the first time the Phase 1 route reaches the board.
  Segments are:
  - projected with the board projection;
  - thinned to 0.02 mm;
  - clipped to the board, so a route that leaves and re-enters becomes separate pieces, never a line
    across the gap;
  - buffered to the route width and clipped to land.

  A new route-width slider controls the width. A route that misses the board, or crosses water, is
  reported.

### 5. Fast overlay-only redraw

This follows the lake tool's split between its geometry cache and its presentation layer
(`geometryCache.ts` / `buildScene.ts`):
- **Terrain reruns only on `terrainRunKey`** (`src/topo/regeneration.ts`): the layer count,
  coverage, contours and smoothing. The page's rerun effect keys on it. Nothing else is in it.
- **Overlay parts are cached by what shapes them** (`features/overlay.ts`, `buildOverlay`). Each
  part has its own key:
  - `roadLines` — capture and detail;
  - `routeLines` — route and view;
  - `frame`;
  - `title`;
  - `labels`.

  Captures and terrain results are compared by identity, as `geometryCache` compares extracted
  features. `buildOverlay` returns which parts it rebuilt, so the tests check the trigger directly.
- **Presentation never rebuilds.** Enabled flags, road thickness and route width are presentation.
  The preview draws road and route centrelines stroked at their physical widths, through an SVG clip
  path of the land. So a thickness change is a stroke width, not a rebuild. The terrain half of the
  preview is a memoised component, so its large path strings are never re-rendered by an overlay
  change.
- **The buffered polygons are built off the main thread.** A new feature worker
  (`features/worker/`) builds the unioned, repaired, land-clipped road and route polygons, debounced
  by 150 ms, with one runner per kind. Export needs those polygons, and the warnings come from them.
  They are kept off the interaction path because they are slow: 425–535 ms for downtown San
  Francisco at High detail. Low and Medium take 40–90 ms.

Measured in the real page (headless Chromium on the VM, real Golden Gate capture, 4 layers, 8
contours), from the event to the painted frame:

| Control | ms |
|---|---|
| Roads off / on | 32 / 33 |
| Road thickness | 34 |
| Labels off / on | 33 / 33 |
| Label size | 33 |
| Frame on / thickness | 30 / 33 |
| Title text / size | 67 / 36 |
| Road detail Medium / High | 50 / 32 |

Terrain tile requests were 9 before these changes and 9 after. The terrain result's details line was
unchanged, meaning no terrain run.

One supporting change: `validRoute` now keeps an already-clean route's arrays. Every reducer action
re-clamps the project, and copying a 250,000-point route each time would make every toggle look like
a new route to the overlay cache.

### Tests

Three new test files and a fixture helper (`tests/helpers/topoFixtures.ts`). The full suite has
1,246 tests, all passing.

- **`topoCoastWater.test.ts`.** The real before/after above, plus the replay equalling the browser
  capture, and determinism.
- **`topoFeatures.test.ts`.**
  - Layer discovery on the real style, and refusal.
  - **Dense-city golden (real).** Replay equals the browser capture: 2,498 cross-layer duplicates
    removed, leaving 7,059 roads across four tiles. Tile-seam re-decodings are deduped, and a road
    moved a metre is kept. Detail tiers and physical widths are checked, and buffered roads are
    finite, on the board, grow with each tier, and have a pinned fingerprint. The minimum-feature
    warnings, label placement, and label glyph paths are all checked.
  - The Golden Gate deck is left off over the strait.
  - The title-over-water warning.
  - A GPX route crossing the board edge.
  - The frame.
  - The terrain run key under every overlay action.
  - The overlay cache's rebuilt parts and timings per control.
- **`topoFeaturesUi.test.tsx`.** Through the page, with the real downtown capture:
  - every overlay control changes the preview synchronously, inside its event;
  - the terrain worker ran once and no tile was downloaded again;
  - a terrain setting does rerun terrain, with the same captured water;
  - with no map, the loud warning appears.
- **`topoTerrainUi.test.tsx`.** Now waits for capture before edit mode opens.

### Decisions and deviations to review

- **Bridges are kept as road-width tabs (Ben's decision)**; see 2a. Open question: tab width versus
  the ornament's 3 mm neck minimum.
- **The preview strokes centrelines rather than drawing the buffered polygons.** The shapes are the
  same (physical width, round caps and joins, clipped to land). Only the gap filling and the fragment
  dropping of the buffer are not shown. This keeps size controls under 100 ms at High detail
  downtown. The plan notes the reference tool made the same split between preview and export.
- **All road classes are captured; detail filters the capture.** The map is gone in edit mode. The
  ornament queries per detail tier instead, because its map stays.
- **Road width scale.** The ornament's table, with the board's shorter side as its "diameter".
- **Road thickness control (Ben's decision: user-adjustable).** This is the plan's
  `roads.thicknessScale`: a multiplier on the physical width table, and the "Road thickness" slider
  in the Roads section. It is **clamped to 0.5×–3×** in 0.05 steps; it was 0.25×–4× before this
  change.
  - **1× is the table exactly.** The dense-city road golden is unchanged at 1×, and so are the
    Golden Gate's tabs.
  - **Bridge tabs follow it.** They are their road's width, so the slider is also how sturdy the
    bridges are, per project.
  - **Why 0.5×.** Below it, residential and service roads join the paths at the 0.25 mm engraving
    floor. Every class below tertiary then becomes one width, and the control only thins major roads
    and bridge tabs.
  - **Why 3×.** At 3× on a 9 in board, motorway tabs are 4.05 mm and primary-road tabs 3.15 mm, both
    past the ornament's 3 mm neck minimum — the structural reason to raise it. Residential streets
    are then 1.9 mm, and High-detail footpaths (1.2 mm) already merge into the streets beside them,
    so past 3× a dense board fills in.
  - **Old projects.** A project saved under the old range is clamped on load.
  - **Terrain.** Neither the terrain key nor any cached overlay part changes: the preview's roads and
    bridges take the width as a stroke, and the feature worker rebuilds the buffered roads and tabs.
    This is tested in `topoRoadThickness.test.ts`.
- **Labels.** One size for all labels (the plan's model has one). **Points of interest have their
  own toggle, off by default (Ben's decision)**; place names stay on. `labels.poiEnabled` was added to
  the domain model. A project saved before it existed opens with POIs off, and `schemaVersion`
  stays 1. The toggles decide which labels are placed, so turning place names off frees their space
  for POIs; either toggle rebuilds the labels, which takes about 10 ms in the browser.
- **Labels, title and frame are overlay parts.** A frame toggle rebuilds the labels and the title,
  because they avoid the frame; that takes ~30 ms.
- **Capacity limits are the ornament's.** They are per rendered map pixel, and the topo frame is a
  similar few hundred pixels.
- **Real fixtures add 1.3 MB to the repository**: nine terrain tiles (0.9 MB) and two gzipped
  capture recordings. They are reproducible with `tests/fixtures/topo/record/`, which runs the app's
  own capture code in headless Chromium. Re-running it reproduced both exactly.
- **The feature runner is a third sibling** of the ornament's geometry runner and the terrain runner,
  like the terrain runner before it. Folding the three into one generic runner is still a mechanical
  follow-up.

### Not done in this phase

- **The compass.** The plan's Phase 3 step 4 lists it; this run's brief did not, and it was
  prioritised last. The domain model has compass settings; there is no geometry or UI yet. The lake
  tool's `src/geometry/scene/compass.ts` is the obvious basis.
- **Road-name labels along roads.** Deferred by instruction.
- **Waterways drawn as lines.** Streams mapped only as lines are not captured. Rivers and lakes
  mapped as areas are.
- **Contour lines are still not crossing-checked** (a Phase 2 note).
- **Playwright** is still not set up. Real-browser checks were run ad hoc in headless Chromium.

## Data attribution

- **Basemap:** © OpenStreetMap contributors, via OpenFreeMap. This is shown in the map pane.
- **Geocoding:** whichever provider answered (Nominatim, Photon or US Census). `PlaceSearch` names
  it, per the existing proxy.
- **Elevation:** Terrain Tiles, Mapzen / AWS Open Data Registry. This is shown in edit mode. The
  test fixture's provenance is in `tests/fixtures/terrain/README.md`. Export metadata comes with
  Phase 4.
- **Real topo fixtures:** © OpenStreetMap contributors via OpenFreeMap, and Terrain Tiles, recorded
  2026-09-25. Provenance and attribution are in `tests/fixtures/topo/README.md`.

## Next phase

Phase 4 — laser-ready SVG:
- the deterministic SVG assembler with the plan's semantic groups (`cut/frame`, `cut/terrain-1…4`,
  `cut/water`, `cut/roads`, `score/contours`, `score/route`, `engrave/labels`, `engrave/title`,
  `engrave/compass`), built from the buffered road and route polygons the feature worker already
  produces, the label and title glyph paths, and the frame;
- cutting layer 1 as the land plus the bridge tabs, and the tab-width question in 2a;
- preflight, including minimum feature width (the ornament's `thinFeatures` is the basis);
- the compass, if it is still wanted before Phase 4 closes.
