import type {LngLatTuple} from '../geometry/mapProjection';

// Feature deduplication.
//
// This exists because of a named risk in the plan: "`queryRenderedFeatures` may duplicate geometry
// across tiles or layers. Deduplicate before buffering or union." Both halves of that happen, for
// different reasons, and they need different handling:
//
//   * Across *layers* — one road can match two style layers (or the same layer twice at a tile
//     seam). MapLibre returns the same tile-decoded geometry once per match, so the duplicates are
//     bit-identical.
//   * Across *tiles* — tiles carry a buffer of their neighbours' geometry so lines join cleanly at
//     seams. A feature inside that buffer is decoded by both tiles. The two decodings come from
//     different tile-local integer grids, so they agree to within a fraction of a pixel rather than
//     exactly.
//
// A key built by stringifying raw coordinates catches the first and misses the second, which is why
// coordinates are quantised first. 1e-7° is about 11mm on the ground and about 0.07 rendered pixels
// at the maximum supported zoom — far finer than any difference the ornament can engrave, and far
// coarser than the disagreement between two tile decodings of the same vertex.
//
// Quantisation has a bucket-boundary case: two points a nanometre apart can still land either side
// of a bucket edge and survive as two features. That is deliberately not chased with a
// tolerance-graph, because the cost of missing a duplicate is bounded — the union absorbs it and the
// geometry is unchanged — while the cost of a slow O(n²) merge on a dense city capture is not.
// What a missed duplicate does change is the reported count, which is why the counts are reported.

const QUANTUM=1e7;

// `+0` normalises -0 to 0, so a longitude that arrives as -0 from one tile and 0 from another does
// not read as two different places.
const quantise=(value:number):number=>Number.isFinite(value)?Math.round(value*QUANTUM)+0:Number.NaN;

const pointKey=(point:LngLatTuple)=>`${quantise(point[0])},${quantise(point[1])}`;

// A polyline and its reverse are the same road. Tile decoders are consistent about winding within
// one source, but a feature that arrives from two sources (or a provider that normalises direction)
// would otherwise duplicate, and taking the lexicographically smaller of the two orientations costs
// one extra pass over a string.
export function lineKey(line:LngLatTuple[]):string{
 if(!line.length)return '';
 const forward=line.map(pointKey).join(' ');
 const backward=[...line].reverse().map(pointKey).join(' ');
 return forward<=backward?forward:backward;
}

// Rings are cyclic, so two decodings of the same ring can start at different vertices. Rotating each
// ring to begin at its lexicographically smallest vertex — and then choosing the smaller of the two
// directions — gives one canonical spelling per ring regardless of where the decoder started.
export function ringKey(ring:LngLatTuple[]):string{
 const points=ring.length>1&&pointKey(ring[0])===pointKey(ring[ring.length-1])?ring.slice(0,-1):ring;
 if(!points.length)return '';
 const keys=points.map(pointKey);
 let start=0;
 for(let i=1;i<keys.length;i++)if(keys[i]<keys[start])start=i;
 const forward=[...keys.slice(start),...keys.slice(0,start)];
 const reversedKeys=[...keys].reverse();
 let reverseStart=0;
 for(let i=1;i<reversedKeys.length;i++)if(reversedKeys[i]<reversedKeys[reverseStart])reverseStart=i;
 const backward=[...reversedKeys.slice(reverseStart),...reversedKeys.slice(0,reverseStart)];
 const a=forward.join(' '),b=backward.join(' ');
 return a<=b?a:b;
}

// Holes are part of the identity: two polygons with the same outline but different islands are two
// different pieces of water, and collapsing them would silently fill in a lake.
export const polygonKey=(rings:LngLatTuple[][]):string=>rings.map(ringKey).join('|');

export interface DedupeResult<T>{items:T[];duplicates:number}

// Insertion order is preserved, which is what makes the pipeline deterministic: the same capture
// replayed twice unions its features in the same order and produces byte-identical output.
export function dedupeBy<T>(items:T[],key:(item:T)=>string):DedupeResult<T>{
 const seen=new Set<string>(),kept:T[]=[];
 let duplicates=0;
 for(const item of items){
  const id=key(item);
  if(seen.has(id)){duplicates++;continue}
  seen.add(id);
  kept.push(item);
 }
 return {items:kept,duplicates};
}
