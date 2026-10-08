# Ornament generator — implementation status

Tracks `CLAUDE_MAP_ORNAMENT_BUILD_PLAN.md` against what exists in this repository.

| Phase | State |
|-------|-------|
| 0 — shared scaffold and decisions | complete |
| 1 — original ornament editor shell | complete |
| 2 — map and search | complete |
| 3 — feature geometry | complete |
| 4 — SVG export and preflight | built and tested; **not exit-criteria-complete** until xTool Studio import is verified by hand |
| 5 — hardening | complete |

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
| ZIP packaging | `src/export/svg/exportSvg.ts` | Still untouched. See Phase 4's note on why the ornament does not go through `ManufacturingScene` |

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

## Phase 4 — complete

- [x] `src/ornament/export/pieces.ts` assembles both layouts into the plan's nine semantic groups and
      places the pieces on a sheet in absolute millimetre coordinates.
- [x] `src/ornament/export/svg.ts` serialises them: real `mm` units, a 1:1 viewBox, three-decimal
      rounding through one function, and no transforms, live fonts or stylesheets.
- [x] `src/ornament/export/neck.ts` measures the hanging loop's neck on the emitted polygon
      (`tests/unit/ornamentNeckWidth.test.ts`).
- [x] `src/ornament/export/morphology.ts` — the erosion/dilation the width checks are built on
      (`tests/unit/ornamentMorphology.test.ts`).
- [x] `src/ornament/export/preflight.ts` — all eight checks, blocking on error
      (`tests/unit/ornamentPreflight.test.ts`).
- [x] `src/ornament/export/lightburn.ts` — the colour preset, with group ids remaining authoritative.
      The filename, the `LIGHTBURN_PRESET` constant and the stored `exportPreset: 'lightburn-colors'`
      value are **holdovers from a wrong assumption about the target software** and have not been
      renamed; see "The target laser software is xTool Studio" below.
- [x] `src/ornament/export/metadata.ts` — app version, schema, viewport, providers, build mode,
      dimensions, timestamp, settings, plus the project JSON embedded as CDATA.
- [x] `src/ornament/export/pathTransform.ts` — translating glyph and marker path data rather than
      emitting a group transform (`tests/unit/ornamentPathTransform.test.ts`).
- [x] `src/ornament/export/download.ts` — SVG plus project JSON, with the DOM isolated from the pure
      export path.
- [x] Exit criteria, automated and browser-verified parts: both modes export from real captured
      geometry, the finished diameter is within 0.1mm, every cut path is closed, and loose pieces are
      reported rather than hidden — 796 tests passing repo-wide, and both modes opened and rendered
      correctly in Chrome against the built container.
- [ ] Exit criteria, manual part: **the file has not been opened in xTool Studio or Inkscape.** Ben
      has to do this before Phase 4 counts as complete. See below.

### The lake tool's `ManufacturingScene` is still not the export path

The gap recorded below was real: `validatePanel()` rejects coordinates outside `width x height`, so
that path cannot describe a disk centred on the origin. The choice was between generalising it and
writing a serializer for the ornament. The ornament got its own, because the two products disagree
about more than their outline: `ManufacturingScene` is a stack of same-sized panels laid out in a
row, and the ornament is two or three differently-shaped pieces that must stay in register with one
another. Generalising the validator would have removed the one assertion that makes the lake tool's
own output safe, in exchange for a shape it still could not lay out. `geometryPath`, the font
registry and the text vectorizer are still shared.

### Product direction change: the marker was removed from the generator

Ben decided against generating a marker at all — he adds one by hand in xTool Studio per order. This
supersedes the keep-out work recorded in earlier revisions of this document, which is gone.

**Removed.** The whole marker domain: `marker.kind`, `marker.sizeMm` and the `MarkerKind` type; the
`markerSizeMm` limit; the `setMarker` action and its clamp; `src/ornament/markers/ornamentMarker.ts`
and the directory with it; `src/ornament/geometry/markerKeepOut.ts`; the `piece/marker/cut-or-engrave`
export group and the `marker` piece id; the heart/pin/house selector, the size control and the whole
Marker section of the controls; the `marker` field in `FeatureGeometrySettings` and the `keepOut`
field in `FeatureGeometryResult`; `roadGeometry`'s `keepOutCircles` option and
`keepOutClippedPieces` metric; the `marker-over-water` warning and the submerged-circle rule that
raised it; the `preview/marker-keepout` overlay; and `tests/unit/ornamentMarkerKeepOut.test.ts`.

