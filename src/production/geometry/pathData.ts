// SVG path data -> flattened polylines, plus the two measurements production planning needs from
// them: length (cut and score) and even-odd filled area (engrave).
//
// Shared by the material/time estimate and the stacked 3D preview, and deliberately independent of
// the lake tool: it reads the same `d` strings every manufacturing SVG in this repo already carries
// (geometryPath's M/L/Z panels, opentype's M/L/Q/C/Z glyphs, the compass's and markers' A arcs), so
// the ornament and topo tools can feed their own output through it unchanged.
//
// Curves are flattened, so a length or area here is a close approximation of the true curve, not an
// exact value. The tolerance below keeps that error well under what a laser's kerf already is.

export type Point=[number,number];
export type Subpath={points:Point[];closed:boolean};

// Target chord length for flattened curves, mm. A 1mm-radius glyph bowl comes out as ~25 segments.
const FLATTEN_STEP_MM=.25;
const MAX_CURVE_SEGMENTS=64;

const isCommand=(c:string)=>/[MmLlHhVvCcSsQqTtAaZz]/.test(c);

// A scanner rather than a split: opentype writes numbers back to back ("L1.5-2.25"), and arc flags
// may legally be written with no separator at all ("a1 1 0 01 2 2").
function tokenize(d:string):(string|number)[]{
 const out:(string|number)[]=[];
 const number=/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
 let i=0,lastCommand='',argIndex=0;
 while(i<d.length){
  const c=d[i];
  if(c===' '||c===','||c==='\n'||c==='\t'||c==='\r'){i++;continue}
  if(isCommand(c)){out.push(c);lastCommand=c;argIndex=0;i++;continue}
  // Arc flags (the 4th and 5th of every 7 arguments) are single characters.
  if((lastCommand==='A'||lastCommand==='a')&&(argIndex%7===3||argIndex%7===4)&&(c==='0'||c==='1')){out.push(+c);argIndex++;i++;continue}
  number.lastIndex=i;
  const match=number.exec(d);
  if(!match)throw new Error(`Unreadable path data near "${d.slice(i,i+12)}"`);
  out.push(+match[0]);argIndex++;i=number.lastIndex;
 }
 return out;
}

const curveSegments=(approxLength:number)=>Math.max(2,Math.min(MAX_CURVE_SEGMENTS,Math.ceil(approxLength/FLATTEN_STEP_MM)));
const dist=(a:Point,b:Point)=>Math.hypot(b[0]-a[0],b[1]-a[1]);

function cubic(from:Point,c1:Point,c2:Point,to:Point,push:(p:Point)=>void){
 const n=curveSegments(dist(from,c1)+dist(c1,c2)+dist(c2,to));
 for(let k=1;k<=n;k++){
  const t=k/n,u=1-t;
  push([u*u*u*from[0]+3*u*u*t*c1[0]+3*u*t*t*c2[0]+t*t*t*to[0],u*u*u*from[1]+3*u*u*t*c1[1]+3*u*t*t*c2[1]+t*t*t*to[1]]);
 }
}

function quadratic(from:Point,c:Point,to:Point,push:(p:Point)=>void){
 const n=curveSegments(dist(from,c)+dist(c,to));
 for(let k=1;k<=n;k++){
  const t=k/n,u=1-t;
  push([u*u*from[0]+2*u*t*c[0]+t*t*to[0],u*u*from[1]+2*u*t*c[1]+t*t*to[1]]);
 }
}

