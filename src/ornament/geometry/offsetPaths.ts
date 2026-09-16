import ClipperLib from 'clipper-lib';
import type {MultiPolygonMm,RingMm} from '../../geometry/shoreline/polygonEngine';
import {ARC_TOLERANCE_MM} from './circle';

export type JoinStyle='round'|'miter'|'square';
export type EndStyle='closed-polygon'|'closed-line'|'open-round'|'open-butt'|'open-square';

// 0.001mm integer precision, identical to the shoreline engine's SCALE so geometry produced by
// either tool quantises the same way.
const SCALE=1000;

const JOIN:Record<JoinStyle,number>={round:ClipperLib.JoinType.jtRound,miter:ClipperLib.JoinType.jtMiter,square:ClipperLib.JoinType.jtSquare};
const END:Record<EndStyle,number>={
 'closed-polygon':ClipperLib.EndType.etClosedPolygon,
 'closed-line':ClipperLib.EndType.etClosedLine,
 'open-round':ClipperLib.EndType.etOpenRound,
 'open-butt':ClipperLib.EndType.etOpenButt,
 'open-square':ClipperLib.EndType.etOpenSquare,
};

export type OffsetOptions={joinStyle?:JoinStyle;endStyle?:EndStyle;arcToleranceMm?:number;miterLimit?:number};

// The general offset primitive this subsystem is built on, and the reason ADR 0001 concluded no new
// geometry engine was needed: clipper-lib already supports open-path offsets with round joins and
// caps, but the shoreline engine's offsetWater() hardcodes etClosedPolygon (and then intersects the
// result with the rectangular product outline, and throws lake-domain errors). This exposes the
// parameters instead of baking them in.
//
// `paths` are polylines for the open end styles and rings for the closed ones. Rings may be given
// closed or open; the duplicated closing point is dropped either way, since Clipper treats the path
// as implicitly closed for etClosedPolygon and would otherwise see a zero-length final segment.
export function offsetPaths(paths:RingMm[],deltaMm:number,options:OffsetOptions={}):MultiPolygonMm{
 const {joinStyle='round',endStyle='open-round',arcToleranceMm=ARC_TOLERANCE_MM,miterLimit=2}=options;
 const usable=paths.map(dropClosingPoint).filter(path=>path.length>=(endStyle.startsWith('open')?2:3));
 if(!usable.length)return [];
 const offsetter=new ClipperLib.ClipperOffset(miterLimit,Math.max(1,arcToleranceMm*SCALE));
 for(const path of usable)offsetter.AddPath(path.map(([x,y])=>({X:Math.round(x*SCALE),Y:Math.round(y*SCALE)})),JOIN[joinStyle],END[endStyle]);
 const tree=new ClipperLib.PolyTree();
 offsetter.Execute(tree,deltaMm*SCALE);
 return ClipperLib.JS.PolyTreeToExPolygons(tree).map(poly=>[poly.outer,...poly.holes].map(ring=>{
  const out:RingMm=ring.map(p=>[p.X/SCALE,p.Y/SCALE] as [number,number]);
  out.push([...out[0]] as [number,number]);
  return out;
 }));
}

function dropClosingPoint(path:RingMm):RingMm{
 if(path.length<2)return path;
 const [fx,fy]=path[0],[lx,ly]=path[path.length-1];
 return Math.abs(fx-lx)<1e-9&&Math.abs(fy-ly)<1e-9?path.slice(0,-1):path;
}