**Kept.** `src/geometry/scene/keepOut.ts` is untouched apart from `KeepOutTarget` losing the two
`ornament-*` members that existed only for the marker. `keepOutFootprint`,
`clipPolylineAgainstCircles`, `pointInsideAnyCircle` and `regionAffects` are exactly as the compass
left them, and the compass still uses them. `src/geometry/scene/markerRegistry.ts` is the *lake*
tool's marker artwork, consumed by `Controls.tsx`, `MarkerCard.tsx` and `buildScene.ts`; it was never
part of this and is not touched.

`pathBoundsMm` moved to `src/ornament/export/pathTransform.ts`. It is a property of path data rather
than of markers, the path translation is checked against it, and leaving a one-function module behind
to hold it would have been worse than moving it.

**Evidence the removal is complete.** After regenerating, all eight golden fixtures are byte-identical
to the digests recorded before the keep-out was ever added — the geometry pipeline is exactly where it
was. The emitted SVG for both modes contains no occurrence of "marker", "keepout", "keep-out" or
"heart", asserted in `ornamentSvgExport.test.ts`.

#### The persisted schema was not versioned up

`schemaVersion` stays at 1. A project saved by the previous build carries a `marker` key that nothing
reads; it rides through `persistence.ts`'s merge as an inert extra property and is re-saved untouched.
Bumping the version would have rejected every one of those projects outright to avoid carrying a few
unread bytes. `ornamentIslandThreshold.test.ts` loads an old-format record and asserts it still opens,
keeps its other settings, and that nothing in the shipped type refers to the dead key. Verified
against the live container too: the browser's stored project predated the removal and loaded cleanly.

### Product direction change: one connected land piece by default

`land.islandPolicy` now defaults to `bridge` rather than `keep-separate`, and the bridge policy was
made to finish the job: it joins what it can reach with visible tabs and drops only fragments already
below the size the user called meaningful. Anything it cannot reach *and* is meaningful is kept,
reported, and left to the user.

Loose land is now a **warning under every policy**, where it had been an error under bridge and omit.
The old rule assumed a policy leaving something loose had failed. It had not: what reaches that point
now is a real island, too far from shore to tab and too large to be one of the specks already called
noise. On the Geneva Lake fixture the islands sit 18–30mm from the mainland and one is 567mm²; there
is no bridge length that reaches them and no threshold that drops them without destroying the map.
Blocking would have left the maker to discover that the only way to get a file out is whichever
setting silences the message — which is the outcome `landIslands.ts` argues against at length.

Measured on the fixtures: the coast fixture goes from two land pieces to one, joined by a 7.97mm tab.
On live Geneva Lake data in water-cutout mode the land now comes out as a single connected piece with
three holes and no loose fragments at all.

The golden fixtures deliberately still pin `keep-separate` and their own 4mm² threshold. A golden
file exists to show what the pipeline does to a given input; if it tracked the defaults, changing one
would silently rewrite every recorded digest and the file would stop being evidence.

#### The omit threshold is 2mm², and that is looser than what it replaced

`minIslandAreaMm2` defaults to 2 rather than 4. Ben was asked explicitly whether "islands under 2mm"
meant an area or a largest linear dimension, because the setting has always been an area in mm² while
"2mm" is a length, and the two give materially different answers. He chose **area: 2mm²**.

Worth stating plainly because it runs opposite to how the instruction reads: 2mm² omits *fewer*
islands than the 4mm² it replaced. A 3mm² island that used to be dropped is now kept. That was the
stated decision, not an oversight, and `ornamentIslandThreshold.test.ts` pins the before/after so it
cannot drift back by accident.

### Departures and judgment calls

- **The frame is not rebuilt from the plan's boolean sequence; Phase 1's result is reused.**
  `buildOrnamentGeometry` already performs it: body union loop, subtract the loop hole, subtract the
  map opening. The plan's fourth step, "union the remaining ring, text band and loop bridge", is
  implicit there — subtracting only the opening *above* the chord leaves the text band attached, so
  the three are already one polygon and there is nothing to union. Re-deriving the frame in the
  export would also break `ornamentCropMask.test.ts`, which pins the preview's crop to being
  byte-identical to the frame's own opening. What Phase 4 adds is the fifth step, repair and
  simplify, in the form of the preflight checks: self-intersection, closure and winding are asserted
  on the emitted polygon rather than assumed from the engine that produced it.
