# Procedural depth terrain (Phase A: engine only)

`src/geometry/terrain/` generates a depth grid from a shoreline for Artistic Depth. It is meant to
replace the offset-ring approach in `shoreline/artisticDepth.ts` with shoreline-distance-driven
terrain that has organic noise character. Like Artistic Depth, it is artwork, not bathymetry.

**Status:** Phase A (the depth grid) is committed. Phase B (contour extraction, below) is built
and tested, pending review. Neither is wired into `Controls.tsx`, `buildScene.ts`, the geometry
cache or export.

This is a clean-room implementation built from standard, publicly documented techniques. All
constants, curve shapes and presets are original to this module.

## Entry point

```ts
generateDepthTerrain(shoreline: MultiPolygonMm, params?: TerrainParamsInput): DepthTerrain
```

The result holds the grid spec and the normalized params. It also holds these row-major arrays:
`inside` (mask), `bodyId` (−1 outside), `distanceCells`, and `depth`. `depth` is 0 outside the
water. It is also exactly 0 in every cell of a *dropped* body: one with fewer than `minBodyCells`
cells, see below. Every cell of a kept body is strictly greater than 0 and never deeper than its
body's `targetDepth`, and the deepest cell of the largest body is exactly `maxDepth`. `bodies`
holds per-body stats, targets, the `dropped` and `terraced` flags and `topBench`, and `warnings`
holds any warnings.

It throws only for geometry it cannot measure: no coordinates, non-finite coordinates, or zero
extent. Parameters are never rejected. Out-of-range values are clamped, and non-finite values fall
back to the defaults.

## Pipeline

| Step | File | Technique |
|---|---|---|
| 1. Rasterize | `terrainRaster.ts` | Scanline even/odd at cell centres. Each polygon is filled with its own holes, then polygons are OR-ed, so overlapping MultiPolygon members union rather than cancel. The grid has one padding cell on each side. |
| 2. Distance | `terrainRaster.ts` | Two-pass 3×3 chamfer, cost 1 / √2. This equals the octile distance to the nearest land cell, which is at most ~8.2% above Euclidean. |
| 3. Bodies | `terrainRaster.ts`, `depthTerrain.ts` | Iterative 8-connected flood fill. Ids are assigned in row-major order. Tracks cell count and max distance per body. Bodies under `minBodyCells` are dropped: they stay water but get depth 0. |
| 4. Noise | `terrainNoise.ts` | Custom integer hash, value noise with smoothstep, fBm, per-octave ridge blend, and low-frequency domain warp. |
| 5. Grain | `terrainNoise.ts` | Rotate into the grain frame, compress along the grain axis, rotate back. At zero strength this step is skipped. |
| 6. Shape | `terrainProfiles.ts` | Shelf remap, then bank curve, then profile. |
| 7. Normalize | `depthTerrain.ts` | Per body: the deepest cell is set to `maxDepth × areaScale`. |
| 8. Terrace | `depthTerrain.ts`, `terrainProfiles.ts` | At shared global benches k/N × `maxDepth`, after normalization (see "Terracing order" below). |

Per inside cell of body *b*:

```text
t  = (distance − 0.5) / (maxDistance_b − 0.5)             shore is half a cell from an edge centre
t' = (t + A · contrast(noise) · min(1, t/A)) / (1 + A/2)   A = noiseAmplitude
v  = profile(bank(shelf(t')))
d  = v · (maxDepth · areaScale_b) / max_b(v)              deepest cell exactly the target
depth = maxDepth · terrace(d / maxDepth, N, strength, topBench_b)    if b is terraced, else d
topBench_b = floor(areaScale_b · N)                        deepest bench within b's target
```

A body is terraced only if terracing is on and `topBench_b ≥ 1`. Within a terraced body, no cell
snaps past bench `topBench_b`. At full strength every terraced cell sits exactly on its bench, not
an ulp off it.

`contrast(n) = x/(1+2|x|)` with `x = 3(n − 0.5)`. It is smooth and stays strictly inside ±0.5.
Together with the `min(1, t/A)` envelope, this guarantees `t' > t/2`. Noise can therefore never
push a cell of a kept body to zero depth, which would be a dry spot. The effect: shallow contours
stay shoreline-shaped, and deeper contours wander.

Noise is sampled in feature units measured from the shoreline's bounding box. One unit equals
`featureScale ×` the longer side of the box. As a result, the same lake at a different product
size, with a proportionally scaled cell size, gives a byte-identical grid (this is tested).

## Parameters

`TerrainParams` in `terrainParams.ts` is the full set. The comments there give each range.
`expandSimpleControls()` maps the user-facing controls onto it:

| Simple control | Drives |
|---|---|
| `character` 0–1 | noise amplitude 0.2→0.8, octaves 3→6, roughness 0.4→0.6, feature size 0.22→0.12, warp 0.2→1.0. Ridges come in only above 0.4. |
| `bankSteepness` 0–1 | bank slope at the waterline (0.4× / 1× / 7× for 0 / 0.5 / 1). Shelf width 0.22→0. |
| `weave` 0–1, `weaveAngleDeg` | grain strength 0→0.85. Also damps the warp by up to 40% and shrinks the features by up to 40%. |
| `terracing` 0–1 | terrace strength. Levels are fixed at 6. |
| `seed`, `profile`, `maxDepth` | passed through unchanged |

The four profiles each map [0,1]→[0,1] monotonically, with exact endpoints:

- `even-slope`: t
- `smooth-basin`: t(2−t)
- `broad-shelf`: 0.18·t plus a smoothstep drop that starts after 30% of the distance
- `stepped-benches`: four smootherstep benches

## Decisions to review before wiring

- **Resolution:** preferred cell size 0.5 mm, clamped to 64–512 cells on the longer side.
  Caldron Falls and Lake Noquebay reach the 512 cap. They generate in roughly 30–60 ms on the VM.
- **Body scaling exponent 0.5:** depth scales with the square root of the area ratio. That is,
  depth is proportional to a body's characteristic width, so every body keeps the same
  depth-to-width proportion (self-similar). An exponent of 0 gives every body full depth.
- **Raster fragments (decided: drop).** A spike or narrow arm thinner than about one cell can
  split off as its own tiny body. Bodies with fewer than `minBodyCells` cells (default 16) are left
  at depth 0, shoreline level, rather than merged into a neighbour. The reasoning for 16 is in
  `terrainParams.ts`: it catches raster debris of 1–5 cells and is 4 mm² at the default cell size.
  The threshold is inclusive (a body of exactly 16 cells is kept). Dropping never changes a kept
  body's scale or depths. If every body falls under the threshold, the terrain is flat and a
  warning says so. Caveat: at the 512-cell cap on a very large shoreline, a real small pond can
  fall under it.
- **Terracing order (decided 2026-09-24: normalize first).** Terracing was originally applied
  before normalization, which gave every body its own benches. It now comes after normalization,
  at shared global benches. See "Terracing order" below for the measurements behind the decision.
- **Determinism scope:** each per-cell sample uses only IEEE-exact operations. The only
  transcendental calls are cos/sin (once per call, for the grain angle) and pow (once per body).
  Byte-identical output across runs is tested and pinned by a SHA-256 fingerprint. Identity across
  different JS engines is expected but not tested.

# Phase B: contour extraction

```ts
extractDepthContours(terrain: DepthTerrain, shoreline: MultiPolygonMm, thresholds: number[], options?): DepthContours
```

This turns the Phase A grid into nested polygons, one per requested depth per kept water body.
Like Phase A it is pure and UI-independent, and it is not wired into `buildScene`, export or the
controls.

Thresholds are **absolute** depths on the `depth` scale (0–1), so a threshold means the same depth
in every body. A body shallower than a threshold has no polygon at it. Invalid thresholds (not in
(0, 1], or not finite) are refused, not clamped, because quietly moving a requested layer changes
the cut stack. Thresholds are sorted and de-duplicated. The options (simplify tolerance, smoothing,
minimum areas) follow Phase A's policy: clamped, and non-finite values fall back to the default.

| Step | File | What |
|---|---|---|
| 1. Marching squares | `marchingSquares.ts` | 16 cases. A sample counts as above when `value ≥ threshold`. Crossings are linearly interpolated from the lower end of each edge and kept at least 1e-6 cells from either end. |
| 2. Stitching | `marchingSquares.ts` | By grid-edge identity rather than coordinate tolerance (see below). The output is closed rings: outer positive, holes negative. |
| 3. Simplify | `depthContours.ts` | Douglas–Peucker in mm, reusing the ornament's `simplifyRing`. Default 0.04 mm, the ornament's value. |
| 4. Smooth | `depthContours.ts` | Optional single Chaikin pass (¼/¾ corner cutting). |
| 5. Validate rings | `contourGeometry.ts` | A ring that now crosses itself or another ring steps back: it loses the smoothing first, then is re-simplified at ½, ¼ and ⅛ of the tolerance, then falls back to raw. |
| 6. Clip | `depthContours.ts` | Clipper, integer, 0.001 mm units. Level 1 is clipped to the shoreline, and each deeper level to the finished level above it for the same body. |
| 7. Clean | `depthContours.ts` | Holes under 0.25 mm² are filled *before* the clip, because filling grows a level. Components under 0.25 mm² are dropped *after* the clip, because dropping only shrinks one. |

**Ambiguous cases 5 and 10: asymptotic decider.** The saddle value of the bilinear interpolant,
`(TL·BR − TR·BL)/(TL+BR−TR−BL)`, decides whether the diagonal above-corners join (saddle ≥
threshold) or stay separate. This reproduces the topology of the bilinear surface, which a test
checks against dense sampling on random grids. Because the saddle value does not depend on the
threshold, a cell's decision flips at most once as the threshold rises. That, together with
monotone crossing positions, makes the raw contours nest exactly.

