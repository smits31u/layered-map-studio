import {describe,expect,it} from 'vitest';
import {coverageCleared,coverageReport} from '../../src/golf/coverage';
import {defaultNines,numberedHoles,boardPar} from '../../src/golf/holes';
import {assembleRings,GolfSnapshotError,normalizeSnapshot,type OverpassElement} from '../../src/server/golf/normalize';
import type {LonLat} from '../../src/server/golf/types';
import {MID_VALLEE_FETCHED_AT,midValleeElements,midValleeSnapshot} from '../helpers/golfFixture';

// Snapshot normalization on the recorded Mid Vallee fixture (docs/GOLF_MODULE_PLAN.md §2.2, §9).
// The role counts are the ones Phase 0 counted independently from the same response with a separate
// script (docs/golf-implementation-status.md, "Overpass check").

describe('golf snapshot normalization (Mid Vallee fixture)',()=>{
 const snapshot=midValleeSnapshot();

 it('reads the course boundary and identity',()=>{
  expect(snapshot.course).toEqual({osmType:'way',osmId:29060461,name:'Mid Vallee Golf Course',city:'De Pere',state:'WI',website:'https://www.midvallee.com/'});
  expect(snapshot.boundary).toHaveLength(1);
  const [w,s,e,n]=snapshot.bbox;
  expect([w,s,e,n].map(v=>v.toFixed(4))).toEqual(['-88.1914','44.3569','-88.1769','44.3703']);
  expect(snapshot.fetchedAt).toBe(MID_VALLEE_FETCHED_AT);
  expect(snapshot.attribution).toMatch(/OpenStreetMap contributors/);
 });

 it('counts every role the way Phase 0 counted it',()=>{
  expect(snapshot.coverage).toMatchObject({holes:27,fairways:33,greens:26,tees:65,bunkers:84,rough:0,cartpaths:32});
  // 16 single trees and one wood.
  expect(snapshot.coverage.trees).toBe(17);
  // Phase 0's 18 "water" were 13 ponds (every one also tagged as a hazard, so one area each), the
  // 4 streams, and one pond wholly outside the boundary.
  expect(snapshot.coverage.water).toBe(13);
  expect(snapshot.areas.filter(a=>a.hazard).length).toBe(13);
  expect(snapshot.lines.filter(l=>l.role==='stream')).toHaveLength(4);
  expect(snapshot.skipped).toEqual({'outside-boundary':1});
 });

 it('reads holes with ref, par, handicap, per-tee distances and their nine',()=>{
  expect(snapshot.holes).toHaveLength(27);
  expect(snapshot.holes.every(h=>h.par!==undefined&&h.handicap!==undefined&&h.ref)).toBe(true);
  expect(snapshot.holes.every(h=>h.distances.blue>0&&h.distances.white>0)).toBe(true);
  expect(snapshot.nines).toEqual(['Blue','Red','White']);
  expect(snapshot.totals).toEqual({holes:27,par:105});
  const hole=snapshot.holes[0];
  expect(hole.tee).toEqual(hole.line[0]);
  expect(hole.green).toEqual(hole.line[hole.line.length-1]);
 });

 it('keeps the 18-hole pairings as layouts',()=>{
  expect(snapshot.layouts).toHaveLength(6);
  expect(snapshot.layouts.map(l=>l.name)).toContain('Blue/White Course');
  for(const layout of snapshot.layouts)expect(layout.nines.length).toBeGreaterThanOrEqual(1);
 });

 it('is deterministic whatever order Overpass returns the elements in',()=>{
  const {boundary,features,osmBase}=midValleeElements();
  const shuffled=[...features].reverse();
  for(let i=shuffled.length-1;i>0;i-=3)[shuffled[i],shuffled[i-1]]=[shuffled[i-1],shuffled[i]];
  const again=normalizeSnapshot({boundary,features:shuffled,fetchedAt:MID_VALLEE_FETCHED_AT,osmBase});
  expect(JSON.stringify(again)).toBe(JSON.stringify(snapshot));
 });

 it('rounds coordinates to 7 decimals and keeps every ring closed',()=>{
  const rings=[...snapshot.boundary,...snapshot.areas.flatMap(a=>a.geometry)].flat();
  for(const ring of rings){
   expect(ring[0]).toEqual(ring[ring.length-1]);
   for(const [x,y] of ring){expect(Math.abs(Number((x*1e7).toFixed(6))%1)).toBe(0);expect(Math.abs(Number((y*1e7).toFixed(6))%1)).toBe(0)}
  }
 });

 it('drops features wholly outside the boundary and says so',()=>{
  const {boundary,features}=midValleeElements();
  const far:OverpassElement={type:'way',id:1,tags:{golf:'green'},geometry:[{lat:44.5,lon:-88},{lat:44.5,lon:-87.99},{lat:44.51,lon:-87.99},{lat:44.5,lon:-88}]};
  const s=normalizeSnapshot({boundary,features:[...features,far],fetchedAt:MID_VALLEE_FETCHED_AT});
  expect(s.coverage.greens).toBe(26);
  expect(s.skipped['outside-boundary']).toBe((snapshot.skipped['outside-boundary']??0)+1);
 });

 it('refuses an element that is not a golf course',()=>{
  const {features}=midValleeElements();
  const notCourse:OverpassElement={type:'way',id:2,tags:{leisure:'park'},geometry:[{lat:0,lon:0},{lat:0,lon:1},{lat:1,lon:1},{lat:0,lon:0}]};
  expect(()=>normalizeSnapshot({boundary:notCourse,features,fetchedAt:MID_VALLEE_FETCHED_AT})).toThrow(GolfSnapshotError);
 });
});

