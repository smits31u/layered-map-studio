import type { CropGeography,LngLat } from '../../types/project';
export type PointMm={x:number;y:number};
// Exported for the ornament, which projects captured map features with the same Web Mercator this
// crop projection is built on. See src/ornament/geometry/mapProjection.ts for why it reuses this
// function but not the inverse-bilinear CropProjection wrapper around it.
export const mercator=(p:LngLat):PointMm=>({x:(p.lng+180)/360,y:(1-Math.log(Math.tan(p.lat*Math.PI/180)+1/Math.cos(p.lat*Math.PI/180))/Math.PI)/2});
const bilinear=(a:PointMm,b:PointMm,c:PointMm,d:PointMm,u:number,v:number)=>({x:(1-u)*(1-v)*a.x+u*(1-v)*b.x+u*v*c.x+(1-u)*v*d.x,y:(1-u)*(1-v)*a.y+u*(1-v)*b.y+u*v*c.y+(1-u)*v*d.y});
export class CropProjection {
 private corners:PointMm[];
 constructor(crop:CropGeography,readonly widthMm:number,readonly heightMm:number){this.corners=[crop.nw,crop.ne,crop.se,crop.sw].map(mercator)}
 project(p:LngLat):PointMm{
  const q=mercator(p); let u=.5,v=.5;
  for(let i=0;i<12;i++){const z=bilinear(this.corners[0],this.corners[1],this.corners[2],this.corners[3],u,v);const e=1e-6;const zu=bilinear(this.corners[0],this.corners[1],this.corners[2],this.corners[3],u+e,v);const zv=bilinear(this.corners[0],this.corners[1],this.corners[2],this.corners[3],u,v+e);const ax=(zu.x-z.x)/e,ay=(zu.y-z.y)/e,bx=(zv.x-z.x)/e,by=(zv.y-z.y)/e,dx=q.x-z.x,dy=q.y-z.y,det=ax*by-ay*bx;if(Math.abs(det)<1e-15)break;u+=(dx*by-dy*bx)/det;v+=(dy*ax-dx*ay)/det}
  return{x:u*this.widthMm,y:v*this.heightMm};
 }
 // Millimetres back to lng/lat. The forward direction of the same bilinear map, so it needs no
 // iteration; used to hand the selected water body to geographic depth providers.
 unproject(p:PointMm):LngLat{
  const q=bilinear(this.corners[0],this.corners[1],this.corners[2],this.corners[3],p.x/this.widthMm,p.y/this.heightMm);
  return{lng:q.x*360-180,lat:Math.atan(Math.sinh(Math.PI*(1-2*q.y)))*180/Math.PI};
 }
}
export function cropFromCorners(nw:LngLat,ne:LngLat,se:LngLat,sw:LngLat):CropGeography{const pts=[nw,ne,se,sw];return{nw,ne,se,sw,bbox:[Math.min(...pts.map(p=>p.lng)),Math.min(...pts.map(p=>p.lat)),Math.max(...pts.map(p=>p.lng)),Math.max(...pts.map(p=>p.lat))]}}