- **`piece/land/roads-engrave` carries roads in classic mode too**, where they engrave onto the base
  piece. The group list has exactly one group for roads and the list is the contract; `data-piece`
  on the group records which physical piece it belongs to.
- **Every group that applies to the build mode is emitted even when empty.** An absent group then
  means "not applicable to this mode" rather than "applicable but empty", which an operator cannot
  otherwise tell apart.
- **Text overflow blocks the export**, although the editor treats it as a warning. In the editor the
  user is still typing; at export, a line wider than the chord it sits on engraves across the map
  window or past the rim.
- **Registration marks are four 0.8mm engraved dots** at the structural ring's midline, on the base
  and land pieces only — never on the frame, whose front face is the one the customer sees. The plan
  names the group and calls it optional but does not specify the mark; this is a choice.
- **Green and cyan are this implementation's choice.** The plan specifies red for cut, black for
  engrave and blue for the light water pass. Registration and labels still need a layer of their
  own, so they were given green and cyan — picked, at the time, from LightBurn's palette, because
  LightBurn was believed to be the target. It is not; see below. Those two colours in particular were
  chosen to satisfy a constraint that turns out not to apply, so they are the weakest part of the
  preset and the first thing to change if xTool Studio wants something else.
- **`piece/marker/cut-or-engrave` was removed from the group list.** The list is the export contract
  and this is a real change to it: a sheet is now two or three stacked pieces and nothing else. The
  remaining eight ids are unchanged.

### The target laser software is xTool Studio

The build plan assumed LightBurn and this phase was written against that assumption. **The actual
hardware and software in use is xTool Studio.** Nothing in the exported geometry depends on which of
the two opens it — the file is plain SVG in real millimetres with no transforms, no live fonts and no
stylesheet — but three things were reasoned about in LightBurn's terms and have to be re-checked
rather than carried over:

1. **The colour-to-operation convention** (red cut, black engrave, blue light-water-engrave, plus
   green registration and cyan labels). This was chosen because LightBurn assigns one layer per
   colour and snaps unknown colours to its own palette. Whether xTool Studio does anything of the
   kind is unverified. It may key off colour differently, ignore colour entirely, or import
   everything onto one layer.
2. **Hairline stroke width.** `CUT_STROKE_MM` is 0.1mm on the reasoning that LightBurn ignores stroke
   width and cuts the path, while a viewer needs something non-zero to draw. If xTool Studio instead
   interprets a stroked path as a shape to be filled or offset, that number matters.
3. **Whether group ids survive the import at all.** The group ids are the authoritative contract and
   are correct regardless, but the practical value of naming them depends on the importer preserving
   or at least displaying them.

**Naming not changed, deliberately.** `src/ornament/export/lightburn.ts`, the exported
`LIGHTBURN_PRESET` constant, and the persisted `ExportPreset` union value `'lightburn-colors'` still
say LightBurn. Renaming the union value is a stored-project schema change, and a slightly awkward
one: `exportPreset` is not clamped by `clampOrnamentProject` at all today — `persistence.ts` merges
it straight out of `localStorage` — so a rename would need migration code written rather than
adjusted, or every project saved before the rename would come back holding a value the union no
longer contains and the preset control would show neither option selected. The value is also
asserted in `tests/unit/ornamentStore.test.ts` and `tests/unit/ornamentSvgExport.test.ts`. That is
more than a documentation correction should carry, so it is left for whoever does the rename
properly. Treat the name as a label for "the colour-coded preset", not as a claim of compatibility
with any particular program.

(Worth noting on its own, and not only because of the rename: `clampOrnamentProject` forces every
stored *numeric* into range, but every *union-typed* field is spread through unchecked —
`exportPreset`, `buildMode`, `displayUnit`, `roads.detail`, `land.islandPolicy`, `marker.kind`,
`marker.output` and each `text.*.fontId`. `loadOrnamentProject` treats persisted data as untrusted
and clamps it for exactly this reason, so the gap undercuts a guarantee the code already intends to
make: a hand-edited or stale `localStorage` entry can put any of those into a value the UI cannot
represent and the reducer will never correct. Phase 5 material.)