describe('multipolygon ring assembly',()=>{
 it('joins split ways end to end, in either direction',()=>{
  const a:LonLat[]=[[0,0],[1,0]],b:LonLat[]=[[1,1],[1,0]],c:LonLat[]=[[1,1],[0,1],[0,0]];
  const {rings,unclosed}=assembleRings([a,b,c]);
  expect(unclosed).toBe(0);
  expect(rings).toEqual([[[0,0],[1,0],[1,1],[0,1],[0,0]]]);
 });
 it('reports a ring that cannot close instead of guessing',()=>{
  expect(assembleRings([[[0,0],[1,0]],[[1,0],[1,1]]])).toEqual({rings:[],unclosed:1});
 });
});

describe('coverage gate (§3)',()=>{
 const snapshot=midValleeSnapshot();
 it('blocks Mid Vallee: 26 greens for 27 holes',()=>{
  const report=coverageReport(snapshot);
  expect(report.blocking).toBe(true);
  expect(report.findings.map(f=>f.code)).toEqual(['missing-greens','no-rough']);
  expect(report.findings[0].message).toMatch(/26 greens for 27 holes/);
  expect(report.items.find(i=>i.role==='rough')).toMatchObject({count:0,ok:false});
 });
 it('clears only for the snapshot that was confirmed',()=>{
  const report=coverageReport(snapshot);
  expect(coverageCleared(report,null)).toBe(false);
  expect(coverageCleared(report,report.key)).toBe(true);
  expect(coverageCleared(report,'way-29060461@2020-01-01T00:00:00.000Z')).toBe(false);
 });
 it('notes an unusual hole count and blocks a course with no holes',()=>{
  const none=coverageReport({...snapshot,coverage:{...snapshot.coverage,holes:0}});
  expect(none.findings[0].code).toBe('no-holes');
  const twelve=coverageReport({...snapshot,coverage:{...snapshot.coverage,holes:12,greens:12}});
  expect(twelve.blocking).toBe(false);
  expect(twelve.findings.map(f=>f.code)).toContain('unusual-hole-count');
 });
});

describe('nines and hole numbers',()=>{
 const snapshot=midValleeSnapshot();
 it('defaults to the first 18-hole pairing',()=>{
  expect(defaultNines(snapshot)).toEqual(snapshot.layouts.find(l=>l.nines.length>=2)!.nines.slice(0,2));
 });
 it('numbers straight through the chosen nines',()=>{
  const holes=numberedHoles(snapshot,['White','Red']);
  expect(holes).toHaveLength(18);
  expect(holes.map(h=>h.number)).toEqual(Array.from({length:18},(_,i)=>i+1));
  expect(holes.slice(0,9).every(h=>h.hole.nine==='White')).toBe(true);
  expect(holes.slice(9).every(h=>h.hole.nine==='Red')).toBe(true);
  expect(boardPar(holes)).toBe(70);
 });
 it('falls back to the default for unknown nines',()=>{
  expect(numberedHoles(snapshot,['Green']).length).toBe(18);
  expect(numberedHoles(snapshot,['Blue','Red','White']).length).toBe(27);
 });
});
