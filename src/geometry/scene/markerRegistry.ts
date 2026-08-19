import type {MarkerType} from '../../types/project';

// Minimum-feature-size floor, same spirit as compass.ts's MIN_COMPASS_SIZE_MM: below this, a
// marker's internal details (fish fins, anchor flukes, house roofline) start collapsing into
// unmanufacturable slivers. The Controls UI sets this as the Size mm input's min.
export const MIN_MARKER_SIZE_MM=4;
export const DEFAULT_MARKER_SIZE_MM=8;

export interface MarkerDefinition{
 type:MarkerType;
 displayName:string;
 defaultSizeMm:number;
 minimumSizeMm:number;
 // Every marker is centered at local (0,0) with sizeMm as its overall bounding height (h=sizeMm/2
 // amplitude) — the same convention compass.ts uses — so drag/rotate/keep-out math is identical
 // across every marker type and never needs per-type special-casing. Returns real closed-path SVG
 // path data (possibly several M..Z subpaths in one string, the same "combine, don't split into
 // several Shapes" technique compass.ts's classic-rose uses), never <text> or a raster reference.
 buildGeometry(sizeMm:number):string;
}

const p3=(n:number)=>Number(n.toFixed(3));
const pt=(x:number,y:number)=>`${p3(x)} ${p3(y)}`;
const closedPolygon=(points:[number,number][])=>'M'+points.map(([x,y],i)=>`${i?'L':''}${pt(x,y)}`).join(' ')+' Z';
const circlePath=(cx:number,cy:number,r:number)=>`M${p3(cx-r)} ${p3(cy)} A${p3(r)} ${p3(r)} 0 1 0 ${p3(cx+r)} ${p3(cy)} A${p3(r)} ${p3(r)} 0 1 0 ${p3(cx-r)} ${p3(cy)} Z`;

// Classic 5-point star via the same alternating outer/inner-radius kite technique compass.ts's
// star uses, generalized to n points instead of 8.
function starPolygon(points:number,outerR:number,innerR:number,rotationDeg=-90){
 const verts:[number,number][]=[];
 for(let i=0;i<points*2;i++){
  const angle=(rotationDeg+i*(180/points))*Math.PI/180,r=i%2===0?outerR:innerR;
  verts.push([r*Math.cos(angle),r*Math.sin(angle)]);
 }
 return closedPolygon(verts);
}

function pin(h:number):string{
 // Round head + triangular tip, as two overlapping closed subpaths (same technique as compass's
 // ring+star) rather than one hand-fitted outline — simpler and just as manufacturable, since both
 // pieces are independently simple/non-self-intersecting.
 const r=h*.42,cy=-h*.12;
 const head=circlePath(0,cy,r);
 const tip=closedPolygon([[0,h],[-h*.22,h*.18],[h*.22,h*.18]]);
 return`${head} ${tip}`;
}

function star(h:number):string{return starPolygon(5,h,h*.4)}

function heart(h:number):string{
 // Two lobes via cubic beziers meeting at a bottom point — the standard parametric heart
 // construction, scaled to fit the shared h=size/2 bounding convention.
 const s=h*.9;
 return`M0 ${p3(s*.28)} C${p3(-s*.55)} ${p3(-s*.35)} ${p3(-s*1.05)} ${p3(s*.15)} 0 ${p3(s)} C${p3(s*1.05)} ${p3(s*.15)} ${p3(s*.55)} ${p3(-s*.35)} 0 ${p3(s*.28)} Z`;
}

function house(h:number):string{
 return closedPolygon([[-h*.7,h*.85],[h*.7,h*.85],[h*.7,-h*.05],[0,-h*.9],[-h*.7,-h*.05]]);
}

function cabin(h:number):string{
 const body=closedPolygon([[-h*.7,h*.85],[h*.7,h*.85],[h*.7,-h*.05],[0,-h*.9],[-h*.7,-h*.05]]);
 const chimney=closedPolygon([[h*.32,-h*.55],[h*.5,-h*.55],[h*.5,-h*.05],[h*.32,-h*.05]]);
 return`${body} ${chimney}`;
}

