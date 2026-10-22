import {COVERAGE_ROLES,GOLF_QUERY_VERSION,GOLF_SNAPSHOT_SCHEMA,OSM_ATTRIBUTION,type CoverageRole,type GeoMultiPolygonLL,type GolfArea,type GolfAreaRole,type GolfHole,type GolfLayout,type GolfLine,type GolfOsmType,type GolfPoint,type GolfSnapshot,type LonLat} from './types';

// Overpass JSON → GolfSnapshot. Pure and deterministic: the same elements in any order give the same
// snapshot, byte for byte, so the recorded fixture can pin it (tests/unit/golfSnapshot.test.ts).
//
// What it does, in order:
//   - builds the course boundary from the boundary element (a closed way, or a multipolygon relation
//     whose member ways are joined into rings);
//   - classifies every other element by its tags into areas, lines, points, holes and layouts, once
//     each (a pond tagged both natural=water and golf=water_hazard is one water area, not two);
//   - drops what lies wholly outside the boundary (the feature query is a bounding box, so it also
//     returns the neighbour's pond), counting it under `skipped`;
//   - rounds every coordinate to 7 decimals (about 1 cm), and sorts everything by OSM id.

export interface OverpassGeometryPoint{lat:number;lon:number}
export interface OverpassMember{type:string;ref:number;role?:string;geometry?:(OverpassGeometryPoint|null)[]}
export interface OverpassElement{
 type:'node'|'way'|'relation'|string;
 id:number;
 lat?:number;
 lon?:number;
 tags?:Record<string,string>;
 geometry?:(OverpassGeometryPoint|null)[];
 members?:OverpassMember[];
}

export class GolfSnapshotError extends Error{
 constructor(message:string,readonly code:'not-found'|'not-a-golf-course'|'no-boundary'){super(message);this.name='GolfSnapshotError'}
}

const round=(v:number)=>Math.round(v*1e7)/1e7;
const point=(p:OverpassGeometryPoint):LonLat=>[round(p.lon),round(p.lat)];
const samePoint=(a:LonLat,b:LonLat)=>a[0]===b[0]&&a[1]===b[1];
const idOf=(e:{type:string;id:number})=>`${e.type[0]}${e.id}`;
const byId=<T extends {id:string}>(a:T,b:T)=>a.id[0]===b.id[0]?Number(a.id.slice(1))-Number(b.id.slice(1)):a.id<b.id?-1:1;

function wayPoints(geometry:OverpassElement['geometry']):LonLat[]{
 const out:LonLat[]=[];
 for(const p of geometry??[]){
  if(!p||!Number.isFinite(p.lat)||!Number.isFinite(p.lon))continue;
  const q=point(p);
  if(!out.length||!samePoint(out[out.length-1],q))out.push(q);
 }
 return out;
}

const isClosed=(ring:LonLat[])=>ring.length>=4&&samePoint(ring[0],ring[ring.length-1]);

// Joins way segments end to end into closed rings (an OSM multipolygon's outer is often several
// ways). A segment that can never close its ring is reported, not guessed at.
export function assembleRings(segments:LonLat[][]):{rings:LonLat[][];unclosed:number}{
 const pool=segments.filter(s=>s.length>=2).map(s=>s.slice());
 const rings:LonLat[][]=[];
 let unclosed=0;
 while(pool.length){
  let ring=pool.shift()!;
  while(!isClosed(ring)){
   const end=ring[ring.length-1];
   const index=pool.findIndex(s=>samePoint(s[0],end)||samePoint(s[s.length-1],end));
   if(index<0)break;
   const next=pool.splice(index,1)[0];
   ring=ring.concat((samePoint(next[0],end)?next:next.slice().reverse()).slice(1));
  }
  if(isClosed(ring))rings.push(ring);else unclosed++;
 }
 return {rings,unclosed};
}

export function pointInRing([x,y]:LonLat,ring:LonLat[]):boolean{
 let inside=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const [xi,yi]=ring[i],[xj,yj]=ring[j];
  if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside;
 }
 return inside;
}

