# V1.0 architecture: what exists, what's proposed

This document is the "first task" deliverable requested for the V1.0 push: an honest
inventory of what the repository already implements, the folder/package architecture
proposed for the remaining milestones, and the extension points for markers, compass
keep-out, lake info, frame/inset, editor zoom/pan, and project persistence.

**This is a continuation of an existing, working, tested application — not a clean-room
rewrite.** Four prior development passes already built and verified most of a V1-aligned
architecture (Artistic Depth geometry tuning against real reference lakes, reproducible
crop tooling, a root-cause fix for shoreline collapse behavior, and a full scene-object
system for labels/title/compass/direct-editing). Discarding that to "start clean" would
throw away real, regression-tested geometry work and a working interactive editor for no
benefit. The plan below extends the existing architecture to close the remaining gaps.

## Repository inspection summary

- 155 passing tests (`npm test`), builds cleanly (`npm run build`), Docker deployment
  verified repeatedly (`docker compose up -d` → healthy, exact-mm SVG export confirmed
  in LightBurn-compatible structure).
- Stack already matches the recommended one: React + TypeScript + Vite, MapLibre GL,
  OpenFreeMap/OpenMapTiles vector source, Photon geocoding, `polygon-clipping` +
  `clipper-lib` for geometry (functionally equivalent to Clipper2 for this project's
  needs — union/difference/intersection/offset/simplify are all already in active,
  tested use; see "Packages" below for why a Clipper2 migration is not recommended),
  `opentype.js` for font-to-vector text.
- The canonical geographic→mm projection (`CropProjection`) is a single shared pipeline
  already used by shorelines, roads, road labels, place labels, and the compass —
  verified isotropic (equal X/Y scale) by a dedicated regression test suite
  (`tests/unit/isotropy.test.ts`), which is exactly the "do not implement independent
  coordinate systems that can drift" requirement.

## What's already implemented (mapped to the V1.0 checklist)

Search/pan/zoom, exact physical dimensions (mm-internal, in/mm display), the canonical
projection, water/road/place extraction, progressive Artistic Depth shoreline layers
(extensively tuned against four real reference lakes — see `docs/artistic-depth.md`),
per-layer enable/disable with only-enabled-layers-exported, Roads All/Main/Off with
independent major/minor width, place labels (per-class toggle, drag, hide, reset-to-
geographic-anchor), road labels (named-road grouping, orientation-corrected, global/
per-label flip, hide, fit-rejection, drag), title/subtitle with vector-path text and
an optional backer, a three-style compass (classic/rose/minimal) with size/rotation/
drag/corner-presets, a click-to-select-and-drag editor for all of the above with a
side panel (X/Y/rotation/visibility/flip/nudge/Reset), Composite/Production-strip/
Individual-layer preview, combined and individual SVG export with named groups, and
manufacturing-semantics tests confirming vector-only text and Land-only presentation
geometry. Full detail in `docs/artistic-depth.md`, `docs/bathymetry.md`, and the git
history (`git log --oneline`).

## Genuine gaps vs. this spec (not yet built)

- **Nominatim fallback geocoder** — only Photon exists today, already behind a
  `GeocoderService` interface so adding a fallback is additive, not a rewrite.
- **Web Worker for heavy geometry** — all geometry currently runs on the main thread.
  Real for large/complex crops (Caldron Falls-scale) but hasn't caused a reported
  problem yet; proposed as its own milestone rather than a blanket requirement.
- **Address/location markers** — not implemented at all: no marker library, no
  geocode-to-marker workflow, no marker drag/reset.
- **Compass (and general) keep-out / vector knockout** — not implemented. Compass
  currently draws on top of roads/labels with no clearance logic.
- **Generalized collision/keep-out engine** — no `collision.ts` module exists yet.
- **Lake information block** — not implemented; no data-provider abstraction exists
  for acreage/max-depth/county (the existing `bathymetry/providers.ts` module resolves
  *survey depth data*, a related but distinct concept — it's a reasonable model to
  extend rather than duplicate).
- **Frame / artwork inset** — not implemented. No inset geometry, no safe-area guide.
- **Editor zoom/pan independent of geographic zoom** — not implemented. The generated
  preview currently scales to fit its container via CSS, with no independent zoom
  control, no space/middle-drag pan.
