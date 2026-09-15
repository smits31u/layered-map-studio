export type Operation='cut'|'engrave'|'annotation';
// transform: an SVG transform ("translate(x y) rotate(d)") applied to positioned/rotated objects
// (labels, title, compass) — keeps path data in reusable local space instead of baking world
// coordinates into every point. group: which named export group this shape belongs to (Phase 10 —
// road-labels, place-labels, title, subtitle, compass, roads-major/minor). objectId: ties a shape
// back to its overrides key so the interactive editor can select/drag it and manufacturing export
// can exclude selection-only UI (which never becomes a Shape in the first place).
// hitRadiusMm: an editor-only (preview-only) invisible circular click target, in local mm centered
// on the shape's own transform origin — never rendered by exportSvg.ts, so it can never leak into
// manufacturing output. Exists because a marker glyph can be a hollow/thin outline (same reasoning
// as the M-COMPASS classic-rose ring) whose bounding-box interior is otherwise unclickable.
export type Shape={id:string;operation:Operation;kind:'path'|'rect';d?:string;x?:number;y?:number;width?:number;height?:number;strokeWidthMm?:number;transform?:string;group?:string;objectId?:string;hitRadiusMm?:number};
export type PhysicalLayer={id:string;name:string;shapes:Shape[];depthMeters?:number};
import type {WaterMetrics} from '../geometry/shoreline/polygonEngine';
import type {BathymetrySourceMetadata} from '../types/project';
export type LabelMetrics={placeLabels:number;roadLabels:number;rejectedRoadLabels:number};
export type ManufacturingScene={widthMm:number;heightMm:number;layers:PhysicalLayer[];objects:Shape[];manufacturingWarnings?:string[];geometryMetrics?:WaterMetrics;labelMetrics?:LabelMetrics;depthMode?:'true-bathymetry'|'decorative-offsets';bathymetrySource?:BathymetrySourceMetadata};
export function assertManufacturingSceneUsable(scene:ManufacturingScene){if(scene.manufacturingWarnings?.length)throw new Error(scene.manufacturingWarnings.join(' '))}
