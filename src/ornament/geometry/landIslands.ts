import {polygonArea,type MultiPolygonMm,type PolygonMm,type RingMm} from '../../geometry/shoreline/polygonEngine';
import {offsetPaths} from './offsetPaths';
import {assertFinite,geometryAreaMm2,normalizeTopology,unionAll} from './polygonRepair';

// Loose land pieces, and what to do about them.
//
// This is a fabrication defect, not a rendering detail. Cutting water out of a disk can leave a
// fragment of land touching nothing: an island in a lake, a sandbar, the far side of a river, a
// headland the ornament clipped off. On screen it is still there. On the machine it drops through
// the honeycomb when the last cut closes, and the customer gets a hole.
//
// The plan is prescriptive about the response: "Detect and warn about loose land islands that would
// fall out after cutting. Offer three explicit policies: keep as separate pieces, bridge
// automatically using user-visible tabs, or omit below a size threshold. Default to warning, never
// silently discard meaningful islands."
//
// Two consequences of that last sentence run through this file. Every policy — including the two
// that do something about the islands — still reports every island it found, so the warning is never
// traded away for an automatic fix. And `omit-below-threshold` reports what it removed *and its
// area*, because "we deleted three islands" is an instruction to go and look, while "we deleted
// three islands" with no sizes is an instruction to trust the tool.

export type LandIslandPolicy='keep-separate'|'bridge'|'omit-below-threshold';

export const LAND_ISLAND_POLICIES:LandIslandPolicy[]=['keep-separate','bridge','omit-below-threshold'];

export interface LandIsland{
 areaMm2:number;
 centroidMm:[number,number];
 // Longest dimension of the island's bounding box. A better "is this meaningful?" signal than area
 // for a long thin sandbar, which can have a tiny area and still be 30mm long.
 extentMm:number;
}

export interface LandBridge{from:[number,number];to:[number,number];lengthMm:number;widthMm:number}

export interface IslandAnalysis{
 // Index into the MultiPolygon of the component everything else is measured against: the largest by
 // area. On a normal ornament this is the mainland.
 mainIndex:number;
 islands:LandIsland[];
}

const centroidOf=(ring:RingMm):[number,number]=>{
 const points=ring.slice(0,-1);
 if(!points.length)return [0,0];
 return [points.reduce((sum,p)=>sum+p[0],0)/points.length,points.reduce((sum,p)=>sum+p[1],0)/points.length];
};

const extentOf=(ring:RingMm):number=>{
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 for(const [x,y] of ring){if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y}
 return Number.isFinite(minX)?Math.max(maxX-minX,maxY-minY):0;
};

const describe=(polygon:PolygonMm):LandIsland=>({
 areaMm2:polygonArea(polygon),
 centroidMm:centroidOf(polygon[0]??[]),
 extentMm:extentOf(polygon[0]??[]),
});

// A MultiPolygon out of polygon-clipping has disjoint members by construction, so "connected
// component" and "member polygon" are the same thing and no flood fill is needed. That is worth
// stating rather than assuming: it is only true because every land geometry reaching this function
// has been through `normalizeTopology`.
export function analyseLandIslands(land:MultiPolygonMm):IslandAnalysis{
 if(!land.length)return {mainIndex:-1,islands:[]};
 let mainIndex=0,mainArea=-Infinity;
 const areas=land.map(polygon=>polygonArea(polygon));
 areas.forEach((area,index)=>{if(area>mainArea){mainArea=area;mainIndex=index}});
 const islands=land.map((polygon,index)=>index===mainIndex?undefined:describe(polygon)).filter((island):island is LandIsland=>Boolean(island));
 return {mainIndex,islands};
}

