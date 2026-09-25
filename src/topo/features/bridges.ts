import type {MultiPolygonMm,RingMm} from '../../geometry/shoreline/polygonEngine';
import {pointInRing} from '../../geometry/terrain/contourGeometry';
import {polylineLengthMm,type PointMm,type PolylineMm} from '../../ornament/geometry/clipLine';
import {createDefaultOrnamentProject} from '../../ornament/defaults';
import {offsetPaths} from '../../ornament/geometry/offsetPaths';
import {assertFinite,unionAll} from '../../ornament/geometry/polygonRepair';
import {capArcToleranceMm} from '../../ornament/geometry/roadGeometry';
import type {TopoFeatureWarning} from './warnings';

// Bridges: where a road or the route genuinely crosses water, keep a tab of material across the gap.
//
// Water is cut out of every terrain layer, so without this a bridge — often the defining feature of
// a coastal or river town — would simply be missing. The tab is the same structural idea as the
// ornament's hanging-loop neck: a physically connected strip of material across a cut-out region. It
// is as wide as the road it carries, from the millimetre width table, and it is a tab only when the
// crossing is real:
//
//   crossing   a run over water that reaches land at two or more points — a bridge, a causeway.
//   dead end   a run over water that reaches land at most once — a pier, a boat launch, a road that
//              stops at the shore. No tab: it would be a spit of material hanging into the water.
//   tunnel     never a tab, whatever it crosses: there is no deck to carry.
//
// How runs are found. Every centreline is split where it crosses the water's boundary, and each
// piece is classified wet or dry by its midpoint. A maximal wet stretch is a run. Each end of a run is
//   - a land exit when the line itself carries on over land there;
//   - a land exit when it is the line's endpoint and another road carries on over land from that
//     same point (a bridge mapped as its own way, ending where the approach road begins);
//   - a node otherwise: the line's endpoint, still over water. Runs meeting at a node are one
//     crossing, and so are runs that touch within a hair of each other — the same road decoded by two
//     vector tiles overlaps itself in the tiles' buffer and shares no endpoint;
//   - nothing at all when it is the board edge: a bridge that leaves the board reaches no land here.
// A connected group of runs with two or more land exits is a crossing, and all its runs get tabs.

export interface BridgeCandidate{line:PolylineMm;widthMm:number;tunnel?:boolean;tag?:string}
export interface BridgeSpan{line:PolylineMm;widthMm:number;lengthMm:number;tag?:string}
export interface BridgeAnalysis{spans:BridgeSpan[];deadEnds:number;tunnelsOverWater:number}

// The ornament's minimum neck width (its default hanging-loop requirement): the narrowest connection
// the ornament will cut. Bridge tabs are measured against it and reported, not widened past the road.
export const MIN_BRIDGE_TAB_WIDTH_MM=createDefaultOrnamentProject().ornament.hangingLoop.minNeckWidthMm;

const NODE_QUANTUM=1e4; // 0.1 µm: far below any feature, far above float noise in one projection
const nodeKey=([x,y]:PointMm)=>`${Math.round(x*NODE_QUANTUM)+0},${Math.round(y*NODE_QUANTUM)+0}`;
// Two decodings of one road by neighbouring tiles lie on top of each other to well under this.
export const RUN_TOUCH_TOLERANCE_MM=.01;
const EDGE_EPS=1e-6;

interface IndexedRing{ring:RingMm;minX:number;minY:number;maxX:number;maxY:number}
interface IndexedPolygon{outer:IndexedRing;holes:IndexedRing[]}

const indexRing=(ring:RingMm):IndexedRing=>{
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 for(const [x,y] of ring){if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y}
 return {ring,minX,minY,maxX,maxY};
};
const inBox=(r:IndexedRing,x:number,y:number)=>x>=r.minX&&x<=r.maxX&&y>=r.minY&&y<=r.maxY;