function campfire(h:number):string{
 const logs=closedPolygon([[-h*.7,h*.7],[h*.7,h*.7],[h*.15,h*.35],[-h*.15,h*.35]]);
 const flame=`M0 ${p3(-h*.9)} C${p3(h*.5)} ${p3(-h*.3)} ${p3(h*.35)} ${p3(h*.15)} 0 ${p3(h*.35)} C${p3(-h*.35)} ${p3(h*.15)} ${p3(-h*.5)} ${p3(-h*.3)} 0 ${p3(-h*.9)} Z`;
 return`${logs} ${flame}`;
}

function fish(h:number):string{
 const body=`M${p3(-h*.9)} 0 C${p3(-h*.5)} ${p3(-h*.55)} ${p3(h*.35)} ${p3(-h*.5)} ${p3(h*.55)} 0 C${p3(h*.35)} ${p3(h*.5)} ${p3(-h*.5)} ${p3(h*.55)} ${p3(-h*.9)} 0 Z`;
 const tail=closedPolygon([[h*.5,0],[h*.95,-h*.4],[h*.95,h*.4]]);
 const eye=circlePath(-h*.55,-h*.08,h*.06);
 return`${body} ${tail} ${eye}`;
}

function boat(h:number):string{
 const hull=closedPolygon([[-h*.8,h*.15],[h*.8,h*.15],[h*.55,h*.6],[-h*.55,h*.6]]);
 const mast=`M0 ${p3(h*.15)} L0 ${p3(-h*.85)}`;
 const sail=closedPolygon([[0,-h*.8],[h*.55,h*.1],[0,h*.1]]);
 return`${hull} ${mast} ${sail}`;
}

function anchor(h:number):string{
 const ring=circlePath(0,-h*.72,h*.15);
 const shaft=`M0 ${p3(-h*.57)} L0 ${p3(h*.55)}`;
 const crossbar=`M${p3(-h*.32)} ${p3(-h*.22)} L${p3(h*.32)} ${p3(-h*.22)}`;
 const leftFluke=`M0 ${p3(h*.55)} A${p3(h*.4)} ${p3(h*.4)} 0 0 1 ${p3(-h*.55)} ${p3(h*.35)}`;
 const rightFluke=`M0 ${p3(h*.55)} A${p3(h*.4)} ${p3(h*.4)} 0 0 0 ${p3(h*.55)} ${p3(h*.35)}`;
 return`${ring} ${shaft} ${crossbar} ${leftFluke} ${rightFluke}`;
}

function crosshair(h:number):string{
 const ring=circlePath(0,0,h*.6);
 const v=`M0 ${p3(-h)} L0 ${p3(-h*.35)} M0 ${p3(h*.35)} L0 ${p3(h)}`;
 const horiz=`M${p3(-h)} 0 L${p3(-h*.35)} 0 M${p3(h*.35)} 0 L${p3(h)} 0`;
 return`${ring} ${v} ${horiz}`;
}

function circle(h:number):string{return circlePath(0,0,h*.75)}

function diamond(h:number):string{return closedPolygon([[0,-h],[h*.68,0],[0,h],[-h*.68,0]])}

function flag(h:number):string{
 const pole=`M${p3(-h*.55)} ${p3(h)} L${p3(-h*.55)} ${p3(-h)}`;
 const banner=closedPolygon([[-h*.55,-h],[h*.7,-h*.55],[-h*.55,-h*.1]]);
 return`${pole} ${banner}`;
}

