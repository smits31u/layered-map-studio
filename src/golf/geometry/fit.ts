import type {LonLat} from '../../server/golf/types';

// Course → board millimetres (docs/GOLF_MODULE_PLAN.md §4 steps 2–3).
//
// A course is a kilometre or two across, so a local tangent plane at the course's centre is exact to
// well under a laser's kerf: metres east and north from the centre, the same in every direction,
// with no Web Mercator stretch to undo. The board is +y downward, like every other tool here.
//
// "Keep north up" off rotates the course to fit the board best: the candidate rotations are the
// ones that lay a convex-hull edge along either board axis (the minimum-area rectangle is always one
// of them), and the one giving the largest scale wins. Ties go to the smaller turn.

const EARTH_RADIUS_M=6378137;
const RAD=Math.PI/180;

export interface FitRect{x:number;y:number;width:number;height:number}

export interface BoardFit{
 project(point:LonLat):[number,number];
 // Millimetres of board per metre of ground, and its reciprocal as a "1:N" scale.
 mmPerMetre:number;
 scaleDenominator:number;
 // Clockwise turn of the course on the board, degrees; 0 is north up.
 rotationDeg:number;
 // The ground the whole board covers, metres.
 coverageM:{width:number;height:number};
 content:FitRect;
}

export class GolfFitError extends Error{constructor(message:string){super(message);this.name='GolfFitError'}}

type P=[number,number];

function convexHull(points:P[]):P[]{
 const sorted=[...points].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 if(sorted.length<3)return sorted;
 const cross=(o:P,a:P,b:P)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
 const lower:P[]=[],upper:P[]=[];
 for(const p of sorted){while(lower.length>=2&&cross(lower[lower.length-2],lower[lower.length-1],p)<=0)lower.pop();lower.push(p)}
 for(const p of [...sorted].reverse()){while(upper.length>=2&&cross(upper[upper.length-2],upper[upper.length-1],p)<=0)upper.pop();upper.push(p)}
 return lower.slice(0,-1).concat(upper.slice(0,-1));
}

const rotate=([u,v]:P,theta:number):P=>{const c=Math.cos(theta),s=Math.sin(theta);return [u*c-v*s,u*s+v*c]};
const bounds=(points:P[])=>{
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 for(const [x,y] of points){if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y}
 return {minX,minY,maxX,maxY,width:maxX-minX,height:maxY-minY};
};
// Into (-90°, 90°]: a course turned 180° is the same fit upside down, never the better one.
const normalizeTurn=(theta:number)=>{let t=theta%Math.PI;if(t<=-Math.PI/2)t+=Math.PI;if(t>Math.PI/2)t-=Math.PI;return t};

export interface FitInput{
 // The course outline's outer rings, and the geographic centre to project about.
 outline:LonLat[];
 center:LonLat;
 board:{widthMm:number;heightMm:number;marginMm:number;northUp:boolean};
 // Board height kept free at the top for a header title strip.
 reserveTopMm?:number;
}

export function fitCourse({outline,center,board,reserveTopMm=0}:FitInput):BoardFit{
 const [lon0,lat0]=center;
 const kx=EARTH_RADIUS_M*RAD*Math.cos(lat0*RAD),ky=EARTH_RADIUS_M*RAD;
 // Metres east (u) and south (v) of the centre.
 const local=([lon,lat]:LonLat):P=>[(lon-lon0)*kx,(lat0-lat)*ky];
 const points=outline.map(local);
 if(points.length<3)throw new GolfFitError('The course outline has too few points to fit.');
 const content:FitRect={x:board.marginMm,y:board.marginMm+reserveTopMm,width:board.widthMm-2*board.marginMm,height:board.heightMm-2*board.marginMm-reserveTopMm};
 if(content.width<10||content.height<10)throw new GolfFitError(`The margin${reserveTopMm?' and the title':''} leave${reserveTopMm?'':'s'} only ${Math.max(0,content.width).toFixed(1)} × ${Math.max(0,content.height).toFixed(1)} mm for the course. Make the board bigger, the margin smaller${reserveTopMm?', or the title smaller':''}.`);

 const hull=convexHull(points);
 const candidates=new Set<number>([0]);
 if(!board.northUp)for(let i=0;i<hull.length;i++){
  const a=hull[i],b=hull[(i+1)%hull.length];
  const angle=Math.atan2(b[1]-a[1],b[0]-a[0]);
  candidates.add(Number(normalizeTurn(-angle).toFixed(9)));
  candidates.add(Number(normalizeTurn(-angle+Math.PI/2).toFixed(9)));
 }
 let best={theta:0,scale:-Infinity};
 for(const theta of [...candidates].sort((a,b)=>Math.abs(a)-Math.abs(b)||a-b)){
  const b=bounds(hull.map(p=>rotate(p,theta)));
  const scale=Math.min(content.width/b.width,content.height/b.height);
  if(scale>best.scale*(1+1e-9))best={theta,scale};
 }
 const {theta,scale}=best;
 if(!Number.isFinite(scale)||scale<=0)throw new GolfFitError('The course outline has no area to fit.');
 const b=bounds(hull.map(p=>rotate(p,theta)));
 const cx=(b.minX+b.maxX)/2,cy=(b.minY+b.maxY)/2;
 const ox=content.x+content.width/2,oy=content.y+content.height/2;
 return {
  project(point){const [u,v]=rotate(local(point),theta);return [ox+(u-cx)*scale,oy+(v-cy)*scale]},
  mmPerMetre:scale,
  scaleDenominator:1000/scale,
  rotationDeg:theta/RAD,
  coverageM:{width:board.widthMm/scale,height:board.heightMm/scale},
  content,
 };
}
