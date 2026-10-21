# Layered Map Studio — V2 Feature Spec

Oct 20, 2026 · @Ben

## Where things stand

V2 builds on five shipped pieces; nothing here replaces an existing engine. This doc supersedes the August `lake-map-generator.md` deferred list, which predates procedural terrain and the topo builder.

| Piece | Status | What V2 reuses |
| --- | --- | --- |
| Lake depth generator | Shipped, in use | Place search, offset rings, curved labels, opentype.js text-to-path, ZIP export |
| Procedural Terrain depth mode | Shipped | Distance transform, seeded noise, marching squares with exact nesting |
| Bathymetry module | Shipped | Measured GeoJSON import, provenance; Michigan DNR source merged Oct 2026; Wisconsin has no measured source |
| Ornament maker | Shipped | 2-piece and 3-piece export, xTool Studio confirmed |
| Topo builder | Phases 0-4 shipped | Terrarium proxy and cache, water masking, roads, bridges, GPX, 12-group SVG preflight; compass and road-name labels deferred |

The estimate and 3D preview already exist in src/production/ (PR #3), with Ben's cut/engrave settings, one machine per board size (P2S, OMTech, Thunder), TruFlat 12x19 sheets and the $25/hr rate. V2 only closes their gaps. Production runs the stacked PR branch fix/size-entry (PR #7); master stops at the PR #2 merge.

Repo `layered-map-studio`, one container on port 8088, live at maps.oldglorydecor.com.

## Ground rules

Competitor studies (TopoStack, DuperCut, others) are feature inventories only. They decide what to build, never how.

- **No borrowed numbers.** No competitor code, CSS, copy, presets, icons or numeric defaults, including per-feature line widths and kerf/margin values. Defaults come from Old Glory test burns on the P2S.
- **Every data source has a recorded basis** in `docs/data-attribution.md`: license, attribution text, access date. Confirm HydroLAKES and GLOBathy licenses before use. Confirm Wisconsin DNR lake-map terms before selling traced maps.
- **No tracing commercial charts.** gpsnauticalcharts and similar paid charts are off-limits unless the publisher gives written permission.
- **Provenance stays honest.** Three labels: measured (vector survey data), traced (digitized from a named chart), generated (procedural). Generated depths keep the not-for-navigation notice.
- **OpenStreetMap credit** goes on the listing or product card and in the ZIP manifest.
- **Session hygiene.** Confirm a referenced doc is in the repo, confirm the container rebuild matches the latest commit, and verify in the production container, not the dev server.

## Workstream A: shared engine and export

These live in shared geometry/export code so lake, topo and the future land map tool all get them at once.

| ID | Feature | Lake maps | Topo | Acceptance |
| --- | --- | --- | --- | --- |
| A1 | Layer numbers and registration marks | Engraved number in a hidden spot; next-layer outline optional, since full rectangles self-align | Required: bands 2-4 are floating shapes with no edge to line up against | Mark sits inside the area covered by the next layer, inset 2 mm or more; if it won't fit, the export names the skipped layer |
| A2 | Bed splitting | Needed for 16x20, 18x24 and 24x36 on the P2S. Hidden MDF layers may split; the top TruFlat/birch layer never splits | Same rule; large topo pieces | Work-area and stock-size settings per machine profile (P2S, friend's 36x52); oversize top layer blocks export with a clear error |
| A3 | Minimum feature cleanup | One mm threshold for slivers and tiny islands | Same | Single shared setting; export report lists what was dropped |
| A4 | Single-line fonts for engraved text | Road and place labels | Labels, title | Engrave text as open strokes in engrave groups only; cut text keeps filled fonts; preflight allows open paths only in engrave/score groups |
| A5 | Material and machine-time estimate (exists, PR #3) | Per order | Per order | Gaps: uncalibrated badge, actual-minutes input showing percent error, summary in the export ZIP. Gate: within 15% of a timed real job |
| A6 | Stacked 3D preview image (exists, PR #3) | Proofs, listing photos | Same | Gaps: proof PNG at 2000 px or more on the long side; test that preview layers match the export |
| A7 | Split exports | Cut-only and engrave-only SVGs beside the combined file | Same | Generated from the existing semantic groups, no new geometry |

Font candidates for A4: the Hershey fonts and Relief SingleLine (open font license). Record their license text in the repo.

## Workstream B: lake depth

Traced-chart import is the only V2 item that makes Wisconsin maps more accurate rather than more convenient. Wisconsin has no usable vector bathymetry, so tracing is the only route to real depths.

### B1: Traced chart import (MVP)

Ben traces once per lake; the app reuses it forever. Most orders repeat the same lakes.

1. Trace contours from a Wisconsin DNR map in CorelDRAW or Inkscape, one closed path per depth, and export SVG.
2. Load the SVG over the selected lake's OSM shoreline and align it with 2-3 control-point pairs (translate, scale, rotate).
3. Tag each path with a depth and unit, then feed it through the bathymetry module's existing measured-import path with provenance "traced from <map name, date>".
4. Clip to the shoreline, enforce nesting, and generate layers with the existing pipeline.
5. Save the traced lake to a library keyed by lake so the next order skips steps 1-4.

Acceptance: a large share of contour length clipped away by the shoreline triggers a misalignment warning; nesting holds; re-import gives byte-identical output; provenance shows in the UI and SVG metadata. Pilot lake: Shawano, then Noquebay, Legend Lake and Pelican.

A full in-browser image/PDF tracer is deferred. It only pays off if customers trace their own lakes.

### B2: Max-depth table

A small JSON file of the Wisconsin lakes Old Glory sells: name, county, max depth (ft), DNR source URL and date. Procedural Terrain mode defaults its max depth from it and warns when a user value differs by more than 25%. This stops the Noquebay problem: modeled at 110 ft, real depth about 51 ft. A global estimate (GLOBathy) is an optional labeled fallback for lakes not in the table.

### B3: Click-to-select lake (optional)

Clicking a lake uses its OSM water polygon from the tiles already loaded. HydroLAKES is attributes only: its outlines are coarser than OSM and it omits lakes under 10 ha.

## Workstream C: topo

TopoStack is a topo tool first, so most of its fabrication ideas pay off here rather than on framed lake maps. Topo bands are floating shapes stacked on a base, not full rectangles.

| ID | Feature | Notes | Acceptance |
| --- | --- | --- | --- |
| C1 | Hollow layers with glue margin | Toggle: solid (default, framed) or hollow (free-standing). Hollow cuts each band as its visible ring plus a margin under the next band. Saves material; makes A1 marks mandatory | Hollow layer covers its visible ring plus the margin; no piece under the min-feature width; loose rings flagged |
| C2 | Live physical readout | Relief, layer count, stack height (mm), horizontal scale 1:N, vertical exaggeration, elevation per layer | Updates without regenerating terrain |
| C3 | Vertical exaggeration and layer cap | Set relative to material thickness | Readout and export agree |
| C4 | Scale bar and lat/long grid | Original designs, engrave groups | Scale bar length matches board scale within 0.1 mm |
| C5 | Compass (deferred item) | Original design, shared with the lake tool | Separate engrave group |
| C6 | Road-name labels (deferred item) | Reuse the lake tool's curved labels | Collision-filtered, single-line fonts when engraved |
| C7 | KML and GeoJSON import | Tracks to route, polygons to boundary, points to markers. Feeds the land map tool (stands, food plots, trails) | Same validation rules as GPX |
| C8 | Marker and logo library | Upload SVG; engrave, score outline, or cut through to the layer below. Topo and land map only; the ornament marker stays removed | Uploaded paths normalized and preflighted |

Flat-land contour spacing already lives in `LAND_MAP_MODULE_PLAN.md`; this doc doesn't repeat it.

## Workstream D: flat engraving mode

A cheap, fast product line from the existing contour engine: one engrave file, no stacking. It feeds SKUs Old Glory already sells (wood coasters $8, cutting boards $30/$50, ornaments $10) and the craft-fair table.

- **Sources:** lake depth (procedural, traced or measured) and topo elevation.
- **Output:** a chosen number of contour lines with every Nth line heavier, a water fill (none, hatch, ripple, dots: original patterns), optional border and title, crop to rectangle, circle or rounded square.
- **Product presets:** wood coaster, slate/leatherette coaster, 10x14 cutting board, 4 in ornament. Tumbler wraps are left out while tumblers are being sold off.
- **Time estimate:** engrave minutes per preset from A5, so batch pricing is known before a fair.

Acceptance: a single SVG with everything in engrave/score groups, exact preset dimensions, and a time estimate within 15% of a timed engrave.

## Deliberately skipped

| Item | Why not |
| --- | --- |
| Kerf compensation | Stacked layers sit on top of each other instead of fitting together. Revisit only for inlay products |
| Nesting engine | Lake layers are full rectangles; xTool Studio handles placement |
| Paint mask templates | Low value until painting becomes the bottleneck |
| d3-contour | The in-house marching squares already has a proven nesting guarantee |
| Copying competitor linework presets | Clean-room rule; tune from test burns instead |
| Tracing gpsnauticalcharts maps | Commercial chart; copyright risk without written permission |
| DXF and PDF exporters | Still deferred; xTool Studio takes SVG |

## Build order

Finish what's already picked, then accuracy, then shop time, then new products. Each step ends with tests, a production build, and a check in the rebuilt production container.

1. **Close the A5/A6 gaps (calibration input, uncalibrated badge, ZIP summary, proof PNG).** Gate: estimate within 15% of a timed real job; preview layers match the export.
   *Progress 2026-10-20:* built and deployed (branch `feat/v2-step1-estimate-preview`), topo included. Preview-matches-export: **passed** (lake and topo tests). 15% real-job gate: **not run yet**, waiting on Ben's timed job. Details in `docs/implementation-status.md`.
2. **B2 max-depth table.** About an evening. Gate: Noquebay defaults to its DNR depth.
3. **B1 traced chart import, Shawano pilot.** Gate: a real 11x14 Shawano map cut from traced data with no hand edits except placement.
4. **A1 layer numbers and A4 single-line fonts.** Gate: labels engrave as single strokes in xTool Studio, with the time saving measured.
5. **A2 bed splitting.** Gate: 16x20 lower layers cut in panels on the P2S, top layer whole.
6. **D flat engraving mode.** Gate: coaster and cutting-board presets engraved and timed.
7. **C1-C8 topo items,** pulled in as topo and land map orders justify them. A3 and A7 ride along with whichever step touches export first.

If Wisconsin lake maps stay the top seller, step 3 can jump ahead of step 1.

## Open questions for Ben

- [ ] Production already assigns one machine per board size (P2S, OMTech, Thunder). If the big sizes always go to a big machine, A2 bed splitting drops in priority. Which machines are yours?
- [ ] Which lakes to trace first, and do you have the DNR map PDFs for them?
- [ ] Are free-standing topo pieces a product, or framed only? Decides whether C1 is worth building.
- [ ] Wood coaster and slate coaster sizes for the D presets.
- [ ] Wisconsin DNR lake-map terms of use: confirm before selling traced maps.
- [ ] Still pending from the land map plan: the Wisconsin State Cartographer's Office email on parcel licensing.
