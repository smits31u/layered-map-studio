# Golf starter: implementation status

Plan: [docs/GOLF_MODULE_PLAN.md](GOLF_MODULE_PLAN.md) (untracked, saved 2026-10-22). This file is the
handoff between phases, the way `topo-implementation-status.md` is for the topo builder.

## Phase 1: flat course, core layers (2026-10-22). Built, deployed; xTool Studio check waits on Ben

Ben approved Phase 0 with every recommended default. Everything below is on branch
`feat/golf-phase1` (cut from `feat/v2-step1-estimate-preview` @ `b2c7807`), commit **`baf1861`**,
in the worktree `~/lms-work/wt-golf`. Pushed, with a PR stacked on `feat/v2-step1-estimate-preview`. master and `feat/street-map-mode` are
untouched; the main checkout is still on `feat/street-map-mode`.

**Deployed:** image `6ef3acbd7911` (built 17:29:56, after the 17:29:24 commit), running as
`layered-map-studio-layered-map-studio-1` since 2026-10-22 22:32Z. Rollback tag
`layered-map-studio:rollback-pre-golf-phase1` = `29dae8045b82` (the V2 Step 1 build). Compose was run
from the golf branch's `docker-compose.yml` (it adds the `golf-cache` volume) with
`--project-directory ~/projects/layered-map-studio`, so the project name and `.env` are unchanged.
**Caution:** a plain `docker compose up --build` from the main checkout (Street Map branch) would
replace golf with Street Map and drop the golf volume mount. Rollback:
`docker tag layered-map-studio:rollback-pre-golf-phase1 layered-map-studio-layered-map-studio:latest`
then `docker compose up -d --no-build` in the main checkout.

### What was verified
- `validate.sh` (worktree copy at `~/lms-work/validate-golf.sh`, `--maxWorkers=3`): **VALIDATE OK**,
  134 files / 1727 tests, typecheck and build clean. Golf adds 54 tests in 4 files; a later run of
  the golf files plus the geocoder and ZIP suites was 104/104.
- Side container on `127.0.0.1:18089`, then production: a live Mid Vallee snapshot through the real
  route (two Overpass requests, 67 s and 74 s; coverage identical to the fixture), then cached (6 ms).
- Headless (`~/lms-work/verify/golf-check.js`, 60 s kill) on both: search → pick → coverage gate →
  confirm → board (≈1 s) → export. ZIP = 3 SVGs, each `457.2mm × 304.8mm` with a matching viewBox,
  no NaN, plus `manifest.json`, `estimate.json`, `estimate.txt`. Preflight: one warning
  (`thin-surface`), no errors. 0 page errors.
- Unfiltered geocode, the terrain proxy and the app root still answer 200 on production.

### Mid Vallee on the default board (18 × 12 in, north up, the default nine pairing: the course's first 18-hole layout)
Scale 1:5,756 (the board covers 2,632 × 1,754 m). L0 floor, L1 ground = 1 piece, L2 = 37 surface
pieces. 18 holes routed, all 18 numbered, par 70. Title: name, "De Pere, WI" (from the course's
addr tags), "Par 70".

### Phase 1 checklist (§8)
- [x] Course search through the filtered geocoder (Photon first, Nominatim offered; Census hidden)
- [x] Snapshot route: two serialized Overpass requests, UA with `GEOCODER_CONTACT`, 60 s timeout
- [x] Disk cache keyed by query version, `fetchedAt`, Refresh from OSM; 429/503/504 never cached
- [x] Coverage gate: blocking needs confirmation (UI and preflight), soft warnings, hole-count note
- [x] Rectangle, size (18 × 12 in default), margin 8 mm, north-up toggle, scale readout
- [x] Floor, ground (water cut out), surface pieces (fairways ∪ greens)
- [x] Marks on exposed surfaces: bunkers, tees, cart paths, streams, routing (stops at greens), hole numbers, green inset and collar
- [x] Title block on the board (header strip or corner block; fields toggleable)
- [x] Per-sheet SVG ZIP: semantic groups, mm viewBox, `{slug}-L{i}-{role}-{stock}mm.svg`, manifest, OSM attribution
- [x] Golf preflight blocks bad output
- [x] Estimate and 3D preview via `src/production/adapters/golfBoard.ts`
- [x] Exit: fixture course gives deterministic output (byte-identical ZIP test)
- [ ] **Exit: a live export opens in xTool Studio at the correct size. Ben's check** (the files are
      the right size by inspection; xTool Studio itself is on the Windows desktop)
- [x] Exit: container rebuilt after the last commit and verified (above)
- [ ] §1 success: a real board cut on the xTool (Ben)
- [ ] "Merged": nothing is merged. See the branch question below.

