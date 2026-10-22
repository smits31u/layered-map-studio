# Golf Course Map Starter: Layered Map Studio Plan

**Owner:** Ben · **Drafted:** 2026-10-22 · **Status:** Plan only, no code yet
**Repo:** `layered-map-studio` (FleetVM, `~/projects/layered-map-studio`, container port 8088)
**Deployed at:** `maps.oldglorydecor.com`

---

## 0. Read this first (Claude Code)

1. **Confirm this file is in the repo** at `docs/GOLF_MODULE_PLAN.md`.
2. **Confirm where you are running.** State the hostname and working directory. The deploy target is the Linux VM, not the Windows desktop.
3. **Inspect before building.** Map the existing topo builder, ornament maker, lake tool, shared geometry, terrain-tile proxy, geocoder abstraction, SVG preflight, and design tokens. Golf must reuse them. Report the integration points before writing code.
4. **"Done" means deployed.** A phase is complete only when the change is merged, the container has been rebuilt, and the rebuild time is later than the last commit. Check the production container, not the dev server.

### Clean-room boundary

This feature is inspired by watching how competing golf-map tools behave as a user. Build it from this spec and from public, documented techniques only.

- Do not use any competitor's source code, bundles, API endpoints, credentials, tilesets, preset names, palette names, default dimensions, UI copy, or filenames.
- All defaults in this document are original choices. Change them freely; do not chase parity with any other product.
- Data comes only from OpenStreetMap (ODbL), USGS 3DEP or AWS Terrain Tiles (public), and user input.

---

## 1. What it is

A **Golf** starter inside the existing app. The user picks a course and a board size, and the app generates a stacked-layer, cut-ready map of the course into the same project/layer model the topo builder uses. It is not a separate tool.

