import * as polygonClipping from 'polygon-clipping';
import ClipperLib from 'clipper-lib';
import type {GeoPolygon,LngLat} from '../../types/project';
import type {CropProjection,PointMm} from '../projection/cropProjection';

export type RingMm=[number,number][];
export type PolygonMm=RingMm[];
export type MultiPolygonMm=PolygonMm[];
export type WaterMode='all'|'primary';
export type ArtisticOpeningMetric={offsetNormalized:number;areaMm2:number;components:number;holes:number;vertices:number;smallestComponentAreaMm2:number;largestComponentAreaMm2:number;rejectedComponents:number;rejectedHoles:number};
export type WaterMetrics={rawWaterFeatures:number;normalizedPolygonComponents:number;unionedComponents:number;selectedWaterComponents:number;originalWaterAreaMm2:number;openingAreasMm2:number[];invalidRejectedRings:number;normalizedProductSize?:{width:number;height:number};artisticOffsetsNormalized?:number[];artisticOpenings?:ArtisticOpeningMetric[];rejectedArtisticComponents?:number;rejectedArtisticHoles?:number};
export type WaterModel={water:MultiPolygonMm;metrics:WaterMetrics};
const EPS=.001,SCALE=1000;
const rectangle=(width:number,height:number):MultiPolygonMm=>[[[[0,0],[width,0],[width,height],[0,height],[0,0]]]];
const finite=(p:number[])=>p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1]);
const same=(a:number[],b:number[])=>Math.abs(a[0]-b[0])<EPS&&Math.abs(a[1]-b[1])<EPS;
const signedArea=(ring:RingMm)=>ring.slice(0,-1).reduce((sum,p,i)=>{const q=ring[(i+1)%(ring.length-1)];return sum+p[0]*q[1]-q[0]*p[1]},0)/2;
const ringArea=(ring:RingMm)=>Math.abs(signedArea(ring));
export const polygonArea=(polygon:PolygonMm)=>Math.max(0,ringArea(polygon[0]??[])-polygon.slice(1).reduce((sum,ring)=>sum+ringArea(ring),0));
export const multiPolygonArea=(geometry:MultiPolygonMm)=>geometry.reduce((sum,polygon)=>sum+polygonArea(polygon),0);

// Framing diagnostics: how much of the physical crop the selected water actually occupies.
// Retained-area percentages after erosion are extremely sensitive to this — the same normalized
// offsets remove proportionally more of a lake that occupies less of the crop. Report both the
// area-based and bounding-box-based occupancy since they answer slightly different questions
// (fraction of the page that is water vs. how tightly the crop is framed around the lake).
export const waterAreaOccupancy=(waterAreaMm2:number,widthMm:number,heightMm:number)=>waterAreaMm2/(widthMm*heightMm);
export function waterBoundingBoxOccupancy(water:MultiPolygonMm,widthMm:number,heightMm:number):number{
 if(!water.length)return 0;
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 for(const polygon of water)for(const ring of polygon)for(const [x,y] of ring){if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y}
 return(maxX-minX)*(maxY-minY)/(widthMm*heightMm);
}

function cleanRing(points:PointMm[]):RingMm|undefined{
 const ring:RingMm=[];
 for(const p of points){const pair:[number,number]=[p.x,p.y];if(!finite(pair)||ring.length&&same(ring.at(-1)!,pair))continue;ring.push(pair)}
 if(ring.length>1&&same(ring[0],ring.at(-1)!))ring.pop();
 if(ring.length<3)return;
 ring.push([...ring[0]] as [number,number]);
 if(ringArea(ring)<EPS)return;
 return ring;
}
function normalizeFeature(feature:GeoPolygon,projection:CropProjection,onReject:()=>void):PolygonMm|undefined{
 const rings=feature.rings.map(ring=>cleanRing(ring.map(point=>projection.project(point)))).filter((ring):ring is RingMm=>{if(!ring)onReject();return Boolean(ring)});
 if(!rings.length)return;
 return rings;
}
function pointInRing(point:[number,number],ring:RingMm){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if(((a[1]>point[1])!==(b[1]>point[1]))&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside}return inside}
function contains(polygon:PolygonMm,point:[number,number]){return pointInRing(point,polygon[0])&&!polygon.slice(1).some(ring=>pointInRing(point,ring))}
function centroid(polygon:PolygonMm):[number,number]{const ring=polygon[0],points=ring.slice(0,-1);return[points.reduce((s,p)=>s+p[0],0)/points.length,points.reduce((s,p)=>s+p[1],0)/points.length]}
function selectWater(geometry:MultiPolygonMm,mode:WaterMode,focus?:PointMm){if(mode==='all'||geometry.length<=1)return geometry;if(focus){const p:[number,number]=[focus.x,focus.y],containing=geometry.filter(poly=>contains(poly,p));if(containing.length)return containing}const center:[number,number]=focus?[focus.x,focus.y]:[0,0];return[[...geometry].sort((a,b)=>{const ca=centroid(a),cb=centroid(b),da=Math.hypot(ca[0]-center[0],ca[1]-center[1]),db=Math.hypot(cb[0]-center[0],cb[1]-center[1]);return polygonArea(b)/(1+db)-polygonArea(a)/(1+da)})[0]]}