- **Live updates without re-Generate for non-drag edits** — partially true today: drag/
  nudge/hide/flip/reset on existing objects update live via a dedicated commit path
  that never re-clears the scene. But most *typed/selected* edits in the Controls
  sidebar (title text, font choice, compass size, road width, etc.) still go through
  the original `setProject` path, which clears the built scene and requires clicking
  "Generate scene" again. Closing this gap is the single biggest lever for the
  "reactive generated-map" requirement (section 28) and is called out as its own
  milestone below rather than bundled into markers/keep-out work.
- **Smart road-label collision scoring** — road labels currently pick the longest
  straight sub-segment of their named road and stop there; there's no candidate
  generation/scoring against other labels, the compass, frame, or lake-info block.
- **JPG/PNG preview export** — SVG only today.
- **Project save/load (IndexedDB + JSON import/export)** — `MapProject` is already a
  clean, flat, JSON-serializable object (no functions, no class instances, no circular
  references), which is precisely the property persistence needs — but no UI or
  storage layer exists yet.
- **Compass N/E/S/W lettering** — the "classic" and "rose" compass styles are pure
  procedural vector geometry (arrow/star shapes) with no cardinal-direction letters.
  The spec explicitly wants "clear N, clear E, clear S, clear W" on the classic rose;
  this needs the font-to-vector pipeline (already built for title/labels) applied to
  four short glyphs positioned around the rose — small, but not yet done.

## Proposed folder architecture

The existing `src/geometry/` split is sound and already partially matches the spec's
suggested structure; the plan is to grow it in place rather than reorganize:

```
src/geometry/
  projection/        cropProjection.ts, cropSnapshot.ts        (existing)
  shoreline/          polygonEngine.ts, artisticDepth.ts         (existing)
  roads/              roads.ts                                   (existing)
  scene/              overrides.ts, placeLabels.ts, roadLabels.ts,
                       compass.ts, titleBacker.ts                 (existing)
  scene/markers.ts     NEW — marker default-position + geometry generators
  scene/lakeInfo.ts    NEW — lake-info block layout + text generation
  scene/frame.ts       NEW — inset rectangle + safe-area guide geometry
  collision/           NEW — keepOutFootprint(), applyKeepOut(), candidate scoring
                       shared by compass, road labels, and (later) lake info/frame
```

`src/text/` (font registry + vectorization) and `src/export/` (scene model + SVG
serializers) stay as-is; markers/lake-info/frame all funnel through the same
`scene.objects` + named-group export path already built for labels/title/compass.

`src/state/` gains a `persistence.ts` (IndexedDB read/write + JSON import/export) when
that milestone starts; `MapProject`'s existing flat shape needs no restructuring for
that to work.

A `worker/` module (e.g. `src/worker/geometryWorker.ts`) is the proposed home for
offloading `buildScene`'s heavy geometry calls when that milestone starts; the existing
`buildScene(project, features)` signature is already a pure function of its two
arguments, which is exactly what makes moving it into a worker without an architecture
change feasible later.

## Packages

Already installed and doing real work: `polygon-clipping`, `clipper-lib`, `opentype.js`,
`react`/`react-dom`, `vite`, `vitest`, `jsdom`, `typescript`. No package changes are
needed for the interface/architecture step in this task.

For upcoming milestones, proposed additions (not installed yet, not needed until their
milestone starts):

- **Nominatim fallback**: no new package — plain `fetch` against the public Nominatim
  API, mirroring the existing `PhotonGeocoder` shape behind `GeocoderService`.
- **IndexedDB persistence**: `idb-keyval` (tiny, no-boilerplate wrapper over the native
  IndexedDB API) rather than a heavier ORM-style IndexedDB library — the project's own
  philosophy of small, purpose-fit dependencies (see the font-engine work) applies here
  too.
- **JPG/PNG export**: no new package — render the existing SVG to an offscreen
  `<canvas>` via a data-URL `<img>` and `canvas.toBlob()`, standard browser APIs.
- **Web Worker**: no new package — native `Worker`/`comlink`-free message passing is
  sufficient given `buildScene` is already a pure function; `comlink` is a reasonable
  fallback if the raw `postMessage` plumbing gets unwieldy, deferred until that
  milestone actually starts.
- Clipper2 (WASM) was considered as the spec suggests, but the project already has two
  working, tested geometry libraries doing exactly what Clipper2 would (Minkowski
  offset via `clipper-lib`, boolean ops via `polygon-clipping`), both proven against
  real lake geometry across three geometry-tuning sessions. Migrating would risk
  re-introducing already-fixed bugs (the anisotropic-fixture bug, the ring-drop bug,
  the closing/nesting-clamp bug) for no functional gain. Not recommended unless a
  concrete limitation of the current libraries is found.
