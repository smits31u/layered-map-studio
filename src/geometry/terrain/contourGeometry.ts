import type {RingMm} from '../shoreline/polygonEngine';

// Ring-level helpers for contour extraction: Chaikin smoothing, point-in-ring, and detection of
// rings that cross themselves or each other.

// One pass of Chaikin corner cutting on a closed ring: every edge PQ is replaced by the two points
// ¾P+¼Q and ¼P+¾Q. The result is inscribed in the original polygon at convex corners and sits
// outside it at reflex corners, so it can move a ring outward. The contour pipeline re-clips after
// smoothing for exactly that reason.
export function chaikinRing(ring:RingMm):RingMm{
 const points=ring.slice(0,-1),n=points.length;
 if(n<3)return ring.slice();
 const out:RingMm=[];
 for(let i=0;i<n;i++){
  const [px,py]=points[i],[qx,qy]=points[(i+1)%n];
  out.push([.75*px+.25*qx,.75*py+.25*qy],[.25*px+.75*qx,.25*py+.75*qy]);
 }
 out.push([out[0][0],out[0][1]]);
 return out;
}

// Shoelace area measured from the ring's own first vertex. A contour ring can be a millionth of a
// cell across (a sample sitting exactly on the threshold) while its coordinates are hundreds of
// millimetres; the textbook formula then cancels away the sign entirely. Relative coordinates keep
// the terms the size of the ring.
export function localSignedArea(ring:RingMm):number{
 if(ring.length<4)return 0;
 const [x0,y0]=ring[0];
 let sum=0;
 for(let i=1;i<ring.length-2;i++){
  const ax=ring[i][0]-x0,ay=ring[i][1]-y0,bx=ring[i+1][0]-x0,by=ring[i+1][1]-y0;
  sum+=ax*by-bx*ay;
 }
 return sum/2;
}

// Even/odd ray casting, the same half-open rule as the rasterizer.
export function pointInRing(x:number,y:number,ring:RingMm):boolean{
 let inside=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const [ax,ay]=ring[i],[bx,by]=ring[j];
  if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)inside=!inside;
 }
 return inside;
}

const orient=(ax:number,ay:number,bx:number,by:number,cx:number,cy:number)=>(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
const within=(a:number,b:number,v:number)=>v>=(a<b?a:b)&&v<=(a<b?b:a);

// Closed-segment intersection, touching and collinear overlap included. Deliberately conservative:
// anything short of clear separation counts, because it is used to decide whether a simplified or
// smoothed ring is still safe to cut.
export function segmentsIntersect(ax:number,ay:number,bx:number,by:number,cx:number,cy:number,dx:number,dy:number):boolean{
 const d1=orient(cx,cy,dx,dy,ax,ay),d2=orient(cx,cy,dx,dy,bx,by),d3=orient(ax,ay,bx,by,cx,cy),d4=orient(ax,ay,bx,by,dx,dy);
 if(((d1>0&&d2<0)||(d1<0&&d2>0))&&((d3>0&&d4<0)||(d3<0&&d4>0)))return true;
 if(d1===0&&within(cx,dx,ax)&&within(cy,dy,ay))return true;
 if(d2===0&&within(cx,dx,bx)&&within(cy,dy,by))return true;
 if(d3===0&&within(ax,bx,cx)&&within(ay,by,cy))return true;
 if(d4===0&&within(ax,bx,dx)&&within(ay,by,dy))return true;
 return false;
}

// Indices of every ring that crosses or touches itself or another ring in the set. Segments that
// are consecutive in the same ring (sharing a vertex by construction) are exempt. Candidate pairs
// come from a uniform spatial hash sized to the average segment length, so the cost is close to
// linear for contour-shaped input rather than quadratic.
export function findCrossingRings(rings:readonly RingMm[]):Set<number>{
 const flagged=new Set<number>();
 const segRing:number[]=[],segIndex:number[]=[],segCount:number[]=[],coords:number[]=[];
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,totalLength=0;
 rings.forEach((ring,r)=>{
  const n=ring.length-1;
  for(let i=0;i<n;i++){
   const [ax,ay]=ring[i],[bx,by]=ring[i+1];
   segRing.push(r);segIndex.push(i);segCount.push(n);coords.push(ax,ay,bx,by);
   totalLength+=Math.hypot(bx-ax,by-ay);
   if(ax<minX)minX=ax;if(bx<minX)minX=bx;if(ax>maxX)maxX=ax;if(bx>maxX)maxX=bx;
   if(ay<minY)minY=ay;if(by<minY)minY=by;if(ay>maxY)maxY=ay;if(by>maxY)maxY=by;
  }
 });
 const count=segRing.length;
 if(count<2)return flagged;
 const extent=Math.max(maxX-minX,maxY-minY,1e-9);
 const cell=Math.max(2*totalLength/count,extent/4096,1e-9);
 const columns=Math.floor((maxX-minX)/cell)+1;
 const buckets=new Map<number,number[]>();
 for(let s=0;s<count;s++){
  const ax=coords[4*s],ay=coords[4*s+1],bx=coords[4*s+2],by=coords[4*s+3];
  const c0=Math.floor((Math.min(ax,bx)-minX)/cell),c1=Math.floor((Math.max(ax,bx)-minX)/cell);
  const r0=Math.floor((Math.min(ay,by)-minY)/cell),r1=Math.floor((Math.max(ay,by)-minY)/cell);
  for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++){
   const key=r*columns+c,list=buckets.get(key);
   if(list)list.push(s);else buckets.set(key,[s]);
  }
 }
 const adjacent=(s:number,t:number)=>{
  if(segRing[s]!==segRing[t])return false;
  const n=segCount[s],d=Math.abs(segIndex[s]-segIndex[t]);
  return d===1||d===n-1;
 };
 for(const list of buckets.values()){
  for(let a=0;a<list.length;a++){
   const s=list[a];
   for(let b=a+1;b<list.length;b++){
    const t=list[b];
    if(adjacent(s,t))continue;
    if(segmentsIntersect(coords[4*s],coords[4*s+1],coords[4*s+2],coords[4*s+3],coords[4*t],coords[4*t+1],coords[4*t+2],coords[4*t+3])){
     flagged.add(segRing[s]);flagged.add(segRing[t]);
    }
   }
  }
 }
 return flagged;
}
