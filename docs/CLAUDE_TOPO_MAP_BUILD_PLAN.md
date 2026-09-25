# Local Topographic Laser-Map Builder — implementation plan for Claude

## Mission

Build a local-first web app that lets one user:

1. search for a place or pan/zoom a map;
2. choose the finished physical size;
3. optionally load a GPX route;
4. turn the visible map into 1–4 elevation layers with water cut-outs, roads, labels, contours, a frame, compass, and title;
5. preview the result; and
6. download a laser-ready SVG whose coordinates are expressed in millimetres.

This is a clean-room reimplementation of observed behavior. Do not copy DuperCut branding, artwork, CSS, source code, analytics, Shopify shell, or proprietary visual assets. Use original UI styling and independently implemented geometry.

## What was verified on the reference tool

The reference is a browser-only generator embedded in Shopify. Its relevant implementation is separable from Shopify:

- Interactive viewport: MapLibre GL JS.
- Basemap/vector features: OpenFreeMap (OpenStreetMap-derived vector tiles and style).
- Address search: public Nominatim forward search.
- Elevation: Mapzen/AWS Terrain Tiles in Terrarium PNG encoding.
- Raster-to-vector geometry: Clipper-style polygon union/offset operations.
- Text-to-path export: opentype.js with remotely loaded TTF fonts.
- GPX: local browser parsing of `trkpt`, then `rtept`, then `wpt` coordinates.
- Output: a client-generated SVG downloaded through a Blob URL.

Observed workflow:

`map/search -> generate terrain -> edit layers/details -> download SVG`

Observed initial settings:

- 9 × 9 in, with inch/mm toggle; reference bounds are 2–24 in or 50–600 mm.
- Zoom 14, adjustable from 6–18 in 0.5 increments.
- High road detail, roads and place labels on.
- One terrain layer initially; optional layers 2–4 use default coverage targets 50%, 25%, and 12%.
- Contours on at “Normal”; five densities correspond to approximately 3, 5, 8, 12, and 18 contour thresholds.
- GPX line width 0.6 mm, adjustable from 0.2–2.5 mm.
- Optional frame, compass corner/size/merge behavior, title/font/size/position.
- The generated editor warns when elevation range is below roughly 30 m.

The reference preview is a high-resolution canvas composite, while final export independently reconstructs vector paths in physical millimetres. This separation is worth preserving.

## Recommended build

Use a small TypeScript monorepo with Node 22+ and npm workspaces:

- `apps/web`: Vite, React, TypeScript, MapLibre GL JS, Zustand (or a small reducer), opentype.js.
- `apps/server`: Fastify or Express, used only as a same-origin proxy/cache for geocoding and terrain tiles.
- `packages/geometry`: pure TypeScript projection, contour, clipping, offset, simplification, and SVG assembly.
- `packages/domain`: shared types, defaults, validation, and units.
- Tests: Vitest for unit/property tests and Playwright for end-to-end tests.

Use current stable package releases, pinned by the lockfile. MapLibre 6 uses ESM and, with Vite, its worker should be bundled using the documented `?worker&url` setup.

Suggested dependencies:

- `maplibre-gl`
- `zustand`
- `opentype.js`
- `fast-xml-parser` (or `DOMParser` in the browser with strict validation)
- `polygon-clipping` or `clipper-lib`/Clipper2 WASM for robust Boolean operations
- `simplify-js` only if the in-house Douglas–Peucker implementation is not adequate
- `zod`
- `fastify` plus a small LRU/disk cache
- `vitest`, `fast-check`, and `@playwright/test`

Do not add a database, authentication, telemetry, ecommerce integration, or cloud deployment in the personal MVP.

## Repository shape

```text
topo-map-builder/
  apps/
    web/
      src/
        components/
        features/map/
        features/settings/
        features/preview/
        features/export/
        state/
        styles/
    server/
      src/
        routes/geocode.ts
        routes/terrain.ts
        cache.ts
  packages/
    domain/src/
      model.ts
      defaults.ts
      units.ts
      validation.ts
    geometry/src/
      mercator.ts
      terrarium.ts
      grid.ts
      contours.ts
      bands.ts
      vector-features.ts
      clipping.ts
      text-paths.ts
      svg-document.ts
  test-fixtures/
    gpx/
    terrain/
    vector-features/
  docs/
    data-attribution.md
    architecture.md
```

## Domain model

Create a serializable `ProjectState` and keep the live MapLibre instance outside it.

