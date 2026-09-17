import type {LngLatTuple,ViewportSnapshot} from '../geometry/mapProjection';
import type {RoadDetail} from '../types';

// The serializable record of one capture.
//
// Everything here is plain arrays and numbers on purpose. It crosses a `postMessage` boundary to the
// geometry worker, it is what a golden fixture stores on disk, and it is what a test replays. A
// MapLibre feature object would do none of those things — the plan keeps "the MapLibre instance and
// captured features" out of the serializable project, and this is the shape the ornament keeps
// instead.

export interface CapturedRoad{
 // The provider's road classification, unmapped. Which physical width it earns is decided later,
 // from a millimetre table — never from the style's pixel width (plan §Roads).
 roadClass:string;
 // One LineString. A MultiLineString is split into several of these at capture time, so nothing
 // downstream has to handle both shapes.
 line:LngLatTuple[];
}

// [outer, ...holes], exactly as GeoJSON orders a Polygon's rings. A MultiPolygon is split into one
// of these per member polygon, which keeps each outer ring paired with its own holes — the plan's
// "preserve inner rings/islands" fails at the first step if holes are flattened into a ring list.
export interface CapturedWater{rings:LngLatTuple[][]}

export interface CaptureCounts{
 rawFeatures:number;
 // Features dropped because an identical geometry had already been seen. Reported rather than
 // silently swallowed: a duplicate rate near zero on a dense city view usually means the dedupe key
 // has stopped matching, not that the tiles stopped overlapping.
 duplicateRoads:number;
 duplicateWater:number;
 // Features from a layer the capture asked for but whose geometry type it cannot use.
 unusableFeatures:number;
}

export interface CapturedFeatures{
 roads:CapturedRoad[];
 water:CapturedWater[];
 counts:CaptureCounts;
}

export interface FeatureCapture{
 viewport:ViewportSnapshot;
 // `diameterMm / renderedMapDiameterPx`, resolved once at capture time (plan §Coordinate system).
 mmPerPx:number;
 // The ornament's map window at capture time, in millimetres. Carried with the capture so the
 // geometry worker never has to rebuild ornament geometry to know where to clip.
 innerRadiusMm:number;
 chordYMm:number;
 detail:RoadDetail;
 features:CapturedFeatures;
 // Wall-clock, for the status line only. Nothing in the geometry pipeline reads it, so a golden
 // fixture stays byte-stable regardless of when it was recorded.
 capturedAt:number;
}

export const totalCapturedFeatures=(features:CapturedFeatures)=>features.roads.length+features.water.length;