export function buildWaterModel(features:GeoPolygon[],projection:CropProjection,width:number,height:number,options:{mode?:WaterMode;minAreaMm2?:number;focus?:LngLat}={}):WaterModel{
 let invalidRejectedRings=0;
 const normalized=features.map(feature=>normalizeFeature(feature,projection,()=>invalidRejectedRings++)).filter((polygon):polygon is PolygonMm=>Boolean(polygon));
 let unioned:MultiPolygonMm=[];
 if(normalized.length){try{unioned=polygonClipping.union(normalized[0],...normalized.slice(1))}catch(error){throw new Error(`Water polygon union failed: ${(error as Error).message}`)}}
 try{unioned=unioned.length?polygonClipping.intersection(unioned,rectangle(width,height)):[]}catch(error){throw new Error(`Water crop clipping failed: ${(error as Error).message}`)}
 const minArea=Math.max(0,options.minAreaMm2??1),filtered=unioned.filter(poly=>polygonArea(poly)>=minArea);
 const selected=selectWater(filtered,options.mode??'primary',options.focus?projection.project(options.focus):undefined);
 if(!selected.length)throw new Error('No valid water polygon remains after normalization and physical-area filtering.');
 return{water:selected,metrics:{rawWaterFeatures:features.length,normalizedPolygonComponents:normalized.length,unionedComponents:unioned.length,selectedWaterComponents:selected.length,originalWaterAreaMm2:multiPolygonArea(selected),openingAreasMm2:[],invalidRejectedRings}};
}

function orient(path:ClipperLib.Path,want:boolean){if(ClipperLib.Clipper.Orientation(path)!==want)path.reverse();return path}
export function offsetWater(water:MultiPolygonMm,offsetMm:number,width:number,height:number):MultiPolygonMm{
 if(offsetMm===0)return water;
 const offsetter=new ClipperLib.ClipperOffset(2,.25*SCALE),tree=new ClipperLib.PolyTree();
 for(const polygon of water)polygon.forEach((ring,index)=>offsetter.AddPath(orient(ring.slice(0,-1).map(([x,y])=>({X:Math.round(x*SCALE),Y:Math.round(y*SCALE)})),index===0),ClipperLib.JoinType.jtRound,ClipperLib.EndType.etClosedPolygon));
 offsetter.Execute(tree,offsetMm*SCALE);
 const expanded:MultiPolygonMm=ClipperLib.JS.PolyTreeToExPolygons(tree).map(poly=>[poly.outer,...poly.holes].map(path=>{const ring=path.map(p=>[p.X/SCALE,p.Y/SCALE] as [number,number]);ring.push([...ring[0]] as [number,number]);return ring}));
 if(!expanded.length)throw new Error(`Water opening collapsed at ${offsetMm} mm offset.`);
 try{return polygonClipping.intersection(expanded,rectangle(width,height))}catch(error){throw new Error(`Water offset clipping failed at ${offsetMm} mm: ${(error as Error).message}`)}
}

export function panelFromWater(water:MultiPolygonMm,width:number,height:number):MultiPolygonMm{
 if(!water.length)return rectangle(width,height);
 try{return polygonClipping.difference(rectangle(width,height),water)}catch(error){throw new Error(`Land panel difference failed: ${(error as Error).message}`)}
}
export function geometryPath(geometry:MultiPolygonMm){return geometry.flatMap(poly=>poly).map(ring=>ring.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(3)} ${y.toFixed(3)}`).join(' ')+' Z').join(' ')}
export function validatePanel(geometry:MultiPolygonMm,width:number,height:number,label:string){if(!geometry.length)throw new Error(`${label} geometry could not be generated safely.`);for(const polygon of geometry){if(!polygon.length)throw new Error(`${label} geometry could not be generated safely.`);for(const ring of polygon){if(ring.length<4||!same(ring[0],ring.at(-1)!))throw new Error(`${label} contains an open or degenerate ring.`);for(const [x,y] of ring)if(!Number.isFinite(x)||!Number.isFinite(y)||x<-EPS||y<-EPS||x>width+EPS||y>height+EPS)throw new Error(`${label} contains coordinates outside the physical product.`)}}}