```ts
type Unit = 'mm' | 'in';
type Detail = 'low' | 'medium' | 'high';
type CompassPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'off';

interface ProjectState {
  viewport: { center: [number, number]; zoom: number; bearing: 0; pitch: 0 };
  output: { widthMm: number; heightMm: number };
  terrain: {
    layerCount: 1 | 2 | 3 | 4;
    coveragePercent: [100, number, number, number];
    contoursEnabled: boolean;
    contourCount: 3 | 5 | 8 | 12 | 18;
  };
  roads: { enabled: boolean; detail: Detail; thicknessScale: number };
  labels: { enabled: boolean; sizeMm: number };
  route: { coordinates: [number, number][]; widthMm: number } | null;
  frame: { enabled: boolean; thicknessMm: number };
  compass: { position: CompassPosition; sizeMm: number; mergeWithTerrain: boolean };
  title: { text: string; fontId: string; sizeMm: number; dxMm: number; dyMm: number };
}
```

Store all physical dimensions internally in mm. The unit toggle only changes display and adjustment increments. Persist projects to localStorage with a schema version and expose “Save project JSON” / “Load project JSON” after the MVP is stable.

## Data and geometry pipeline

### 1. Map and feature capture

- Initialize MapLibre with an OpenFreeMap style and explicit OpenStreetMap/OpenFreeMap attribution.
- Keep the viewport at bearing 0 and pitch 0 for the first release; this makes screen-to-output projection deterministic.
- At generation time, freeze center, zoom, geographic bounds, CSS canvas size, and output size.
- Query only rendered features needed for output:
  - roads from `transportation` line layers;
  - water from `water` polygon and `waterway` line layers;
  - labels from place/POI/transportation-name symbol layers.
- Deduplicate features by a stable combination of source, source-layer, feature id, class/name, and normalized geometry hash. `queryRenderedFeatures` can return duplicates across style layers and tile boundaries.
- Convert longitude/latitude into frozen viewport pixels using the MapLibre projection, then pixels into millimetres using independent X/Y scale factors.
- Clip every geometry to the finished board rectangle before export.

### 2. Geocoding

- Implement `/api/geocode?q=...` on the local server.
- Enforce a one-request-per-second limiter, a descriptive application User-Agent, attribution, a short timeout, and a cache.
- Search only on submit; do not implement keystroke autocomplete against public Nominatim.
- Return a small normalized result object and allow the user to choose among the top 5 matches. This is an improvement over the reference tool’s first-result-only behavior.
- Keep the provider behind an interface so self-hosted Nominatim, Photon, or a paid provider can replace it.

### 3. Terrain acquisition

- Compute XYZ tile coverage for the frozen viewport at `clamp(floor(mapZoom), 5, 14)`.
- Add a one-tile padding ring to avoid edge artifacts.
- Request Terrarium PNG tiles through `/api/terrain/:z/:x/:y.png`; cache successful responses on disk and cap concurrency (start at 6).
- Mosaic the 256×256 tiles, crop precisely to the frozen geographic bounds, and resample to a working grid.
- Start with a width near 900 samples for the default 9-inch square, scaling modestly with output perimeter; enforce a pixel budget so a 600 mm board cannot exhaust memory.
- Decode each RGB pixel using `elevation_m = R * 256 + G + B / 256 - 32768`.
- Treat missing tiles as an explicit error, not silently as sea level. Clamp clearly invalid values only after recording a warning.
- Smooth with a separable Gaussian/box filter whose radius is configurable and covered by tests.

### 4. Terrain bands and contours

- Sort valid elevation samples once.
- Convert the user’s coverage percentages into quantile thresholds. The base layer covers the entire land area; higher layers represent elevations at or above their threshold.
- Generate polygons from binary masks. For MVP parity, run-length rectangles plus polygon union is acceptable. Preferred quality path: marching squares -> ring chaining -> simplification -> polygon repair/union.
- Subtract water polygons from every terrain layer.
- Ensure nested layer invariants: layer 4 must be geometrically contained by layer 3, then 2, then 1.
- Create optional contour centerlines with marching squares at evenly spaced elevation values. Resolve ambiguous cases 5/10 consistently (asymptotic decider preferred), chain segments, smooth lightly, simplify, and clip.
- Display a “very flat area” warning when the elevation range is under 30 m and still allow export.

### 5. Roads, water, route, labels, title, frame, compass

- Roads: filter classes by detail level; convert lines to filled cut/engrave geometry using a robust line offset/buffer in mm. Define a documented width table rather than relying on style pixel widths.
- Water: union polygonal water and buffered waterways, then subtract from terrain. Handle holes and MultiPolygons.
- GPX: parse tracks first, then routes, then waypoints; reject invalid XML, non-finite coordinates, fewer than two points, and over-large files. Offer “fit route,” replace, and clear.
- Labels: dedupe and collision-filter in output coordinates. Convert glyphs to paths with opentype.js for portable SVGs. Add a toggle to export labels as engraving paths or omit them from cut geometry.
- Title: use bundled, redistributable fonts; convert glyphs to paths. Avoid remote “latest” font URLs in a reproducible local build.
- Frame: build as the Boolean difference between outer and inner board rectangles.
- Compass: draw an original compass asset created for this project. “Separate” emits engraving/cut geometry as its own group; “merged” unions/subtracts it according to the chosen fabrication model.