// Parameters t in (0,1) where a→b crosses a ring edge.
function crossings(a:PointMm,b:PointMm,rings:readonly IndexedRing[],into:number[]):void{
 const sMinX=Math.min(a[0],b[0]),sMaxX=Math.max(a[0],b[0]),sMinY=Math.min(a[1],b[1]),sMaxY=Math.max(a[1],b[1]);
 const dx=b[0]-a[0],dy=b[1]-a[1];
 for(const r of rings){
  if(sMaxX<r.minX||sMinX>r.maxX||sMaxY<r.minY||sMinY>r.maxY)continue;
  const ring=r.ring;
  for(let i=0;i+1<ring.length;i++){
   const p=ring[i],q=ring[i+1];
   if(Math.max(p[0],q[0])<sMinX||Math.min(p[0],q[0])>sMaxX||Math.max(p[1],q[1])<sMinY||Math.min(p[1],q[1])>sMaxY)continue;
   const ex=q[0]-p[0],ey=q[1]-p[1],den=dx*ey-dy*ex;
   if(den===0)continue;
   const t=((p[0]-a[0])*ey-(p[1]-a[1])*ex)/den,u=((p[0]-a[0])*dy-(p[1]-a[1])*dx)/den;
   if(t>0&&t<1&&u>=0&&u<=1)into.push(t);
  }
 }
}

function distanceToSegment([px,py]:PointMm,[ax,ay]:PointMm,[bx,by]:PointMm):number{
 const dx=bx-ax,dy=by-ay,len=dx*dx+dy*dy;
 const t=len?Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/len)):0;
 return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));
}

interface Run{candidate:number;points:PolylineMm;ends:[RunEnd,RunEnd]}
type RunEnd={kind:'exit'}|{kind:'edge'}|{kind:'node';key:string;point:PointMm};

export function findBridgeSpans(candidates:readonly BridgeCandidate[],water:MultiPolygonMm,widthMm:number,heightMm:number):BridgeAnalysis{
 if(!water.length)return {spans:[],deadEnds:0,tunnelsOverWater:0};
 const polygons:IndexedPolygon[]=water.map(polygon=>({outer:indexRing(polygon[0]),holes:polygon.slice(1).map(indexRing)}));
 const allRings=polygons.flatMap(p=>[p.outer,...p.holes]);
 const wet=(x:number,y:number)=>polygons.some(p=>inBox(p.outer,x,y)&&pointInRing(x,y,p.outer.ring)&&!p.holes.some(h=>inBox(h,x,y)&&pointInRing(x,y,h.ring)));
 const onEdge=([x,y]:PointMm)=>x<=EDGE_EPS||y<=EDGE_EPS||x>=widthMm-EDGE_EPS||y>=heightMm-EDGE_EPS;

 // Split every line at the shoreline; collect its wet runs, and every point where a road carries on
 // over land from a line endpoint.
 const runs:Run[]=[];
 const dryEndpoints=new Set<string>();
 let tunnelsOverWater=0;
 candidates.forEach((candidate,index)=>{
  const line=candidate.line;
  if(line.length<2)return;
  const pieces:{a:PointMm;b:PointMm;wet:boolean}[]=[];
  const ts:number[]=[];
  for(let i=0;i+1<line.length;i++){
   const a=line[i],b=line[i+1];
   ts.length=0;
   crossings(a,b,allRings,ts);
   ts.push(0,1);
   ts.sort((p,q)=>p-q);
   for(let k=0;k+1<ts.length;k++){
    const t0=ts[k],t1=ts[k+1];
    if(t1-t0<1e-12)continue;
    const p0:PointMm=[a[0]+(b[0]-a[0])*t0,a[1]+(b[1]-a[1])*t0],p1:PointMm=[a[0]+(b[0]-a[0])*t1,a[1]+(b[1]-a[1])*t1];
    pieces.push({a:p0,b:p1,wet:wet((p0[0]+p1[0])/2,(p0[1]+p1[1])/2)});
   }
  }
  if(!pieces.length)return;
  if(!pieces[0].wet)dryEndpoints.add(nodeKey(pieces[0].a));
  if(!pieces[pieces.length-1].wet)dryEndpoints.add(nodeKey(pieces[pieces.length-1].b));
  if(!pieces.some(p=>p.wet))return;
  if(candidate.tunnel){tunnelsOverWater++;return}
  const endOf=(point:PointMm,isLineEnd:boolean):RunEnd=>!isLineEnd?{kind:'exit'}:onEdge(point)?{kind:'edge'}:{kind:'node',key:nodeKey(point),point};
  for(let k=0;k<pieces.length;){
   if(!pieces[k].wet){k++;continue}
   let j=k;
   while(j+1<pieces.length&&pieces[j+1].wet)j++;
   const points:PolylineMm=[pieces[k].a,...pieces.slice(k,j+1).map(p=>p.b)];
   runs.push({candidate:index,points,ends:[endOf(pieces[k].a,k===0),endOf(pieces[j].b,j===pieces.length-1)]});
   k=j+1;
  }
 });

 // A line endpoint over water where another road carries on over land is a land exit.
 for(const run of runs)run.ends=run.ends.map(end=>end.kind==='node'&&dryEndpoints.has(end.key)?{kind:'exit'}:end) as [RunEnd,RunEnd];

 // Group runs: shared nodes, and nodes touching another run.
 const parent=runs.map((_,i)=>i);
 const find=(i:number):number=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i]}return i};
 const union=(a:number,b:number)=>{const ra=find(a),rb=find(b);if(ra!==rb)parent[Math.max(ra,rb)]=Math.min(ra,rb)};
 const byNode=new Map<string,number>();
 runs.forEach((run,i)=>{for(const end of run.ends)if(end.kind==='node'){const seen=byNode.get(end.key);if(seen===undefined)byNode.set(end.key,i);else union(seen,i)}});
 runs.forEach((run,i)=>{
  for(const end of run.ends){
   if(end.kind!=='node')continue;
   runs.forEach((other,j)=>{
    if(j===i||find(j)===find(i))return;
    for(let s=0;s+1<other.points.length;s++)if(distanceToSegment(end.point,other.points[s],other.points[s+1])<=RUN_TOUCH_TOLERANCE_MM){union(i,j);return}
   });
  }
 });

 const exits=new Map<number,number>();
 runs.forEach((run,i)=>{const root=find(i);exits.set(root,(exits.get(root)??0)+run.ends.filter(end=>end.kind==='exit').length)});
 const spans:BridgeSpan[]=[];
 const deadGroups=new Set<number>();
 runs.forEach((run,i)=>{
  const root=find(i);
  if((exits.get(root)??0)>=2){
   const c=candidates[run.candidate];
   spans.push({line:run.points,widthMm:c.widthMm,lengthMm:polylineLengthMm(run.points),...(c.tag!==undefined?{tag:c.tag}:{})});
  }else deadGroups.add(root);
 });
 return {spans,deadEnds:deadGroups.size,tunnelsOverWater};
}

