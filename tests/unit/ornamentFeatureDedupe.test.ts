import {describe,expect,it} from 'vitest';
import {dedupeBy,lineKey,polygonKey,ringKey} from '../../src/ornament/capture/dedupe';
import {extractCapturedFeatures} from '../../src/ornament/capture/mapCapture';
import {OPENFREEMAP} from '../../src/ornament/map/provider';
import {cityCapture,DUPLICATE_FIXTURE_ORIGINALS,duplicateCapture} from '../fixtures/ornament/captures';

// Deduplication is a named risk in the plan — "`queryRenderedFeatures` may duplicate geometry across
// tiles or layers. Deduplicate before buffering or union" — and a silent one: a duplicated road
// unions into itself and looks perfect, while a duplicated water polygon can fill in an island.
// The fixture in `captures.ts` contains one duplicate of each kind that actually occurs.

describe('line keys',()=>{
 it('gives one key to a line and its reverse',()=>{
  const line:[number,number][]=[[0,0],[1,1],[2,3]];
  expect(lineKey(line)).toBe(lineKey([...line].reverse()));
 });

 it('gives different keys to different lines',()=>{
  expect(lineKey([[0,0],[1,1]])).not.toBe(lineKey([[0,0],[1,2]]));
 });

 it('treats a sub-quantum difference as the same line',()=>{
  // Two tile decodings of the same vertex differ by far less than this.
  expect(lineKey([[0,0],[1,1]])).toBe(lineKey([[1e-11,-1e-11],[1+1e-11,1-1e-11]]));
 });

 it('does not collapse two genuinely different places',()=>{
  // A tenth of a degree is about 11km.
  expect(lineKey([[0,0],[1,1]])).not.toBe(lineKey([[.1,0],[1,1]]));
 });

 it('normalises negative zero',()=>{
  expect(lineKey([[0,0],[1,1]])).toBe(lineKey([[-0,-0],[1,1]]));
 });
});

describe('ring keys',()=>{
 const ring:[number,number][]=[[0,0],[2,0],[2,2],[0,2],[0,0]];

 it('is unchanged by where the decoder started the ring',()=>{
  const rotated:[number,number][]=[[2,2],[0,2],[0,0],[2,0],[2,2]];
  expect(ringKey(ring)).toBe(ringKey(rotated));
 });

 it('is unchanged by winding direction',()=>{
  const reversed=[...ring.slice(0,-1)].reverse();
  expect(ringKey(ring)).toBe(ringKey([...reversed,reversed[0]]));
 });

 it('is unchanged by whether the ring was given closed or open',()=>{
  expect(ringKey(ring)).toBe(ringKey(ring.slice(0,-1)));
 });

 it('distinguishes a polygon from the same polygon with an island',()=>{
  const hole:[number,number][]=[[.5,.5],[1.5,.5],[1.5,1.5],[.5,1.5],[.5,.5]];
  expect(polygonKey([ring])).not.toBe(polygonKey([ring,hole]));
 });
});

describe('dedupeBy',()=>{
 it('keeps the first of each group and counts the rest',()=>{
  const result=dedupeBy(['a','b','a','c','b','a'],value=>value);
  expect(result.items).toEqual(['a','b','c']);
  expect(result.duplicates).toBe(3);
 });

 it('preserves input order, which is what makes the pipeline deterministic',()=>{
  const result=dedupeBy(['c','a','b','a'],value=>value);
  expect(result.items).toEqual(['c','a','b']);
 });
});

describe('the deliberately duplicated tile-boundary fixture',()=>{
 const features=duplicateCapture();
 const extracted=extractCapturedFeatures(features,OPENFREEMAP);

 it('starts with twice as many features as it has distinct ones',()=>{
  expect(features).toHaveLength(DUPLICATE_FIXTURE_ORIGINALS*2);
 });

 it('deduplicates down to the originals',()=>{
  expect(extracted.roads.length+extracted.water.length).toBe(DUPLICATE_FIXTURE_ORIGINALS);
 });

 it('reports what it removed rather than swallowing it',()=>{
  expect(extracted.counts.rawFeatures).toBe(DUPLICATE_FIXTURE_ORIGINALS*2);
  expect(extracted.counts.duplicateRoads+extracted.counts.duplicateWater).toBe(DUPLICATE_FIXTURE_ORIGINALS);
  expect(extracted.counts.unusableFeatures).toBe(0);
 });

 it('removes the right ones: every surviving feature is distinct',()=>{
  const roadKeys=new Set(extracted.roads.map(road=>road.roadClass+lineKey(road.line)));
  const waterKeys=new Set(extracted.water.map(polygon=>polygonKey(polygon.rings)));
  expect(roadKeys.size).toBe(extracted.roads.length);
  expect(waterKeys.size).toBe(extracted.water.length);
 });

 it('keeps roads and water apart', ()=>{
  expect(extracted.roads).toHaveLength(5);
  expect(extracted.water).toHaveLength(3);
 });
});

describe('extraction from a clean capture',()=>{
 it('removes nothing when there is nothing to remove',()=>{
  const extracted=extractCapturedFeatures(cityCapture(),OPENFREEMAP);
  expect(extracted.counts.duplicateRoads).toBe(0);
  expect(extracted.counts.duplicateWater).toBe(0);
  expect(extracted.roads.length).toBe(cityCapture().length);
 });

 it('splits a MultiLineString into one road per part',()=>{
  const extracted=extractCapturedFeatures([{
   geometry:{type:'MultiLineString',coordinates:[[[0,0],[1,0]],[[2,0],[3,0]]]},
   properties:{class:'primary'},
   sourceLayer:'transportation',
  }],OPENFREEMAP);
  expect(extracted.roads).toHaveLength(2);
 });

 it('splits a MultiPolygon into one water polygon per member, holes intact',()=>{
  const outer=[[0,0],[4,0],[4,4],[0,4],[0,0]];
  const hole=[[1,1],[3,1],[3,3],[1,3],[1,1]];
  const extracted=extractCapturedFeatures([{
   geometry:{type:'MultiPolygon',coordinates:[[outer,hole],[[[9,9],[10,9],[10,10],[9,9]]]]},
   sourceLayer:'water',
  }],OPENFREEMAP);
  expect(extracted.water).toHaveLength(2);
  expect(extracted.water[0].rings).toHaveLength(2);
 });

 it('counts a geometry type it cannot use instead of pretending it was not there',()=>{
  const extracted=extractCapturedFeatures([
   {geometry:{type:'Point',coordinates:[0,0]},sourceLayer:'water'},
   {geometry:{type:'LineString',coordinates:[[0,0],[1,1]]},properties:{},sourceLayer:'transportation'},
  ],OPENFREEMAP);
  expect(extracted.counts.unusableFeatures).toBe(2);
  expect(extracted.roads).toHaveLength(0);
  expect(extracted.water).toHaveLength(0);
 });

 it('copies coordinates out of the source arrays so later panning cannot mutate a capture',()=>{
  const coordinates=[[0,0],[1,1]];
  const extracted=extractCapturedFeatures([{
   geometry:{type:'LineString',coordinates},
   properties:{class:'primary'},
   sourceLayer:'transportation',
  }],OPENFREEMAP);
  coordinates[1][0]=99;
  expect(extracted.roads[0].line[1][0]).toBe(1);
 });
});
