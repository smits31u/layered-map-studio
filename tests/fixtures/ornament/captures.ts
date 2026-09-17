import type {CaptureMapFeature} from '../../../src/ornament/capture/mapCapture';
import {WATER_LAYER_ID,roadLayerId} from '../../../src/ornament/map/style';
import type {RoadDetail} from '../../../src/ornament/types';

// The four golden fixtures the plan names by hand:
//
//   * "Dense rectilinear city roads."
//   * "Curving suburban/rural roads."
//   * "Lake shoreline with islands."
//   * "Ocean coastline crossing the ornament."
//
// They are generated rather than recorded, for three reasons. A recorded capture of a real place is
// a snapshot of somebody else's tile server on a particular afternoon, and it changes under us. A
// generated one can be made to contain the specific hazards each case is meant to exercise — an
// island exactly at the minimum cuttable size, a coastline that crosses the disk boundary twice, a
// road that leaves and re-enters the map window — instead of whatever happened to be at those
// coordinates. And it is readable: a reviewer can see what the fixture asserts without opening a
// 4MB JSON file.
//
// Everything below is deterministic. No `Math.random`, no clock, no network: the same call produces
// the same coordinates on every machine, which is what the determinism assertions depend on.

export const FIXTURE_CENTER:[number,number]=[-88.0043,45.2323];
export const FIXTURE_ZOOM=14;
export const FIXTURE_CANVAS_PX=400;

const EARTH_RADIUS_M=6378137;

// Local-tangent-plane offsets. Accurate to well under a metre over the ~2km a fixture spans, which
// is far finer than anything the ornament can engrave, and it keeps a fixture readable in metres
// instead of in six decimal places of longitude.
export function offsetLngLat(east:number,north:number,center:[number,number]=FIXTURE_CENTER):[number,number]{
 const latRad=center[1]*Math.PI/180;
 return [
  center[0]+(east/(EARTH_RADIUS_M*Math.cos(latRad)))*180/Math.PI,
  center[1]+(north/EARTH_RADIUS_M)*180/Math.PI,
 ];
}

const road=(roadClass:string,tier:RoadDetail,points:[number,number][]):CaptureMapFeature=>({
 geometry:{type:'LineString',coordinates:points.map(([east,north])=>offsetLngLat(east,north))},
 properties:{class:roadClass},
 sourceLayer:'transportation',
 layer:{id:roadLayerId(tier)},
});

const water=(rings:[number,number][][]):CaptureMapFeature=>({
 geometry:{type:'Polygon',coordinates:rings.map(ring=>ring.map(([east,north])=>offsetLngLat(east,north)))},
 properties:{class:'lake'},
 sourceLayer:'water',
 layer:{id:WATER_LAYER_ID},
});

// A closed ring of `count` points around (cx, cy), with the radius modulated by two harmonics so the
// shoreline is irregular rather than a circle. Deterministic by construction — the "randomness" is
// two sine terms, not a generator with a seed to get wrong.
function blob(cx:number,cy:number,radius:number,count:number,wobble=.18,phase=0):[number,number][]{
 const ring:[number,number][]=[];
 for(let i=0;i<count;i++){
  const t=2*Math.PI*i/count;
  const r=radius*(1+wobble*Math.sin(3*t+phase)+wobble*.5*Math.cos(5*t-phase));
  ring.push([cx+r*Math.cos(t),cy+r*Math.sin(t)]);
 }
 ring.push([ring[0][0],ring[0][1]]);
 return ring;
}

