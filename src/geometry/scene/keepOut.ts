// Non-destructive keep-out clipping (M-COMPASS). Source road/label geometry is never mutated —
// these functions take the already-computed presentation geometry and return a new, filtered
// result for a given set of exclusion regions. Circles are the only footprint shape needed today
// (the compass's visible extent is circular, so its keep-out mask is a plain circle — rotation is
// irrelevant to a circle's shape, which is why CompassObject.rotationDeg never has to factor into
// keepOutFootprint below), but the polyline clipper works against any circle list, and the
// KeepOutRegion/KeepOutTarget types below are intentionally generic — see docs/v1-milestones.md
// for how a future object (title, lake-info, a marker) would plug into the same system.
export type PointMm={x:number;y:number};
export type Circle={cx:number;cy:number;r:number};

// The lake tool's four layer names. Two ornament targets were added here briefly, for a marker
// keep-out the ornament generator no longer has; they went with it. The mechanism below is
// unchanged and is still the compass's.
export type KeepOutTarget='roads-major'|'roads-minor'|'road-labels'|'place-labels';

export interface KeepOutRegion{
 id:string;
 sourceObjectId:string;
 circles:Circle[]; // physical-mm, already positioned — not local/unpositioned geometry
 paddingMm:number;
 affects:KeepOutTarget[];
}

export function keepOutFootprint(id:string,sourceObjectId:string,centerXMm:number,centerYMm:number,radiusMm:number,paddingMm:number,affects:KeepOutTarget[]):KeepOutRegion{
 return{id,sourceObjectId,circles:[{cx:centerXMm,cy:centerYMm,r:Math.max(0,radiusMm)+Math.max(0,paddingMm)}],paddingMm,affects};
}

export function regionAffects(regions:KeepOutRegion[],target:KeepOutTarget):KeepOutRegion[]{
 return regions.filter(r=>r.affects.includes(target));
}

const EPS=1e-9;
const isOutsideAll=(p:PointMm,circles:Circle[])=>circles.every(c=>Math.hypot(p.x-c.cx,p.y-c.cy)>=c.r-EPS);

// t in (0,1) where segment p0->p1 crosses the circle boundary.
function segmentCircleCrossings(p0:PointMm,p1:PointMm,circle:Circle):number[]{
 const dx=p1.x-p0.x,dy=p1.y-p0.y,fx=p0.x-circle.cx,fy=p0.y-circle.cy;
 const a=dx*dx+dy*dy;
 if(a<EPS)return[];
 const b=2*(fx*dx+fy*dy),c=fx*fx+fy*fy-circle.r*circle.r,disc=b*b-4*a*c;
 if(disc<0)return[];
 const sqrtDisc=Math.sqrt(disc),t1=(-b-sqrtDisc)/(2*a),t2=(-b+sqrtDisc)/(2*a);
 return[t1,t2].filter(t=>t>0&&t<1);
}

// Clips one polyline against a set of exclusion circles, returning zero or more disconnected
// sub-polylines representing only the portions OUTSIDE every circle. A segment can cross multiple
// circles' boundaries; every crossing point across every circle is collected and sorted per
// segment, then each resulting sub-segment's midpoint decides whether that piece is kept — this
// sidesteps ambiguity exactly at a crossing point and handles overlapping circles correctly.
export function clipPolylineAgainstCircles(points:PointMm[],circles:Circle[]):PointMm[][]{
 if(!circles.length||circles.every(c=>c.r<=0))return points.length>1?[points]:[];
 if(points.length<2)return[];
 const result:PointMm[][]=[];
 let current:PointMm[]=[];
 const flush=()=>{if(current.length>1)result.push(current);current=[]};
 if(isOutsideAll(points[0],circles))current.push(points[0]);
 for(let i=0;i<points.length-1;i++){
  const p0=points[i],p1=points[i+1];
  const ts=new Set<number>([0,1]);
  for(const circle of circles)for(const t of segmentCircleCrossings(p0,p1,circle))ts.add(t);
  const sorted=[...ts].sort((a,b)=>a-b);
  const at=(t:number):PointMm=>({x:p0.x+(p1.x-p0.x)*t,y:p0.y+(p1.y-p0.y)*t});
  for(let k=1;k<sorted.length;k++){
   const tMid=(sorted[k-1]+sorted[k])/2,mid=at(tMid);
   if(isOutsideAll(mid,circles)){
    if(current.length===0)current.push(at(sorted[k-1]));
    current.push(at(sorted[k]));
   }else flush();
  }
 }
 flush();
 return result;
}

// Point-based suppression for labels (M-COMPASS §9): a label is suppressed entirely (never
// half-clipped) if its anchor point falls inside any keep-out circle, expanded by half the
// label's own rendered width — a deliberately simple, documented approximation rather than a full
// bounding-box/polygon intersection, per the brief's explicit "do not compromise this milestone on
// perfect label placement" scope limit.
export function pointInsideAnyCircle(point:PointMm,circles:Circle[],extraRadiusMm=0):boolean{
 return circles.some(c=>Math.hypot(point.x-c.cx,point.y-c.cy)<c.r+extraRadiusMm);
}
