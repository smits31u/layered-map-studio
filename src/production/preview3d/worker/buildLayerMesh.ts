import {extrudePolygons,outlinePolygons,type MeshData} from '../extrude';
import type {MeshLayerInput} from './protocol';

// One layer's solid, exactly as the worker builds it. Shared by the worker and the inline fallback.
export function buildLayerMesh(layer:MeshLayerInput):MeshData{
 const polygons=outlinePolygons(layer.outlinePaths);
 if(!polygons.length)throw new Error(`${layer.id} has no closed outline to extrude.`);
 return extrudePolygons(polygons,{widthMm:layer.widthMm,heightMm:layer.heightMm,baseY:0,thicknessMm:layer.thicknessMm});
}