// --- 1. Dense rectilinear city -------------------------------------------------------------------
//
// A 120m grid over ±900m: 15 avenues each way. Every fifth is a primary, every other one a
// secondary, the rest minor, with service alleys offset half a block. Roads run the full width of
// the fixture, so every one of them crosses the ornament boundary and exercises circle clipping at
// both ends, and the ones below the chord exercise the text-band clip.
export function cityCapture():CaptureMapFeature[]{
 const features:CaptureMapFeature[]=[];
 const span=900,step=120;
 const classFor=(index:number)=>index%5===0?['primary','low'] as const:index%2===0?['secondary','low'] as const:['minor','medium'] as const;
 for(let i=-7;i<=7;i++){
  const at=i*step;
  const [cls,tier]=classFor(i+7);
  features.push(road(cls,tier,[[-span,at],[span,at]]));
  features.push(road(cls,tier,[[at,-span],[at,span]]));
  features.push(road('service','high',[[-span,at+step/2],[span,at+step/2]]));
 }
 return features;
}

// --- 2. Curving rural ----------------------------------------------------------------------------
//
// Five sinuous roads, sampled every 25m so the curve is a polyline dense enough that simplification
// has something to remove, plus two dead-end tracks that terminate inside the disk — the case that
// proves a road end gets a round cap rather than being clipped flat by the boundary.
export function ruralCapture():CaptureMapFeature[]{
 const sample=(fn:(t:number)=>[number,number],from:number,to:number,step=25):[number,number][]=>{
  const points:[number,number][]=[];
  for(let t=from;t<=to;t+=step)points.push(fn(t));
  return points;
 };
 return [
  road('primary','low',sample(t=>[t,260*Math.sin(t/430)],-1000,1000)),
  road('secondary','low',sample(t=>[t,-420+180*Math.cos(t/300)],-1000,1000)),
  road('minor','medium',sample(t=>[340*Math.cos(t/260),t],-900,900)),
  road('minor','medium',sample(t=>[-560+120*Math.sin(t/180),t],-900,900)),
  road('track','high',sample(t=>[t*.8,520-t*.35],-400,400)),
  // Dead ends: both endpoints well inside the ornament.
  road('track','high',[[0,0],[210,-140]]),
  road('path','high',[[-150,120],[-40,300],[120,340]]),
 ];
}

// --- 3. Lake shoreline with islands --------------------------------------------------------------
//
// One lake with four islands, deliberately spanning the size range the policies sort on: two large,
// one at roughly the default 4mm² omit threshold, and one far below the minimum cuttable size so the
// "filled a hole" warning has something to report. The lake sits entirely inside the disk so nothing
// about this fixture depends on boundary clipping — that is the coast fixture's job.
export function lakeCapture():CaptureMapFeature[]{
 return [
  water([
   blob(-40,-60,560,96,.22),
   blob(-180,-140,150,40,.15,1.1),
   blob(150,-30,110,32,.12,2.2),
   blob(40,180,34,24,.1,.5),
   // ~6m across on the ground; at the fixture's scale that is far under a tenth of a millimetre.
   blob(-300,90,3,12,.05,0),
  ]),
  road('primary','low',[[-1000,-700],[1000,-680]]),
  road('minor','medium',[[-620,-900],[-600,900]]),
  road('service','high',[[-900,420],[-500,430],[-460,700]]),
 ];
}

// --- 4. Ocean coastline crossing the ornament -----------------------------------------------------
//
// The sea occupies everything south-east of a wandering coastline, as a polygon far larger than the
// viewport — which is what a real ocean feature looks like coming out of a tile, and what makes the
// intersect-with-the-disk step matter. Two offshore islands and one inland pond are separate
// polygons, so this fixture also covers a MultiPolygon-shaped capture arriving as several features.
export function coastCapture():CaptureMapFeature[]{
 const coastline:[number,number][]=[];
 for(let x=-3000;x<=3000;x+=50)coastline.push([x,-150+240*Math.sin(x/700)+90*Math.cos(x/230)]);
 const sea:[number,number][]=[...coastline,[3000,-4000],[-3000,-4000],[coastline[0][0],coastline[0][1]]];
 return [
  water([sea]),
  water([blob(430,-520,130,40,.2,.7)]),
  water([blob(-520,-430,70,28,.18,1.9)]),
  water([blob(-260,420,180,48,.16,2.6),blob(-260,420,55,20,.1,.3)]),
  road('trunk','low',[[-1000,560],[1000,520]]),
  road('secondary','low',[[-300,900],[-260,300],[-120,120]]),
  road('minor','medium',[[420,900],[400,260]]),
  road('path','high',[[-800,700],[-600,640],[-420,660]]),
 ];
}

