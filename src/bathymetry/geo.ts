import * as polygonClipping from 'polygon-clipping';
import type {GeoMultiPolygon} from './model';

// Small lng/lat helpers shared by the state router and the DNR providers. Areas are planar in
// degrees scaled by cos(latitude), which is plenty for ratios and thresholds at lake scale.
export type Position=[number,number];
export type Ring=Position[];

export function pointInRing([x,y]:Position,ring:Ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside}return inside}
export const pointInMultiPolygon=(point:Position,geometry:GeoMultiPolygon)=>geometry.some(polygon=>pointInRing(point,polygon[0])&&!polygon.slice(1).some(hole=>pointInRing(point,hole)));

const METERS_PER_DEGREE=111_320;
const ringAreaDeg2=(ring:Ring)=>{let sum=0;for(let i=0;i<ring.length-1;i++)sum+=ring[i][0]*ring[i+1][1]-ring[i+1][0]*ring[i][1];return Math.abs(sum/2)};
export const ringAreaM2=(ring:Ring)=>ringAreaDeg2(ring)*METERS_PER_DEGREE**2*Math.cos((ring[0]?.[1]??0)*Math.PI/180);
export const multiPolygonAreaM2=(geometry:GeoMultiPolygon)=>geometry.reduce((sum,polygon)=>sum+Math.max(0,ringAreaM2(polygon[0])-polygon.slice(1).reduce((holes,ring)=>holes+ringAreaM2(ring),0)),0);
export const distanceM=(a:Position,b:Position)=>Math.hypot((a[0]-b[0])*Math.cos(a[1]*Math.PI/180),a[1]-b[1])*METERS_PER_DEGREE;

export function bbox(geometry:GeoMultiPolygon):[number,number,number,number]{let w=Infinity,s=Infinity,e=-Infinity,n=-Infinity;for(const polygon of geometry)for(const ring of polygon)for(const[x,y]of ring){w=Math.min(w,x);e=Math.max(e,x);s=Math.min(s,y);n=Math.max(n,y)}return[w,s,e,n]}

export function intersects(a:GeoMultiPolygon,b:GeoMultiPolygon){
 const[aw,as,ae,an]=bbox(a),[bw,bs,be,bn]=bbox(b);
 if(aw>be||bw>ae||as>bn||bs>an)return false;
 return polygonClipping.intersection(a,b).length>0;
}

// A point guaranteed to lie inside the largest polygon: the midpoint of the widest span on a
// horizontal scanline through its middle. A centroid can fall outside a crescent-shaped lake.
export function interiorPoint(geometry:GeoMultiPolygon):Position{
 const polygon=[...geometry].sort((a,b)=>ringAreaDeg2(b[0])-ringAreaDeg2(a[0]))[0];
 const[,s,,n]=bbox([polygon]),y=(s+n)/2,xs:number[]=[];
 for(const ring of polygon)for(let i=0;i<ring.length-1;i++){const a=ring[i],b=ring[i+1];if((a[1]>y)!==(b[1]>y))xs.push(a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]))}
 xs.sort((a,b)=>a-b);
 let best:Position=polygon[0][0],width=-1;
 for(let i=0;i+1<xs.length;i+=2)if(xs[i+1]-xs[i]>width){width=xs[i+1]-xs[i];best=[(xs[i]+xs[i+1])/2,y]}
 return best;
}
