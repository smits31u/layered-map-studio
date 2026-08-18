# Artistic Depth model

Artistic Depth is shoreline-derived artwork, not surveyed bathymetry. It starts with normalized, unioned, crop-clipped Primary Water Body geometry and creates nested openings through inward polygon erosion.

The design coordinate system is 500 units across the product width:

```text
normalizedWidth  = 500
normalizedHeight = 500 × physicalHeightMm / physicalWidthMm
physicalOffsetMm = normalizedOffset × physicalWidthMm / 500
```

Normal uses absolute offsets from the original shoreline of `3, 9, 20, 34, 52` normalized units. The measured reference evidence supports `3, 9, 20`; `34, 52` are provisional extensions for Layers 5 and 6. Every opening is computed independently from `W0`, not recursively from the preceding result.

Clipper uses round joins. A separate working copy is simplified by `0.08` normalized units before offset and `0.04` after offset; the accurate `W0` used by Land is unchanged. Cleanup applies depth-indexed minimum component areas (`0.5/1/2/3/4` normalized square units), ratios to the largest current component (`0.1%/0.3%/1%/1.5%/2%`), and minimum hole areas (`0.2/0.5/1/1.5/2` normalized square units). The largest component always survives. Crop-edge components use a conservative `0.25` normalized-square-unit floor. Every result is intersected with `W0` to guarantee ancestry and nesting.

Collapsed geometry disappears naturally. No retained-area percentage is imposed: lake shape determines survival. Manufacturing panels remain `R − Wi`, while Base remains `R`.

Reference calibration metadata is retained for Caldron Falls, High Falls, Lake Noquebay, and Wind Pudding Lake in `tests/fixtures/artisticDepthReferences.ts`.
