import type {EstimateConfig} from '../estimate/config';
import {assignMaterials,matchRecipe} from '../estimate/estimate';
import type {ProductionJob} from '../job';

// How the job's pieces stack into the finished object: bottom piece on the bench, each piece above
// sitting on the one below at its material's real thickness, the top piece last. Pure, so the order
// and heights the preview draws are the ones the tests check.

export type StackLayer={
 id:string;
 name:string;
 materialId:string;
 thicknessMm:number;
 // Height of the piece's underside with the stack assembled (no explode).
 baseY:number;
 // Position from the bottom, 0 = the bench piece.
 level:number;
 // The piece's outline cut paths, for the extruder.
 outlinePaths:string[];
};

// Only the pieces the scene draws are stacked: a recipe's border piece is an estimate line with
// assumed geometry, and the preview never shows anything that is not in the cut file.
export function stackLayers(job:ProductionJob,config:EstimateConfig):StackLayer[]{
 const {pieces}=assignMaterials(job,matchRecipe(job.widthMm,job.heightMm,config.recipes),config);
 const layered=pieces.filter(p=>p.piece.role==='layer');
 const thickness=(materialId:string)=>config.materials.find(m=>m.id===materialId)?.thicknessMm??3.175;
 // assignMaterials keeps the job's order, top first; the stack is built from the bottom.
 const bottomUp=[...layered].reverse();
 let y=0;
 return bottomUp.map(({piece,materialId},level)=>{
  const layer:StackLayer={id:piece.id,name:piece.name,materialId,thicknessMm:thickness(materialId),baseY:y,level,outlinePaths:piece.shapes.filter(s=>s.outline).map(s=>s.d)};
  y+=layer.thicknessMm;
  return layer;
 });
}

export const stackHeight=(layers:StackLayer[])=>layers.reduce((sum,l)=>sum+l.thicknessMm,0);

// The exploded view lifts each piece by `gapMm` per level, so the bench piece stays put and every
// gap between neighbours is the same.
export const explodedY=(layer:StackLayer,gapMm:number)=>layer.baseY+layer.level*gapMm;

const WOOD='#c9a46c';
const SHALLOW=[0x9c,0xcf,0xe8],DEEP=[0x12,0x3a,0x66];
const hex=(rgb:number[])=>`#${rgb.map(c=>Math.round(c).toString(16).padStart(2,'0')).join('')}`;

// The lake-map look: wood for the top piece, then water from light to deep blue going down, the
// bench piece the deepest. Returned bottom-up, matching stackLayers.
export function defaultLayerColors(layers:StackLayer[]):string[]{
 const n=layers.length;
 return layers.map(layer=>{
  if(layer.level===n-1)return WOOD;
  const below=n-1;// water pieces: every level below the top
  const t=below<=1?1:1-layer.level/(below-1);// level 0 (deepest) -> 1, the piece under the top -> 0
  return hex(SHALLOW.map((c,i)=>c+(DEEP[i]-c)*t));
 });
}
