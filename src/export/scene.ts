export type Operation='cut'|'engrave'|'annotation';
// transform: an SVG transform ("translate(x y) rotate(d)") applied to positioned/rotated objects
// (labels, title, compass) — keeps path data in reusable local space instead of baking world
// coordinates into every point. group: which named export group this shape belongs to (Phase 10 —
// road-labels, place-labels, title, subtitle, compass, roads-major/minor). objectId: ties a shape
// back to its overrides key so the interactive editor can select/drag it and manufacturing export
// can exclude selection-only UI (which never becomes a Shape in the first place).
export type Shape={id:string;operation:Operation;kind:'path'|'rect';d?:string;x?:number;y?:number;width?:number;height?:number;strokeWidthMm?:number;transform?:string;group?:string;objectId?:string};
export type PhysicalLayer={id:string;name:string;shapes:Shape[];depthMeters?:number};
import type {WaterMetrics} from '../geometry/shoreline/polygonEngine';
import type {BathymetrySourceMetadata} from '../types/project';
export type LabelMetrics={placeLabels:number;roadLabels:number;rejectedRoadLabels:number};
export type ManufacturingScene={widthMm:number;heightMm:number;layers:PhysicalLayer[];objects:Shape[];geometryMetrics?:WaterMetrics;labelMetrics?:LabelMetrics;depthMode?:'true-bathymetry'|'decorative-offsets';bathymetrySource?:BathymetrySourceMetadata};
