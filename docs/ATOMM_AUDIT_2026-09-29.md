# Atomm lake generator: code audit (2026-09-29)

> **Status: Atomm work is shelved until Nov/Dec 2026.** This audit records the state of the code on
> 2026-09-29 so the work can resume from facts rather than memory. Re-verify the build state before
> acting on it; anything committed after `8e4cb71` is not covered.

Report only. No code was changed for this audit. It checks the lake depth map tool against the
Atomm Generator docs:

- https://dev.atomm.com/docs/quickstart
- https://dev.atomm.com/docs/publish
- https://dev.atomm.com/docs/design/platform
- https://dev.atomm.com/docs/export
- https://dev.atomm.com/docs/export/svg-color-spec

Where this conflicts with `docs/ATOMM_LAKE_GENERATOR_HANDOFF.md`, this audit is the verified
source (see "Conflicts with the handoff doc" below).

## Verified build state

- Branch `master`, HEAD `8e4cb71` (2026-09-25 09:22, CLAUDE.md-only). Last code commit `f9ec901`
  (2026-09-25 09:18).
- Container `layered-map-studio-layered-map-studio-1` (port 8088) was created 2026-09-27 07:47 UTC
  from an image built 2026-09-27 02:47 -05:00, which is after the commit. The Dockerfile builds from
  the working tree (`COPY . .`), so the timestamp alone proves nothing. To check it, `f9ec901` was
  built in a throwaway worktree. All five asset hashes (`index-Gq7jcwNk.js`, `index-DWx3mHE3.css`,
  `geometryWorker-B3QIPcOv.js`, `featureWorker-BdRNl3ah.js`, `terrainWorker-Sm34YSeL.js`) are
  identical to the running container's. **The container runs exactly `f9ec901`.**
- At audit time the working tree had uncommitted UI/theme work: 8 modified files plus
  `src/theme/`, `src/styles/`, `src/components/ui/` and `tests/unit/theme.test.tsx`. **None of it
  is in the running container.** Findings below are against `f9ec901`; where the uncommitted edits
  change a finding, that is noted.

## Corrections to the assumed stack

- **The lake tool has no Web Workers.** `buildGeometryLayers` runs synchronously on the main
  thread (`App.tsx` `generate()`/`rebuildScene`). The only workers belong to the ornament
  (`geometryWorker`) and topo (`featureWorker`, `terrainWorker`) tools.
- **The lake tool has no project persistence.** It uses no IndexedDB and has no project save or
  load. Its only `localStorage` use is the bathymetry lookup cache (`bathymetry/resolver.ts`).
  `persistence.ts` exists only under `src/ornament/` and `src/topo/`. Project state lives in memory,
  apart from the developer "Copy Crop JSON" panel.
- **MapLibre is not an npm dependency.** It is loaded from `unpkg.com/maplibre-gl@5.6.2` by a
  classic `<script>` tag in `index.html` and used as a global (`declare const maplibregl`).
- **Geocoding:** lake search uses `ProxyGeocoder('photon')` via `/api/geocode`. Nominatim is only the
  marker-lookup fallback (`FallbackGeocoder`). The server also has a US Census adapter.
- **Polygon libraries:** `clipper-lib` and `polygon-clipping`. Zip output uses `fflate`.

## 1. Bundle isolation

`App.tsx` imports `OrnamentPage` and `TopoPage` directly, so the current bundle ships all of the
ornament and topo code plus their three workers (850 KB main chunk).

A trial lake-only build that only removed those two imports produced 664 KB JS (200 KB gzip), no
workers, and about 1.4 MB for all of `dist` including fonts. Two things remain in it:

- **Procedural Terrain depends on ornament code.** `src/geometry/terrain/contourLines.ts` and
  `src/geometry/terrain/nestedBands.ts` import `simplifyRing`/`simplifyLine` from
  `src/ornament/geometry/simplify.ts`. That file is 73 lines and imports only a type from
  `polygonEngine`, so it can move to shared `src/geometry/` without other changes.
- **The bathymetry module.** `Controls.tsx` imports `bathymetry/model`, `bathymetry/resolver` and
  `bathymetry/providers`. `export/buildScene.ts` imports `bathymetry/depthGeometry`.

`GeocoderService.ts` imports only *types* from `server/geocode/types`, which are erased at build
time.