export const pointInMultiPolygon=(p:LonLat,geometry:GeoMultiPolygonLL)=>geometry.some(polygon=>pointInRing(p,polygon[0])&&!polygon.slice(1).some(hole=>pointInRing(p,hole)));

// Outer rings each take the inner rings that fall inside them. An inner with no outer is dropped.
function nest(outers:LonLat[][],inners:LonLat[][]):GeoMultiPolygonLL{
 const polygons:GeoMultiPolygonLL=outers.map(outer=>[outer]);
 for(const inner of inners){
  const host=polygons.find(polygon=>pointInRing(inner[0],polygon[0]));
  if(host)host.push(inner);
 }
 return polygons;
}

// A closed way is a one-ring polygon; a multipolygon relation is its members' rings. Anything else
// is not an area.
export function areaGeometry(element:OverpassElement):{geometry?:GeoMultiPolygonLL;reason?:string}{
 if(element.type==='way'){
  const ring=wayPoints(element.geometry);
  return isClosed(ring)?{geometry:[[ring]]}:{reason:'unclosed-way'};
 }
 if(element.type==='relation'){
  const members=(element.members??[]).filter(m=>m.type==='way');
  const outer=assembleRings(members.filter(m=>m.role!=='inner').map(m=>wayPoints(m.geometry)));
  const inner=assembleRings(members.filter(m=>m.role==='inner').map(m=>wayPoints(m.geometry)));
  if(!outer.rings.length)return {reason:'relation-without-closed-outer'};
  return {geometry:nest(outer.rings,inner.rings)};
 }
 return {reason:'not-an-area'};
}

const GOLF_AREAS:Partial<Record<string,GolfAreaRole>>={fairway:'fairway',green:'green',tee:'tee',bunker:'bunker',rough:'rough',driving_range:'driving_range',water_hazard:'water',lateral_water_hazard:'water'};
const STREAMS=new Set(['stream','river','ditch','drain','canal','brook']);

type Classified=
 |{kind:'area';role:GolfAreaRole}
 |{kind:'line';role:GolfLine['role']}
 |{kind:'point';role:GolfPoint['role']}
 |{kind:'hole'}
 |{kind:'layout'}
 |{kind:'ignore';reason:string};

function classify(e:OverpassElement):Classified{
 const t=e.tags??{};
 if(t.golf==='hole')return e.type==='way'?{kind:'hole'}:{kind:'ignore',reason:'hole-not-a-way'};
 if(t.golf==='course'&&e.type==='relation')return {kind:'layout'};
 const golfArea=t.golf?GOLF_AREAS[t.golf]:undefined;
 if(golfArea)return e.type==='node'?{kind:'ignore',reason:`${t.golf}-node`}:{kind:'area',role:golfArea};
 if(t.golf==='pin')return e.type==='node'?{kind:'point',role:'pin'}:{kind:'ignore',reason:'pin-not-a-node'};
 if(t.golf==='cartpath'||(t.highway&&t.golf_cart))return e.type==='way'?{kind:'line',role:'cartpath'}:{kind:'ignore',reason:'cartpath-not-a-way'};
 if(t.natural==='water'||t.water==='pond'||t.water==='lake'||t.waterway==='riverbank')return e.type==='node'?{kind:'ignore',reason:'water-node'}:{kind:'area',role:'water'};
 if(t.waterway&&STREAMS.has(t.waterway))return e.type==='way'?{kind:'line',role:'stream'}:{kind:'ignore',reason:'waterway-not-a-way'};
 if(t.natural==='wood'||t.landuse==='forest')return e.type==='node'?{kind:'ignore',reason:'wood-node'}:{kind:'area',role:'wood'};
 if(t.natural==='tree')return e.type==='node'?{kind:'point',role:'tree'}:{kind:'ignore',reason:'tree-not-a-node'};
 if(t.leisure==='golf_course')return {kind:'ignore',reason:'other-course-boundary'};
 return {kind:'ignore',reason:'untagged-for-golf'};
}

