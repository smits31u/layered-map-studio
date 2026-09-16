# Ornament generator — implementation status

Tracks `CLAUDE_MAP_ORNAMENT_BUILD_PLAN.md` against what exists in this repository.

| Phase | State |
|-------|-------|
| 0 — shared scaffold and decisions | complete |
| 1 — original ornament editor shell | complete |
| 2 — map and search | not started |
| 3 — feature geometry | not started |
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

This is worth revisiting if a second consumer appears (a server package for the Phase 2 geocoder
proxy is the likely trigger), at which point the split has a concrete payoff rather than being
purely organisational.

## What is reused rather than rebuilt

| Need | Source | Notes |
|------|--------|-------|
| Text → outlines | `src/text/textVector.ts` | Extended with optional `letterSpacingMm`; zero spacing takes the original code path unchanged |
| Bundled fonts | `src/text/fontRegistry.ts` | Verbatim. See ADR 0002 |
| Polygon booleans | `polygon-clipping` via `src/geometry/shoreline/polygonEngine.ts` types | `MultiPolygonMm`/`RingMm` shared so both tools speak one geometry vocabulary |
| Path offsets | `clipper-lib` | New generalised wrapper, see ADR 0001 |
| SVG path serialisation | `geometryPath()` from `polygonEngine.ts` | Verbatim |
| Unit conversion | `src/utils/units.ts` | `inchesToMm`/`mmToInches` |
| Geocoding | `src/map/geocoding/GeocoderService.ts` | Untouched — Phase 2 |
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

## Known gaps carried into later phases

- **Arc/curved text is not implemented.** `textVector.ts` sets straight baselines only. If the
  design later wants the subtitle or date following the rim curve, that is new per-glyph rotation
  work, not a parameter.
- **`ManufacturingScene` assumes a rectangular product.** `validatePanel()` rejects coordinates
  outside `width × height`, so the lake tool's SVG/ZIP export path cannot be pointed at a disk
  as-is. Phase 4 needs either a bounding-box convention for round products or a generalised
  validator.
- **Playwright is not set up.** The plan's acceptance suite calls for end-to-end coverage; the
  reset acceptance item is currently covered by a jsdom component test
  (`tests/unit/ornamentResetUi.test.tsx`) that asserts on rendered control values, which is the
  failure mode the reference bug actually had. Browser-level E2E arrives with Phase 2, when there
  is a map and a geocoder worth driving.
- **`fast-check` is not set up.** The property-style assertions in the acceptance suite are
  currently expressed as swept loops over fixed ranges.
- **MapLibre is a CDN `<script>`, not an npm dependency** (`index.html`, with
  `declare const maplibregl:any`). Phase 2 should decide whether to keep that or pin it properly;
  the current arrangement has no lockfile pinning and no types.

## Next concrete phase

Phase 2 — map and search. First task is the localhost geocoder proxy
(`/api/geocode?q=...`), since the plan forbids calling public providers directly from the browser
and the existing `GeocoderService` implementations do exactly that today.
