# V2 implementation status

Tracks the build order in `docs/V2_FEATURE_SPEC.md`. One section per step: what was built, the
judgment calls behind it, how it was verified, and what is still open. Product-specific histories
stay in `ornament-implementation-status.md` and `topo-implementation-status.md`.

## Step 1: close the A5/A6 gaps (2026-10-20)

Branch `feat/v2-step1-estimate-preview`, stacked on `fix/size-entry` (PR #7). Commits `4ffaa91`
(code and tests) and `2d19d67` (topo 3D view height).

### What already existed (PR #3 and its follow-ups)

Most of A5/A6 was already in `src/production/`: the estimate from the export geometry (cut, score
and engrave per piece), per-machine settings with placeholder flags, the three confidence levels,
material config, calibration entries with an estimate/actual ratio, the lazy three.js preview with
an explode slider, PNG export at 3000/4000/6000 px, and a lake test that the preview matches the
export path for path (`tests/unit/productionPreviewMatchesExport.test.ts`). Step 1 builds on those
rather than replacing them.

### A5: estimate

| Gap | Built | Where |
| --- | --- | --- |
| Uncalibrated badge | Pill next to the machine time: Placeholder speeds, Uncalibrated, or Calibrated | `estimate/ui/EstimatePanel.tsx`, `confidenceBadge` in `estimate/estimate.ts` |
| Actual minutes show percent error | Live as the minutes are typed, and per recorded job, against the 15% gate | `estimate/calibration.ts` (pure), panel |
| Summary in the export ZIP | `estimate.json` and `estimate.txt` inside the Individual Files ZIP | `estimate/exports.ts` (`estimateSummaryFiles`, `estimateFilesFor`), `export/svg/exportSvg.ts`, `App.tsx` |
| Topo (spec table: "per order") | Estimate section 9 on the topo page; `-estimate.json` and `-estimate.txt` beside the SVG on export | `adapters/topoBoard.ts`, `topo/ui/TopoPage.tsx` |

Judgment calls:

- **Percent error is against the real job**: (estimate − actual) / actual. Positive means the
  estimate ran high. The gate passes at |error| ≤ 15%.
- **No clock reading in the ZIP summary.** The lake ZIP pins its timestamps so re-exporting an
  unchanged design gives identical bytes. `generatedAt` is left out of the packed JSON; a test
  checks two exports are byte-identical. Design time comes from the saved design timer, the same
  rule as the panel (`designTimeFrom`).
- **Only the Individual Files layout is a ZIP.** Production Sheet and Registered Layers still
  download a single SVG with no summary beside it; the panel's Estimate JSON / Quote buttons cover
  those. Adding a second download to every single-SVG export was not done without asking.
- **Recipes can be limited to a product** (`LayerRecipe.products`). Ben's seven recipes are
  lake-map recipes, so an 11x14 topo board no longer gets a TruFlat top and a hand-made border; it
  is estimated by bed fit with a "no layer recipe" warning. Saved configs from before migrate: the
  default recipe ids get `['lake-map']`, recipes Ben added stay for every product. The recipe
  settings tab has a "For" selector.
- **Hairline scores stay scores.** With roads set to "engraved", a stroked line becomes an engrave
  area (length × width). A score with no width (a topo contour) used to become zero area, so zero
  time; it now stays a score (`strokedLengthMm` in `job.ts`). Lake output is unchanged: every lake
  score has a width.
- **Topo pieces** (`adapters/topoBoard.ts`): `cut/terrain-1…4` are the layers. Roads, contours, the
  route and glyphs are counted on layer 1, because the single SVG does not say which layer they are
  burned on, so the totals are right but the per-layer split puts them on the base. The frame is
  costed as its own piece but not stacked in 3D. `cut/water` is not counted: it is layer 1's own
  water holes, so counting it again would double that cut length. Layers 2–4 use their own bounding
  box for sheet fit.

### A6: 3D preview

| Gap | Built | Where |
| --- | --- | --- |
| Proof PNG ≥ 2000 px long side | "Save proof PNG": opaque neutral background (`#ecebe8`), current size and watermark. `finalizePreviewPng` refuses any image under 2000 px on its long side; every offered size is 3000 px or more on its long side | `preview3d/previewImage.ts`, `ui/Preview3D.tsx` |
| Test: preview layers match the export | Lake test already existed; added the topo equivalent on the real Golden Gate board | `tests/unit/productionTopoAdapter.test.ts` |
| Topo 3D preview | "3D Preview" tab in topo edit mode, lazy-loaded, earth-tone defaults | `topo/ui/TopoPage.tsx`, `preview3d/stack.ts` |

The preview background now defaults to the opaque neutral grey instead of transparent; the
"Transparent background" checkbox still gives a transparent Export PNG. (The old headless check
`~/lms-work/verify/preview3d.js` expects a transparent default and will report that line as failing
until it ticks the checkbox first.)

### Bundle sizes (`npm run build`, Vite)

| Chunk | Before (9425f1c, the spec commit on fix/size-entry) | After (2d19d67) |
| --- | --- | --- |
| `index` (main) | 762.99 kB, gzip 231.30 kB | 768.08 kB, gzip 232.58 kB |
| `Preview3D` (three.js, lazy) | 580.79 kB, gzip 148.03 kB | 581.61 kB, gzip 148.34 kB |
| `TopoPage` (lazy) | 94.44 kB, gzip 32.71 kB | 98.31 kB, gzip 33.95 kB |

three.js stays out of the main bundle, and the topo page reaches it through the same lazy chunk.
The main bundle grew 5.1 kB (calibration, summary and topo-adapter code shared by both tools). The
"~858 KB" in the task prompt does not match this build; the measured baseline is above.

### Verification

- `npx tsc -b`: 0 errors. `npx vitest run --maxWorkers=3`: 130 files, 1674 tests passed.
  `npm run build`: passed.
- New tests: `productionCalibration` (percent error and gate, the estimate on fixed 100 × 100 mm
  geometry with every number worked by hand, summary text and JSON, recipe product scope and its
  migration, ZIP contents and byte-identity), `productionTopoAdapter` (Golden Gate board: preview
  layer count, order and path data equal to the SVG, solids' area and volume, water not double
  counted), `productionProofImage` (2000 px floor, neutral background), and panel tests for the
  badge and the live percent error.
- Production container (port 8088, image `7682cc9c4637`), headless Chromium under a 60 s kill:
  `~/lms-work/verify/v2-estimate.js`, `v2-proof.js` and `v2-topo.js` all pass, as does the earlier
  `estimate.js`. Mary Lake MI at 11x14: estimate 20.1 min machine time, $29.45 total, badge
  "Uncalibrated"; the ZIP holds 5 panel SVGs plus `estimate.json` and `estimate.txt`; the proof PNG
  is 3000 × 2250 with an opaque neutral background; the topo board (Crivitz, 9 × 9 in, 4 layers)
  builds 4 solids for 4 non-empty terrain groups in its SVG.
- Rollback: `layered-map-studio:rollback-pre-v2-step1` (`bb34b293bcff`, the `fix/size-entry`
  deploy).

### Open

- **The 15% gate is not run.** It needs a real job timed on the P2S; only Ben can do that. Enter
  the minutes xTool Studio reports in "Calibrate machine time"; the panel shows the error against
  the gate.
- **P2S settings still marked placeholder:** score speed, score power and engrave power. Cut
  50 mm/s at 70%, engrave 400 mm/s and line interval 300 lines/cm are from Ben's notes (2026-10-15).
  The P2S bed (600 × 308 mm) is xTool's published figure, not measured. Topo boards depend on the
  score speed (contours), so their badge says "Placeholder speeds" until it is entered.
- Topo has no layer recipes yet; Ben can add one per size in the estimate settings ("For: Topo maps").
- Next step in the build order: **2. B2 max-depth table**.