const int=(v:string|undefined)=>{if(v===undefined)return undefined;const n=Number(v.trim());return Number.isInteger(n)?n:undefined};
const decimal=(v:string|undefined)=>{if(v===undefined)return undefined;const n=Number.parseFloat(v.replace(/,/g,''));return Number.isFinite(n)&&n>0?n:undefined};

function holeOf(e:OverpassElement):GolfHole|undefined{
 const line=wayPoints(e.geometry);
 if(line.length<2)return undefined;
 const t=e.tags??{};
 const distances:Record<string,number>={};
 const plain=decimal(t.dist)??decimal(t.distance);
 if(plain!==undefined)distances['']=plain;
 for(const [key,value] of Object.entries(t)){
  const match=/^dist:([a-z0-9_-]+)$/i.exec(key);
  const n=decimal(value);
  if(match&&n!==undefined)distances[match[1].toLowerCase()]=n;
 }
 const ref=(t.ref??'').trim();
 const nine=(t['golf:course:name']??t['course:name'])?.trim();
 return {
  id:idOf(e),ref,
  ...(int(ref)!==undefined?{number:int(ref)}:{}),
  ...(int(t.par)!==undefined?{par:int(t.par)}:{}),
  ...(int(t.handicap)!==undefined?{handicap:int(t.handicap)}:{}),
  distances:Object.fromEntries(Object.entries(distances).sort(([a],[b])=>a<b?-1:a>b?1:0)),
  ...(nine?{nine}:{}),
  line,tee:line[0],green:line[line.length-1],
 };
}

const anyInside=(points:LonLat[],boundary:GeoMultiPolygonLL)=>points.some(p=>pointInMultiPolygon(p,boundary));

export interface NormalizeInput{boundary:OverpassElement;features:readonly OverpassElement[];fetchedAt:string;osmBase?:string}