Recommendation: give the Atomm build its own entry point rather than stripping imports from
`App.tsx`, so the Docker build keeps all four tools.

## 2. Depth modes for the public version

- **True Bathymetry: drop it.** It needs user-supplied GeoJSON. "Check Bathymetry" can only ever
  succeed for Wisconsin DNR: `NoaaNceiProvider` and `UsgsProvider` are hard-coded to return
  `unsupported`. The lookup makes browser requests to `dnrmaps.wi.gov`. A successful lookup also
  silently switches the mode to True Bathymetry.
- **Procedural Terrain:** the main feature.
- **Artistic Depth:** the simpler secondary option. It is currently the default mode
  (`defaultProject.ts`).

## 3. Procedural Terrain performance

These are full `buildGeometryLayers` times (median of 3) on the four real-lake fixtures in
`tests/fixtures/liveLakes.ts`. They were measured with Node on the VM (Ryzen 9 5900X) at
14×11 in and 24×18 in, with 3 and 5 depth panels.

| Mode | Time per rebuild |
|---|---|
| Artistic Depth | 39–268 ms |
| Procedural Terrain, default controls | 76–201 ms |
| Procedural Terrain, rugged + terraced | 107–325 ms |

- The terrain grid is capped at 512 cells on the long side (`DEFAULT_TERRAIN_RESOLUTION`), so
  product size barely matters. The cost is contour extraction and the polygon booleans.
- Every terrain slider change triggers a full synchronous rebuild on the main thread (after a
  120 ms debounce). The terrain controls are part of the geometry cache key. On an ordinary laptop
  in a browser, expect roughly 0.3–1 s of frozen page per adjustment. That is an estimate, not
  measured.
- **Recommendation:** move `buildGeometryLayers` into a worker before launch. The code is already
  pure (no DOM), so the move is mechanical.
- **Output size is not a concern:** at most about 250 KB for a production SVG, and at most about 90 KB
  for the per-layer zip.

## 4. Public labeling (generated, not measured)

Existing disclaimers that should be kept:

- The terrain controls say Procedural Terrain is "generated artwork shaped by the shoreline, not
  surveyed depth".
- The Artistic Depth section says offsets are "normalized design units, not surveyed depths".

Public labels that do not say "generated":

- The mode dropdown options "Artistic Depth" and "Procedural Terrain", and the section-summary
  label in the uncommitted `Controls.tsx`.
- The section heading "3. Depth Data" ("Depth data" in the uncommitted version).
- The layer names "Artistic Depth N" and "Terrain Depth N" (`buildScene.ts`). They appear in the
  preview's layer picker (`GeneratedPreview.tsx`) and in `previewSvg.ts`.
- The slider labels "Max depth" and "Bottom profile", which read as physical quantities.
- Exported files: they are named `layer-depth-N.svg` and carry no mode or disclaimer text.
- If bathymetry is removed: the default status line ("Bathymetry has not been checked…"), and the
  developer-facing "12. Developer: Crop Reproducibility" and "Geometry metrics" panels.

The Atomm listing's card title and description go through Atomm review and need the same
"generated, not measured" wording.

## 5. Export against the Atomm spec

| Requirement | Current state (`src/export/svg/exportSvg.ts`) |
|---|---|
| Export goes through `atomm.lifecycle.on('export', …)` | ❌ `App.tsx` downloads through a Blob URL and an `<a>` click |
| Cut stroke `#FE0002`, engrave `#2366FF` | ❌ The root sets `stroke="#000" fill="none"`. Operation is marked only by `data-operation` on `<g>` elements, which Atomm does not read (the processing attribute must go on each element, never a `<g>`). No shape would get a processing type. |
| No `<use>` | ✅ None in the lake export |
| mm units, viewBox in mm | ✅ `width="…mm" height="…mm" viewBox="0 0 W H"` |
| Static zip ≤ 50 MB | ✅ About 1.4 MB, once the section 6 blockers are fixed |
| SDK script tag survives the build | ✅ Likely. Vite keeps the classic unpkg `<script>` tag unchanged in `dist/index.html`, and the SDK tag is the same kind of tag. Recheck it in the packaged bundle. |

**ZIP vs single file.** The export hook accepts `{filename, blob}` or an array of them. An array
downloads as a platform-made zip, and an array of one downloads directly. So the per-layer export
should return an array of SVGs, and the `fflate` zip step is not needed for Atomm. Combined size
must be ≤ 100 MB.