// --- Deduplication fixture -----------------------------------------------------------------------
//
// Not one of the plan's four; it exists because the test suite requires deduplication to be "verified
// against a fixture with deliberately duplicated tile-boundary geometry", and none of the four
// contains any. Each duplicate here is a duplicate for a different reason, and each reason is one
// the dedupe key has to handle separately:
//
//   * byte-identical — the same feature matched by two style layers;
//   * reversed — the same road decoded with the opposite winding;
//   * sub-nanometre jitter — two tiles decoding the same vertex off their own integer grids;
//   * rotated ring — the same water ring decoded starting from a different vertex.
//
// The originals are 8 features; the fixture is 16; deduplication must return 8.
export const DUPLICATE_FIXTURE_ORIGINALS=8;

export function duplicateCapture():CaptureMapFeature[]{
 const base=[
  road('primary','low',[[-800,0],[800,20]]),
  road('secondary','low',[[0,-800],[20,800]]),
  road('minor','medium',[[-400,-400],[-100,-380],[200,-360]]),
  road('service','high',[[300,300],[500,480]]),
  road('minor','medium',[[-700,500],[-300,520]]),
  water([blob(0,0,420,48,.2)]),
  water([blob(600,-600,120,32,.15,1.4)]),
  water([blob(-600,600,90,28,.12,.8)]),
 ];

 const identical=structuredClone(base[0]);
 const reversed=structuredClone(base[1]);
 (reversed.geometry.coordinates as number[][]).reverse();
 const jittered=structuredClone(base[2]);
 // 1e-10 degrees is about 11 micrometres — well inside one quantisation bucket, which is exactly the
 // disagreement two tile decodings of the same vertex produce.
 (jittered.geometry.coordinates as number[][]).forEach(point=>{point[0]+=1e-10;point[1]-=1e-10});
 const alsoIdentical=structuredClone(base[3]);
 const reversedAgain=structuredClone(base[4]);
 (reversedAgain.geometry.coordinates as number[][]).reverse();

 const ringRotated=structuredClone(base[5]);
 const ring=(ringRotated.geometry.coordinates as number[][][])[0];
 const open=ring.slice(0,-1);
 const rotated=[...open.slice(17),...open.slice(0,17)];
 (ringRotated.geometry.coordinates as number[][][])[0]=[...rotated,[rotated[0][0],rotated[0][1]]];

 const ringReversed=structuredClone(base[6]);
 const reversedRing=(ringReversed.geometry.coordinates as number[][][])[0].slice(0,-1).reverse();
 (ringReversed.geometry.coordinates as number[][][])[0]=[...reversedRing,[reversedRing[0][0],reversedRing[0][1]]];

 const waterIdentical=structuredClone(base[7]);

 // Interleaved rather than appended, because a dedupe that only compared against the previous item
 // would pass on a fixture where every duplicate follows its original.
 return [
  base[0],base[1],identical,base[2],base[3],reversed,base[4],jittered,
  base[5],alsoIdentical,base[6],ringRotated,base[7],reversedAgain,ringReversed,waterIdentical,
 ];
}

export const GOLDEN_FIXTURES={
 city:cityCapture,
 rural:ruralCapture,
 lake:lakeCapture,
 coast:coastCapture,
} as const;

export type GoldenFixtureName=keyof typeof GOLDEN_FIXTURES;
export const GOLDEN_FIXTURE_NAMES=Object.keys(GOLDEN_FIXTURES) as GoldenFixtureName[];