export function normalizeSnapshot({boundary:element,features,fetchedAt,osmBase}:NormalizeInput):GolfSnapshot{
 if(element.tags?.leisure!=='golf_course')throw new GolfSnapshotError(`OSM ${element.type} ${element.id} is not tagged leisure=golf_course.`,'not-a-golf-course');
 const area=areaGeometry(element);
 if(!area.geometry)throw new GolfSnapshotError(`OSM ${element.type} ${element.id} has no closed outline to map (${area.reason}).`,'no-boundary');
 const boundary=area.geometry;
 const all=boundary.flatMap(polygon=>polygon[0]);
 const bbox:[number,number,number,number]=[Math.min(...all.map(p=>p[0])),Math.min(...all.map(p=>p[1])),Math.max(...all.map(p=>p[0])),Math.max(...all.map(p=>p[1]))];

 const skipped:Record<string,number>={};
 const skip=(reason:string)=>{skipped[reason]=(skipped[reason]??0)+1};
 const areas:GolfArea[]=[],lines:GolfLine[]=[],points:GolfPoint[]=[],holes:GolfHole[]=[];
 const layoutElements:OverpassElement[]=[];
 const seen=new Set<string>();
 const sorted=[...features].sort((a,b)=>a.type===b.type?a.id-b.id:a.type<b.type?-1:1);
 for(const e of sorted){
  const id=idOf(e);
  if(seen.has(id)||id===idOf(element))continue;
  seen.add(id);
  const c=classify(e);
  if(c.kind==='ignore'){skip(c.reason);continue}
  if(c.kind==='layout'){layoutElements.push(e);continue}
  if(c.kind==='hole'){
   const hole=holeOf(e);
   if(!hole){skip('hole-too-short');continue}
   if(!anyInside(hole.line,boundary)){skip('outside-boundary');continue}
   holes.push(hole);continue;
  }
  if(c.kind==='point'){
   if(e.lat===undefined||e.lon===undefined){skip('point-without-coordinates');continue}
   const coordinate=point({lat:e.lat,lon:e.lon});
   if(!pointInMultiPolygon(coordinate,boundary)){skip('outside-boundary');continue}
   points.push({id,role:c.role,coordinate});continue;
  }
  if(c.kind==='line'){
   const coordinates=wayPoints(e.geometry);
   if(coordinates.length<2){skip('line-too-short');continue}
   if(!anyInside(coordinates,boundary)){skip('outside-boundary');continue}
   lines.push({id,role:c.role,coordinates});continue;
  }
  const geometry=areaGeometry(e);
  if(!geometry.geometry){skip(geometry.reason!);continue}
  if(!anyInside(geometry.geometry.flatMap(p=>p[0]),boundary)&&!geometry.geometry.some(p=>all.some(q=>pointInRing(q,p[0])))){skip('outside-boundary');continue}
  const t=e.tags??{};
  const hazard=t.golf==='water_hazard'||t.golf==='lateral_water_hazard'?t.golf:undefined;
  const ref=t.ref?.trim();
  areas.push({id,role:c.role,geometry:geometry.geometry,...(hazard?{hazard}:{}),...(ref?{ref}:{})});
 }

 const nines=[...new Set(holes.map(h=>h.nine).filter((n):n is string=>Boolean(n)))].sort();
 // Plain code-unit order, not localeCompare: the snapshot must not depend on the server's locale.
 const text=(a:string,b:string)=>a<b?-1:a>b?1:0;
 holes.sort((a,b)=>text(a.nine??'',b.nine??'')||((a.number??Infinity)-(b.number??Infinity)||0)||byId(a,b));
 const holeIds=new Set(holes.map(h=>h.id));
 const holeById=new Map(holes.map(h=>[h.id,h]));
 const layouts:GolfLayout[]=layoutElements.map(e=>{
  const members=(e.members??[]).filter(m=>m.type==='way').map(m=>`w${m.ref}`).filter(id=>holeIds.has(id));
  const order:string[]=[];
  for(const id of members){const nine=holeById.get(id)?.nine;if(nine&&!order.includes(nine))order.push(nine)}
  return {id:idOf(e),name:(e.tags?.name??'').trim()||`Layout ${e.id}`,nines:order,holeIds:members};
 }).filter(l=>l.holeIds.length>0).sort(byId);

 const count=(role:GolfAreaRole)=>areas.filter(a=>a.role===role).length;
 const coverage:Record<CoverageRole,number>={
  holes:holes.length,fairways:count('fairway'),greens:count('green'),tees:count('tee'),bunkers:count('bunker'),rough:count('rough'),
  water:count('water'),trees:points.filter(p=>p.role==='tree').length+count('wood'),cartpaths:lines.filter(l=>l.role==='cartpath').length,
 };
 for(const role of COVERAGE_ROLES)coverage[role]??=0;
 const pars=holes.map(h=>h.par);
 const t=element.tags??{};
 return {
  schema:GOLF_SNAPSHOT_SCHEMA,
  queryVersion:GOLF_QUERY_VERSION,
  fetchedAt,
  ...(osmBase?{osmBase}:{}),
  course:{
   osmType:element.type as GolfOsmType,osmId:element.id,
   ...(t.name?{name:t.name.trim()}:{}),
   ...(t['addr:city']?{city:t['addr:city'].trim()}:{}),
   ...(t['addr:state']?{state:t['addr:state'].trim()}:{}),
   ...(t.website?{website:t.website.trim()}:{}),
  },
  boundary,bbox,
  areas:areas.sort(byId),lines:lines.sort(byId),points:points.sort(byId),
  holes,nines,layouts,
  totals:{holes:holes.length,...(holes.length&&pars.every(p=>p!==undefined)?{par:pars.reduce((a,b)=>a!+b!,0)}:{})},
  coverage,
  skipped:Object.fromEntries(Object.entries(skipped).sort(([a],[b])=>a<b?-1:1)),
  attribution:OSM_ATTRIBUTION,
 };
}
