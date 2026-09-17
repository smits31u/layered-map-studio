import type {RingMm} from '../../geometry/shoreline/polygonEngine';

// A point in ornament millimetres, matching the tuple shape the ornament geometry pipeline uses
// throughout (`RingMm` is an array of these).
type PointMm=RingMm[number];

// Ramer–Douglas–Peucker, in ornament millimetres.
//
// It runs on *projected* coordinates rather than on longitude and latitude on purpose: the tolerance
// is a physical distance on the finished piece, so it means the same thing at every zoom and
// latitude. A tolerance expressed in degrees would simplify a Wisconsin capture and a Florida
// capture differently for no reason a user could predict.
//
// Iterative rather than recursive. A dense coastline ring is tens of thousands of points, and the
// naive recursion overflows the stack on exactly the captures this exists to make survivable.

export const simplifyLine=(points:readonly PointMm[],toleranceMm:number):PointMm[]=>{
 if(toleranceMm<=0||points.length<3)return points.slice();
 const keep=new Uint8Array(points.length);
 keep[0]=1;
 keep[points.length-1]=1;
 const stack:[number,number][]=[[0,points.length-1]];
 const toleranceSq=toleranceMm*toleranceMm;
 while(stack.length){
  const [first,last]=stack.pop()!;
  if(last<=first+1)continue;
  let farthest=-1,farthestSq=toleranceSq;
  for(let index=first+1;index<last;index++){
   const distanceSq=perpendicularDistanceSq(points[index],points[first],points[last]);
   if(distanceSq>farthestSq){farthest=index;farthestSq=distanceSq}
  }
  if(farthest<0)continue;
  keep[farthest]=1;
  stack.push([first,farthest],[farthest,last]);
 }
 const out:PointMm[]=[];
 for(let index=0;index<points.length;index++)if(keep[index])out.push(points[index]);
 return out;
};

// Squared perpendicular distance from `point` to the segment `start`–`end`. Squared throughout so
// the inner loop has no square root in it; the caller compares against a squared tolerance.
function perpendicularDistanceSq(point:PointMm,start:PointMm,end:PointMm):number{
 const dx=end[0]-start[0],dy=end[1]-start[1];
 if(dx===0&&dy===0){
  const ox=point[0]-start[0],oy=point[1]-start[1];
  return ox*ox+oy*oy;
 }
 // Projection parameter, clamped so a point beyond either end measures to that end rather than to
 // the infinite line — a ring doubling back on itself would otherwise keep points it does not need.
 const t=Math.max(0,Math.min(1,((point[0]-start[0])*dx+(point[1]-start[1])*dy)/(dx*dx+dy*dy)));
 const px=start[0]+t*dx,py=start[1]+t*dy;
 const ox=point[0]-px,oy=point[1]-py;
 return ox*ox+oy*oy;
}

// A closed ring needs its first and last point to stay equal, and needs at least three distinct
// points to still be a polygon. A ring that simplifies below that is returned unchanged rather than
// destroyed: dropping it would be exactly the silent geometry loss the ornament refuses elsewhere.
export const simplifyRing=(ring:readonly PointMm[],toleranceMm:number):PointMm[]=>{
 if(toleranceMm<=0||ring.length<5)return ring.slice();
 const closed=ring.length>1&&ring[0][0]===ring[ring.length-1][0]&&ring[0][1]===ring[ring.length-1][1];
 const open=closed?ring.slice(0,-1):ring.slice();
 const simplified=simplifyLine(open,toleranceMm);
 if(simplified.length<3)return ring.slice();
 return closed?[...simplified,simplified[0]]:simplified;
};

export const countLineVertices=(lines:readonly (readonly PointMm[])[]):number=>{
 let total=0;
 for(const line of lines)total+=line.length;
 return total;
};
