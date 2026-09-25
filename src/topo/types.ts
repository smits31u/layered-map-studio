import type {FontId} from '../types/project';

// Domain model for the topographic laser-map builder (docs/CLAUDE_TOPO_MAP_BUILD_PLAN.md,
// §Domain model). Serializable and free of anything live: the MapLibre instance never enters it.
//
// All physical dimensions are millimetres. `displayUnit` is presentation only, so switching in/mm
// can never drift the geometry — the same rule the ornament follows (src/ornament/types.ts).
//
// Departures from the plan's TypeScript block, each to satisfy its own prose or a Phase 1 need:
//   - schemaVersion — the plan requires persisting "with a schema version".
//   - displayUnit — the plan declares `type Unit` and a unit toggle but never stores the choice;
//     a toggle that forgets its setting on reload fails Phase 1's "recover non-file state".
//   - viewport.selectedPlaceLabel — so the chosen place survives a reload with its name.
//   - route.segments instead of route.coordinates — a GPX track is one or more segments, and a gap
//     between segments (a pause, a ferry, a lost signal) is real: flattening them into one list
//     would draw a straight line across it that nobody walked. A route with one segment is exactly
//     the plan's shape, nested once.
//   - route.source/name/pointCount — which GPX element the route came from (track → route →
//     waypoint fallback), for the UI to say so.
//   - title.fontId is the existing FontId union rather than `string`, per ADR 0002.
//
// bearing and pitch are the literal type 0: the plan fixes them at 0 for the first release so that
// screen-to-output projection is deterministic, and a literal type makes that a compile error.

export type TopoUnit='mm'|'in';
export type TopoDetail='low'|'medium'|'high';
export type TopoCompassPosition='top-left'|'top-right'|'bottom-left'|'bottom-right'|'off';
export type TopoContourCount=3|5|8|12|18;
export type TopoRouteSource='track'|'route'|'waypoints';

export interface TopoRoute{
 // [longitude, latitude] pairs, GeoJSON order like viewport.center. Every segment has ≥2 points.
 segments:[number,number][][];
 widthMm:number;
 source:TopoRouteSource;
 name?:string;
 pointCount:number;
}

export interface TopoProject{
 schemaVersion:1;
 viewport:{center:[number,number];zoom:number;bearing:0;pitch:0;selectedPlaceLabel?:string};
 output:{widthMm:number;heightMm:number};
 displayUnit:TopoUnit;
 terrain:{layerCount:1|2|3|4;coveragePercent:[100,number,number,number];contoursEnabled:boolean;contourCount:TopoContourCount};
 roads:{enabled:boolean;detail:TopoDetail;thicknessScale:number};
 labels:{enabled:boolean;sizeMm:number};
 route:TopoRoute|null;
 frame:{enabled:boolean;thicknessMm:number};
 compass:{position:TopoCompassPosition;sizeMm:number;mergeWithTerrain:boolean};
 title:{text:string;fontId:FontId;sizeMm:number;dxMm:number;dyMm:number};
}

export type NumericLimit={min:number;max:number;step:number};

// One source of truth for every numeric range: the UI renders inputs from these and validation
// clamps against these, so a control can never offer a value validation would reject.
//
// outputMm is 50–600. The plan gives the reference bounds as "2–24 in or 50–600 mm", which do not
// agree (24 in is 609.6 mm). Millimetres are the stored unit, so the millimetre range is the one
// that holds; in inches that is about 1.97–23.62. The same resolution the ornament made for its
// own inconsistent diameter range.
export const TOPO_LIMITS={
 outputMm:{min:50,max:600,step:1},
 zoom:{min:6,max:18,step:.5},
 coveragePercent:{min:1,max:99,step:1},
 roadThicknessScale:{min:.25,max:4,step:.05},
 labelSizeMm:{min:1,max:20,step:.1},
 routeWidthMm:{min:.2,max:2.5,step:.1},
 frameThicknessMm:{min:1,max:40,step:.5},
 compassSizeMm:{min:8,max:120,step:1},
 titleSizeMm:{min:2,max:80,step:.5},
 titleOffsetMm:{min:-300,max:300,step:.5},
} as const satisfies Record<string,NumericLimit>;

export const TOPO_CONTOUR_COUNTS:readonly TopoContourCount[]=[3,5,8,12,18];

// Web Mercator's latitude limit: beyond it the projection is undefined, and MapLibre clamps there.
export const MERCATOR_MAX_LATITUDE=85.051129;