### 6. SVG contract

Produce an SVG with:

- `width="...mm"`, `height="...mm"`, and `viewBox="0 0 widthMm heightMm"`;
- deterministic group order and stable numeric rounding (3 decimals is sufficient);
- no transforms left unresolved in geometry groups;
- closed paths for cut regions and open paths only for score/engrave lines;
- explicit `fill-rule="evenodd"` where holes exist;
- metadata containing app version, viewport, elevation source, generation timestamp, and settings;
- a small legend outside the board only when the user explicitly enables it.

Recommended semantic groups:

```text
cut/frame
cut/terrain-1
cut/terrain-2
cut/terrain-3
cut/terrain-4
cut/water
cut/roads
score/contours
score/route
engrave/labels
engrave/title
engrave/compass
```

Do not depend only on stroke color to define fabrication intent. Give groups stable IDs and also provide an optional LightBurn-oriented color preset.

## UI plan

Create an original two-pane desktop layout and a single-column mobile layout.

### Map mode

- Search field and results list.
- Map with pan/zoom and an output-aspect-ratio crop frame.
- Zoom, physical width/height, unit toggle, and GPX controls.
- Primary “Generate terrain” action.

### Edit mode

- Live canvas/SVG preview on the right.
- Terrain layer count and coverage controls.
- Contour, road, label, route, frame, compass, and title sections on the left.
- “Back to map,” “Reset,” and “Download SVG.”
- Dirty-state banner when the viewport changed after generation.
- Progress states for tile download, decode, contours, geometry cleanup, and SVG assembly.

Use accessible labels, keyboard-operable segmented controls, visible focus, sufficient contrast, and meaningful progress/error announcements. Do not reproduce the reference site’s header/footer or visual brand.

## Implementation phases for Claude

### Phase 0 — scaffold and decision log

1. Create the workspace, strict TypeScript config, lint/format scripts, Vitest, and Playwright.
2. Add `docs/architecture.md`, `docs/data-attribution.md`, and an ADR choosing the polygon engine.
3. Add a minimal server health route and a Vite proxy.

Exit criteria: `npm ci`, `npm run typecheck`, `npm test`, and `npm run build` all work from a clean clone.

### Phase 1 — map/search/size/GPX

1. Render MapLibre and a visible board crop frame.
2. Add serializable state, unit conversion, dimension validation, and zoom synchronization.
3. Implement the rate-limited/cached geocoder proxy and result selection.
4. Implement GPX parsing, fit-to-route, replace, clear, and route preview.

Exit criteria: a user can select a place, set a board size, pan/zoom, load a GPX, reload the app, and recover non-file state.

### Phase 2 — terrain preview

1. Implement XYZ coverage and Terrarium decode with fixture-based tests.
2. Add tile fetch concurrency, cache, cancellation, timeout, and error reporting.
3. Build the mosaic/crop/resample/smoothing pipeline in a Web Worker.
4. Add quantile bands, water masking, and canvas preview.
5. Add contours using marching squares.

Exit criteria: three fixed test locations (mountainous, coastal, flat) generate deterministic previews without freezing the UI.

### Phase 3 — vector features and editing

1. Capture/dedupe/clip roads, water, and labels from the frozen MapLibre viewport.
2. Buffer roads/waterways in physical units.
3. Add all edit controls and a fast overlay-only redraw path.
4. Add frame, original compass, title, text path conversion, and GPX output.

Exit criteria: toggles and size controls update preview in under 100 ms when terrain does not need recomputation.

### Phase 4 — laser-ready SVG

1. Create the deterministic SVG assembler and semantic group IDs.
2. Repair/self-intersection-check polygons and enforce nesting.
3. Add a preflight panel: open paths, self-intersections, tiny islands, minimum feature width, board dimensions, missing attribution/metadata.
4. Download SVG and project JSON.

Exit criteria: SVG opens correctly in Chrome, Inkscape, and LightBurn; reported dimensions match within 0.1 mm; paths do not contain NaN/Infinity; a round-trip XML parse succeeds.

### Phase 5 — hardening

1. Add cancellation and stale-result protection when settings/viewport change mid-generation.
2. Add memory/pixel/tile/GPX point limits.
3. Add offline-friendly font bundling and optional cached tiles.
4. Run desktop/mobile/accessibility tests and document provider replacement/self-hosting.

Exit criteria: the full acceptance suite below passes and error states are actionable.

## Acceptance suite

### Unit/property tests

