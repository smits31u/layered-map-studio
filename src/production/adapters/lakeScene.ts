import {layerExportShapes,type ManufacturingScene,type Shape} from '../../export/scene';
import {rectPathData} from '../geometry/pathData';
import type {JobShape,ProductionJob} from '../job';

// The lake tool's ManufacturingScene as a ProductionJob. scene.layers is already in stack order, top
// first (Land / Top, the depth panels, Base / Backer), and every piece is the full product
// rectangle, so pieces map one to one.
//
// Shapes come from layerExportShapes, the same set exportSvg.ts writes, and `d` strings are passed
// through untouched: the estimate measures and the 3D preview extrudes exactly the paths in the file.
const toJobShape=(shape:Shape,outline:boolean):JobShape|undefined=>{
 if(shape.operation==='annotation')return undefined;
 const d=shape.kind==='rect'?rectPathData(shape.x??0,shape.y??0,shape.width??0,shape.height??0):shape.d;
 if(!d)return undefined;
 // A stroked engrave path (roads) is a line burned along the path: a score. Everything else the lake
 // tool engraves (glyph outlines, the compass) is a filled area.
 const operation=shape.operation==='cut'?'cut':shape.strokeWidthMm?'score':'engrave';
 return {id:shape.id,d,operation,...(shape.transform?{transform:shape.transform}:{}),...(shape.strokeWidthMm?{strokeWidthMm:shape.strokeWidthMm}:{}),...(outline&&operation==='cut'?{outline:true}:{})};
};

export function lakeSceneToJob(scene:ManufacturingScene):ProductionJob{
 return {
  product:'lake-map',
  widthMm:scene.widthMm,
  heightMm:scene.heightMm,
  pieces:scene.layers.map(layer=>{
   const own=new Set(layer.shapes);
   const shapes=layerExportShapes(scene,layer).map(shape=>toJobShape(shape,own.has(shape))).filter((s):s is JobShape=>Boolean(s));
   return {id:layer.id,name:layer.name,role:'layer' as const,widthMm:scene.widthMm,heightMm:scene.heightMm,shapes};
  }),
 };
}