// The tabs themselves: each span buffered to its road's width with round ends, so the tab reaches
// onto the land at both shores, then unioned. Spans of one width share one offset pass.
export function bridgeTabs(spans:readonly BridgeSpan[]):MultiPolygonMm{
 const byWidth=new Map<number,PolylineMm[]>();
 for(const span of spans){const lines=byWidth.get(span.widthMm);if(lines)lines.push(span.line);else byWidth.set(span.widthMm,[span.line])}
 const parts=[...byWidth].map(([width,lines])=>offsetPaths(lines,width/2,{joinStyle:'round',endStyle:'open-round',arcToleranceMm:capArcToleranceMm(width/2)}));
 const tabs=unionAll(parts,'Bridge tabs');
 assertFinite(tabs,'Bridge tabs');
 return tabs;
}

// A tab as wide as a 9 in board's roads (0.4–1.4 mm) is far thinner than the ornament's minimum neck.
// It is kept at the road's width, as specified, and the gap is reported rather than hidden.
export function bridgeTabWarnings(spans:readonly BridgeSpan[],what:'road'|'route'):TopoFeatureWarning[]{
 const narrow=spans.filter(span=>span.widthMm<MIN_BRIDGE_TAB_WIDTH_MM);
 if(!narrow.length)return [];
 const longest=Math.max(...narrow.map(s=>s.lengthMm)),thinnest=Math.min(...narrow.map(s=>s.widthMm));
 return [{code:`bridge-tab-narrow-${what}`,message:`${narrow.length} ${what} bridge tab${narrow.length>1?'s are':' is'} as narrow as ${thinnest.toFixed(2)} mm (spanning up to ${longest.toFixed(1)} mm of water), under the ${MIN_BRIDGE_TAB_WIDTH_MM} mm minimum neck width the ornament requires for a connection that must not snap. Each tab is as wide as its ${what}: raise ${what==='road'?'Road thickness':'Route width'} to widen them, or check the material.`}];
}
