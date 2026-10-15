import {evenOddArea,parsePathData,pathLength,transformScale} from './geometry/pathData';

// A product-neutral description of what gets cut: the physical pieces, top of the finished stack
// first, each with the paths the laser runs on it. The estimate and the 3D preview read only this,
// so a tool joins them by writing one adapter from its own scene (see adapters/lakeScene.ts) rather
// than by teaching either module about lake panels, ornaments or topo boards.
//
// Operations follow xTool Studio's three processing types:
//  - cut: a closed or open line cut through the stock.
//  - score: a line burned into the surface (a stroked path: roads in the lake tool).
//  - engrave: a filled area rastered line by line (glyphs, the compass).
export type JobOperation='cut'|'score'|'engrave';

export type JobShape={
 id:string;
 d:string;
 operation:JobOperation;
 transform?:string;
 strokeWidthMm?:number;
 // True for the cut paths that bound the piece itself. The 3D preview extrudes exactly these; any
 // other cut on the piece (a title backer, a cut-out marker) is drawn as a cut line on its face.
 outline?:boolean;
};

// role 'layer' pieces come from the generated scene. 'border' pieces are added by a layer recipe
// (the TruFlat frame around a small lake map) and have no scene geometry of their own.
export type JobPiece={id:string;name:string;role:'layer'|'border';widthMm:number;heightMm:number;shapes:JobShape[]};

export type ProductionJob={product:string;widthMm:number;heightMm:number;pieces:JobPiece[]};

export type PieceMetrics={cutLengthMm:number;scoreLengthMm:number;engraveAreaMm2:number};

// Lengths and areas are invariant under the translate/rotate transforms scene objects carry;
// transformScale covers the scale() none of them use today.
export function shapeMetrics(shape:JobShape):PieceMetrics{
 const subpaths=parsePathData(shape.d),scale=transformScale(shape.transform);
 if(shape.operation==='cut')return{cutLengthMm:pathLength(subpaths)*scale,scoreLengthMm:0,engraveAreaMm2:0};
 if(shape.operation==='score')return{cutLengthMm:0,scoreLengthMm:pathLength(subpaths)*scale,engraveAreaMm2:0};
 return{cutLengthMm:0,scoreLengthMm:0,engraveAreaMm2:evenOddArea(subpaths)*scale*scale};
}

// Parsing a lake panel is the expensive part (a shoreline is tens of thousands of points), and a
// piece's paths only change when the scene is rebuilt, so results are cached per piece object.
const metricsCache=new WeakMap<JobPiece,PieceMetrics>();

export function pieceMetrics(piece:JobPiece):PieceMetrics{
 const cached=metricsCache.get(piece);
 if(cached)return cached;
 const total={cutLengthMm:0,scoreLengthMm:0,engraveAreaMm2:0};
 for(const shape of piece.shapes){const m=shapeMetrics(shape);total.cutLengthMm+=m.cutLengthMm;total.scoreLengthMm+=m.scoreLengthMm;total.engraveAreaMm2+=m.engraveAreaMm2}
 metricsCache.set(piece,total);
 return total;
}