// SVG arc, endpoint parameterisation -> centre parameterisation (SVG 1.1 appendix F.6.5).
function arc(from:Point,rxIn:number,ryIn:number,rotationDeg:number,largeArc:boolean,sweep:boolean,to:Point,push:(p:Point)=>void){
 let rx=Math.abs(rxIn),ry=Math.abs(ryIn);
 if(rx===0||ry===0||(from[0]===to[0]&&from[1]===to[1])){push(to);return}
 const phi=rotationDeg*Math.PI/180,cos=Math.cos(phi),sin=Math.sin(phi);
 const dx=(from[0]-to[0])/2,dy=(from[1]-to[1])/2;
 const x1=cos*dx+sin*dy,y1=-sin*dx+cos*dy;
 const lambda=(x1*x1)/(rx*rx)+(y1*y1)/(ry*ry);
 if(lambda>1){const s=Math.sqrt(lambda);rx*=s;ry*=s}
 const num=rx*rx*ry*ry-rx*rx*y1*y1-ry*ry*x1*x1,den=rx*rx*y1*y1+ry*ry*x1*x1;
 const coef=(largeArc===sweep?-1:1)*Math.sqrt(Math.max(0,num/den));
 const cx1=coef*rx*y1/ry,cy1=-coef*ry*x1/rx;
 const cx=cos*cx1-sin*cy1+(from[0]+to[0])/2,cy=sin*cx1+cos*cy1+(from[1]+to[1])/2;
 const angle=(ux:number,uy:number,vx:number,vy:number)=>Math.atan2(ux*vy-uy*vx,ux*vx+uy*vy);
 const theta1=angle(1,0,(x1-cx1)/rx,(y1-cy1)/ry);
 let delta=angle((x1-cx1)/rx,(y1-cy1)/ry,(-x1-cx1)/rx,(-y1-cy1)/ry);
 if(!sweep&&delta>0)delta-=2*Math.PI;
 else if(sweep&&delta<0)delta+=2*Math.PI;
 const n=curveSegments(Math.abs(delta)*Math.max(rx,ry));
 for(let k=1;k<=n;k++){
  const t=theta1+delta*k/n,ex=rx*Math.cos(t),ey=ry*Math.sin(t);
  push(k===n?to:[cos*ex-sin*ey+cx,sin*ex+cos*ey+cy]);
 }
}

export function parsePathData(d:string):Subpath[]{
 const tokens=tokenize(d),subpaths:Subpath[]=[];
 let i=0,command='',current:Point=[0,0],start:Point=[0,0],lastControl:Point|undefined,lastKind='';
 let sub:Subpath|undefined;
 const num=()=>{const v=tokens[i++];if(typeof v!=='number')throw new Error('Path data is missing a number.');return v};
 const push=(p:Point)=>{sub!.points.push(p)};
 const ensureSub=()=>{if(!sub){sub={points:[[...current]],closed:false};subpaths.push(sub)}};
 while(i<tokens.length){
  if(typeof tokens[i]==='string')command=tokens[i++] as string;
  else if(!command)throw new Error('Path data must start with a command.');
  const rel=command===command.toLowerCase(),C=command.toUpperCase();
  const at=(x:number,y:number):Point=>rel?[current[0]+x,current[1]+y]:[x,y];
  switch(C){
   case 'M':{
    const p=at(num(),num());
    sub={points:[p],closed:false};subpaths.push(sub);current=p;start=p;
    // Further pairs after a moveto are implicit linetos.
    command=rel?'l':'L';lastKind='M';break;
   }
   case 'L':{ensureSub();const p=at(num(),num());push(p);current=p;lastKind='L';break}
   case 'H':{ensureSub();const x=num();const p:Point=[rel?current[0]+x:x,current[1]];push(p);current=p;lastKind='L';break}
   case 'V':{ensureSub();const y=num();const p:Point=[current[0],rel?current[1]+y:y];push(p);current=p;lastKind='L';break}
   case 'C':case 'S':{
    ensureSub();
    const c1:Point=C==='C'?at(num(),num()):(lastKind==='C'&&lastControl?[2*current[0]-lastControl[0],2*current[1]-lastControl[1]]:[...current]);
    const c2=at(num(),num()),p=at(num(),num());
    cubic(current,c1,c2,p,push);lastControl=c2;current=p;lastKind='C';break;
   }
   case 'Q':case 'T':{
    ensureSub();
    const c:Point=C==='Q'?at(num(),num()):(lastKind==='Q'&&lastControl?[2*current[0]-lastControl[0],2*current[1]-lastControl[1]]:[...current]);
    const p=at(num(),num());
    quadratic(current,c,p,push);lastControl=c;current=p;lastKind='Q';break;
   }
   case 'A':{
    ensureSub();
    const rx=num(),ry=num(),rot=num(),large=num()!==0,sweep=num()!==0,p=at(num(),num());
    arc(current,rx,ry,rot,large,sweep,p,push);current=p;lastKind='A';break;
   }
   case 'Z':{
    if(sub){sub.closed=true;const first=sub.points[0],last=sub.points.at(-1)!;if(sub.points.length>1&&first[0]===last[0]&&first[1]===last[1])sub.points.pop()}
    current=[...start];sub=undefined;lastKind='Z';
    // A Z is followed by a command letter, never by numbers; clearing the command makes a stray
    // number an error instead of a silent extra point.
    command='';break;
   }
   default:throw new Error(`Unsupported path command "${command}".`);
  }
 }
 return subpaths.filter(s=>s.points.length>0);
}

export const rectPathData=(x:number,y:number,width:number,height:number)=>`M${x} ${y} L${x+width} ${y} L${x+width} ${y+height} L${x} ${y+height} Z`;

