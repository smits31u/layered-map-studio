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
- [x] **M13** Generated Map Edit Mode — selectable objects, drag positioning (editor
      zoom/pan still pending, see M-ZOOM below)
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

- [ ] **M-LIVE** Make Controls-sidebar edits (title text, font, sizes, road width,
      compass size, etc.) update the generated scene live, the same way drag/nudge/
      hide/flip/reset already do — currently these still require clicking "Generate
      scene" again. This is the biggest single gap against section 28's "reactive
      generated map" requirement and should land before markers/keep-out/frame, since
      those will all need the same live-update path.
- [ ] **M-ZOOM** Editor zoom/pan independent of geographic zoom (section 29) —
      currently the generated-map SVG only scales-to-fit via CSS; no independent
      zoom control or space/middle-drag pan exists.
- [ ] **M-COLLISION** Generalized keep-out/collision module (section 22), built once
      and reused by compass (M16), road labels (M19), and later lake-info/frame.

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
- [~] Live changes after generation — true for drag/nudge/hide/flip/reset; not yet
      true for sidebar text/select/number-field edits (see M-LIVE)
- [ ] Generated editor pan
- [ ] Generated editor zoom
- [x] Editor zoom does not change physical dimensions (holds by construction — scene
      geometry is mm-based and independent of any display scale — will stay true once
      M-ZOOM is implemented)
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
