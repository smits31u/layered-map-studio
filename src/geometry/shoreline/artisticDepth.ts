import * as polygonClipping from 'polygon-clipping';
import {multiPolygonArea,offsetWater,polygonArea,type MultiPolygonMm,type PolygonMm,type RingMm} from './polygonEngine';
export const NORMALIZED_DESIGN_WIDTH=500;
export type ArtisticDepthPresetName='xfine'|'fine'|'narrow'|'normal'|'wide'|'custom';
export type ArtisticDepthPreset={name:ArtisticDepthPresetName;normalizedOffsets:number[];measured:boolean};
export const ARTISTIC_DEPTH_PRESETS:Record<Exclude<ArtisticDepthPresetName,'custom'>,ArtisticDepthPreset>={
 xfine:{name:'xfine',normalizedOffsets:[1,3,7,12,19],measured:false},fine:{name:'fine',normalizedOffsets:[2,6,13,22,34],measured:false},narrow:{name:'narrow',normalizedOffsets:[2.5,7.5,16,27,41],measured:false},normal:{name:'normal',normalizedOffsets:[3,9,20,25,30],measured:true},wide:{name:'wide',normalizedOffsets:[5,14,30,49,73],measured:false},
};
// 3/9/20 reproduce measured template behavior. 25/30 are generalized deep-layer extensions,
// selected by a deterministic cross-lake search; they remain provisional until deeper template
// references exist and deliberately avoid any lake-specific retained-area target.
export const COLLAPSED_ARTISTIC_OPENING_AREA_MM2=.01;
// closingEpsilonNormalized is optional so existing custom cleanup configs (e.g. in tests) that omit
// it keep their exact prior behavior (treated as [0] — no closing) without needing to be updated.
export type ArtisticDepthCleanup={preOffsetSimplifyTolerance:number;postOffsetSimplifyTolerance:number;minimumComponentAreaNormalized:number[];minimumComponentAreaRatio:number[];minimumHoleAreaNormalized:number[];cropEdgeMinimumAreaNormalized:number;closingEpsilonNormalized?:number[]};
// closingEpsilonNormalized: a depth-indexed morphological closing (dilate then erode by the same
// amount) applied to the working water geometry immediately before that depth's main erosion.
// Closing heals narrow water necks pinched by land intrusions and fills small islands below the
// closing radius, without expanding the true original shoreline used by Land (the final nesting
// step below always re-intersects with the true, unclosed `original`). Root cause: shorelines with
// high perimeter-to-area complexity (branches, islands) lose disproportionately more area under
// uniform Euclidean erosion than simple/rounder shorelines — see the crop-collapse investigation.
// [0,6,7] was found by testing a small, reasoned matrix of schedules against all three lakes with a
// known reference target, through the real production pipeline (including the nesting clamp below):
// it brings Caldron Falls (the most complex regression shoreline) within the documented acceptance
// band at every depth (W1 within +/-3, W2/W3 within +/-5) while Wind Pudding's match slightly
// improves and Lake Noquebay's excellent match is only mildly affected (W3 shifts by ~5 points,
// still a good match). No per-lake constants are involved — the same array applies to every product.
export const DEFAULT_ARTISTIC_DEPTH_CLEANUP:ArtisticDepthCleanup={preOffsetSimplifyTolerance:.08,postOffsetSimplifyTolerance:.04,minimumComponentAreaNormalized:[.5,1,2,3,4],minimumComponentAreaRatio:[.001,.003,.01,.015,.02],minimumHoleAreaNormalized:[.2,.5,1,1.5,2],cropEdgeMinimumAreaNormalized:.25,closingEpsilonNormalized:[0,6,7]};
export const normalizedProductSize=(widthMm:number,heightMm:number)=>({width:500,height:500*heightMm/widthMm});
export const normalizedOffsetToMm=(normalizedOffset:number,widthMm:number)=>normalizedOffset*widthMm/NORMALIZED_DESIGN_WIDTH;
export function presetOffsets(name:ArtisticDepthPresetName,custom:number[]=[]){return name==='custom'?custom:[...ARTISTIC_DEPTH_PRESETS[name].normalizedOffsets]}
const sq=(value:number)=>value*value;
const pointSegmentDistanceSq=(p:[number,number],a:[number,number],b:[number,number])=>{const dx=b[0]-a[0],dy=b[1]-a[1];if(dx===0&&dy===0)return sq(p[0]-a[0])+sq(p[1]-a[1]);const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy))),x=a[0]+t*dx,y=a[1]+t*dy;return sq(p[0]-x)+sq(p[1]-y)};
function simplifyOpen(points:[number,number][],tolerance:number):[number,number][]{if(points.length<=2)return points;let max=0,index=0;for(let i=1;i<points.length-1;i++){const distance=pointSegmentDistanceSq(points[i],points[0],points.at(-1)!);if(distance>max){max=distance;index=i}}if(max>tolerance*tolerance){const left=simplifyOpen(points.slice(0,index+1),tolerance),right=simplifyOpen(points.slice(index),tolerance);return[...left.slice(0,-1),...right]}return[points[0],points.at(-1)!]}
function simplifyRing(ring:RingMm,toleranceMm:number):RingMm{if(toleranceMm<=0)return ring;const points=ring.slice(0,-1);if(points.length<4)return ring;let farthest=1,max=0;for(let i=1;i<points.length;i++){const distance=sq(points[i][0]-points[0][0])+sq(points[i][1]-points[0][1]);if(distance>max){max=distance;farthest=i}}const rotated=[...points.slice(farthest),...points.slice(0,farthest),points[farthest]],simplified=simplifyOpen(rotated,toleranceMm);if(simplified.length<4)return ring;return simplified}
export function simplifyGeometry(geometry:MultiPolygonMm,toleranceMm:number):MultiPolygonMm{return geometry.map(polygon=>polygon.map(ring=>simplifyRing(ring,toleranceMm))).filter(polygon=>polygon.length&&polygonArea(polygon)>0)}
const ringArea=(ring:RingMm)=>Math.abs(ring.slice(0,-1).reduce((sum,p,index)=>{const q=ring[index+1];return sum+p[0]*q[1]-q[0]*p[1]},0)/2);
const touchesCrop=(polygon:PolygonMm,width:number,height:number,epsilon=.002)=>polygon[0].some(([x,y])=>x<=epsilon||y<=epsilon||x>=width-epsilon||y>=height-epsilon);
const depthValue=(values:number[],index:number)=>values[Math.min(index,values.length-1)];
// Morphological closing: dilate by epsilon then erode back by the same amount. Widens/heals narrow
// water necks and small islands below the closing radius; if either offset direction collapses,
// falls back to the unclosed input rather than throwing, since closing is a pre-pass, not the main
// erosion — the main erosion's own collapse handling still applies afterward.
export function closeWater(water:MultiPolygonMm,epsilonMm:number,widthMm:number,heightMm:number):MultiPolygonMm{
 if(epsilonMm<=0)return water;
 let dilated:MultiPolygonMm;
 try{dilated=offsetWater(water,epsilonMm,widthMm,heightMm)}catch{return water}
 try{return offsetWater(dilated,-epsilonMm,widthMm,heightMm)}catch{return water}
}
export type ArtisticOpening={normalizedOffset:number;physicalOffsetMm:number;geometry:MultiPolygonMm;areaMm2:number;componentCount:number;holeCount:number;vertexCount:number;smallestComponentAreaMm2:number;largestComponentAreaMm2:number;rejectedComponents:number;rejectedHoles:number};