// Nearest-approach search between two rings.
//
// Vertex-to-vertex is not enough. A coastline can run for thirty millimetres between two vertices,
// and the nearest *vertex* on it can be far from the nearest *point* on it — which would make a tab
// far longer than the actual gap, and often longer than the maximum, so the island would be reported
// unbridgeable when a 2mm tab would have done. So each sampled vertex of one ring is measured
// against every sampled *segment* of the other, in both directions.
//
// Exhaustive, which is O(n·m). Both rings are subsampled to at most SAMPLE_LIMIT vertices first,
// capping the work at a fixed budget regardless of how dense the shoreline is. The stride is
// deterministic — every k-th vertex, never a random subset — so the same land geometry always
// produces the same tab in the same place, which is what lets a test assert on tab coordinates.
//
// Sampling can still miss the true nearest approach by up to the sampled spacing. That is a
// fraction of a millimetre in where a tab lands, not a correctness problem: any straight segment
// between the two pieces joins them.
const SAMPLE_LIMIT=512;

// Closest point to p on the segment a→b, as [point, distance].
function closestOnSegment(p:[number,number],a:[number,number],b:[number,number]):[[number,number],number]{
 const dx=b[0]-a[0],dy=b[1]-a[1],lengthSq=dx*dx+dy*dy;
 const t=lengthSq>0?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/lengthSq)):0;
 const point:[number,number]=[a[0]+t*dx,a[1]+t*dy];
 return [point,Math.hypot(p[0]-point[0],p[1]-point[1])];
}

function sampleRing(ring:RingMm):RingMm{
 const points=ring.length>1?ring.slice(0,-1):ring;
 if(points.length<=SAMPLE_LIMIT)return points;
 const stride=Math.ceil(points.length/SAMPLE_LIMIT),sampled:RingMm=[];
 for(let i=0;i<points.length;i+=stride)sampled.push(points[i]);
 return sampled;
}

export function nearestPair(a:RingMm,b:RingMm):{from:[number,number];to:[number,number];lengthMm:number}|undefined{
 const left=sampleRing(a),right=sampleRing(b);
 if(!left.length||!right.length)return undefined;
 let best=Infinity,from:[number,number]=[left[0][0],left[0][1]],to:[number,number]=[right[0][0],right[0][1]];
 const scan=(points:RingMm,against:RingMm,swap:boolean)=>{
  for(const p of points)for(let i=0;i<against.length;i++){
   const [point,distance]=closestOnSegment(p,against[i],against[(i+1)%against.length]);
   // Strictly less than, so the first candidate at a given distance wins and the result does not
   // depend on the order the two rings were passed in.
   if(distance<best){best=distance;from=swap?point:[p[0],p[1]];to=swap?[p[0],p[1]]:point}
  }
 };
 scan(left,right,false);
 scan(right,left,true);
 return {from,to,lengthMm:best};
}

// A tab is a capsule: the segment offset by half the tab width with butt ends, so the tab is exactly
// as long as the gap it spans and does not spill a round cap into the water on either side. It is
// unioned into the land, which is what makes it "user-visible" in the plan's sense — it is real
// material on the finished piece, in the exported cut path, not an annotation.
export function bridgeTab(from:[number,number],to:[number,number],widthMm:number):MultiPolygonMm{
 const length=Math.hypot(to[0]-from[0],to[1]-from[1]);
 if(!(widthMm>0))return [];
 // A zero-length gap needs no tab; the pieces already touch, and a zero-length open path offset with
 // butt ends is empty anyway.
 if(!(length>0))return [];
 return offsetPaths([[from,to]],widthMm/2,{joinStyle:'round',endStyle:'open-butt'});
}

export interface IslandPolicyOptions{
 policy:LandIslandPolicy;
 minIslandAreaMm2:number;
 bridgeWidthMm:number;
 // Tabs longer than this are not drawn: a 40mm strut across open water is not a tab, it is a new
 // design decision, and the island is reported unbridged instead.
 maxBridgeLengthMm?:number;
}

export interface IslandPolicyResult{
 geometry:MultiPolygonMm;
 // Everything found, before the policy ran. Always populated, whatever the policy did.
 detected:LandIsland[];
 omitted:LandIsland[];
 bridges:LandBridge[];
 // Islands the policy intended to bridge but could not reach.
 unbridged:LandIsland[];
 // Islands still loose in the returned geometry.
 remaining:LandIsland[];
}

