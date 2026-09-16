# ADR 0001 — Polygon boolean and buffer engine for ornament geometry

- Status: accepted
- Date: 2026-09-16
- Context: `CLAUDE_MAP_ORNAMENT_BUILD_PLAN.md`, Phase 0 ("ADRs for polygon/buffer engine and font licensing")

## Context

The ornament generator needs geometry the lake-map tool has never needed:

- **Open-path offsets with round joins and round caps** — road centerlines are captured as
  polylines and must become filled engraving polygons (plan §Roads: "offset them with round
  joins/caps, union, simplify").
- Union / difference / intersection on the results (plan §Water, §Geometry specification).
- Circle and chord clipping (plan §Circular and chord clipping).

The build plan recommends: "Prefer Clipper2/WASM if its bundle and license are acceptable: this
tool needs robust open-path offsets as well as union, difference, and intersection."

That recommendation was written without knowledge of what this repository already contains, so it
was treated as a hypothesis to test rather than a decision to implement.

## What was actually verified

The existing lake tool already depends on `clipper-lib@6.4.2` and `polygon-clipping@0.15.7`.

`src/geometry/shoreline/polygonEngine.ts`'s `offsetWater()` uses `JoinType.jtRound` already —
round joins are the established convention here — but hardcodes `EndType.etClosedPolygon`, which
is why open-path offsetting looked absent.

The limitation is in **that wrapper**, not in the engine. Verified empirically against the
installed `clipper-lib`:

```
EndType:  {"etOpenSquare":0,"etOpenRound":1,"etOpenButt":2,"etClosedLine":3,"etClosedPolygon":4}
JoinType: {"jtSquare":0,"jtRound":1,"jtMiter":2}
```

Offsetting an open 10mm segment by 1mm with `jtRound`/`etOpenRound` produces a single closed
stadium polygon, no holes — i.e. exactly the road-buffering primitive the plan calls for. Measured
against the analytic stadium area (`2·r·L + πr²` = 23.1416mm²):

| arcTolerance | vertices | area mm² | error   |
|--------------|----------|----------|---------|
| 0.25mm       | 6        | 21.9840  | −5.002% |
| 0.05mm       | 12       | 22.9392  | −0.875% |
| 0.02mm       | 18       | 23.0605  | −0.350% |
| 0.005mm      | 34       | 23.1218  | −0.086% |

## Decision

**Keep `clipper-lib` + `polygon-clipping`. Do not add Clipper2/WASM.**

Expose the capability through a new general-purpose wrapper,
`src/ornament/geometry/offsetPaths.ts`, which takes join style, end style, and arc tolerance as
parameters instead of hardcoding them.

`offsetWater()` is left untouched. It is not a candidate for direct reuse: beyond the hardcoded
`etClosedPolygon`, it intersects every result with the product `rectangle(width,height)` — a
rectangular-product assumption that is meaningless for a disk — and throws lake-domain errors
("Water opening collapsed at N mm offset"). Generalising it in place would have meant threading
ornament concerns through the shoreline pipeline; a sibling module with no lake coupling is
cheaper and leaves the shipped shoreline behaviour bit-identical.

**Arc tolerance defaults to 0.02mm for ornament geometry**, against the lake tool's 0.25mm. The
table above is the reason: at 0.25mm a 1mm round cap degenerates to 6 vertices and loses 5% of its
area. That is invisible on a 355mm lake panel and obvious on a 101.6mm ornament, where rim and
road-cap curvature is a finished visual surface rather than an interior contour.

## Consequences

- No new runtime dependency, no WASM loading path, no bundle-size or licence review.
- Integer scaling stays at `SCALE=1000` (0.001mm), matching the lake tool, so geometry from both
  tools is directly comparable and roundtrips through the same precision.
- `clipper-lib` is unmaintained (last release 2017) and is a JS port of Clipper 1.x. It is
  sufficient here and already load-bearing in shipped manufacturing output, so the risk is
  accepted rather than introduced.
- Boolean ops continue to go through `polygon-clipping`, which is already used for union /
  difference / intersection and returns the `MultiPolygonMm` shape the rest of the codebase speaks.

## Revisit this if

- Open-path offsets are measurably wrong or unstable on dense real road networks (Phase 3's city
  fixture is the test that would surface it).
- Self-intersecting or zero-length input polylines survive repair and produce invalid output.
- Profiling shows offsetting dominates export time on the High road-detail setting.

Any of those would justify reopening Clipper2/WASM, which has a genuinely better offsetting
implementation. None of them can be assessed before Phase 3 has real captured road data.
