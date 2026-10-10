import type {GeoMultiPolygon} from './model';
import {intersects,pointInRing,type Position,type Ring} from './geo';

// Which state a water body is in decides which DNR is asked about it — a state agency's service
// can only vouch for its own lakes (the Wisconsin hydro layer hands back WBIC 0 for a Michigan lake
// rather than nothing). Only states with an automated source are carried. The outlines are the
// Census legal boundaries (Great Lakes water included), generalised to ~50 m: see the `source` field
// in stateBoundaries.json. They are loaded on first use so they stay out of the initial bundle.
export type StateCode='WI'|'MI';
type Boundaries={source:string;states:Record<StateCode,Ring[]>};
let boundaries:Promise<Boundaries>|undefined;
const load=()=>boundaries??=import('./stateBoundaries.json').then(module=>(module.default??module) as unknown as Boundaries);

// Every supported state the water touches: a lake on the Menominee or a border lake such as
// Lac Vieux Desert can belong to both, and then both agencies are asked.
export async function statesForWater(water:GeoMultiPolygon|undefined,point:Position):Promise<StateCode[]>{
 const {states}=await load();
 return (Object.keys(states) as StateCode[]).filter(code=>water?.length?intersects(water,states[code].map(ring=>[ring])):states[code].some(ring=>pointInRing(point,ring)));
}
