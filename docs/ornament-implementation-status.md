# Ornament generator — implementation status

Tracks `CLAUDE_MAP_ORNAMENT_BUILD_PLAN.md` against what exists in this repository.

| Phase | State |
|-------|-------|
| 0 — shared scaffold and decisions | complete |
| 1 — original ornament editor shell | complete |
| 2 — map and search | complete |
| 3 — feature geometry | complete |
| 4 — SVG export and preflight | not started |
| 5 — hardening | not started |

## Repository shape — deliberate departure from the plan

The plan's §Repository shape describes an npm-workspaces monorepo (`apps/web`, `apps/server`,
`packages/domain`, `packages/map-core`, `packages/geometry`, `packages/svg-export`) and its Phase 0
says to "reuse shared map/domain/geometry/SVG packages when present".

**No such workspace exists.** `layered-map-studio` is a single flat Vite package. The ornament code
therefore lives beside the lake tool under `src/ornament/` rather than in `packages/*`.


Converting the repository to workspaces was rejected for now: it would touch every import in a
shipped, deployed, Docker-built application in service of a directory layout, while the plan's own
execution rules require preserving existing work and keeping the app runnable after every phase.
The sharing the plan actually cares about is already happening — the ornament imports the lake
tool's font registry, text vectorizer, polygon helpers and SVG path serializer directly.

Phase 1 predicted that a server package for the geocoder proxy would be the trigger to revisit this.
Phase 2 built that server and the prediction did not hold. The server-side code is small, has no
dependencies the web app does not already have, and is consumed from exactly two places — the Vite
dev middleware and `server/index.ts`. It lives in `src/server/geocode/` with a rule stated at the
top of `types.ts`: nothing under `src/server/**` may import React, MapLibre or anything DOM-only.
A workspace boundary would enforce that rule mechanically; a comment and a code review do not. That
is the whole of what is being given up, and it is not yet worth rewriting every import to buy.
## What is reused rather than rebuilt

| Need | Source | Notes |
|------|--------|-------|
| Text → outlines | `src/text/textVector.ts` | Extended with optional `letterSpacingMm`; zero spacing takes the original code path unchanged |
| Bundled fonts | `src/text/fontRegistry.ts` | Verbatim. See ADR 0002 |
| Polygon booleans | `polygon-clipping` via `src/geometry/shoreline/polygonEngine.ts` types | `MultiPolygonMm`/`RingMm` shared so both tools speak one geometry vocabulary |
| Path offsets | `clipper-lib` | New generalised wrapper, see ADR 0001 |
| SVG path serialisation | `geometryPath()` from `polygonEngine.ts` | Verbatim |
| Unit conversion | `src/utils/units.ts` | `inchesToMm`/`mmToInches` |
| Geocoding | `src/map/geocoding/GeocoderService.ts` | Rewritten in Phase 2 as a client for `/api/geocode`; provider code moved to `src/server/geocode/adapters/`. See ADR 0003 |
| ZIP packaging | `src/export/svg/exportSvg.ts` | Untouched — Phase 4 |

## Phase 0 — complete

- [x] Inspected the repository; determined the monorepo does not exist (see above)
- [x] Reused shared text/geometry/SVG code rather than duplicating it
- [x] ADR for the polygon/buffer engine — `docs/adr/0001-polygon-and-buffer-engine.md`
- [x] ADR for font licensing — `docs/adr/0002-font-licensing-and-bundling.md`
- [x] This status document
- [x] Exit criteria: typecheck, tests and production build pass

Strict TypeScript was already configured repo-wide; no change was needed.

## Phase 1 — complete

- [x] `OrnamentProject` (`src/ornament/types.ts`), defaults, validation/clamping, reducer, unit
      conversion, reset, local persistence
- [x] Parameterised disk, rim, text band and hanging loop as SVG, built from booleans
- [x] Three text lines using the existing bundled-font vectorizer, with fit/overflow warnings and a
      "fit text" action
- [x] Classic/three-piece mode selection with an explanatory stack diagram
- [x] Exit criteria: ornament and personalisation work with no map; reset restores every displayed
      and stored value

### Departures from the plan's domain model

- `hangingLoop.minNeckWidthMm` added. The plan's TypeScript block omits it while its prose requires
  the loop be sized "from minimum material width, not a magic fraction" and be "connected by at
  least the configured minimum neck width". Configured means stored.
- `displayUnit` added. The plan declares `type Unit = 'mm' | 'in'` and never uses it, but Phase 1
  calls for unit conversion and the UI plan calls for a unit display.
- `TextLine.fontId` is the existing `FontId` union, not `string` — see ADR 0002.
- `diameterMm` is validated to 25–300mm. The plan records the reference tool as accepting 1–30 in
  its UI while clamping to 1–12in / 25–300mm internally, and asks for "one consistent validated
  range"; mm is the stored unit, so the mm range wins.

### Ornament proportions