### Departures from the Phase 0 file plan, and why
- No `/api/golf/search` route: the page calls `/api/geocode?filter=golf-course` directly, which is the
  same thing without a second route.
- The "Can't find it?" map click is deferred (decision 10). Instead, a pasted OpenStreetMap link
  (`openstreetmap.org/way/…`) picks a course.
- Border (none/edge/frame, §4.5) and the compass/scale bar (§6, optional) are **not built**. They are
  not in the §8 Phase 1 list; Phase 2 candidates.
- Water hazards are counted as water (Mid Vallee's 13 ponds are all tagged both ways). Streams
  (`waterway=stream` etc.) are a separate scored mark.
- 503 is treated as "busy" alongside 429 and 504, and so is an Overpass `remark` saying the query
  timed out or ran out of memory (Overpass reports those with HTTP 200).
- The board is 457.2 × 304.8 mm (exactly 18 × 12 in) rather than the plan's rounded 457 × 305.
- Hole numbers: a 6 mm scored ring with the number engraved, placed near the tee, wholly on one
  exposed region and clear of greens. A hole with no room gets a warning, never a silent drop.
- Stock thickness comes from the estimate config's materials (3.175 mm today) per sheet.

### Open for Ben
1. Open the three SVGs in xTool Studio and confirm the size and layers (any export from the Golf
   tool; Mid Vallee is in the server cache).
2. Review and merge the PR. It stacks on the unmerged `feat/v2-step1-estimate-preview`, so that one
   lands first (or the PR is retargeted).

This doc and `docs/GOLF_MODULE_PLAN.md` are committed on `feat/golf-phase1` (Ben, 2026-10-22).

## Phase 0: assessment (2026-10-22). Approved by Ben the same day

No feature code has been written. Phase 0 added three untracked files and nothing else:
`docs/GOLF_MODULE_PLAN.md`, this file, and `test-fixtures/golf/` (the Overpass fixture plus its
attribution note).

### Ground truth

| | |
|---|---|
| Host | `smits31u-Standard-PC-Q35-ICH9-2009` (FleetVM), reached from the Windows desktop with `ssh fleetvm` |
| Checkout | `/home/smits31u/projects/layered-map-studio` |
| Branch | `feat/street-map-mode` @ `5ef1514` (2026-10-21 14:45), in sync with origin |
| Working tree | untracked only: `docs/DEPLOY_MAPS_SUBDOMAIN.md` (deliberate; left alone), plus the Phase 0 files above |
| master | `8a29eba` (2026-10-14 23:04, merge of PR #2). 15 commits behind this branch |
| Container | `layered-map-studio-layered-map-studio-1`, image `29dae8045b82`, built 2026-10-20 23:02:24 -05:00 |
| Image vs heads | Newer than master (10-14). **Older** than `feat/street-map-mode` (10-21 14:45). One minute newer than `feat/v2-step1-estimate-preview` @ `b2c7807` (10-20 23:01) |

What is deployed, checked rather than assumed. The built bundle in the container has the V2 Step 1
estimate summary (`estimate.txt`). It has none of Street Map mode's group ids (`engrave-light/water`
appears 0 times). So the container is the V2 Step 1 build, as expected, and Street Map mode is not
deployed. Branch ancestry: `feat/v2-step1-estimate-preview` is an ancestor of `feat/street-map-mode`.
Street Map mode changed 22 files, all under `src/topo/**`, `src/production/adapters/topoBoard.ts`,
`docs/topo-implementation-status.md` and tests.

Where the modules golf reuses live:

| Module | On master | On v2-step1 (deployed) | Changed on street-map-mode only |
|---|---|---|---|
| Topo model, store, persistence (`src/topo/types.ts`, `store.ts`, `persistence.ts`) | yes | yes | yes: `style`/`street` fields |
| Topo terrain engine (`src/topo/terrain/**`) | yes | yes | `pipeline.ts`, `bands.ts` (flat board) |
| Topo export (`src/topo/export/board.ts`, `svg.ts`, `preflight.ts`, `metadata.ts`) | yes | yes | all four (street groups, `engrave-light`) |
| Terrain tile proxy + disk cache (`src/server/terrain/**`) | yes | yes | no |
| Geocoder proxy (`src/server/geocode/**`, `src/map/geocoding/GeocoderService.ts`) | yes | yes | no |
| Ornament geometry, island policy, preflight helpers (`src/ornament/**`) | yes | yes | no |
| Topo bridge tabs (`src/topo/features/bridges.ts`) | yes | yes | no |
| Text to path, fonts (`src/text/**`, `public/fonts/`) | yes | yes | no |
| Design tokens, Slider, ThemeToggle (`src/styles/tokens.css`, `studio.css`, `src/components/ui/`) | yes | yes | no |
| `NumberEntry` (`src/components/ui/NumberEntry.tsx`) | **no** | yes | no |
| Estimate + 3D preview + `ProductionJob` (`src/production/**`) | **no** | yes | `adapters/topoBoard.ts` |
| Saved projects, IndexedDB (`src/state/projects/**`, lake only) | **no** | yes | no |

### Reuse map (Step 3)

Verdicts: **as-is** = import and call; **small extension** = a few lines or one new option in the
existing module; **new** = does not exist and has to be written.

| Item | Files (branch) | Current API | Verdict |
|---|---|---|---|
| Project/layer document model | `src/topo/types.ts` (`TopoProject`), `src/topo/export/board.ts` (`TopoBoard`, `TopoExportGroup`, `TOPO_GROUP_ORDER`), `src/production/job.ts` (`ProductionJob`/`JobPiece`/`JobShape`) (all on v2-step1) | Each tool owns its own settings model: lake `MapProject`, ornament `OrnamentProject`, topo `TopoProject`. None stores layers or features. Topo layers exist only at export time, as `TopoBoard` groups built by `buildTopoBoard()`. The one model all tools share is `ProductionJob` (pieces with cut/score/engrave shapes), which the estimate and 3D preview read | **No shared layer model exists.** Golf gets its own `GolfProject` and a `GolfBoard` built at export time, plus a `ProductionJob` adapter. That matches how topo works (see Conflicts 1) |
| Starter/template entry point | `src/App.tsx:60` `tool` state `'lake-map'\|'ornament'\|'topo'`; nav buttons "Ornament Studio →" / "Topo Map Builder →" (`App.tsx:195`); lazy pages `OrnamentPage`/`TopoPage` with `onExit`. Street Map is a style inside the topo page (`TopoProject.style`), not a tool | No template or starter picker. The lake tool is home; the other tools are buttons in its nav bar | **small extension**: add `'golf'` to the union, one lazy import, one nav button. A real starter chooser does not exist; building one is out of Phase 1 scope (Decision 9) |
| Geocoder + rate limiter | `src/server/geocode/handler.ts` (`createGeocodeHandler`), `adapters/photon.ts`, `adapters/nominatim.ts`, `rateLimiter.ts` (`createRateLimiter(minIntervalMs)`), `cache.ts` (in-memory LRU+TTL), `httpRoute.ts` (`GET /api/geocode?q=&provider=`); client `ProxyGeocoder.searchDetailed()` | Per-provider serialized queue (Nominatim 1000 ms, Photon 250 ms), 8 s timeout, max 5 results, default provider = **Nominatim** (first adapter). No filter parameter. Photon ids already carry OSM type+id (`photon:W123`); Nominatim ids are `place_id` | **small extension**: an optional `filter` (golf only) in the handler, its cache key and the URL builders. Photon gets `&osm_tag=leisure:golf_course`. Nominatim gets a post-filter on `category=leisure`/`type=golf_course` with a larger upstream limit, plus `osm_type`/`osm_id` on its candidates. Add an optional `osm:{type,id}` to `GeocodeCandidate` |
| Server routes | `server/index.ts` (production: geocode, `/api/terrain/`, `/health`, static), `vite.config.ts` (dev/preview middleware plugins for the same two routes) | Plain functions `serveX(request,response,handler)` with handlers that take an injected fetch and cache, so they are tested without sockets | **small extension**: `/api/golf/*` mounted in **both** `server/index.ts` and `vite.config.ts`, in `src/server/golf/` following the terrain module's shape |
| Disk cache + lock | `src/server/terrain/tileCache.ts` (`createDiskTileCache`, private `withLock`), named volume `terrain-cache` in `docker-compose.yml`, dir created in `Dockerfile` | Write to temp, `rename` into place (atomic), then a promise-chain lock serializes only the index/evict section. `get()` is lock-free. Paths come from validated integers only (`z/x/y.png`) | **small extension**: move `withLock` into a shared `serialLock` helper (tileCache keeps identical behaviour), then write a small JSON snapshot cache on the same temp-rename + lock pattern. The key comes from validated `[nwr]` + integer id + query version, never request text. Add a `golf-cache` volume and directory |
| Terrain engine + tile proxy (Phase 3) | `src/topo/terrain/**` (`generateTerrain`, `buildTerrainBands`, `smoothGrid`, `FLAT_AREA_RANGE_M=30`), `src/server/terrain/**` | Pure pipeline from Terrarium PNG bytes (AWS, z ≤ 15) to nested bands. The board must be framed from a MapLibre view (`FrozenTerrainView`) | **as-is for Phase 3 Terrarium**, but it needs a non-MapLibre `FrozenTerrainView` built from golf's own fit. **3DEP does not exist anywhere** (no code; `usgs` appears only as the bathymetry `UsgsProvider` and in the Terrarium attribution text). `LAND_MAP_MODULE_PLAN.md` does not exist (Conflicts 7) |
| Offset/buffer | `src/ornament/geometry/offsetPaths.ts` (`offsetPaths(paths,deltaMm,{joinStyle,endStyle})`, Clipper, 0.001 mm grid) | Open and closed offsets with round, miter and square joins | **as-is** (routing lines, green collar and inset, Phase 2 rough) |
| Boolean ops | `src/ornament/geometry/polygonRepair.ts` (`unionAll`, `intersect`, `subtract`, `repairGeometry`, `normalizeTopology`), `src/geometry/shoreline/robustBoolean.ts` (polygon-clipping, falls back to Clipper) | `MultiPolygonMm` in, repaired `MultiPolygonMm` out, with a label for errors | **as-is** (exposed regions, water cut-outs) |
| Clipping | `src/ornament/geometry/clipLine.ts` (`clipPolylineToRect`), `src/geometry/terrain/contourLines.ts` (`clipLinesToArea`), `nestedBands.ts` (`clip`) | Polyline to rect or area; polygon clip | **as-is** |
| Simplification | `src/ornament/geometry/simplify.ts` (`simplifyLine`, `simplifyRing`, iterative RDP in mm) | | **as-is** |
| Projection | `src/ornament/geometry/mapProjection.ts` (`createMapProjection`, Web Mercator at a MapLibre zoom/frame), `src/topo/features/projection.ts` (`boardProjection(view)`) | Built for a MapLibre frame | **new (small)**: golf fits the course bbox to the board itself, north-up or rotated. A local projection plus fit, written against the same `[x,y]` mm convention |
| Island policy (ornament) | `src/ornament/geometry/landIslands.ts` (`analyseLandIslands`, `applyIslandPolicy` with `'keep-separate'\|'bridge'\|'omit-below-threshold'`, `bridgeTab`) | Works on any `MultiPolygonMm`; reports every island it finds, even under policies that act on them | **as-is** (Phase 2 per the plan; Phase 1 only reports, Decision 7) |
| Bridge tabs (topo) | `src/topo/features/bridges.ts` (`findBridgeSpans`, `bridgeTabs`, `MIN_BRIDGE_TAB_WIDTH_MM` = ornament's min neck) | Road-over-water crossings | **as-is**, but it applies only to cart-path bridges over ponds, which golf does not need in Phase 1 |
| Text to path + fonts | `src/text/textVector.ts` (`textPathData(font,text,sizeMm,anchor,x,y)`, explicit Z, NaN-safe), `src/text/fontRegistry.ts` (Inter, Cinzel, Great Vibes; OFL; `getLoadedFont`), `src/topo/features/title.ts` (`buildTitle`) | Glyph outlines in mm, baked positions | **as-is** for glyphs. The multi-field title block is **new** |
| Compass | `src/geometry/scene/compass.ts` (`compassPathData(style,sizeMm)`, `MIN_COMPASS_SIZE_MM`) | The project's own original compass | **as-is** (Phase 1 optional) |
| SVG assembly + semantic groups | `src/topo/export/svg.ts` (`topoSvg`, mm units, viewBox 1:1, red cut, blue score, black engrave), `src/ornament/export/svg.ts` (`formatMm`, `geometryPathMm`), `src/ornament/export/lightburn.ts` (`LIGHTBURN_PRESET`, `SEMANTIC_PRESET`) | Topo writes **one SVG for the whole board**, all layers as groups | **small extension**: one SVG per sheet with the same serializer helpers and colour convention. A golf `svg.ts` is about 60 lines |
| Preflight | `src/ornament/export/preflight.ts` (exports `ringIsClosed`, `ringSelfIntersects`, `pathSubpathsAreClosed`, `geometryHasNonFinite`, `ABSOLUTE_MIN_PIECE_AREA_MM2`), `src/ornament/export/morphology.ts` (`thinFeatures`), `src/topo/export/preflight.ts` (`runTopoPreflight`, error blocks, warning exports) | Checkers are reusable functions. The runners are tool-specific | **as-is (checkers)** + **new runner** `runGolfPreflight` with the plan's golf checks |
| ZIP export | `src/export/svg/exportSvg.ts` (`individualSvgsZip`, fflate `zipSync`, pinned timestamps, deterministic bytes), `src/ornament/export/download.ts` (`downloadFiles`, staggered multi-download used by topo) | Lake has a deterministic ZIP. Topo downloads separate files | **small extension**: lift the pinned-timestamp zip helper into a shared function both can call |
| Manifest / metadata | `src/topo/export/metadata.ts` (`buildTopoMetadata`: app version, providers with attribution and `retrievedAt`, settings), `src/production/estimate/exports.ts` (`estimateFilesFor` → `estimate.json`/`estimate.txt` in the ZIP) | Embedded in the SVG `<metadata>` | **new** `manifest.json` following the same provider-record discipline. The estimate files go in as-is |
| Design tokens + sidebar | `src/styles/tokens.css` (188 custom properties, light and dark), `src/styles/studio.css` (`.studio` layout), `src/components/ui/Slider.tsx`, `NumberEntry.tsx` (v2-step1+), `ThemeToggle.tsx`, `FontLoadNotice.tsx`; the topo page sidebar pattern in `src/topo/ui/TopoPage.tsx` | | **as-is** |
| Estimate + stacked preview | `src/production/**` (`estimateJob`, `EstimatePanel`, `Preview3D`, proof PNG), adapters per tool | The plan calls these "planned". They exist and are deployed | **small extension**: `src/production/adapters/golfBoard.ts` (`GolfBoard` to `ProductionJob`) |
| Persistence | Topo and ornament: one localStorage record each (`layered-map-studio.topo.v1`), merged over defaults and clamped, with no saved-project list. Lake: IndexedDB saved projects + autosave (`src/state/projects/**`, lake-typed) | | **as-is pattern**: `layered-map-studio.golf.v1` holds settings plus the course's OSM id. The snapshot is not stored in the browser; it reloads from the server cache. A golf saved-projects list would need `src/state/projects` generalized (Decision 8) |

### Overpass check (Step 4)

One request on 2026-10-22 at 20:24Z: HTTP 200 in 39.5 s, 458,725 bytes, 319 elements. Saved to
`test-fixtures/golf/mid-vallee.overpass.json`, with `mid-vallee.ATTRIBUTION.md` beside it (ODbL, the
query, timestamps).

- **Course:** way **29060461**, `leisure=golf_course`, "Mid Vallee Golf Course". Its bbox is
  44.35688–44.37030 N, 88.19144–88.17688 W, about 1.16 × 1.49 km. All 274 golf features and all 27
  hole lines sit inside the boundary.
- **It is a 27-hole course:** three nines named White, Red and Blue (`golf:course:name` on every
  hole). There are six `golf=course` relations (`type=sport`) for the 18-hole pairings
  (Blue/White, Red/White, Blue/Red, Red/Blue, White/Blue, White/Red), with 14–24 members each, so
  they are inconsistently complete.

| Role | Count |
|---|---|
| holes (`golf=hole`) | 27 (refs 1–9 ×3) |
| fairways | 33 (26 ways + 7 multipolygons) |
| greens | **26** (23 carry `ref`) |
| tees | 65 |
| bunkers | 84 |
| rough | 0 |
| water (`natural=water` / `water=*` / `waterway`) | 18 |
| water hazards | 4 `water_hazard` + 9 `lateral_water_hazard` |
| trees | 16 `natural=tree` nodes + 1 wood/forest area |
| cart paths | 32 (`golf=cartpath`) |
| not in the plan's role list | 9 `golf=pin` nodes, 1 `golf=driving_range` |

Hole tags: `ref` 27/27, `par` 27/27 (sum 105 = three par-35 nines), `handicap` 27/27. **`dist`
0/27**. Distances are per tee instead: `dist:blue`/`dist:white`/`dist:gold` 27/27, `dist:red`
23/27, plain `distance` 1/27.

Gate result under the plan's §3 rules: **blocking warning**, because there are 26 greens for 27
holes. Soft warning: no rough. Hole count 27 is fine. This makes it a good fixture for the gate and
for the 27-hole case, and a poor choice for Phase 1's "well-mapped course" cut (Decision 3).

### Branch to cut golf from (recommendation only, nothing done)

**Recommended: a new `feat/golf-phase1` branch from `feat/v2-step1-estimate-preview` (`b2c7807`).**
That is the code production runs. The plan's "done means deployed" rule then ships golf without also
shipping Street Map mode, which Ben has not reviewed yet. Golf lives in new directories (`src/golf/`,
`src/server/golf/`). The files it shares with Street Map mode are `src/App.tsx`, `server/index.ts`
and `vite.config.ts`, none of which Street Map mode touched. Rebasing onto `feat/street-map-mode`
later should therefore be clean.

Alternatives:
- **Cut from `feat/street-map-mode`** if Ben approves Street Map mode first. Deploying golf would then
  deploy both.
- **Cut from master: no.** master (10-14) lacks `src/production`, `NumberEntry` and saved projects.
  It is a week behind production, so golf would have to re-solve problems already solved upstream.

Separately, the PR stack should eventually land on master. The plan's "merged" needs a target, and
today master is not what runs (see Conflicts 10).

### Files for Phase 1

New, server side (`src/server/golf/`, Node-only like the rest of `src/server/**`):
- `overpass.ts`: query builder (versioned `GOLF_QUERY_VERSION`), one-at-a-time limiter (`createRateLimiter`), descriptive User-Agent from `GEOCODER_CONTACT`, 60 s timeout, and 429/504 mapped to the plan's "OpenStreetMap is busy" error.
- `normalize.ts`: Overpass JSON to snapshot (boundary, bbox, features by role, holes with tee/green points, totals, coverage). Pure and deterministic, so it gets the fixture tests.
- `snapshotCache.ts`: disk JSON cache keyed `{type}-{id}-{queryVersion}`, with temp-rename + `serialLock`. Never writes a failure.
- `handler.ts` + `httpRoute.ts`: `GET /api/golf/snapshot/:osmType/:osmId[?refresh=1]` and `GET /api/golf/search?q=`. The search route calls the geocode handler with the golf filter.

New, shared:
- `src/server/serialLock.ts`: the promise-chain lock, lifted out of `tileCache.ts`.
- `src/export/zip.ts`: the pinned-timestamp deterministic ZIP, lifted out of `exportSvg.ts` so lake and golf share it.

New, client side (`src/golf/`):
- `types.ts`, `defaults.ts`, `validation.ts`, `store.ts`, `persistence.ts`: `GolfProject` (course ref, size 457×305 mm, margin 8 mm, north-up, border, marks, title fields, nine selection), reducer and clamp, localStorage `layered-map-studio.golf.v1`. Same structure as topo.
- `snapshotClient.ts`: browser client for `/api/golf/*` with typed errors (busy, not found, unreachable).
- `coverage.ts`: §3 gate (blocking, soft, info) from the snapshot's coverage report.
- `geometry/fit.ts`: course to board. North-up, or rotated to the minimum-area rectangle; margin; scale readout.
- `geometry/layers.ts`: floor, ground (water cut out), surface pieces (fairways + greens).
- `geometry/exposed.ts`: `exposed(k)` and mark assignment (§5.1), the core logic.
- `geometry/marks.ts`: bunkers, tees, routing interrupted at greens, green inset and collar, hole badges with collision avoidance.
- `geometry/titleBlock.ts`: header strip or corner block via `textPathData` and the bundled fonts.
- `export/board.ts`: `GolfBoard`, sheets with semantic groups `cut/…`, `score/…`, `engrave/…`.
- `export/svg.ts`: one SVG per sheet in mm, with the topo/ornament serializer helpers and colours.
- `export/preflight.ts`: `runGolfPreflight`, using the ornament checkers plus the golf checks (pieces tagged, marks inside exposed regions, piece caps).
- `export/manifest.ts`: `manifest.json` (course, OSM ids, `fetchedAt`, settings, per-sheet counts, stack order, attribution, app version).
- `export/exportGolf.ts`: build, preflight, then ZIP (`{slug}-L{i}-{role}-{stock}mm.svg` + manifest + estimate files). A blocked preflight produces no ZIP.
- `ui/GolfPage.tsx`, `ui/CourseSearch.tsx`, `ui/CoveragePanel.tsx`, `ui/golf.css`: page on the topo page's sidebar pattern and tokens, the course chooser, the gate checklist with confirm-to-continue, an SVG preview of the stack, and "© OpenStreetMap contributors" in the UI.

New, production:
- `src/production/adapters/golfBoard.ts`: `GolfBoard` to `ProductionJob`, so the existing estimate and 3D preview work.

Changed:
- `src/App.tsx`: `'golf'` tool, lazy `GolfPage`, nav button.
- `server/index.ts`: mount `/api/golf/`; create the snapshot cache from `GOLF_CACHE_DIR`.
- `vite.config.ts`: the same route as a dev/preview middleware plugin (the terrain plugin's shape).
- `src/server/geocode/types.ts`, `handler.ts`, `adapters/photon.ts`, `adapters/nominatim.ts`: optional `filter`, `osm` on candidates, and the filter in the cache key. Lake, ornament and topo calls are unchanged (no filter means today's behaviour).
- `src/server/terrain/tileCache.ts`: import `serialLock` instead of its private copy. No behaviour change.
- `src/export/svg/exportSvg.ts`: import the lifted ZIP helper. Byte-identical output, pinned by the existing test.
- `docker-compose.yml`, `Dockerfile`: `golf-cache` named volume and `/app/cache/golf` owned by `node`.
- `CLAUDE.md`: a short golf section (routes, cache, fixture rules).

Tests (`tests/unit/golf*.test.ts`, fixtures under `tests/fixtures/golf/`, Decision 2): normalization
determinism on the Mid Vallee fixture; the cache key changes with `queryVersion`; 429/504 are never
cached; the coverage gate (Mid Vallee is blocking); exposed-region properties (marks stay inside
`exposed(k)`, and `exposed(k)` never overlaps a layer above); routing is interrupted at greens; badges
never overlap greens or each other; per-sheet SVG size and viewBox; preflight blocks on an untagged
piece; the ZIP is byte-identical across two exports; the geocoder filter params for both providers;
`tileCache` behaviour unchanged.

### Conflicts between the plan and the repo

1. **There is no shared project/layer model** (§1, §5 "the shared project/layer model"). Lake, ornament
   and topo each own a settings model. Topo's "layers" are export-time groups in one SVG. The only
   cross-tool model is `ProductionJob`. Golf will follow topo's shape (own project, board built at
   export, job adapter) rather than invent a shared document model.
2. **No "shared sheet stock setting (default 3 mm)"** (§5). Stock thickness exists only in the
   estimate config's materials, where 1/8" MDF and birch are **3.175 mm**. The filename's `{stock}mm`
   needs a source (Decision 4).
3. **Geocoder: "Photon primary, Nominatim fallback"** (§2.1) is in tension with the repo's geocoder
   policy. The default is Nominatim, and an *automatic* fallback is forbidden by the existing plan;
   the ornament offers the other provider as an explicit choice. Also, Photon's filter is the query
   parameter `osm_tag=leisure:golf_course`; `osm_key`/`osm_value` are response fields.
   Nominatim's free-text `/search` has no class/type filter, so it means post-filtering
   (`category`/`type`) with a larger upstream limit. Nominatim candidates carry `place_id`, not OSM
   type and id, until the adapter is changed.
4. **"Existing rate limiter and cache"** (§2.1): the geocode cache is in-memory with a 6 h TTL, on
   purpose (privacy). That's fine for search. Snapshots need the new disk cache.
5. **The tileCache "eviction-race fix" lock** (§2.3) guards only the index/evict section, and its
   on-disk layout is `z/x/y.png`. Reuse means extracting the lock helper and the temp-rename
   pattern, not calling `createDiskTileCache`.
6. **Snapshot clipping "to the boundary plus the user's margin"** (§2.2 step 3) cannot happen server
   side under the plan's own cache key `{osmType}-{osmId}-{queryVersion}`, which has no margin in it.
   Recommended: the server returns features in bbox + 50 m, clipped to nothing. The client clips to
   boundary + margin when it builds the board, in board millimetres.
7. **`LAND_MAP_MODULE_PLAN.md` does not exist** (§2.4), and there is **no 3DEP code**. The terrain
   proxy is hard-wired to Terrarium `z/x/y` PNGs. 3DEP 1 m is a different service shape (ImageServer/WCS
   rasters), so it is new work in Phase 3, not reuse.
8. **"Planned V2 estimate" and "planned stacked-preview image"** (§7, §10) already exist and are
   deployed (`src/production/**`, V2 A5/A6). Phase 1 can hook in now.
9. **Topo exports one SVG; golf wants one SVG per sheet in a ZIP** (§7). The lake tool's
   individual-file ZIP is the precedent to share, not topo's export.
10. **"Done means merged + deployed"** (§0.4). Production runs an unmerged PR branch. master is
    `8a29eba` (10-14), so "merged" currently has no meaningful target.
11. **Fixture path**: the task put the fixture in `test-fixtures/golf/`. The repo's fixtures all live
    in `tests/fixtures/` (40 tracked files, including `tests/fixtures/topo/`). Decision 2.
12. **Hole distance**: the plan reads `dist`. Mid Vallee has none; it uses `dist:<tee colour>`
    (`dist:red` missing on 4 holes). A total-length rule "only if every hole has `dist`" would never
    fire here. Decision 6.
13. **Multi-layout courses are not in the Phase 1 list** (§4.4 is setup flow, but §8 Phase 1 does not
    mention layouts). The obvious test course is 27 holes with hole numbers 1–9 three times. Drawing
    all 27 with plain numbers gives ambiguous badges. Decision 5.
14. **Overpass "boundary bbox + 50 m pad" in one query.** Overpass QL cannot feed a computed bbox back
    into a filter, so the snapshot route needs either two serialized requests (boundary, then bbox)
    or the area ∪ around-50 m form used for the fixture. Recommended: two requests, which is exactly
    the plan's wording, both behind the one-at-a-time limiter.

### Open decisions (recommended default first)

1. **Base branch:** cut `feat/golf-phase1` from `feat/v2-step1-estimate-preview` (`b2c7807`), the
   deployed code. Alternative: from `feat/street-map-mode` if you approve it first.
2. **Fixture location:** move it to `tests/fixtures/golf/` (repo convention) when Phase 1 starts.
   Recommended. Alternative: keep `test-fixtures/golf/`.
3. **Phase 1 cut course:** Mid Vallee becomes the gate fixture (blocking: 26 greens, 27 holes). For the
   real cut, you name one well-mapped 18-hole Wisconsin course, or we cut Mid Vallee as two nines
   after confirming the gate. Recommended: the second, because it exercises the gate and the layout
   picker on a course you know.
4. **Stock thickness source:** read it from the estimate config's selected material (3.175 mm today),
   so the filename, estimate and 3D preview agree. Alternative: a golf-only 3 mm field as the plan says.
5. **27-hole courses in Phase 1:** include a nine picker (one or two nines, default the first
   18-hole `golf=course` pairing, else the first two nines), renumbered 1–18 for the board.
   Alternative: defer it and draw everything (ambiguous badges).
6. **Total length:** a manual field (per §2.5). Offer "sum of `dist:<tee>`" for a tee colour the user
   picks, only when every selected hole has it.
7. **Floating pieces in Phase 1:** detect and **report** with `analyseLandIslands` (no silent drops),
   with keep/tab/omit actions in Phase 2 as planned.
8. **Persistence:** localStorage settings + the course's OSM id, with the snapshot from the server cache
   (topo/ornament pattern). Alternative: generalize lake's IndexedDB saved projects (bigger change).
9. **Entry point:** a "Golf Course Map →" button in the lake nav next to Ornament/Topo. Alternative: a
   starter chooser screen (new UI, not in Phase 1 scope).
10. **"Can't find it?" map-click fallback (§2.1):** defer to Phase 2. It needs a MapLibre map on the golf
    page plus an `is_in` Overpass query, and search plus a pasted OSM link covers Phase 1.
11. **North up:** default **on** (plan leaves the default open). Rotation to best fit is a toggle.
12. **Green marks:** inset engraved 1.0 mm inside the green edge; collar scored 1.5 mm outside. Hole
    badge 6 mm circle, number in Inter, engraved. These are original defaults; change freely.
13. **Overpass User-Agent contact:** use `GEOCODER_CONTACT` (already in compose) in the golf
    User-Agent.

### Phase 1 checklist, against §8 exit criteria

Scope items (§8 Phase 1):
- [ ] Course search through the filtered geocoder (Photon + Nominatim filters, OSM type/id on candidates)
- [ ] `GET /api/golf/snapshot/:osmType/:osmId`: two serialized Overpass requests, UA, 60 s timeout
- [ ] Disk snapshot cache keyed by query version, `fetchedAt`, "Refresh from OSM", 429/504 never cached
- [ ] Coverage gate: blocking needs confirmation, soft warnings, hole-count note
- [ ] Rectangle shape, size (457×305 default), margin 8 mm, north-up toggle, scale readout
- [ ] Floor, ground (water cut out), surface pieces (fairways + greens)
- [ ] Marks on exposed surfaces: bunkers, tees, routing (interrupted at greens), hole badges, green inset + collar
- [ ] Title block on the board (fields toggleable; bundled fonts; no live fonts)
- [ ] Per-sheet SVG ZIP: semantic groups, mm viewBox, filename convention, `manifest.json`, OSM attribution
- [ ] Golf preflight blocks bad output; existing checkers reused
- [ ] Estimate/3D preview via `adapters/golfBoard.ts`

Exit criteria:
- [ ] **Recorded fixture course produces deterministic output.** Mid Vallee fixture to snapshot to board to ZIP, byte-identical twice, in vitest (`--maxWorkers=3`). No network in unit tests.
- [ ] **A live run against a real course exports and opens in xTool Studio at the correct size.** Headless check on the VM (`~/lms-work/verify/golf.js`, 60 s kill) proves the ZIP and each SVG's mm size; **opening in xTool Studio is Ben's check** (Windows desktop).
- [ ] **The container is rebuilt and verified.** `validate.sh` prints VALIDATE OK; image build time later than the last commit (`--no-cache` if the last commit is docs-only); pre-check on `127.0.0.1:18088`; rollback tag before swapping production.
- [ ] §1 success: a real board cut on the xTool with placement-only hand edits (Ben).
