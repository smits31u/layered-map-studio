# V1.0 milestone checklist

Status against the development-order milestones and V1.0 acceptance criteria. Checked
items are implemented and covered by a passing test in the current suite (`npm test`);
unchecked items are genuine gaps, not aspirational claims. This file is meant to be
updated as each milestone lands — do not mark something done without a test proving it.

## Milestones 1–19 (already substantially complete)

- [x] **M1** Repository + application shell + Docker
- [x] **M2** MapLibre map viewer + location search (Photon; Nominatim fallback pending)
- [x] **M3** Physical dimensions + geographic crop/aspect ratio
- [x] **M4** Canonical geographic → mm projection — isotropy verified by dedicated tests
- [x] **M5** Water/road/place feature extraction
- [x] **M6** Geometry engine (`polygon-clipping` + `clipper-lib`; see `docs/v1-architecture.md`
      for why a Clipper2 migration isn't recommended)
- [x] **M7** Progressive shoreline layers (Artistic Depth — tuned against 4 real reference
      lakes; see `docs/artistic-depth.md`)
- [x] **M8** Production strip export — Caldron Falls dimensions/panel-count regression-tested
- [x] **M9** Road geometry (major/minor width, All/Main/Off)
- [x] **M10** Place labels
- [x] **M11** OpenType font conversion (Inter, Cinzel, Great Vibes — bundled, license-checked)
- [~] **M12** Road labels + text-along-path — vector labels on the longest straight
      sub-segment of each named road; **not** full glyph-by-glyph curve-following (a
      documented simplification, not a gap to silently close later without deciding
      it's worth the complexity)
- [x] **M13** Generated Map Edit Mode — selectable objects, drag positioning, editor
      zoom/pan (M-LIVE, below)
- [x] **M14** Title/subtitle/backer
- [~] **M15** Classic compass rose — three real styles implemented; **no N/E/S/W
      lettering yet** on the rose (real gap)
- [ ] **M16** Dynamic compass keep-out geometry — not started
- [ ] **M17** Address markers — not started
- [x] **M18** Draggable place and road labels
- [ ] **M19** Road-label candidate scoring / collision avoidance — not started (current
      placement is deterministic, not scored against other objects)

## Milestones 20–25 (not started)

- [ ] **M20** Frame/inset system
- [ ] **M21** Lake-information block + data-provider abstraction
- [x] **M22** Composite preview (already exists, predates this milestone numbering)
- [ ] **M23** Project save/load
- [~] **M24** Export options — SVG (combined/production/individual) done; JPG/PNG
      preview and project JSON export not started
- [x] **M25** Docker deployment + regression suite

## New/reordered work this spec calls for that didn't have a milestone number

- [x] **M-LIVE** (done — this milestone). Controls-sidebar edits (title text/size/font,
      subtitle, backer mode/padding, compass style/size/rotation/position, road
      visibility/width, road/place-label visibility/size, physical layer enable/disable)
      now update the generated scene immediately, without clicking "Generate scene"
      again. Editor zoom (25%–400%, Fit/100%/±) and pan are implemented, fully
      independent of geographic zoom and physical export dimensions, and object
      dragging remains physically correct at any editor zoom level. See "M-LIVE
      results" below for exactly what's live vs. what still needs Generate, and the
      architectural changes made.
- [ ] **M-COLLISION** Generalized keep-out/collision module (section 22), built once
      and reused by compass (M16), road labels (M19), and later lake-info/frame. Not
      started — M-LIVE's compass now exposes a stable position/size/rotation state
      that a future keep-out mask can consume without further rework, but no masking
      logic exists yet.

### M-LIVE results

**Now live** (no Generate click needed): title text/font/size/visibility, subtitle
text/font/size/gap/visibility, title backer mode/padding, compass style/size/rotation/
position (corner presets and custom), road visibility mode (All/Main/Off) and major/
minor width, road-label visibility/font/size/offset/flip-all, place-label visibility/
font/size/per-class toggles, and physical layer enable/disable — all update the
generated preview within ~120ms (a short debounce that coalesces rapid typing/clicking
into one rebuild rather than one per keystroke). Drag, nudge, per-object hide/flip/
reset — already live before this milestone — continue to work unchanged.

**Still requires an explicit Generate/"Load visible vector features"**: anything that
changes *which* geography is being used — search/pan/zoom the geographic map, or
re-extract features. This is intentional (section 28 of the M-LIVE brief: "Generate
may still be required" for source changes) and is enforced simply because those
actions don't go through the live-rebuild path at all.

**Architecture**: `buildScene` (src/export/buildScene.ts) is split into
`buildGeometryLayers` (the expensive polygon-boolean shoreline/depth work — water
union, erosion, panel differencing) and `buildPresentationScene` (roads, road/place
labels, title/subtitle/backer, compass — no polygon booleans, safe to re-run on every
edit). `buildScene` itself is now a thin wrapper composing the two, so every existing
caller/test is unaffected. `src/export/geometryCache.ts` provides a pure,
independently-tested cache keyed on exactly the fields that affect the expensive stage
(crop, dimensions, shoreline, bathymetry) — anything else (roads.mode/width, labels,
title, compass, manual overrides) reuses the cached geometry. `App.tsx` holds this
cache in a `useRef` and lightly debounces (120ms) the Controls-driven rebuild path;
drag/nudge/reset from the generated-map editor stay undebounced (they already fire
once per discrete action). Editor viewport state (`src/geometry/scene/viewport.ts`:
zoom, pan) is deliberately framework-free pure math, lives only as local React state in
`GeneratedPreview.tsx`, is never part of `MapProject`, and is never passed to any
`buildScene`/export function — verified by dedicated tests
(`tests/unit/editorViewportIsolation.test.ts`) proving there is no parameter for it to
leak through.

**Known limitation**: `enabledLayers` (physical layer toggles) is deliberately included
in the expensive-stage cache key (it also affects True Bathymetry's automatic threshold
selection, which does need to change when the enabled count changes), so toggling a
layer still triggers a fresh `buildGeometryLayers` call rather than a free filter over
already-computed panels. In practice this remains fast (single-digit milliseconds even
for complex real lake geometry, per the existing Artistic Depth test suite) and was
verified live in-browser, but it is not the fully isolated "layer toggle never touches
geometry" design a future optimization pass could pursue if profiling ever shows it's
needed.

**Found and fixed during manual verification**: the drag-under-zoom Playwright checks
initially reported failures at 100%/200% zoom that turned out to be a test-script bug,
not a product bug — the compass, positioned near the physical top-left corner, was
legitimately clipped outside the visible viewport at those zoom/pan combinations (the
same thing would happen to a real user, who would naturally pan before dragging). Fixed
the test to pan the target into view first; all three zoom levels (50%, 100%, 244%)
then showed drag deltas matching the expected millimeter conversion to 6 decimal places.

## V1.0 acceptance checklist (section 50 of the spec, verbatim structure)

Legend: `[x]` implemented + tested · `[~]` partially implemented (see note) · `[ ]` not started

- [x] Search a lake/location/address
- [x] Pan geographic map
- [x] Geographic zoom
- [x] Set exact finished physical dimensions
- [x] Correct geographic-to-mm conversion
- [x] Extract water
- [x] Extract roads
- [x] Extract places
- [x] Generate progressive physical shoreline layers
- [x] Enable/disable individual physical layers
- [x] Export only enabled layers
- [x] Roads All/Main/Off
- [x] Independent major/minor road thickness
- [x] Place labels
- [x] Draggable place/village labels
- [x] Reset place labels to geographic anchor
- [~] Curved/vector road labels — vector, straight-segment (not curve-following)
- [ ] Road-label automatic free-space candidate scoring
- [x] Individually movable road labels
- [x] Individually hide road labels
- [x] Individual road-label side flip
- [x] Title
- [x] Subtitle
- [x] Multiple fonts (3: Inter, Cinzel, Great Vibes)
- [x] Title/subtitle converted to vector paths
- [x] Draggable title
- [x] Title backer
- [~] Classic compass rose with N/E/S/W — rose shape yes, cardinal letters no
- [x] Compass size control
- [x] Compass drag positioning
- [ ] Compass keep-out / vector knockout
- [ ] Engraving restores when compass moves (depends on keep-out)
- [ ] Address geocoding marker
- [ ] Multiple markers
- [ ] Selectable marker symbols
- [ ] Marker drag
- [ ] Marker reset to true address
- [ ] Frame/artwork inset in exact physical units
- [ ] Safe area guide
- [ ] Optional lake information
- [ ] Editable lake information
- [ ] Draggable lake-information block
- [x] Live changes after generation — drag/nudge/hide/flip/reset AND sidebar text/
      select/number-field edits (title, compass, roads, labels, layer toggles) now all
      update immediately; only a genuine geographic/source change still needs Generate
- [x] Generated editor pan — middle-mouse or left-drag on empty background
- [x] Generated editor zoom — 25%–400%, wheel-to-cursor, Fit, 100%
- [x] Editor zoom does not change physical dimensions — verified both architecturally
      (viewport state is not a parameter of any export function) and by exporting the
      same project at 50%/100%/200% editor zoom and diffing the resulting SVGs
- [x] Composite preview
- [x] Production strip
- [x] Individual layer preview
- [x] Combined SVG export
- [x] Individual SVG export
- [ ] JPG/PNG preview
- [ ] Project save/load
- [x] SVG opens correctly in LightBurn (structural conventions verified: named groups,
      `data-operation` attributes, vector-only paths, exact mm `viewBox`/dimensions —
      not independently re-verified by opening LightBurn itself in this pass)
- [x] Physical dimensions are exact in LightBurn (355.600 × 279.400 mm regression-tested)
- [x] Manufacturing text is real vector geometry (tested: no `<text>` in export)
- [x] Docker deployment works