#### What Ben needs to do

Export both modes, then in **xTool Studio**:

- Confirm the ornament measures its configured diameter — 101.6mm at the defaults — and that the
  sheet matches the `width`/`height` on the `<svg>` element and the `lms:dimensions` entry in the
  metadata. The sheet size varies with the design (it is sized around the pieces), so measure the
  ornament, not the sheet, as the fixed reference. If everything arrives roughly 3.78× too large,
  the importer is reading user units as pixels and ignoring the `mm` suffix.
- Confirm cut and engrave end up separable — by colour, by group, or by whatever xTool Studio keys
  off — and record which, because that is what the preset should be built around.
- Confirm `registration/optional` and `labels/non-production` can be switched off or deleted, and
  that they are not silently treated as cuts. A cut through a registration dot ruins the piece.
- Confirm the text and marker render as filled outlines, not as missing glyphs or hairline outlines.
- Confirm nothing is dropped. The SVG is plain text: `grep -o '<g id="[^"]*"' file.svg` lists every
  group the file contains, and each `<path` inside one is a shape. Compare that against what xTool
  Studio shows. A silently dropped group is the failure mode worth looking for, because the piece
  still looks plausible without it.

Inkscape is the second half of the same manual pass and is equally unverified. Chrome was checked
directly against the built container and renders both modes correctly.

### The neck width check

The plan requires the loop to be "connected by at least the configured minimum neck width", and
requires it of the exported geometry rather than of the editor preview. Those are different claims
about different objects, and the editor's existing check only makes the first.

`evaluateHangingLoop` solves the two circles' radical line and reports the chord where they cross.
That is arithmetic about the diameters and the overlap. It never looks at the frame, so it cannot see
a mistake in the boolean chain, a repair pass that trimmed the bridge, or a loop hole dipping below
the junction and splitting one wide neck into two thin struts.

So the export measures the polygon. It erodes the frame by w/2 and asks whether any single connected
component still holds both loop material and body material — the definition of "joined by at least w
of material" — and binary-searches w for the largest value that still passes. The probes are regions
rather than points: the loop's annulus on the far side of its hole, and the frame inside the body and
outside the loop. Taking the *far* half of the annulus is deliberate; the whole annulus reaches down
to where the loop meets the body, so a component touching only that last sliver would count as
connected without ever crossing the bridge.

On the default ornament this measures 3.98mm against a 4.00mm prediction — the loop's own annulus,
not the 11.90mm junction chord, because the annulus is the narrowest point on the path from the
hanging point to the body. Reporting the chord would overstate the connection threefold.

`tests/unit/ornamentNeckWidth.test.ts` damages the frame polygon while leaving every parameter valid,
so a regression that replaced the measurement with `geometry.loop.junctionWidthMm` fails it. Its last
case sweeps every loop the editor will accept and asserts that each one is either refused or really
does have the material.

### Product direction change: the hanging loop moved to the backing in three-piece mode

In water-cutout (three-piece) mode the hanging loop is now cut as part of the **backing / water**
piece (`piece/base/cut`), not the frame. Classic two-piece mode is unchanged.

The reason is structural. The three-piece frame is a 6mm rim with the map window hollowed out of it,
joined to the text band, and the whole ornament used to hang from the top of that rim. The backing
is a solid disk, so hanging from it puts the load through the widest, most continuous piece in the
stack, and the frame becomes decorative.

- **Backing** = body disk ∪ loop outer disk − loop hole (`buildThreePieceShapes` in
  `geometry/ornamentShape.ts`). It is the same loop: the same circles from `evaluateHangingLoop`,
  the same configurable overlap, the same minimum neck width. `buildOrnamentGeometry` has already
  refused any loop that fails those checks, and when it has, the backing falls back to the plain
  disk so preflight finds the loop detached and blocks.
- **Frame** = body disk − loop hole − map window: the ring plus the text band. None of the loop's
  outer disk survives, so there is no bridge stub. The loop-hole subtraction is a no-op on the
  default ornament, where the hole sits wholly above the body. It is kept so that a large overlap,
  which dips the hole into the rim, notches the frame where the backing is notched rather than
  covering part of the hole the ribbon goes through.
