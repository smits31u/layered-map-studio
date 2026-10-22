import type {MultiPolygonMm,PolygonMm,RingMm} from '../../geometry/shoreline/polygonEngine';
import {robustBoolean} from '../../geometry/shoreline/robustBoolean';
import {geometryAreaMm2,repairGeometry} from '../../ornament/geometry/polygonRepair';
import {simplifyRing} from '../../ornament/geometry/simplify';
import type {GeoMultiPolygonLL,LonLat} from '../../server/golf/types';

// The board builder's geometry vocabulary, all from the shared engines: booleans are robustBoolean
// (polygon-clipping first, Clipper's integer arithmetic if that throws, as the lake tool's shorelines
// need), simplification is the ornament's RDP in millimetres, repair is polygonRepair's.

export type Project=(point:LonLat)=>[number,number];

// Vertices closer than this to the line through their neighbours go: a tenth of a typical kerf.
export const SIMPLIFY_MM=.02;

export const union=(parts:MultiPolygonMm[]):MultiPolygonMm=>{
 const usable=parts.filter(p=>p.length);
 if(!usable.length)return [];
 return robustBoolean('union',usable[0],usable.slice(1)) as MultiPolygonMm;
};
export const intersect=(a:MultiPolygonMm,b:MultiPolygonMm):MultiPolygonMm=>a.length&&b.length?robustBoolean('intersection',a,[b]) as MultiPolygonMm:[];
export const difference=(a:MultiPolygonMm,b:MultiPolygonMm):MultiPolygonMm=>!a.length?[]:!b.length?a:robustBoolean('difference',a,[b]) as MultiPolygonMm;

// Drops slivers and pinholes the booleans leave, and normalises winding for the SVG.
export const tidy=(geometry:MultiPolygonMm,label:string,minComponentAreaMm2=.05,minHoleAreaMm2=.05)=>repairGeometry(geometry,label,{minComponentAreaMm2,minHoleAreaMm2});

const closeRing=(ring:RingMm):RingMm=>{
 if(ring.length<3)return ring;
 const [fx,fy]=ring[0],[lx,ly]=ring[ring.length-1];
 return fx===lx&&fy===ly?ring:[...ring,[fx,fy]];
};

export function projectPolygons(geometry:GeoMultiPolygonLL,project:Project):MultiPolygonMm{
 const out:MultiPolygonMm=[];
 for(const polygon of geometry){
  const [outer,...holes]=polygon.map(ring=>closeRing(simplifyRing(ring.map(project),SIMPLIFY_MM)));
  // An outer ring that simplified away takes its holes with it.
  if(outer&&outer.length>=4)out.push([outer,...holes.filter(ring=>ring.length>=4)]);
 }
 return out;
}

export const projectLine=(line:LonLat[],project:Project):[number,number][]=>line.map(project);

export const rect=(x:number,y:number,width:number,height:number):MultiPolygonMm=>[[[[x,y],[x+width,y],[x+width,y+height],[x,y+height],[x,y]]]];

export function circle(cx:number,cy:number,radiusMm:number,segments=48):PolygonMm{
 const ring:RingMm=[];
 for(let i=0;i<segments;i++){const a=2*Math.PI*i/segments;ring.push([cx+radiusMm*Math.cos(a),cy+radiusMm*Math.sin(a)])}
 ring.push([...ring[0]] as [number,number]);
 return [ring];
}

// Every ring of a geometry, as a closed polyline (an outline to score).
export const outlines=(geometry:MultiPolygonMm):[number,number][][]=>geometry.flat().filter(r=>r.length>=2).map(r=>r.map(p=>[p[0],p[1]] as [number,number]));

function inRing([x,y]:[number,number],ring:RingMm):boolean{
 let inside=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const [xi,yi]=ring[i],[xj,yj]=ring[j];
  if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside;
 }
 return inside;
}
export const pointIn=(p:[number,number],geometry:MultiPolygonMm)=>geometry.some(polygon=>inRing(p,polygon[0])&&!polygon.slice(1).some(h=>inRing(p,h)));

export function boundsOf(geometry:MultiPolygonMm|PolygonMm[]){
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 for(const polygon of geometry)for(const [x,y] of polygon[0]??[]){if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y}
 return {minX,minY,maxX,maxY};
}

export function centroidOf(polygon:PolygonMm):[number,number]{
 const ring=polygon[0];
 let a=0,cx=0,cy=0;
 for(let i=0;i<ring.length-1;i++){const [x0,y0]=ring[i],[x1,y1]=ring[i+1];const f=x0*y1-x1*y0;a+=f;cx+=(x0+x1)*f;cy+=(y0+y1)*f}
 if(Math.abs(a)<1e-12){const b=boundsOf([polygon]);return [(b.minX+b.maxX)/2,(b.minY+b.maxY)/2]}
 return [cx/(3*a),cy/(3*a)];
}

export const area=geometryAreaMm2;