- Inch/mm conversions round-trip within tolerance.
- Longitude/latitude <-> tile math handles antimeridian and Web Mercator latitude limits.
- Terrarium RGB fixtures decode to expected elevations.
- Quantile thresholds are monotonic; higher terrain bands are subsets of lower bands.
- Marching-squares cases 0–15 have expected segment topology.
- Polygon Boolean operations preserve holes and never emit NaN/Infinity.
- SVG output is deterministic for fixed inputs.
- GPX track/route/waypoint fallback and invalid-file cases.

### Golden fixtures

- Mountain: broad elevation range and four distinct nested bands.
- Coast: water cut-outs and islands/holes.
- Flat land: warning and valid one-layer export.
- Dense city: road filtering, dedupe, labels, and minimum-feature warnings.
- GPX route crossing the crop boundary.

### End-to-end

- Search -> select -> generate -> edit -> download.
- Pan after generation produces dirty-state warning.
- Back to map -> regenerate uses new frozen viewport.
- Cancellation prevents an old worker result overwriting new state.
- Responsive layout at 390 × 844 and 1440 × 900.
- Keyboard-only completion of the primary workflow.

## Known risks and mitigations

- **Public geocoder policy:** public Nominatim is limited to 1 request/second, requires identification and attribution, and forbids client-side autocomplete. Proxy, cache, rate-limit, search-on-submit, and make the provider swappable.
- **Data-provider availability:** OpenFreeMap currently offers a public instance without API keys or request limits, but local personal use should still cache responsibly and retain a self-host configuration path.
- **Elevation licensing/attribution:** include Mapzen/AWS Terrain Tiles attribution and record access date/provider in documentation and SVG metadata.
- **Map data licensing:** include OpenStreetMap attribution in the UI and exported project metadata; review ODbL obligations before distributing derived datasets.
- **Browser CORS/canvas taint:** proxy terrain tiles and fonts through localhost or bundle fonts. Never let a failed cross-origin image silently poison the export canvas.
- **Geometry explosion:** use a worker, pixel budget, simplification tolerance in physical units, minimum island/feature filters, and cancellation.
- **Tile seams/duplicates:** pad terrain fetches and dedupe vector features before buffering/union.
- **Fabrication semantics:** “looks good on screen” is insufficient. Preflight closed paths, feature widths, dimensions, nesting, and cut/score/engrave grouping.
- **Upstream style changes:** do not hard-code only style-layer IDs. Discover by `source-layer`, validate expected layers on load, and surface a clear compatibility error.

## Non-goals for the MVP

- Exact pixel-for-pixel duplication of the reference UI.
- Copying its compass, fonts-by-remote-latest behavior, CSS, or SVG structure.
- 3D/STL export, print ordering, nesting multiple products, ecommerce, accounts, analytics, or collaboration.
- Fully offline global map/elevation data. Provider self-hosting can be a later deployment profile.

## Claude execution rules

Claude should implement in vertical slices and leave the repository runnable after every phase.

1. Before coding, inspect the existing repository and preserve unrelated user changes.
2. Create/update a short checklist in `docs/implementation-status.md`.
3. For every phase, first add the smallest representative fixture and failing test, then implementation, then UI integration.
4. Do not paste or vendor DuperCut source/assets. Reimplement the behavior from this specification.
5. Do not call public services in unit tests. Record small legal test fixtures with attribution, or synthesize them.
6. Keep geometry functions pure and independent of React/MapLibre.
7. Use Web Workers for terrain/contour/vectorization work and support cancellation.
8. Run typecheck, unit tests, build, and relevant Playwright tests before marking a phase complete.
9. If a provider, license, or geometry choice is uncertain, write an ADR and choose the reversible option.
10. Stop only on a concrete blocker that changes product scope; otherwise make conservative defaults and continue.

## Copy/paste kickoff prompt for Claude

```text
Implement the local Topographic Laser-Map Builder described in CLAUDE_TOPO_MAP_BUILD_PLAN.md.

Start by inspecting the repository and reporting any conflicting existing structure. Then execute Phase 0 and Phase 1 completely. Keep the design original; do not copy DuperCut code, CSS, branding, or assets. Use strict TypeScript, pure geometry/domain modules, and tests. Maintain docs/implementation-status.md as you work.

At the end of the run, provide:
1. completed checklist items;
2. files added/changed;
3. exact commands and results for typecheck/tests/build;
4. any unresolved risks or decisions;
5. the next concrete phase.

Do not merely describe code—create it, run it, and fix failures until Phase 0 and Phase 1 acceptance criteria pass.
```

## Reference links for implementation decisions

- MapLibre GL JS: https://maplibre.org/maplibre-gl-js/docs/
- OpenFreeMap: https://openfreemap.org/
- Nominatim usage policy: https://operations.osmfoundation.org/policies/nominatim/
- Nominatim search API: https://nominatim.org/release-docs/develop/api/Search/
- AWS Open Data Terrain Tiles: https://registry.opendata.aws/terrain-tiles/