- **Preflight** measures the neck on whichever piece `OrnamentPieceSet.loopPiece` names
  (`loopPieceFor(mode)` in `export/pieces.ts`): the frame in classic mode, the backing in
  three-piece mode. The measurement itself (`neck.ts`) is unchanged. The probes are built from the
  same circles, and the body probe's ring is solid material on the backing just as it is on the
  frame. On the default ornament the backing measures 3.984mm, the same figure the classic frame
  measures. The thin-feature sweep now treats the backing as structural (an error, not a warning)
  in three-piece mode, as it always has the frame. Messages name the piece. In classic mode that
  name is "frame", so classic findings read exactly as before.
- **Finished diameter** is measured on the frame in three-piece mode, because the backing's bounding
  box is now taller than the ornament by the loop's height. Classic mode still measures the base.
- **Layout** needed no special case. Pieces are spaced by their own bounds, loop included, so the
  backing's bounds grow by the loop and the sheet grows with them. On the default ornament the sheet
  is the same size as before, since the loop's height moved from one piece to another rather than
  being added. The new tests sweep the default, 25mm and 300mm ornaments, plus a loop wider than the
  disk, and assert that no two pieces overlap and that every piece is inside the margins.
- **Stack diagram** draws the loop as a ring on the layer that carries it: the frame in classic
  mode, the backing in three-piece mode. The frame's description reads "no loop" in three-piece mode.

Proof that classic output is byte-identical: `tests/unit/ornamentPieceGolden.test.ts` pins the
SHA-256 of the whole classic SVG for all four golden fixtures under both presets, plus preflight's
verdict and finding codes. The goldens were recorded before any source changed and pass unchanged
after it. The existing feature-geometry goldens are digests of roads, water and land, which never
reach the pieces, so on their own they could not have shown this. The three-piece sheet goldens
beside them record each piece's components, holes, area, bounds and offset, so a reviewer can see
the loop move from frame to backing. Behaviour is pinned in
`tests/unit/ornamentLoopOnBacking.test.tsx`.

## Phase 5 — complete

The plan's four hardening items. Marker-related coverage is absent throughout because the feature is
gone: what the plan asked for there no longer has a control to be applied to.

### 1. Cancellation and stale-result guards, and timeouts

Three separate races, guarded in three different places, because they fail differently.

**A superseded geometry build** was already guarded in Phase 3 by the revision check in
`OrnamentPage`, and the runner terminates the worker rather than letting a cancelled job keep a core.
Unchanged.

**A capture that lands after the project has moved on** was not guarded, and could not be seen from
the geometry side. `onCapture` stamped the snapshot with the project's *current* fingerprint, so a
capture whose settings the user had changed while it was in flight was recorded as describing the new
ones — export unblocked, against features read under the old ones. `snapshotFromCapture()` in
`snapshot.ts` now builds the fingerprint from the capture's own record (`viewport`, `detail`,
`innerRadiusMm`), so a capture that no longer matches the project reads as stale on arrival and
blocks export with the reason already written for it.

Worth stating precisely, because it is easy to over-claim: *panning* during a capture was never this
bug. `captureOrnamentFeatures` waits for the map to settle and only then reads the viewport, so a pan
during the wait is part of the view that gets captured, and a pan across the read itself is caught by
the before/after check that throws `moved`. The value that genuinely goes stale is road detail, which
is read *before* the wait because it decides which layers to query.

**A capture that never reports at all** — the map unmounted mid-capture, an exception swallowed
between the two — left nothing to clear the working state, and the capture button read "Working…"
for the rest of the session. `CAPTURE_TIMEOUT_MS` (20s) in `OrnamentPage` is the outer bound, longer
than the capture's own 8s idle timeout so it cannot fire underneath it. A report arriving after the
watchdog has given up is dropped rather than reviving a capture the user was told had failed.

**A wedged worker** now has `DEFAULT_GEOMETRY_TIMEOUT_MS` (30s) in `geometryRunner`. It terminates the
worker, because a worker inside a synchronous Clipper union cannot be asked to stop, and rejects with
`GeometryTimeoutError` — distinct from a cancellation, since one is expected and the other is a fault
the user has to be told about.