Original, not derived from the reference tool: 101.6mm diameter, 6mm rim, 16/8mm loop with 3mm
overlap and a 3mm minimum neck, map/text boundary at y=+14mm. At these values the loop joins the
body over 11.90mm with 4mm of loop material, and the text band is 30.8mm tall.

## Phase 2 — complete

- [x] MapLibre with a minimal original road/water style (`src/ornament/map/style.ts`): neutral land
      background, water fill, and one road line layer per detail tier. No labels, buildings, landuse
      or boundaries — the style is also the query filter Phase 3 will capture through.
- [x] Policy-compliant geocoder proxy at `/api/geocode?q=...` (`src/server/geocode/`), result
      chooser, map fitting from a result's bounding box, and provider attribution in the UI.
- [x] Frozen bearing/pitch, zoom 7–19 in 0.5 steps defaulting to 14, road-detail control,
      circular/text-band crop mask, and marker modes.
- [x] Dirty-state tracking and export-disabled conditions (`src/ornament/snapshot.ts`).
- [x] Exit criteria: search, choose a result, pan/zoom, switch detail and place the marker with
      preview and state in step — driven end to end in `tests/unit/ornamentMapUi.test.tsx`.

### The geocoder proxy

| Requirement (plan §Geocoding plan) | Where |
|---|---|
| `/api/geocode?q=...` on localhost | `server/index.ts` in production, a Vite plugin in dev — both mount the same handler |
| Search on explicit submit only | `PlaceSearch.tsx` is a form; no autocomplete, no debounce, no search-as-you-type |
| Descriptive server-side User-Agent | `buildUserAgent()`; `GEOCODER_CONTACT` supplies the contact and the header says so when it is unset |
| One request per second for public Nominatim | `createRateLimiter(1000)`, one queue per provider, asserted against a virtual clock |
| Cache responses | `createLruCache`, bounded and expiring — see the note on query history below |
| Up to five normalized candidates | `MAX_RESULTS`; id, label, coordinates, bounding box, provider attribution |
| Providers behind adapters | `adapters/{nominatim,photon,census}.ts`; a self-hosted instance is a constructor argument |
| No automatic fallback | The handler calls exactly one provider. A miss offers the others as buttons |
| No stored address history | The server cache is bounded and expires; the browser is sent `Cache-Control: no-store`; nothing is persisted to the project |

Scope decision (retrofit the existing `GeocoderService` rather than build ornament-only) and its
consequences: `docs/adr/0003-geocoder-proxy-and-map-runtime.md`.

### The crop mask is the Phase 1 geometry

`mapWindowLayout()` clips the map with `buildOrnamentGeometry(...).mapOpening` — the same
MultiPolygon subtracted from the frame — rather than re-deriving a circle and a chord. The map
element is the square circumscribing the inner opening, centred on the ornament centre, so the
plan's export scale rule (`diameterMm / renderedMapDiameterPx`) is one division.
`tests/unit/ornamentCropMask.test.ts` asserts the serialized crop is byte-identical to the frame's
own opening, so replacing it with a lookalike fails.

### Circle and chord line clipping

`src/ornament/geometry/clipLine.ts` implements the analytic clip the plan permits, and
`tests/unit/ornamentClipLine.test.ts` covers the cases it names as the reason to be careful:
tangents, endpoints exactly on the circle, polylines that leave and re-enter (two and three times),
zero-length lines, repeated vertices, lines lying along the chord, non-finite coordinates and
non-positive radii. Pieces shorter than `MIN_PIECE_LENGTH_MM` are dropped, because a zero-length
piece offset with round caps engraves as a dot.

Phase 3 consumes this for real captured features; it exists now because the crop mask and the
clipper have to describe the same region, and a test is the only thing that keeps them agreeing.

### Marker artwork

Reuses `src/geometry/scene/markerRegistry.ts` — this repository's own parameterised heart, pin and
house, written for the lake tool, not traced from the reference generator. What Phase 2 adds is the
part the lake tool never needed: an anchor (a pin's tip sits on the coordinate, a heart and a house
centre on it) and a conservative path bounding box, so the fit check can warn when a symbol would
overhang the rim or the text chord. It warns; it never moves the marker.

The marker goes to the selected place's coordinate and stays there when the map pans. Moving it is
two explicit actions: "Move marker to map centre" and "Return marker to selected place".

### Departures and judgment calls

- **`viewport.selectedPlaceCenter` added.** The plan's domain model declares only
  `selectedPlaceLabel`, while its prose needs the coordinate for both "not automatically at the
  current map center after panning" and "return to selected place". Optional, so older persisted
  projects still load.
- **Scroll-zoom settles onto the nearest half step.** The plan asks for the zoom control to move in
  0.5 increments and Phase 1 already snapped the stored value. Rather than letting the map hold a
  zoom the control cannot display, the map is corrected to the snapped value when a gesture ends.
  The correction is at most 0.25.
- **The map element is registered to the ornament centre, not the map-window centroid.** The window
  is the disk above the chord, so its centroid is above centre; centring the map there would make
  the projection an offset rather than a division, for no gain.