**Buyers:** golfers as gifts (retirements, Father's Day, first hole-in-one, league trophies), couples ("our first round"), course pro shops, and clubhouse decor.

**Success criteria:**
- **Phase 1 done:** a real board for one well-mapped Wisconsin course cut on the xTool from generated files, with no hand-editing except placement.
- **Phase 3 done:** a customer order fulfilled in under 30 minutes of design time.

---

## 2. Data

### 2.1 Course search

- Use the existing geocoder abstraction (Photon primary, Nominatim fallback, both behind the existing rate limiter and cache).
- Filter results to golf courses. Photon uses `osm_key=leisure, osm_value=golf_course`; Nominatim uses `class=leisure, type=golf_course`.
- Return up to 5 candidates with name, city/state, and **OSM type + ID**. The user picks one.
- Fallback: "Can't find it?" lets the user click a point on the map. The server then looks for a `leisure=golf_course` area containing that point.

### 2.2 Course snapshot (server side)

Add a route to the existing app server (do not stand up a new service):

`GET /api/golf/snapshot/:osmType/:osmId`

1. Fetch the course boundary (`leisure=golf_course` way or relation) with full geometry.
2. Fetch features inside the boundary's bbox plus a 50 m pad:
   - `golf=hole` (routing line; tags `ref`, `par`, `handicap`, sometimes `dist`)
   - `golf=fairway`, `green`, `tee`, `bunker`, `rough`, `water_hazard`, `lateral_water_hazard`, `cartpath`
   - `natural=water`, `water=pond|lake`, `waterway=*`
   - `natural=tree`, `natural=wood`, `landuse=forest`
3. Clip everything to the boundary plus the user's margin, in the projected working CRS.
4. Return a normalized snapshot: boundary, bbox, features grouped by role, holes (number, par, handicap, tee point = first vertex of the routing line, green point = last vertex), course totals, and a **coverage report** (count per role).

Note on Overpass: a lookup by the course's OSM ID returns only the boundary. Fairways and greens are separate ways that are usually not members of the course relation, so step 2 is a separate spatial query.

### 2.3 Caching and rate limits (required, not optional)

- Use public Overpass for now. Send one request at a time with a descriptive User-Agent and a 60 s timeout.
- Cache snapshots on disk, keyed by `{osmType}-{osmId}-{queryVersion}`. Reuse the topo tile cache's locking pattern (the eviction-race fix in `tileCache.ts`), not a new ad-hoc cache.
- Store `fetchedAt` in the snapshot. Add a manual "Refresh from OSM" button. There is no automatic expiry, because course geometry rarely changes.
- On HTTP 429 or 504, return a clear "OpenStreetMap is busy, try again in a minute" error and never cache the failure.
- Later (with Land Map Phase 5): switch to a self-hosted Overpass or a Wisconsin OSM extract.

### 2.4 Elevation (Phase 3 only)

- Reuse the topo builder's terrain engine and server-side tile proxy as-is.
- Prefer **USGS 3DEP 1 m** where available (see `LAND_MAP_MODULE_PLAN.md` section 3.1), falling back to Terrarium. Most Wisconsin courses are too flat to produce useful terraces at 10 m resolution. 1 m lidar plus relief-based level picking is what makes terraces worth offering here.
- Detect flat courses (relief under ~2 m after smoothing) and default to zero terraces, with an explanation.

### 2.5 Data the user types in

OSM almost never has these. Treat them as manual fields from the start, never as "pre-filled when available":
- course rating, slope, architect, year established, total length (use `dist` sums only if every hole has one)
- personal line ("Our first round together"), line above the name

Par and handicap come from OSM when present and stay editable.

### 2.6 Licensing

- "© OpenStreetMap contributors" in the app UI, the export manifest, and any product listing. The physical board doesn't need it.
- Course names are factual. Never use course logos or trademarked artwork.

---

## 3. Coverage gate

Before generating anything, show the coverage report as a checklist: holes, fairways, greens, tees, bunkers, water, trees. Flag these:

- **Blocking warning:** no `golf=hole` lines, or fewer greens than holes. The map will be missing obvious features. The user can continue only after confirming.
- **Soft warning:** no bunkers, no tees, or no rough (rough can be synthesized; see section 5.3).
- Hole count that isn't 9/18/27/36: note it and continue (executive and par-3 courses exist).

This is the main guard against discovering missing greens at the laser.

---

## 4. Setup flow

1. **Course:** search, pick, review coverage.
2. **Shape:** rectangle (rotated to fit the course's long axis), or course outline plus margin. Phase 2 adds the shape library already used by other products.
3. **Size:** finished width x height. Original default: **457 x 305 mm (18 x 12 in)**, margin 8 mm, "keep north up" toggle (off = rotate to best fit). Show real-world coverage and scale.
4. **Scope:** whole course, or a single hole (Phase 2). Multi-layout courses (27 holes) offer layouts by nine.
5. **Border:** none, edge, or frame with width.

---

## 5. Layer model

All layers use the shared project/layer model and the shared sheet stock setting (default 3 mm). Listed bottom to top:

| # | Layer | Contents | Default op |
|---|---|---|---|
| 0 | Floor | Solid backing. Water areas engraved or left for stain so ponds read through | cut outline |
| 1 | Ground | Course area with water cut out | cut |
| 2..n | Terraces (Phase 3, 0 by default) | Area above each elevation level, from the terrain engine, water subtracted, nested | cut |
| n+1 | Surface pieces | Fairways and greens as separate cut pieces to glue on | cut |
| n+2 | Trees (optional) | Canopy pieces; **off by default** | cut |
| - | Plaque (optional) | Title block as its own piece | cut + engrave |

### 5.1 Marks on the visible surface (the key logic)

Bunkers, tees, rough, cart paths, routing lines, hole numbers, and tree engravings are not their own sheets. Each one is marked on whichever layer is **visible from above** at that spot.

    exposed(k) = region(k) - union(region(j) for every layer j above k)
    for each mark feature F:
        for each layer k from top down:
            part = F intersect exposed(k)
            if part is not empty: add part to layer k's marks

- Every mark offers engrave, score, or none.
- Greens get an engraved inset (paint pocket) and a scored collar ring, both toggleable.
- Hole numbers: a small badge near the tee, placed on the exposed layer, with collision avoidance against greens and other badges.
- Routing: a scored line from tee to green, interrupted where it crosses a green.

### 5.2 Splitting pieces across terraces (Phase 3)

When terraces exist, a fairway that crosses a terrace boundary would rock on the step. Split each surface piece by each terrace's exposed region and tag each part with the terrace it sits on (T1, T2, ...). This tag goes into the export as an engraved or labeled ID so gluing is unambiguous.

### 5.3 Synthesized rough

If OSM has no `golf=rough`, optionally generate it as a band around fairways and greens using the existing offset code (default width 4 mm on the board, clipped to the course and subtracted from water, fairways, greens, tees, and bunkers). Always label it as generated in the UI.

### 5.4 Trees

Cutting hundreds of canopy pieces is a brutal glue-up. Default to **engraved** tree marks on the exposed surface. The optional cut-piece mode places canopies from mapped woods and individual trees, never over fairway, green, tee, or water, with a **hard cap of 150 pieces** and a warning that shows the glue-up count.

### 5.5 Floating pieces

Reuse the existing island policy and bridge/tab logic (ornament island threshold, topo bridge tabs). On each cut layer, detect regions not connected to the frame and offer keep as a separate piece, weld with tabs, or omit below a size threshold. Never drop a meaningful piece silently.

### 5.6 Placement guides (Phase 2)

Optional: score the outline of each glued piece onto the layer it sits on, so placement is a trace job.

---

## 6. Title block

- **Layouts:** header strip with stats, or corner block. Text goes on the board, on a separate plaque piece, or nowhere.
- **Fields:** course name and city/state (pre-filled), line above the name, par, length, rating/slope, year, architect, personal line. Each field can be toggled.
- Uses the existing bundled fonts and opentype.js text-to-path. No live fonts in export.
- Compass to true north and an automatic scale bar, both optional. Use the project's own compass asset if one exists; otherwise create an original one.

---

## 7. Export

- Reuse the existing preflight (closed paths, self-intersections, NaN/Infinity, dimensions, tiny islands, minimum feature width). Add golf checks: every surface piece is tagged, no mark falls outside its exposed region, and piece counts are under the caps.
- **One SVG per physical sheet**, delivered as a ZIP, each in mm with matching viewBox and stable semantic groups (`cut/...`, `score/...`, `engrave/...`). Use the existing operation color preset; metadata is authoritative.
- Filename convention (original): `{course-slug}-L{index}-{role}-{stock}mm.svg`, for example `mid-vallee-L3-surface-pieces-3mm.svg`.
- `manifest.json` in the ZIP: course, OSM IDs, snapshot `fetchedAt`, settings, per-sheet piece counts, stack order, gluing notes (terrace tags), OSM attribution, app version.
- Hook into the planned V2 material and machine-time estimate when it exists. Piece counts and cut lengths per sheet are its inputs.

---

## 8. Phases

### Phase 0: assessment (no code)
Report the existing modules golf will reuse, the starter/template entry point in the UI, how projects persist, and where the server routes live. Write `docs/golf-implementation-status.md`.
**Exit:** an integration plan naming the files to add/change, approved by Ben.

### Phase 1: flat course, core layers
- Course search, snapshot route, disk cache, coverage gate.
- Rectangle shape, size, margin, north-up.
- Floor, ground (water cut out), surface pieces.
- Marks on the visible surface: bunkers, tees, routing, hole numbers, green inset and collar.
- Title block on the board.
- Per-sheet SVG ZIP export with manifest and preflight.

**Exit:** one recorded fixture course generates deterministic output; a live run against a real course exports and opens in xTool Studio at the correct size; the container is rebuilt and verified.

### Phase 2: shapes and finishing
Course-outline shape with margin, shape library, single-hole mode, placement guides, floating-piece detection with tabs, plaque piece, synthesized rough, engraved trees.
**Exit:** single-hole and outline exports cut cleanly; no unintended loose pieces.

### Phase 3: terrain and optional pieces
Terraces from the shared terrain engine (3DEP first), flat-course detection, piece splitting with terrace tags, optional cut trees with cap.
**Exit:** one genuinely hilly course and one flat course both behave correctly; the flat one defaults to zero terraces and says why.

---

## 9. Tests

- **No public services in unit tests.** Record small Overpass responses as fixtures with ODbL attribution.
- **Fixtures:** a well-mapped 18-hole course; a poorly mapped course (missing greens) to trigger the blocking warning; a course with ponds and islands; a 27-hole multi-layout course; a course crossing the board edge.
- **Unit/property tests:**
  - exposed-region math: marks never leave their exposed region, and an exposed region never overlaps the layer above
  - surface-piece splitting covers the original piece with no gaps or overlaps
  - synthesized rough never overlaps fairways, greens, tees, bunkers, or water
  - snapshot normalization is deterministic for a fixed fixture
  - cache key changes when `queryVersion` changes
  - failures (429/504) are never cached
- **End-to-end:** search, pick, coverage, generate, edit, export; refresh from OSM; Overpass-busy error is recoverable.

---

## 10. Risks

- **OSM coverage quality** is the whole product. Small-town courses are often half-mapped. The coverage gate is non-negotiable.
- **Overpass throttling.** Cache, serialize requests, and plan the self-hosted move.
- **Flat terrain.** Terraces are a feature for hilly courses only. Don't market them as standard.
- **Glue-up labor.** Piece caps and terrace tags exist to keep fulfillment under 30 minutes.
- **Scope creep.** No 3D mesh preview in this module. Use the planned V2 stacked-preview image when it exists.
