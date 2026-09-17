import {MARKER_REGISTRY} from '../../geometry/scene/markerRegistry';
import {isInsideMapWindow,type MapWindow,type PointMm} from '../geometry/clipLine';
import type {MarkerKind} from '../types';
import type {OrnamentIssue} from '../geometry/ornamentShape';

// Marker artwork for the ornament.
//
// The plan requires original heart, pin and house symbols with clear redistribution rights, and
// forbids copying the reference tool's paths. It also says (execution rule 1) to preserve and reuse
// existing repository work. Both are satisfied by reusing `src/geometry/scene/markerRegistry.ts`:
// those symbols were written for the lake map tool in this repository, parameterised rather than
// traced, and are already the project's own artwork. Re-drawing three shapes that already exist
// would add a second set of paths to maintain and no originality that is not already there.
//
// What this module adds is the part the lake tool never needed: an anchor, so the symbol can be
// placed *at* a coordinate rather than centred on one, and a bounding box, so the ornament can tell
// the user when the symbol will not fit inside the map window.

export interface BoundsMm{minX:number;minY:number;maxX:number;maxY:number}

export interface OrnamentMarkerSymbol{
 kind:MarkerKind;
 label:string;
 sizeMm:number;
 // Path data in the symbol's own local space, where the registry centres everything on (0,0).
 path:string;
 bounds:BoundsMm;
 // The point within that local space which should land on the geographic coordinate. Subtract it
 // from every coordinate to place the symbol.
 anchorMm:PointMm;
}

const DEFINITIONS=new Map(MARKER_REGISTRY.map(definition=>[definition.type,definition]));

// A pin points at a place; its tip is the location and anything else would be a lie about where the
// house is. A heart and a house are emblems sitting *on* a place, so they centre on it. The
// registry builds every symbol with a half-height of sizeMm/2, so the pin's tip is at +sizeMm/2.
const anchorFor=(kind:MarkerKind,sizeMm:number):PointMm=>kind==='pin'?[0,sizeMm/2]:[0,0];

const MARKER_LABELS:Record<MarkerKind,string>={heart:'Heart',pin:'Pin',house:'House'};

// Numbers-per-segment for each SVG path command, and which of those numbers are coordinates.
const ARGS:Record<string,number>={M:2,L:2,H:1,V:1,C:6,S:4,Q:4,T:2,A:7,Z:0};

// Conservative bounding box of SVG path data.
//
// Every Bézier lies inside the convex hull of its control points, so including control points
// without solving for extrema over-estimates rather than under-estimates — which is the safe
// direction for a fit check. An elliptical arc is bounded by expanding its endpoints by its radii,
// which is likewise conservative for any rotation or sweep.
export function pathBoundsMm(d:string):BoundsMm{
 const tokens=d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi)??[];
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 let x=0,y=0,startX=0,startY=0;
 let command='',index=0;
 const see=(px:number,py:number)=>{
  if(!Number.isFinite(px)||!Number.isFinite(py))return;
  minX=Math.min(minX,px);minY=Math.min(minY,py);maxX=Math.max(maxX,px);maxY=Math.max(maxY,py);
 };
 while(index<tokens.length){
  const token=tokens[index];
  if(/^[A-Za-z]$/.test(token)){command=token;index++;if(command==='Z'||command==='z'){x=startX;y=startY;continue}}
  const upper=command.toUpperCase();
  const relative=command!==upper;
  const count=ARGS[upper];
  if(count===undefined||count===0)break;
  const args=tokens.slice(index,index+count).map(Number);
  if(args.length<count||args.some(n=>!Number.isFinite(n)))break;
  index+=count;
  if(upper==='H'){x=relative?x+args[0]:args[0];see(x,y)}
  else if(upper==='V'){y=relative?y+args[0]:args[0];see(x,y)}
  else if(upper==='A'){
   const [rx,ry,,,,ax,ay]=args;
   const ex=relative?x+ax:ax,ey=relative?y+ay:ay;
   // The arc stays within the radii of both its endpoints, whatever its rotation and sweep.
   see(x-Math.abs(rx),y-Math.abs(ry));see(x+Math.abs(rx),y+Math.abs(ry));
   see(ex-Math.abs(rx),ey-Math.abs(ry));see(ex+Math.abs(rx),ey+Math.abs(ry));
   x=ex;y=ey;
  }else{
   for(let pair=0;pair<count;pair+=2){
    const px=relative?x+args[pair]:args[pair];
    const py=relative?y+args[pair+1]:args[pair+1];
    see(px,py);
    if(pair+2>=count){x=px;y=py}
   }
   if(upper==='M'){startX=x;startY=y;
    // A second coordinate pair after M is an implicit lineto, which the loop above already handled.
    if(relative)command='l';else command='L';
   }
  }
 }
 return Number.isFinite(minX)?{minX,minY,maxX,maxY}:{minX:0,minY:0,maxX:0,maxY:0};
}

export function buildOrnamentMarker(kind:MarkerKind,sizeMm:number):OrnamentMarkerSymbol{
 const definition=DEFINITIONS.get(kind);
 if(!definition)throw new Error(`No marker artwork is registered for "${kind}".`);
 const path=definition.buildGeometry(sizeMm);
 return {kind,label:MARKER_LABELS[kind],sizeMm,path,bounds:pathBoundsMm(path),anchorMm:anchorFor(kind,sizeMm)};
}

// The symbol's footprint once its anchor is placed at `positionMm`.
export function placedBounds(symbol:OrnamentMarkerSymbol,positionMm:PointMm):BoundsMm{
 const dx=positionMm[0]-symbol.anchorMm[0],dy=positionMm[1]-symbol.anchorMm[1];
 return {minX:symbol.bounds.minX+dx,minY:symbol.bounds.minY+dy,maxX:symbol.bounds.maxX+dx,maxY:symbol.bounds.maxY+dy};
}

export const boundsCorners=(bounds:BoundsMm):PointMm[]=>[[bounds.minX,bounds.minY],[bounds.maxX,bounds.minY],[bounds.maxX,bounds.maxY],[bounds.minX,bounds.maxY]];

// The map window is a disk intersected with a half-plane, so it is convex: a rectangle fits inside
// it exactly when all four of its corners do. Testing corners is therefore not an approximation,
// and because the symbol is inside its own bounding box, a passing check is a guarantee.
export function markerFitsInMapWindow(symbol:OrnamentMarkerSymbol,positionMm:PointMm,window:MapWindow):boolean{
 return boundsCorners(placedBounds(symbol,positionMm)).every(corner=>isInsideMapWindow(corner,window));
}

// A warning, never an automatic move. The plan: "show a warning and clamp/move only with explicit
// user action" — silently nudging the marker would put the house on the wrong street.
export function markerFitIssues(symbol:OrnamentMarkerSymbol,positionMm:PointMm,window:MapWindow):OrnamentIssue[]{
 if(!Number.isFinite(positionMm[0])||!Number.isFinite(positionMm[1]))
  return [{code:'marker-off-map',severity:'warning',message:'The marker is outside the area the map is showing. Pan or zoom until it is visible, or re-centre it.'}];
 if(!isInsideMapWindow(positionMm,window))
  return [{code:'marker-outside-window',severity:'warning',message:'The marker sits outside the ornament’s map window. Pan or zoom the map so the place is inside the circle.'}];
 if(!markerFitsInMapWindow(symbol,positionMm,window))
  return [{code:'marker-clipped',severity:'warning',message:`The ${symbol.label.toLowerCase()} marker is close enough to the edge that part of it falls outside the map window. Move the place inwards or reduce the marker size.`}];
 return [];
}