- **`vite.config.js` and `vite.config.d.ts` deleted.** They were committed `tsc -b` emit artifacts,
  and Vite resolves `vite.config.js` *before* `vite.config.ts` — so the geocode dev middleware
  added to the `.ts` file would have been silently ignored. `tsconfig.node.json` now emits to
  `node_modules/.tmp/` instead of the repository root.

### Not done in Phase 2, deliberately

- **Marker dragging.** The plan's preview pane lists a draggable marker; Phase 2's own task list
  does not, and the two actions above cover placing it. Carried to a later phase.
- **Feature capture.** "Capture map geometry" records which viewport a capture belongs to and is
  what the dirty check compares against. Extracting and deduplicating the features themselves is
  Phase 3, and the button says so.
- **Playwright.** Still not set up. The exit criteria are covered by jsdom component tests, which
  can drive everything except the map's own pan and zoom gestures — those need WebGL. The map's
  reporting path (`moveend` → store) is the same path the zoom control uses and is covered.
- **`fast-check`.** Still not set up; swept loops over fixed ranges stand in.

## Phase 3 — complete

- [x] `src/ornament/capture/mapCapture.ts` snapshots rendered road and water features from the
      MapLibre style Phase 2 defined, keyed to the viewport the capture belongs to.
- [x] `src/ornament/capture/dedupe.ts` deduplicates features captured across tiles/layers before
      geometry work runs (`tests/unit/ornamentFeatureDedupe.test.ts`).
- [x] `src/ornament/geometry/mapProjection.ts` projects captured coordinates to millimetres through
      `mapWindowLayout().scalePxPerMm` (`tests/unit/ornamentMapProjection.test.ts`).
- [x] `src/ornament/geometry/roadGeometry.ts` / `roadWidths.ts` turn clipped road polylines into
      buffered, unioned road geometry per detail tier (`tests/unit/ornamentRoadGeometry.test.ts`).
- [x] `src/ornament/geometry/waterGeometry.ts` builds clipped, unioned water polygons
      (`tests/unit/ornamentWaterGeometry.test.ts`).
- [x] `src/ornament/geometry/landIslands.ts` detects land islands within water bodies so they are
      not silently filled (`tests/unit/ornamentLandIslands.test.ts`).
- [x] `src/ornament/geometry/polygonRepair.ts` repairs degenerate polygons (self-intersections,
      collapsed rings) coming out of capture/clip/union before they reach export.
- [x] `src/ornament/geometry/featureGeometry.ts` is the Phase 3 entry point tying capture, clip,
      buffer/union and repair together into a single `GeometrySnapshot`.
- [x] `src/ornament/worker/` (`geometryWorker.ts`, `geometryRunner.ts`, `protocol.ts`) moves this
      pipeline off the main thread via a Web Worker with a typed request/response protocol
      (`tests/unit/ornamentGeometryWorker.test.ts`).
- [x] Golden fixtures for city/coast/lake/rural scenes in both classic and water-cutout modes
      (`tests/fixtures/ornament/golden/*.json`) pin known-good output for the whole pipeline.
- [x] Exit criteria: capture, dedupe, project, clip, buffer/union and repair run end to end for real
      captured features, off the main thread, with golden-fixture regression coverage — 707 tests
      passing repo-wide.

## Next concrete phase

Phase 4 — SVG export and preflight. Point the manufacturing scene / SVG export path at the disk
ornament shape and the Phase 3 `GeometrySnapshot` output (roads, water, land islands) rather than
the lake tool's rectangular `ManufacturingScene`, and add the preflight checks (min feature size,
open paths, self-intersections) called out in the plan before export is enabled end to end.

## Known gaps carried into later phases

- **Arc/curved text is not implemented.** `textVector.ts` sets straight baselines only. If the
  design later wants the subtitle or date following the rim curve, that is new per-glyph rotation
  work, not a parameter.
- **`ManufacturingScene` assumes a rectangular product.** `validatePanel()` rejects coordinates
  outside `width × height`, so the lake tool's SVG/ZIP export path cannot be pointed at a disk
  as-is. Phase 4 needs either a bounding-box convention for round products or a generalised
  validator.
- **Playwright is still not set up.** Phase 1 expected browser-level E2E to arrive with Phase 2.
  It did not: the acceptance items are covered by jsdom component tests
  (`tests/unit/ornamentResetUi.test.tsx`, `tests/unit/ornamentMapUi.test.tsx`) that assert on
  rendered control values, which is the failure mode the reference bugs actually had. What those
  cannot reach is the map's own pan and zoom gestures, which need WebGL — the map's reporting path
  into the store is the same one the zoom control drives and is covered.
- **`fast-check` is not set up.** The property-style assertions in the acceptance suite are
  currently expressed as swept loops over fixed ranges.
- **Marker dragging.** The plan's preview pane lists a draggable marker with "return to selected
  place". The return action exists; dragging does not.

