# Bathymetry module — Phase 1 assessment (2026-09-17)

## 0. Spec-doc mismatch (read this first)

The four documents originally named for this assessment do not exist in this repo:

- `PRODUCT_REQUIREMENTS.md` — not found
- `DATA_AND_PROVENANCE.md` — not found
- `ACCEPTANCE_TESTS.md` — not found
- A bathymetry-specific `CLAUDE.md` describing "Phases 1-6 (domain/data layer, measured-data
  path, generated-data path, composition/export, verification)" — not found. The one `CLAUDE.md`
  that exists is repo-wide and describes **ornament**-tool phases 0-4; it has no bathymetry phase
  structure at all.

Checked: the working tree, full git history (`git log --all --diff-filter=A`), and `.claude`/
`.codex` caches. None of the four turned up anywhere.

This is the same failure mode the repo's own `CLAUDE.md` already flags for a different phantom
file (`CLAUDE_MAP_ORNAMENT_BUILD_PLAN.md` — "does not exist... not in any commit... treat every
reference to it as a citation of a document held outside the repository"). This assessment uses
the real docs that do exist and describe bathymetry instead: `docs/bathymetry.md`, the "Depth
data strategy" section of `CLAUDE.md`, `docs/v1-architecture.md`, and `docs/v1-milestones.md`
(milestone M8).

## 1. What exists in `src/bathymetry/`

- `model.ts` — `normalizeDepth` (ft→m, rejects negative/unparseable units), `validateDataset`
  (unique increasing depths, non-empty geometry), `automaticThresholds` (evenly-spaced level
  picker), `sourceMetadata` (forces `notForNavigation: true`), `importDepthRegionGeoJson` (parses
  FeatureCollection/Feature Polygon/MultiPolygon into a `BathymetryDataset`, grouping by
  normalized depth). All real, not stubs.
- `depthGeometry.ts` — `projectDepthRegions`: projects each depth contour to mm, intersects with
  the shoreline and the previous (shallower) region to guarantee nesting, validates each
  resulting panel. `selectedThresholds` dispatches automatic vs. manual selection.
- `providers.ts` — `WisconsinDnrProvider`, `NoaaNceiProvider`, `UsgsProvider`.
- `resolver.ts` — `BathymetryResolver` + two `BathymetryCache` implementations (memory,
  localStorage); tries providers in order, caches non-`unavailable` results, short-circuits on
  first `available`.

**Not just typed — genuinely wired into the app**, beyond the bathymetry folder itself:

- `src/types/project.ts:59` — `MapProject.bathymetry` is a real field (mode/provider/status/
  selection/thresholds/dataset).
- `src/components/controls/Controls.tsx` has a live "3. Depth Data" panel: mode selector, "Check
  Bathymetry" button (drives the resolver), a GeoJSON file-import input, automatic/manual
  threshold pickers.
- `src/export/buildScene.ts` (lines ~50-60) uses `project.bathymetry.mode` to branch between true
  depth regions and Artistic Depth, builds real cut-path panels for each depth layer, and refuses
  export with a clear error if True Bathymetry is selected but no dataset is loaded.
- `src/export/scene.ts` / `src/export/geometryCache.ts` — bathymetry is part of the manufacturing
  scene type and the expensive-stage cache key.

So depth panels flow through the *same* export pipeline as everything else (Production Sheet /
Registered Layers / Individual Files) — there's no separate/half-built bathymetry export path.

## 2. `bathymetry.test.ts` — what the 6 tests actually cover

1. Unit normalization + serializability + `notForNavigation` on imported GeoJSON.
2. Deterministic automatic threshold selection.
3. DNR provider: mocked fetch call, asserts it returns `status: 'unsupported'` with a message
   explicitly denying it found georeferenced polygons — **and asserts the fetcher was called
   exactly once**.
4. Resolver caching (second identical query doesn't re-invoke the provider).
5. End-to-end `buildScene` with a real imported dataset against Caldron Falls fixtures: asserts
   `depthMode === 'true-bathymetry'`, correct depth values on layers, strictly decreasing nested
   areas, no NaN/Infinity in path data.
6. Refusal path: True Bathymetry mode with no dataset throws `'no verified depth-valued dataset'`;
   decorative mode still works independently.

All 6 pass (`npx vitest run tests/unit/bathymetry.test.ts` → 6/6, 39ms). This is real regression
coverage of the domain layer, the measured-data path, and composition — not smoke tests.

## 3. Cross-reference against the domain model

| Concept | Status |
|---|---|
| Shoreline geometry | Present, but lives outside bathymetry (`src/geometry/shoreline/polygonEngine.ts`) — bathymetry consumes it. |
| Measured depth observations | Present: `BathymetryContour`/`BathymetryDataset` (`types/project.ts:9-11`), GeoJSON import, unit normalization. |
| Generated terrain config | **Absent.** No rasterization, distance fields, noise, or marching-squares code anywhere in `src/` (checked repo-wide). The shipped fallback, **Artistic Depth**, is a *different, already-complete* mechanism — calibrated Clipper inward-offsets, not procedural terrain — and per `docs/bathymetry.md`/`CLAUDE.md` it's explicitly the intended non-bathymetric fallback, not a placeholder for a terrain generator. |
| Source provenance/license metadata | Present: `BathymetrySourceMetadata` (provider, datasetId, sourceUrl, quality, `notForNavigation: true` always forced). |
| Units/sign conventions | Present and enforced: `normalizeDepth` only accepts m/ft, throws otherwise; internal storage is always meters. |
| Contour levels | Present: `BathymetryContour[]`, automatic/manual threshold selection, nesting-by-intersection. |
| Fabrication operations | Present, but generic (not bathymetry-specific): `cut`/`engrave`/`annotation` in `src/export/scene.ts`; depth panels use `cut` like every other layer. |
| Sheet-stack config | **Absent entirely** — no material/thickness/stock concept exists anywhere in the codebase, bathymetry or otherwise. |

## 4. DNR provider behavior — matches intent, with one nuance worth flagging

It does **not** attempt to fetch or reconstruct actual depth polygons — for that, it always
returns `unsupported`/`unavailable`, consistent with the "no usable public WI bathymetry data"
finding. But it does perform one real network call: an ArcGIS REST query against DNR's
hydrography layer to *identify the waterbody by name/location* (WBIC lookup), before returning
`unsupported` for the depth data itself. Test #3 above explicitly asserts this fetch happens once.
So: no fake/automated depth ingestion (correct), but it's not literally "no automated fetch" — it
fetches waterbody identity metadata only, never contour data. This matches `docs/bathymetry.md`'s
stated design ("programmatic waterbody discovery is practical; scanned-map contour ingestion...
[is not]"), so this is intentional and correctly scoped, not a bug — just worth naming precisely
rather than a flat yes/no.

## 5. Phase completeness (mapped to the task's phase language, since that structure isn't in this repo's own docs)

- **Phase 1 (assessment)** — this document.
- **Phase 2 (domain/data layer)** — Done. Types, normalization, validation, dataset construction
  all real and tested.
- **Phase 3 (measured-data path / GeoJSON import)** — Done. Import function, UI file input,
  unit/validation, tested end-to-end through `buildScene`.
- **Phase 4 (generated-data path / procedural terrain)** — Not started, and per current docs may
  not be the intended direction at all — see recommendation below.
- **Phase 5 (composition/export)** — Substantially done for bathymetry's part: depth regions →
  validated panels → same SVG export pipeline as every other layer. Sheet-stock/material config
  is the one piece from the domain model that's missing, but it's a repo-wide gap, not specific
  to bathymetry.
- **Phase 6 (verification against acceptance tests)** — Can't verify against a document that
  doesn't exist. What does exist: 6 passing unit tests covering the full path from raw GeoJSON to
  exported panel geometry. Missing relative to the ornament module's bar: no golden-fixture/
  exported-SVG-level regression test for bathymetry (the ornament module has that; bathymetry's
  tests check `scene.layers`/metrics, not serialized SVG output), and no manual "opened the True
  Bathymetry export in real CAM/vector software" check (the ornament module explicitly tracks
  that as an open exit-criterion for Ben).

One more data point: `git log --oneline -- src/bathymetry docs/bathymetry.md
tests/unit/bathymetry.test.ts` shows exactly **one** commit touching any of this — the initial
baseline. 18 subsequent commits improved roads, compass, markers, Artistic Depth tuning, and the
ornament tool, but nobody has touched bathymetry since day one. It still passes and is still
wired in, but it's the one corner of the app that's had zero iteration.

## 6. Recommended smallest next increment

Given the domain layer, measured-data path, and composition/export are already real and tested,
there's a tension worth resolving before treating "build Phase 4" as the obvious next step: a
rasterization/noise/marching-squares terrain generator would contradict the documented decision
that Artistic Depth is the intentional, calibrated, already-shipped fallback — not a stand-in for
future procedural generation. Building that without confirming it's actually wanted risks real,
unwanted scope.

Smallest sensible increments that don't require that confirmation:

1. **Golden-fixture SVG test for a True Bathymetry export** (analogous to the ornament module's
   Web Worker regression fixtures) — closes the biggest real verification gap cheaply, using the
   existing Caldron Falls fixture.
2. **Manual exit-criteria check**: import a real GeoJSON depth dataset through the actual UI,
   generate, export, and open the SVG in a viewer — the same kind of manual step the ornament
   module still owes for xTool/Inkscape.
3. Smaller UX gap: `Controls.tsx`'s bathymetry status message doesn't distinguish "DNR found your
   lake but only has scanned maps" (today's actual, common case) from a generic unavailable/error
   state — worth a one-line UI tweak so the honest "unsupported" outcome doesn't read as a
   failure.

If procedural terrain generation is genuinely wanted as new capability (distinct from Artistic
Depth), that's a much larger, separate build that should be scoped explicitly rather than folded
into "Phase 4" by default.
