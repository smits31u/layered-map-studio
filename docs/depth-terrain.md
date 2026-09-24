# Procedural depth terrain (Phase A: engine only)

`src/geometry/terrain/` generates a depth grid from a shoreline for Artistic Depth. It is meant to
replace the offset-ring approach in `shoreline/artisticDepth.ts` with shoreline-distance-driven
terrain that has organic noise character. Like Artistic Depth, it is artwork, not bathymetry.

**Status:** Phase A. This is a pure, UI-independent engine. It is not wired into `Controls.tsx`,
`buildScene.ts`, the geometry cache or export. It produces a grid only. Turning that grid into cut
layers (contouring at depth planes, e.g. marching squares, then smoothing and polygon repair) is
follow-up work.

This is a clean-room implementation built from standard, publicly documented techniques. All
constants, curve shapes and presets are original to this module.

## Entry point

```ts
generateDepthTerrain(shoreline: MultiPolygonMm, params?: TerrainParamsInput): DepthTerrain
```

The result holds the grid spec and the normalized params. It also holds these row-major arrays:
`inside` (mask), `bodyId` (−1 outside), `distanceCells`, and `depth`. `depth` is 0 outside the
water. It is also exactly 0 in every cell of a *dropped* body: one with fewer than `minBodyCells`
cells, see below. Every cell of a kept body is strictly greater than 0, and the deepest cell of the
largest body is exactly `maxDepth`. `bodies` holds per-body stats, targets and the `dropped` flag,
and `warnings` holds any warnings.

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
| 6. Shape | `terrainProfiles.ts` | Shelf remap, then bank curve, then profile, then terrace. |
| 7. Normalize | `depthTerrain.ts` | Per body: the deepest cell is set to `maxDepth × areaScale`. |

Per inside cell of body *b*:

```text
t  = (distance − 0.5) / (maxDistance_b − 0.5)             shore is half a cell from an edge centre
t' = (t + A · contrast(noise) · min(1, t/A)) / (1 + A/2)   A = noiseAmplitude
v  = terrace(profile(bank(shelf(t'))))
depth = v · (maxDepth · areaScale_b) / max_b(v)
```

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
- **Terrace before normalize (deferred to Phase B).** This order was specified. Bench levels are
  therefore per body, and a small body's benches do not line up with the main basin's. Contouring
  will cut at global depth planes, so Phase B may move the terrace step after normalization. That
  would change the promise that each body's deepest cell hits its exact target.
- **Determinism scope:** each per-cell sample uses only IEEE-exact operations. The only
  transcendental calls are cos/sin (once per call, for the grain angle) and pow (once per body).
  Byte-identical output across runs is tested and pinned by a SHA-256 fingerprint. Identity across
  different JS engines is expected but not tested.