**Stitching and closure.** Every grid edge has at most one crossing, computed once from that
edge, so adjacent cells share bit-identical endpoints. Each crossed edge starts exactly one
segment and ends exactly one, so segments always form closed cycles. No tolerance is needed, and
a tolerance would only risk joining the wrong segments at a pinch. Samples outside the grid read
as 0, so a contour can never leave the grid open. The terrain grid's zero padding already makes
this automatic.

**The crop edge.** Where the crop rectangle cuts through a lake, the shoreline polygon has an edge
along the crop line. Phase A treats that edge as shore, depth 0, like the existing offset model.
So contours close inside the water rather than running off the edge. Whether the crop edge
*should* read as shore is worth deciding before wiring.

**Nesting is exact, not "within rounding".** Simplification and Chaikin can both push a ring
outward, so nesting is enforced by the clip in step 6, the same pattern `artisticDepth.ts` uses.
The clip needs two safeguards:
- `polygon-clipping` could not be used. Its float sweep throws on exactly this input, a polygon
  sharing edges with its container, so the clip runs in Clipper.
- Clipper rounds each new intersection vertex to the grid. So each container is first eroded by 3
  units (0.003 mm), which keeps output about 0.87 units inside even after every rounding step.

`assertNestedContours` then checks the finished output with a Clipper difference and requires
**exactly zero** area outside. It throws otherwise. The cost is 0.003 mm per level, about 1/50 of
a 0.15 mm kerf.

**Smoothing is new code, not a reuse.** No Chaikin or corner-cutting pass existed anywhere in the
codebase. `artisticDepth.ts` shapes its rings with Clipper round joins plus Douglas–Peucker. The
Chaikin pass here is a fresh, standard implementation.

## Terracing order

**Decided 2026-09-24: normalize first, then terrace at shared global benches.** For a stacked cut
product, shared depth planes across all water bodies matter more than any one body hitting its
exact per-body target. Ben's sub-decision: a body shallower than the first bench stays
un-terraced, at its own continuous depth, and is not lifted to that bench.

The implementation adds one more guard in the same spirit: no cell snaps to a bench deeper than
its body's target. Without it, a body whose target lies more than halfway to the next bench would
have its deepest cells rounded *up*. For example, with 5 benches the bay's target is 0.35, and
plain rounding would take its deepest cells to 0.40.

What the change touches:
- With terracing off, output is byte-identical to the old order. This is tested against hashes
  taken before the change, for the multi-body lake and all four real lakes at the defaults.
  Terracing is off by default, so default output did not change at all.
- Terraced output changes for multi-body and single-body lakes alike, as the measurements below
  predicted. The Phase B nesting tests were re-run under the new order, including thresholds
  exactly on the bench depths, where the grid is flat plateaus. Nesting holds with zero area
  outside.
- The re-run comparison matches the "post-normalization" column below cell for cell for the main
  lake, the bay, Caldron Falls and Lake Noquebay. The only difference is the pond, by the
  sub-decision: its deepest cell is exactly its 0.123 target, and it has 14 mm² inside the 0.083
  plane, instead of being lifted to 0.167 and giving 53 mm².

The measurements that informed the decision follow. They use hard terracing (strength 1), 6
levels, maxDepth 1, and cut planes midway between the global levels.

Old order (terrace, then normalize per body):
- **Multi-body test lake.** The bay (area scale 0.35) gets its own six benches at
  0.058/0.117/…/0.350, finer than the cut-plane spacing. Only two planes cross it, so four of its
  benches fall between planes and never become an edge.
- **The pond** (target 0.123) gets one 9 mm² layer.

Post-normalization terracing (normalize, then terrace at global levels k/6):
- The bay's benches are 0.167 and 0.333. They coincide with the planes and give two layers of
  445 and 89 mm², against 309 and 70 mm² in the old order.
- The pond's target is below the first global bench, and `terrace` never snaps water to 0.
  Terraced naively, the whole pond is lifted to 0.167, deeper than its own target, and becomes one
  53 mm² layer. The sub-decision above prevents this.
- **Single-body lakes differ too.** The old order quantized the value before normalization,
  and that value peaks below 1 because of noise headroom. So the deepest bench catches only the
  very peak:

  | Lake | Deepest layer, old order | Deepest layer, post-normalization (now) |
  |---|---|---|
  | Caldron Falls | 98 mm² | 234 mm² |
  | Lake Noquebay | 245 mm² | 781 mm² |

  The bench *depths* are the same in both orders.

The change relaxes Phase A's promise that each body's deepest cell equals `maxDepth × areaScale`
exactly:
- **Terraced bodies:** the deepest cell now sits on (at full strength) the deepest global bench
  that does not exceed the target. It is never deeper than the target.
- **Un-terraced bodies and the largest body:** unchanged. The largest body still reaches
  `maxDepth` exactly.

All four real-lake fixtures are single-body, even with every water feature in the crop included.
So the shallow-body rule is exercised on the multi-body test lake's pond, not on real geography.