// Scale factor of an SVG transform. The scenes in this repo only ever translate and rotate, which
// preserve length and area, so this is 1 for every transform they write; it is here so a future
// scale() is accounted for rather than silently mis-measured.
export function transformScale(transform?:string):number{
 if(!transform)return 1;
 const match=/scale\(\s*([-\d.eE+]+)(?:[\s,]+([-\d.eE+]+))?\s*\)/.exec(transform);
 if(!match)return 1;
 const sx=Math.abs(+match[1]),sy=match[2]===undefined?sx:Math.abs(+match[2]);
 return Math.sqrt(sx*sy);
}

export function subpathLength(sub:Subpath):number{
 let total=0;
 for(let k=1;k<sub.points.length;k++)total+=dist(sub.points[k-1],sub.points[k]);
 if(sub.closed&&sub.points.length>1)total+=dist(sub.points.at(-1)!,sub.points[0]);
 return total;
}

export const pathLength=(subpaths:Subpath[])=>subpaths.reduce((sum,s)=>sum+subpathLength(s),0);

export function ringSignedArea(ring:Point[]):number{
 let a=0;
 for(let k=0,j=ring.length-1;k<ring.length;j=k++)a+=ring[j][0]*ring[k][1]-ring[k][0]*ring[j][1];
 return a/2;
}

export function pointInRing(p:Point,ring:Point[]):boolean{
 let inside=false;
 for(let k=0,j=ring.length-1;k<ring.length;j=k++){
  const [xk,yk]=ring[k],[xj,yj]=ring[j];
  if((yk>p[1])!==(yj>p[1])&&p[0]<(xj-xk)*(p[1]-yk)/(yj-yk)+xk)inside=!inside;
 }
 return inside;
}

type Box={minX:number;minY:number;maxX:number;maxY:number};
const boxOf=(ring:Point[]):Box=>{let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const [x,y] of ring){if(x<minX)minX=x;if(y<minY)minY=y;if(x>maxX)maxX=x;if(y>maxY)maxY=y}return{minX,minY,maxX,maxY}};
const boxContains=(outer:Box,inner:Box)=>inner.minX>=outer.minX&&inner.maxX<=outer.maxX&&inner.minY>=outer.minY&&inner.maxY<=outer.maxY;

// One filled polygon under the even-odd rule: an outer ring and the rings that are holes in it.
export type NestedPolygon={outer:Point[];holes:Point[][]};

// Groups closed rings into polygons with holes by even-odd nesting depth: a ring inside an even
// number of others is an outer boundary, one inside an odd number is a hole in its immediate parent.
// That is exactly how an even-odd SVG fill (and so a laser's cut) reads a lake panel: the board
// rectangle, the water openings in it, the islands in those, the ponds on the islands, and so on.
//
// Assumes the rings do not cross each other, which holds for every manufacturing path in this repo
// (Clipper and polygon-clipping both output simple, non-overlapping rings). Rings are visited from
// largest to smallest, so a ring's smallest container is the last one found among those already
// placed, and a bounding-box test rejects nearly every candidate before the point-in-ring walk.
export function nestRings(rings:Point[][]):NestedPolygon[]{
 const items=rings.filter(r=>r.length>=3).map(ring=>({ring,box:boxOf(ring),area:Math.abs(ringSignedArea(ring)),depth:0,parent:-1})).filter(r=>r.area>0);
 items.sort((a,b)=>b.area-a.area);
 for(let k=0;k<items.length;k++){
  const item=items[k],probe=item.ring[0];
  for(let j=k-1;j>=0;j--){
   const candidate=items[j];
   if(!boxContains(candidate.box,item.box))continue;
   if(pointInRing(probe,candidate.ring)){item.parent=j;item.depth=candidate.depth+1;break}
  }
 }
 const polygons=new Map<number,NestedPolygon>();
 items.forEach((item,index)=>{if(item.depth%2===0)polygons.set(index,{outer:item.ring,holes:[]})});
 items.forEach(item=>{if(item.depth%2===1)polygons.get(item.parent)?.holes.push(item.ring)});
 return [...polygons.values()];
}

export function nestedPolygonArea(polygon:NestedPolygon):number{
 return Math.abs(ringSignedArea(polygon.outer))-polygon.holes.reduce((sum,h)=>sum+Math.abs(ringSignedArea(h)),0);
}

// Even-odd filled area of a path. Every subpath counts as closed, the way SVG fills an open one.
export function evenOddArea(subpaths:Subpath[]):number{
 return nestRings(subpaths.map(s=>s.points)).reduce((sum,p)=>sum+nestedPolygonArea(p),0);
}