export const DEFAULT_MAX_BRIDGE_LENGTH_MM=12;

export function applyIslandPolicy(land:MultiPolygonMm,options:IslandPolicyOptions):IslandPolicyResult{
 const analysis=analyseLandIslands(land);
 const detected=analysis.islands;
 const empty={detected,omitted:[] as LandIsland[],bridges:[] as LandBridge[],unbridged:[] as LandIsland[]};
 if(analysis.mainIndex<0||!detected.length)return {...empty,geometry:land,remaining:[]};

 if(options.policy==='omit-below-threshold'){
  const threshold=Math.max(0,options.minIslandAreaMm2);
  const kept:MultiPolygonMm=[],omitted:LandIsland[]=[];
  land.forEach((polygon,index)=>{
   if(index===analysis.mainIndex){kept.push(polygon);return}
   const island=describe(polygon);
   if(island.areaMm2<threshold){omitted.push(island);return}
   kept.push(polygon);
  });
  assertFinite(kept,'Land piece');
  return {...empty,geometry:kept,omitted,remaining:analyseLandIslands(kept).islands};
 }

 // 'bridge' resolves the piece rather than half-resolving it.
 //
 // Choosing "bridge" is choosing to end up with one connected ornament. Leaving a fragment loose
 // because it happened to be out of tab reach would be the policy failing silently — and Phase 4's
 // preflight agrees: loose land under any policy other than keep-separate is an *error* there, on
 // the grounds that the policy was supposed to have dealt with it. So anything that cannot be
 // bridged and is already below the size the user called meaningful is dropped, and anything that
 // cannot be bridged and *is* meaningful is kept, reported, and left for preflight to block on.
 // Deleting a 30mm sandbar to make the export succeed is exactly the silent discard the plan
 // forbids; deleting a 2mm speck the user already said was noise is not.
 if(options.policy==='bridge'){
  const maxLength=options.maxBridgeLengthMm??DEFAULT_MAX_BRIDGE_LENGTH_MM;
  const threshold=Math.max(0,options.minIslandAreaMm2);
  const mainRing=land[analysis.mainIndex][0];
  const bridges:LandBridge[]=[],unbridged:LandIsland[]=[],omitted:LandIsland[]=[],tabs:MultiPolygonMm[]=[];
  const kept:MultiPolygonMm=[];
  land.forEach((polygon,index)=>{
   if(index===analysis.mainIndex){kept.push(polygon);return}
   const island=describe(polygon);
   const pair=nearestPair(polygon[0],mainRing);
   const tab=pair&&pair.lengthMm<=maxLength?bridgeTab(pair.from,pair.to,options.bridgeWidthMm):[];
   if(tab.length&&pair){
    kept.push(polygon);
    tabs.push(tab);
    bridges.push({from:pair.from,to:pair.to,lengthMm:pair.lengthMm,widthMm:options.bridgeWidthMm});
    return;
   }
   if(island.areaMm2<threshold){omitted.push(island);return}
   kept.push(polygon);
   unbridged.push(island);
  });
  const bridged=tabs.length?normalizeTopology(unionAll([kept,...tabs],'Land bridges'),'Land bridges'):kept;
  assertFinite(bridged,'Land piece');
  return {detected,omitted,bridges,unbridged,geometry:bridged,remaining:analyseLandIslands(bridged).islands};
 }

 // 'keep-separate': the geometry is already correct — every island is its own closed cut path and
 // Phase 4 will lay it out as its own piece. The work this policy does is entirely in the report.
 return {...empty,geometry:land,remaining:detected};
}

export const totalIslandAreaMm2=(islands:LandIsland[])=>islands.reduce((sum,island)=>sum+island.areaMm2,0);

export const landAreaMm2=geometryAreaMm2;
