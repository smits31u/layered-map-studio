import type {GolfHole,GolfSnapshot} from '../server/golf/types';

// Which holes the board numbers and routes, and what number each one gets.
//
// A single-layout course numbers its holes as OSM tags them. A multi-layout course (a 27-hole course
// is three nines, each numbered 1–9) plays nines in pairs, so the board takes a list of nines in play
// order and numbers straight through them: White then Red is White 1–9 as 1–9 and Red 1–9 as 10–18.
// Every fairway and green is drawn either way; only routing and numbers follow the choice
// (docs/golf-implementation-status.md, decision 5).

export interface NumberedHole{hole:GolfHole;number:number;label:string}

// The default nines: the first layout that pairs two nines, else the first two nines by name.
export function defaultNines(snapshot:GolfSnapshot):string[]{
 if(!snapshot.nines.length)return [];
 const pairing=snapshot.layouts.find(l=>l.nines.length>=2&&l.nines.every(n=>snapshot.nines.includes(n)));
 return pairing?pairing.nines.slice(0,2):snapshot.nines.slice(0,2);
}

export function resolveNines(snapshot:GolfSnapshot,chosen:string[]|null):string[]{
 if(!snapshot.nines.length)return [];
 const known=(chosen??[]).filter(n=>snapshot.nines.includes(n));
 return known.length?known:defaultNines(snapshot);
}

export function numberedHoles(snapshot:GolfSnapshot,chosen:string[]|null):NumberedHole[]{
 const byNumber=(a:GolfHole,b:GolfHole)=>(a.number??Infinity)-(b.number??Infinity)||0;
 if(!snapshot.nines.length){
  return [...snapshot.holes].sort(byNumber).map((hole,i)=>{const number=hole.number??i+1;return {hole,number,label:String(number)}});
 }
 const out:NumberedHole[]=[];
 for(const nine of resolveNines(snapshot,chosen)){
  const holes=snapshot.holes.filter(h=>h.nine===nine).sort(byNumber);
  const offset=out.length;
  holes.forEach((hole,i)=>{const number=offset+(hole.number??i+1);out.push({hole,number,label:String(number)})});
 }
 return out;
}

// Par for the holes on the board, only when every one of them has it.
export function boardPar(holes:readonly NumberedHole[]):number|undefined{
 if(!holes.length||holes.some(h=>h.hole.par===undefined))return undefined;
 return holes.reduce((sum,h)=>sum+h.hole.par!,0);
}
