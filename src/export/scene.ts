export type Operation='cut'|'engrave'|'annotation';
export type Shape={id:string;operation:Operation;kind:'path'|'rect';d?:string;x?:number;y?:number;width?:number;height?:number;strokeWidthMm?:number};
export type PhysicalLayer={id:string;name:string;shapes:Shape[];depthMeters?:number};
import type {WaterMetrics} from '../geometry/shoreline/polygonEngine';
import type {BathymetrySourceMetadata} from '../types/project';
export type ManufacturingScene={widthMm:number;heightMm:number;layers:PhysicalLayer[];objects:Shape[];geometryMetrics?:WaterMetrics;depthMode?:'true-bathymetry'|'decorative-offsets';bathymetrySource?:BathymetrySourceMetadata};