// Every intermediate stage of one depth level's erosion, exposed for diagnostics without changing
// production behavior — artisticDepthOpenings below is a thin wrapper over this. rawBuffer is the
// ClipperOffset result straight off closedWorking (already round-join + PolyTree-repaired + crop-clipped
// inside offsetWater); postSimplify applies the light post-offset simplification; nested additionally
// guarantees containment inside the original W0 shoreline; cleaned is nested after component/hole cleanup.
export type ArtisticDepthStageSnapshot={normalizedOffset:number;physicalOffsetMm:number;preOffsetWorking:MultiPolygonMm;depthWorking:MultiPolygonMm;closedWorking:MultiPolygonMm;rawBuffer:MultiPolygonMm;postSimplify:MultiPolygonMm;nested:MultiPolygonMm;cleaned:MultiPolygonMm;rejectedComponents:number;rejectedHoles:number};

export function artisticDepthStages(original:MultiPolygonMm,normalizedOffsets:number[],widthMm:number,heightMm:number,minComponentAreaNormalized?:number,cleanup:ArtisticDepthCleanup=DEFAULT_ARTISTIC_DEPTH_CLEANUP):ArtisticDepthStageSnapshot[]{
 const scale=widthMm/NORMALIZED_DESIGN_WIDTH,working=simplifyGeometry(original,cleanup.preOffsetSimplifyTolerance*scale),originalArea=multiPolygonArea(original);
 // previous starts at the true original W0 and becomes each depth's cleaned result. Offsets are
 // still computed independently from `working`/`closedWorking` (never recursively eroding a prior
 // depth's result), but the final containment intersection uses `previous` instead of always
 // `original`: with per-depth closing epsilon now varying, plain Euclidean-erosion monotonicity no
 // longer guarantees Wi stays inside Wi-1 on its own (a more-closed deeper level can heal a narrow
 // neck a less-closed shallower level excluded), so that guarantee must be enforced explicitly here.
 let previous=original;
 return normalizedOffsets.map((normalizedOffset,depthIndex)=>{const physicalOffsetMm=normalizedOffsetToMm(normalizedOffset,widthMm),minimumHoleArea=depthValue(cleanup.minimumHoleAreaNormalized,depthIndex)*scale*scale;let rejectedHoles=0;const depthWorking=working.map(polygon=>[polygon[0],...polygon.slice(1).filter(hole=>{const keep=ringArea(hole)>=minimumHoleArea;if(!keep)rejectedHoles++;return keep})]);const closingEpsilonMm=depthValue(cleanup.closingEpsilonNormalized??[0],depthIndex)*scale,closedWorking=closeWater(depthWorking,closingEpsilonMm,widthMm,heightMm);let rawBuffer:MultiPolygonMm=[];try{rawBuffer=offsetWater(closedWorking,-physicalOffsetMm,widthMm,heightMm)}catch(error){if(!(error as Error).message.includes('collapsed'))throw error}const postSimplify=simplifyGeometry(rawBuffer,cleanup.postOffsetSimplifyTolerance*scale);let nested:MultiPolygonMm;try{nested=polygonClipping.intersection(postSimplify,previous)}catch(error){throw new Error(`Artistic depth topology repair failed: ${(error as Error).message}`)}const largestArea=Math.max(0,...nested.map(polygonArea)),absoluteNormalized=minComponentAreaNormalized??depthValue(cleanup.minimumComponentAreaNormalized,depthIndex),absoluteArea=absoluteNormalized*scale*scale,relative=depthValue(cleanup.minimumComponentAreaRatio,depthIndex),edgeArea=cleanup.cropEdgeMinimumAreaNormalized*scale*scale;let rejectedComponents=0;const cleaned=nested.filter(polygon=>{const area=polygonArea(polygon),keep=area===largestArea||(touchesCrop(polygon,widthMm,heightMm,physicalOffsetMm+.002)?area>=edgeArea:area>=absoluteArea&&area>=largestArea*relative&&area>=originalArea*relative*.25);if(!keep)rejectedComponents++;return keep}).map(polygon=>{const holes=polygon.slice(1).filter(hole=>{const keep=ringArea(hole)>=minimumHoleArea;if(!keep)rejectedHoles++;return keep});return[polygon[0],...holes]});previous=cleaned;return{normalizedOffset,physicalOffsetMm,preOffsetWorking:working,depthWorking,closedWorking,rawBuffer,postSimplify,nested,cleaned,rejectedComponents,rejectedHoles}});
}

export function artisticDepthOpenings(original:MultiPolygonMm,normalizedOffsets:number[],widthMm:number,heightMm:number,minComponentAreaNormalized?:number,cleanup:ArtisticDepthCleanup=DEFAULT_ARTISTIC_DEPTH_CLEANUP):ArtisticOpening[]{
 return artisticDepthStages(original,normalizedOffsets,widthMm,heightMm,minComponentAreaNormalized,cleanup).map(stage=>{const cleaned=stage.cleaned,areas=cleaned.map(polygonArea),holeCount=cleaned.reduce((sum,polygon)=>sum+polygon.length-1,0),vertexCount=cleaned.reduce((sum,polygon)=>sum+polygon.reduce((ringSum,ring)=>ringSum+ring.length-1,0),0);return{normalizedOffset:stage.normalizedOffset,physicalOffsetMm:stage.physicalOffsetMm,geometry:cleaned,areaMm2:multiPolygonArea(cleaned),componentCount:cleaned.length,holeCount,vertexCount,smallestComponentAreaMm2:areas.length?Math.min(...areas):0,largestComponentAreaMm2:areas.length?Math.max(...areas):0,rejectedComponents:stage.rejectedComponents,rejectedHoles:stage.rejectedHoles}});
}
