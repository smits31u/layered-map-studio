import {geometryPathMm} from '../../ornament/export/svg';
import type {GolfBoard,GolfGroup} from '../../golf/geometry/board';
import {linePathData} from '../../golf/export/svg';
import type {EstimateConfig} from '../estimate/config';
import {assignMaterials,matchRecipe} from '../estimate/estimate';
import type {JobPiece,JobShape,ProductionJob} from '../job';

// The golf board as a ProductionJob, so the existing estimate and stacked 3D preview read it the way
// they read the lake and topo boards. Path data comes from the functions the golf SVGs are written
// with, so what is measured and extruded is what is in the files.
//
// One job piece per sheet, because each sheet is one laser job on one sheet of stock: the floor, the
// ground (all its pieces), and the surface pieces (all of them, cut in place). Every cut path that
// bounds a piece is an outline, which is what the 3D preview extrudes. Pieces are listed top of the
// stack first, as in every ProductionJob.

export const GOLF_PRODUCT='golf-map';

function groupShapes(group:GolfGroup,outline:boolean):JobShape[]{
 if(group.operation==='cut')return group.geometry.map((polygon,i)=>({id:`${group.id}#${i}`,d:geometryPathMm([polygon]),operation:'cut' as const,...(outline?{outline:true}:{})}));
 if(group.operation==='score')return group.lines.filter(l=>l.length>=2).map((line,i)=>({id:`${group.id}#${i}`,d:linePathData(line),operation:'score' as const}));
 return [
  ...group.geometry.map((polygon,i)=>({id:`${group.id}#a${i}`,d:geometryPathMm([polygon]),operation:'engrave' as const})),
  ...group.glyphs.filter(g=>g.d).map((glyph,i)=>({id:`${group.id}#g${i}`,d:glyph.d,operation:'engrave' as const})),
 ];
}

// The stock thickness each sheet is cut from, as the estimate assigns materials (its recipe for this
// size, else its first material), so the file names, the estimate and the 3D preview agree
// (docs/golf-implementation-status.md, decision 4).
export function golfSheetStock(job:ProductionJob,config:EstimateConfig):(sheetIndex:number)=>number{
 const {pieces}=assignMaterials(job,matchRecipe(job.widthMm,job.heightMm,config.recipes,job.product),config);
 const fallback=config.materials[0]?.thicknessMm??3;
 return index=>{
  const assigned=pieces.find(p=>p.piece.id===`golf-L${index}`);
  return config.materials.find(m=>m.id===assigned?.materialId)?.thicknessMm??fallback;
 };
}

export function golfBoardToJob(board:GolfBoard):ProductionJob{
 const pieces:JobPiece[]=board.sheets.map(sheet=>({
  id:`golf-L${sheet.index}`,
  name:`L${sheet.index} ${sheet.name}${sheet.index>0?` (${sheet.pieces.length} piece${sheet.pieces.length===1?'':'s'})`:''}`,
  role:'layer' as const,
  widthMm:board.widthMm,heightMm:board.heightMm,
  shapes:sheet.groups.flatMap(g=>groupShapes(g,g.id.startsWith('cut/'))),
 }));
 return {product:GOLF_PRODUCT,widthMm:board.widthMm,heightMm:board.heightMm,pieces:pieces.reverse()};
}