The inline runner deliberately takes no timeout. `buildFeatureGeometry` runs synchronously on the only
thread there is, so a timer set before it cannot fire until after it has finished; a timeout there
would be decoration. That path is protected by the capacity limits instead.

Export itself is synchronous and likewise cannot be pre-empted by a timer. It is bounded by the
limits below rather than by a clock, which is the honest arrangement rather than a timeout that
cannot fire.

### 2. Feature, vertex, memory and simplification limits

`src/ornament/limits.ts`, sized for the ornament this tool is actually for — up to 4in / 101.6mm —
and explicitly recorded as such in `ORNAMENT_CAPACITY.sizedForDiameterMm`, so a future larger
ornament is a deliberate revisit rather than a silent inheritance.

| Limit | Value | Effect |
|---|---|---|
| `maxCapturedFeatures` | 12,000 | Capture refused |
| `maxCapturedVertices` | 400,000 | Capture refused |
| `simplifyAboveVertices` | 25,000 | Capture thinned before building |
| `simplifyToleranceMm` | 0.04mm | The tolerance thinning works to |
| `warnOutputVertices` | 200,000 | Built geometry reported as large |

A refusal is thrown as a `CaptureError` with code `too-large`, at the capture boundary — before the
capture is stored, before it crosses into the worker, and before the UI has claimed anything was
captured. Both refusal messages name the two levers the user actually has: zoom in, or drop road
detail.

Simplification is Ramer–Douglas–Peucker (`geometry/simplify.ts`), run on **projected millimetres**
rather than on longitude and latitude, so the tolerance is a physical distance on the finished piece
and means the same thing at every zoom and latitude. 0.04mm is roughly a quarter of a typical 0.15mm
laser kerf, so it is not visible on any size this tool supports. It removes points and never moves
them, keeps rings closed, and returns a ring unchanged rather than destroying it where thinning would
collapse it below three points.

An ordinary capture is untouched — the golden fixtures are well under the threshold and their digests
are unchanged by this work, which is the check that a limit meant for pathological captures has not
quietly started thinning every export.

### 3. Keyboard, mobile and accessibility coverage

Against the plan's §Accessibility list, applied to the current UI:

- **Real labels on all controls** — already held; now enforced by a test that walks every input in
  the control pane and fails on any without an accessible name.
- **Keyboard-operable segmented controls** — they were reachable (they are buttons) but cost one tab
  stop per option. Now the standard toolbar pattern: one tab stop for the group resting on the live
  option, arrow keys between options, Home/End to the ends. `aria-pressed` is retained.
- **Numeric values adjacent to sliders and editable directly** — already held; now covered by a test
  that pairs every slider with its number input and checks they share one value, one range and one
  step.
- **Status/progress through a polite live region** — this was the real gap. Progress existed only as
  a button label, and a label changing under a screen reader is not announced. `PipelinePhase` in
  `OrnamentPage` is now one value for what the pipeline is doing, rendered as a
  `role="status" aria-live="polite"` region carrying `aria-busy`.
- **Errors explain how to recover** — held; the new failure states (capture too large, capture
  timeout, build timeout) each name what to change, and are tested for it.
- **Colour never alone for cut/engrave** — the drawing already encoded role structurally (a cut is an
  unfilled stroke, an engrave is filled) but never said so. A legend now names each role and its
  shape treatment before its colour, the swatches are `aria-hidden` because the words carry the
  meaning, the cut and engrave groups carry `<title>` elements, and every finding in the status badge
  is prefixed with the word "Error" or "Warning" rather than relying on its border colour.

**Mobile** needed a real fix, not just coverage: `index.html` had no viewport meta at all, so a phone
would have laid the page out at a 980px virtual viewport and scaled it down — the breakpoints could
never have applied. It now has one, plus the `lang`, charset and title that were also missing. Below
720px the two panes stack, fields go full width, and controls take a 38px minimum touch target; below
420px the preview's floating legend and metrics become static so nothing overlaps at 390px.

### 4. Provider, licence, attribution and self-hosting documentation

[`docs/ornament-operations.md`](ornament-operations.md). It consolidates rather than duplicates: the
reasoning stays in ADR 0002 (fonts) and ADR 0003 (geocoder proxy, MapLibre CDN), and the new page is
the procedure — what can be swapped and how, what has to be credited and where the four places are
that credit appears, and what changes when each external dependency is self-hosted.