Untested: "Open in Studio" with multiple files. The docs say it needs xTool Studio 1.8+ and that
"identical groups merge across files". Registered-layout layers all sit at the origin, so in one
Studio canvas they would probably overlap. The Production Sheet layout (one SVG, panels side by
side) is the safer file to send to Studio. This needs a real test in Studio.

The spec does not mention `transform`, which labels, title and compass use (`translate() rotate()`).
Either test it or bake the transforms into the path data.

## 6. Blockers for a static bundle

1. **Geocoding needs the server.** Search goes through `/api/geocode`, and a static Atomm bundle has
   no server. The code's own comments say direct browser calls to Photon or Nominatim are forbidden
   by the plan, and they would conflict with Nominatim's usage policy at public traffic levels.
   Decision needed: a hosted proxy (the handoff recommends a Cloudflare Worker) or another option.
2. **Root-relative paths will break.** Vite's default `base` gives `/assets/…` URLs, and fonts load
   from `/fonts/…` (`text/fontRegistry.ts`). Both will 404 under Atomm's subpath. They need
   `base: './'` and relative font URLs.
3. **MapLibre and map tiles come from outside.** MapLibre loads from unpkg and tiles from
   OpenFreeMap (`VITE_MAP_STYLE_URL`). Atomm's docs say nothing about external requests either way.
   Bundle MapLibre from npm, and confirm tile loading inside the Atomm runtime.

Also check: the uncommitted UI adds a "Layered Map Studio" wordmark header. Atomm's platform rules
forbid rebuilding or imitating the platform top bar.

## Bugs affecting the current product (not Atomm-specific)

These affect `maps.oldglorydecor.com` today, whatever happens with Atomm. Neither was reproduced in
xTool Studio during this audit; both follow from the exported SVG. Confirm with a test import before
fixing.

### Roads use `stroke-width` for thickness

`buildScene.ts` gives each road a `strokeWidthMm` (defaults: major 0.45 mm, minor 0.25 mm), and
`exportSvg.ts` writes it as a `stroke-width` attribute on a single centreline `<path>`. Laser
software treats a stroked path as a vector line: it follows the centreline and ignores the SVG
stroke width. So the "Major/Minor width mm" controls change the preview but probably not the cut
piece, and every road engraves at the laser's line width. The fix is to export roads as closed
outline polygons, buffering the centreline by half the width (the repo already has Clipper
offsetting), so the width is in the geometry.

### Text is exported as stroked outlines (hollow letters)

Title, subtitle, place labels, road labels, marker labels and the compass letters are glyph
outlines from opentype.js (`text/textVector.ts`). They are exported as `<path>` elements with no
fill of their own, inheriting the root's `fill="none" stroke="#000"`. Imported as-is, each letter
is an outline, so a vector engrave traces the letter's edge and leaves the inside un-engraved
(hollow letters) unless the user changes the fill in xTool Studio. The compass has the same problem.
Engraved text should be exported as filled closed paths (`fill` set, no stroke) so it imports as a
fill engrave.

## Conflicts with the handoff doc

`docs/ATOMM_LAKE_GENERATOR_HANDOFF.md` differs from the verified code in these places:

- **§3, "geometry, procedural terrain engine, workers … are imported from existing modules":** the
  lake tool has no workers to import. A worker for `buildGeometryLayers` has to be written (see
  section 3 above).
- **§2, "Project save/load … stays in the Old Glory version only":** the lake tool has no project
  save/load, so there is nothing to exclude.
- **§5, "The existing LightBurn/xTool Studio preset for the main app stays unchanged":** the lake
  export has no color preset. It is uniform `stroke="#000"`, with operation marked only by
  `data-operation` on groups. The only LightBurn preset in the repo is the ornament tool's
  (`src/ornament/export/lightburn.ts`).

## Suggested order (when the work resumes)

1. Separate Atomm entry point; move `ornament/geometry/simplify.ts` into shared `geometry/`.
2. Keep bathymetry out of the Atomm build.
3. Color-spec export through the hook, returning an array of SVGs.
4. Relative `base` path and font URLs.
5. Geocoder decision.
6. Geometry worker.
7. Labeling pass.