export const MARKER_REGISTRY:MarkerDefinition[]=[
 {type:'pin',displayName:'Map Pin',defaultSizeMm:DEFAULT_MARKER_SIZE_MM,minimumSizeMm:MIN_MARKER_SIZE_MM,buildGeometry:sizeMm=>pin(sizeMm/2)},
 {type:'star',displayName:'Star',defaultSizeMm:DEFAULT_MARKER_SIZE_MM,minimumSizeMm:MIN_MARKER_SIZE_MM,buildGeometry:sizeMm=>star(sizeMm/2)},
 {type:'heart',displayName:'Heart',defaultSizeMm:DEFAULT_MARKER_SIZE_MM,minimumSizeMm:MIN_MARKER_SIZE_MM,buildGeometry:sizeMm=>heart(sizeMm/2)},
 {type:'house',displayName:'House',defaultSizeMm:DEFAULT_MARKER_SIZE_MM,minimumSizeMm:MIN_MARKER_SIZE_MM,buildGeometry:sizeMm=>house(sizeMm/2)},
 {type:'cabin',displayName:'Cabin',defaultSizeMm:DEFAULT_MARKER_SIZE_MM,minimumSizeMm:MIN_MARKER_SIZE_MM,buildGeometry:sizeMm=>cabin(sizeMm/2)},
 {type:'campfire',displayName:'Campfire',defaultSizeMm:DEFAULT_MARKER_SIZE_MM,minimumSizeMm:MIN_MARKER_SIZE_MM,buildGeometry:sizeMm=>campfire(sizeMm/2)},
 {type:'fish',displayName:'Fish',defaultSizeMm:DEFAULT_MARKER_SIZE_MM,minimumSizeMm:MIN_MARKER_SIZE_MM,buildGeometry:sizeMm=>fish(sizeMm/2)},
 {type:'boat',displayName:'Boat',defaultSizeMm:DEFAULT_MARKER_SIZE_MM,minimumSizeMm:MIN_MARKER_SIZE_MM,buildGeometry:sizeMm=>boat(sizeMm/2)},
 {type:'anchor',displayName:'Anchor',defaultSizeMm:DEFAULT_MARKER_SIZE_MM,minimumSizeMm:MIN_MARKER_SIZE_MM,buildGeometry:sizeMm=>anchor(sizeMm/2)},
 {type:'crosshair',displayName:'Crosshair',defaultSizeMm:DEFAULT_MARKER_SIZE_MM,minimumSizeMm:MIN_MARKER_SIZE_MM,buildGeometry:sizeMm=>crosshair(sizeMm/2)},
 {type:'circle',displayName:'Circle',defaultSizeMm:DEFAULT_MARKER_SIZE_MM,minimumSizeMm:MIN_MARKER_SIZE_MM,buildGeometry:sizeMm=>circle(sizeMm/2)},
 {type:'diamond',displayName:'Diamond',defaultSizeMm:DEFAULT_MARKER_SIZE_MM,minimumSizeMm:MIN_MARKER_SIZE_MM,buildGeometry:sizeMm=>diamond(sizeMm/2)},
 {type:'flag',displayName:'Flag',defaultSizeMm:DEFAULT_MARKER_SIZE_MM,minimumSizeMm:MIN_MARKER_SIZE_MM,buildGeometry:sizeMm=>flag(sizeMm/2)},
];

const registryByType=new Map(MARKER_REGISTRY.map(d=>[d.type,d]));

// Defensive fallback (never crash/lose a marker over an unrecognized type — e.g. project JSON from
// a future version listing a marker type this build doesn't know yet): falls back to the first
// registered definition rather than throwing, matching this codebase's established "never silently
// lose scene objects" philosophy — the marker still renders as *something* real and editable.
export function markerDefinition(type:MarkerType):MarkerDefinition{
 return registryByType.get(type)??MARKER_REGISTRY[0];
}

export function markerPathData(type:MarkerType,sizeMm:number):string{
 return markerDefinition(type).buildGeometry(sizeMm);
}

// Outer radius of the rendered marker, in mm — used for keep-out footprint and the editor-only hit
// area, not a per-type exact bound (all marker geometry above fits within roughly sizeMm/2 of
// local origin by construction, matching the shared h=sizeMm/2 convention every buildGeometry
// function above uses).
export function markerFootprintRadiusMm(sizeMm:number):number{
 return sizeMm/2;
}