### The map element fills the preview pane

Tonight's restructure made the preview show the full map with the exterior dimmed rather than
hard-clipped, so a user can see the geography they are panning past. The map element itself was still
only the square circumscribing the ornament's inner opening, though, so "the full map" reached barely
past the frame — about 527px of a 694x722 pane.

The element is now the smallest rectangle **centred on the ornament centre** that covers the whole
pane. Centred on the ornament centre, not on the pane, is the part that matters: the export
projection puts the ornament's (0,0) at the map's centre pixel, so growing the element around that
point keeps this a presentation change and nothing more. It is a rectangle rather than a square
because the ornament centre sits below the pane's centre — the hanging loop extends the drawing
upward — and it is allowed to overhang the pane, which `.ornament-preview`'s `overflow:hidden`
contains.

Two things had to change with it, and both are improvements in their own right:

**The scale no longer comes from the element's width.** `captureOrnamentFeatures` used to compute
`mmPerPx` as `innerRadiusMm*2 / canvasWidthPx`, which was correct only while the element *was* the
ornament's map window. It now takes `mmPerPx` from the preview layout. Had it kept deriving the scale
from the element, an ornament exported from a maximised window would have come out a different
physical size from one exported from a small window — the exact class of bug the plan's "do not infer
export scale from an arbitrary DOM fallback" rule exists to prevent. `assertProjectionAgrees` checks
the supplied number against the live map at a probe point, so a wrong scale fails loudly at capture
rather than silently at the laser.

**The capture queries the ornament window, not the element.** `queryRenderedFeatures` is now given an
explicit bounding box of `innerRadiusMm` either side of the element centre. Querying the whole element
would read thousands of features that exist only to be clipped away, and would have made the captured
feature count — and therefore the capacity limits above — depend on how large the user's browser
window happened to be.

### Fixed: a flaky test, and the gap behind it

`ornamentMapUi.test.tsx`'s "re-capturing after a move clears the dirty state" failed under full-suite
load and passed in isolation.

Its `captureGeometry` helper waited for "Captured N feature(s)". That text appears when the snapshot
is set — one render *before* the geometry built from it finishes, at which point the pipeline is still
busy and the capture button still reads "Working…". The helper therefore returned mid-pipeline, and
the re-capture case is the one that immediately queries that button by its settled name. Whether that
synchronous query found "Re-capture map geometry" or "Working…" depended on when an out-of-act React
state update happened to flush, which under load it sometimes had not.

The wait condition was the bug, so the fix is a wait condition that is actually the completion
condition: the helper now waits on `aria-busy` on the progress region — the pipeline's own account of
whether it has finished. That region had to exist anyway for the accessibility requirement above, so
the test and the screen reader now synchronise on the same signal. No timeout was lengthened and no
retry was added.

`tests/unit/ornamentHardening.test.tsx` pins the invariant directly: at the moment the snapshot text
first appears the pipeline still reports itself busy and the button still reads "Working…", so
`aria-busy` is the only safe thing to wait on.

## Next concrete phase

Phase 5 — hardening.

## Known gaps carried into later phases

- **Arc/curved text is not implemented.** `textVector.ts` sets straight baselines only. If the
  design later wants the subtitle or date following the rim curve, that is new per-glyph rotation
  work, not a parameter.
- **`ManufacturingScene` assumes a rectangular product.** Resolved in Phase 4 by not using it — see
  above. The lake tool's validator is unchanged and still rejects coordinates outside
  `width × height`, which is correct for the product it describes.
- **No ZIP packaging for the ornament.** The lake tool ships individual panels as an archive; the
  ornament writes one sheet plus the project JSON. Splitting the pieces into separate files has not
  been asked for and would lose the registration between them that the shared origin line provides.
- **Inkscape and xTool Studio have not been opened against the output.** The exit criteria name
  three programs; Chrome was verified directly against the built container, and neither of the other
  two is installed in this environment. This is the one outstanding item on Phase 4 and it is a
  manual step for Ben — see "The target laser software is xTool Studio" above for what to check.
- **The colour preset is unverified against the real importer.** Red/black/blue plus green/cyan were
  chosen for LightBurn's layer model, which is not what is being used. The group ids are the
  contract and are unaffected; the colours are a convenience whose usefulness is currently assumed
  rather than known.
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

