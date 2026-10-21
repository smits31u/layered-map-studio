import type {TopoBoard,TopoExportGroup,TopoGroupId} from '../../topo/export/board';
import {polygonPathData,scorePathData} from '../../topo/export/svg';
import type {JobPiece,JobShape,ProductionJob} from '../job';

// The topo builder's export board as a ProductionJob. Path data comes from the same functions
// topo/export/svg.ts writes the file with, so the estimate measures and the 3D preview extrudes the
// strings in the SVG.
//
// The SVG is one sheet of groups by operation, not one file per layer, so the adapter decides which
// piece each group is cut from:
//  - cut/terrain-1…4 are the layers, one piece each, layer 1 (the base, land plus bridge tabs) at the
//    bottom. Every polygon of a band is an outline: the 3D preview extrudes exactly those.
//  - cut/frame is the frame ring: a piece of its own ('border', so it is costed but not stacked; the
//    preview has its own frame control and never draws assumed geometry).
//  - cut/roads, score/*, engrave/*: the export does not say which layer a road opening, contour or
//    label is burned on, so they are counted on layer 1. Totals are right; the per-layer rows put
//    them on the base.
//  - cut/water is left out. It is layer 1's own water holes (topo-implementation-status.md: layer 1
//    and the water "tile the board exactly"), so cutting layer 1 already cuts it; counting it again
//    would double that cut length.
//
// Layers 2-4 float on the base, so their stock is their own bounding box, not the whole board.
//
// A street map is one layer, cut/base, with everything else on it. Its engraved roads and lightly
// engraved water are filled areas (kind 'areas') and are costed as engraving, not as cut length. It
// keeps the topo product id, so the topo recipes and 3D colours apply to it.

export const TOPO_PRODUCT='topo-map';
const BANDS:TopoGroupId[]=['cut/terrain-1','cut/terrain-2','cut/terrain-3','cut/terrain-4'];
const STREET_BANDS:TopoGroupId[]=['cut/base'];
// Counted on layer 1 (see above), in the file's group order.
const ON_BASE:TopoGroupId[]=['cut/roads','score/contours','score/route','engrave/labels','engrave/title','engrave/compass'];
const STREET_ON_BASE:TopoGroupId[]=['cut/roads','score/route','engrave-light/water','engrave/roads','engrave/labels','engrave/title'];

const outlineShapes=(group:TopoExportGroup):JobShape[]=>group.geometry.map((polygon,i)=>({id:`${group.id}#${i}`,d:polygonPathData(polygon),operation:'cut',outline:true}));

function groupShapes(group:TopoExportGroup):JobShape[]{
 if(group.operation==='cut')return group.geometry.map((polygon,i)=>({id:`${group.id}#${i}`,d:polygonPathData(polygon),operation:'cut'}));
 if(group.kind==='areas')return group.geometry.map((polygon,i)=>({id:`${group.id}#${i}`,d:polygonPathData(polygon),operation:'engrave'}));
 if(group.operation==='score')return group.lines.map((score,i)=>({id:`${group.id}#${i}`,d:scorePathData(score),operation:'score' as const,...(group.strokeWidthMm?{strokeWidthMm:group.strokeWidthMm}:{})})).filter(s=>s.d);
 return group.glyphs.filter(g=>g.d).map((glyph,i)=>({id:`${group.id}#${i}`,d:glyph.d,operation:'engrave'}));
}

// The bounding box of a band's polygons (outer rings carry every point that matters).
function bounds(group:TopoExportGroup):{widthMm:number;heightMm:number}{
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 for(const polygon of group.geometry)for(const [x,y] of polygon[0]??[]){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y)}
 return Number.isFinite(minX)?{widthMm:maxX-minX,heightMm:maxY-minY}:{widthMm:0,heightMm:0};
}

export function topoBoardToJob(board:TopoBoard):ProductionJob{
 const group=(id:TopoGroupId)=>board.groups.find(g=>g.id===id);
 const layers:JobPiece[]=[];
 const street=board.style==='street';
 (street?STREET_BANDS:BANDS).forEach((id,index)=>{
  const g=group(id);
  if(!g||!g.geometry.length)return;
  const base=index===0;
  const shapes=[...outlineShapes(g),...(base?(street?STREET_ON_BASE:ON_BASE).flatMap(other=>{const o=group(other);return o?groupShapes(o):[]}):[])];
  const size=base?{widthMm:board.widthMm,heightMm:board.heightMm}:bounds(g);
  layers.push({id:`terrain-${index+1}`,name:base?'Layer 1 (base)':`Layer ${index+1}`,role:'layer',...size,shapes});
 });
 const frame=group('cut/frame');
 const extras:JobPiece[]=frame&&frame.geometry.length?[{id:'frame',name:'Frame',role:'border',widthMm:board.widthMm,heightMm:board.heightMm,shapes:outlineShapes(frame)}]:[];
 // Pieces are listed top of the stack first, as in every ProductionJob.
 return {product:TOPO_PRODUCT,widthMm:board.widthMm,heightMm:board.heightMm,pieces:[...extras,...layers.reverse()]};
}

