import {describe,expect,it} from 'vitest';
import {createDefaultOrnamentProject} from '../../src/ornament/defaults';
import {exportReadiness,fingerprintsMatch,isSnapshotStale,snapshotFromCapture,viewportFingerprint,type GeometrySnapshot,type ViewportFingerprint} from '../../src/ornament/snapshot';
import {cityCapture} from '../fixtures/ornament/captures';
import {fixtureCapture} from '../helpers/ornamentCapture';
import {ornamentReducer} from '../../src/ornament/store';
import type {OrnamentProject} from '../../src/ornament/types';

const base=createDefaultOrnamentProject();
const RADIUS=44.8;
const print=(project:OrnamentProject)=>viewportFingerprint(project,RADIUS);
const snapshotOf=(project:OrnamentProject):GeometrySnapshot=>({fingerprint:print(project),takenAt:0});

const ready=(over:Partial<Parameters<typeof exportReadiness>[0]>={})=>exportReadiness({
 snapshot:snapshotOf(base),
 current:print(base),
 hasSelectedPlace:true,
 blockingIssueCount:0,
 blockingTextIssueCount:0,
 ...over,
});

describe('viewport fingerprint',()=>{
 it('captures what decides which geography lands on the ornament',()=>{
  expect(print(base)).toEqual({center:base.viewport.center,zoom:base.viewport.zoom,detail:base.roads.detail,innerRadiusMm:RADIUS});
 });

 it('copies the centre rather than aliasing it, so a later edit cannot rewrite the snapshot',()=>{
  const fingerprint=print(base);
  const moved=ornamentReducer(base,{type:'setViewport',patch:{center:[1,2]}});
  expect(fingerprint.center).toEqual(base.viewport.center);
  expect(print(moved).center).toEqual([1,2]);
 });

 it('treats a re-render of the same view as unchanged',()=>{
  expect(fingerprintsMatch(print(base),print({...base}))).toBe(true);
 });

 it('tolerates the float noise a map reports for the same position',()=>{
  const a=print(base);
  const b:ViewportFingerprint={...a,center:[a.center[0]+1e-9,a.center[1]-1e-9],zoom:a.zoom+1e-9};
  expect(fingerprintsMatch(a,b)).toBe(true);
 });

 it('notices a real pan, zoom, detail change or rim change',()=>{
  const a=print(base);
  expect(fingerprintsMatch(a,{...a,center:[a.center[0]+0.01,a.center[1]]})).toBe(false);
  expect(fingerprintsMatch(a,{...a,zoom:a.zoom+0.5})).toBe(false);
  expect(fingerprintsMatch(a,{...a,detail:'high'})).toBe(false);
  expect(fingerprintsMatch(a,{...a,innerRadiusMm:RADIUS-3})).toBe(false);
 });

 // Road width scale changes how thick a captured centreline is drawn, not which centrelines were
 // captured, so it must not invalidate a snapshot.
 it('ignores road width scale',()=>{
  const scaled=ornamentReducer(base,{type:'setRoads',patch:{widthScale:2.5}});
  expect(fingerprintsMatch(print(base),print(scaled))).toBe(true);
 });

 it('ignores personalisation text and build mode',()=>{
  const edited=ornamentReducer(ornamentReducer(base,{type:'setTextLine',key:'title',patch:{value:'Caldron Falls'}}),{type:'setBuildMode',value:'water-cutout-3-piece'});
  expect(fingerprintsMatch(print(base),print(edited))).toBe(true);
 });
});

describe('staleness',()=>{
 it('is not stale before anything has been captured',()=>{
  expect(isSnapshotStale(undefined,print(base))).toBe(false);
 });

 it('is not stale immediately after capture',()=>{
  expect(isSnapshotStale(snapshotOf(base),print(base))).toBe(false);
 });

 it('becomes stale once the map moves',()=>{
  const moved=ornamentReducer(base,{type:'setViewport',patch:{center:[-88.1,45.4]}});
  expect(isSnapshotStale(snapshotOf(base),print(moved))).toBe(true);
 });

 it('becomes stale when the road detail changes',()=>{
  const detailed=ornamentReducer(base,{type:'setRoads',patch:{detail:'high'}});
  expect(isSnapshotStale(snapshotOf(base),print(detailed))).toBe(true);
 });
});

describe('export readiness',()=>{
 it('is ready when a place is chosen, the geometry is valid and the capture is current',()=>{
  expect(ready()).toMatchObject({ready:true,dirty:false,reasons:[]});
 });

 it('blocks and says why when nothing has been captured',()=>{
  const result=ready({snapshot:undefined});
  expect(result.ready).toBe(false);
  expect(result.reasons.map(r=>r.code)).toContain('no-snapshot');
 });

 it('blocks as dirty once the viewport moves after a capture',()=>{
  const moved=ornamentReducer(base,{type:'setViewport',patch:{zoom:16}});
  const result=ready({current:print(moved)});
  expect(result.dirty).toBe(true);
  expect(result.ready).toBe(false);
  expect(result.reasons.map(r=>r.code)).toEqual(['snapshot-stale']);
 });

 it('blocks without a chosen place',()=>{
  expect(ready({hasSelectedPlace:false}).reasons.map(r=>r.code)).toContain('no-place');
 });

 it('blocks on invalid geometry and on text that does not fit',()=>{
  expect(ready({blockingIssueCount:1}).reasons.map(r=>r.code)).toContain('geometry-invalid');
  expect(ready({blockingTextIssueCount:2}).reasons.map(r=>r.code)).toContain('text-invalid');
 });

 it('lists every unmet condition, not just the first',()=>{
  const result=ready({snapshot:undefined,hasSelectedPlace:false,blockingIssueCount:1});
  expect(result.reasons.map(r=>r.code).sort()).toEqual(['geometry-invalid','no-place','no-snapshot']);
 });

 it('gives every reason a message that says what to do next',()=>{
  for(const reason of ready({snapshot:undefined,hasSelectedPlace:false,blockingIssueCount:1,blockingTextIssueCount:1}).reasons){
   expect(reason.message.length).toBeGreaterThan(20);
  }
 });
});


// The stale-result guard for the capture half of the pipeline. A capture is asynchronous, so the
// project can move underneath one that is still in flight; the snapshot has to describe what was
// actually read, not what the project happened to say when the result landed.
describe('snapshot from a capture',()=>{
 const capture=fixtureCapture(cityCapture(),{detail:'medium',zoom:15,innerRadiusMm:44.8});

 it('records the viewport the capture was taken at, not the one in hand now',()=>{
  const snapshot=snapshotFromCapture(capture);
  expect(snapshot.fingerprint.center).toEqual(capture.viewport.center);
  expect(snapshot.fingerprint.zoom).toBe(15);
  expect(snapshot.fingerprint.detail).toBe('medium');
  expect(snapshot.fingerprint.innerRadiusMm).toBe(44.8);
 });

 it('counts the features it actually holds',()=>{
  const snapshot=snapshotFromCapture(capture);
  expect(snapshot.featureCount).toBe(capture.features.roads.length+capture.features.water.length);
 });

 it('copies the centre rather than aliasing the capture viewport',()=>{
  const snapshot=snapshotFromCapture(capture);
  expect(snapshot.fingerprint.center).not.toBe(capture.viewport.center);
 });

 it('reads as stale against a viewport that moved while it was in flight',()=>{
  const snapshot=snapshotFromCapture(capture);
  const moved:ViewportFingerprint={...snapshot.fingerprint,detail:'high'};
  expect(isSnapshotStale(snapshot,moved)).toBe(true);
  expect(exportReadiness({snapshot,current:moved,hasSelectedPlace:true,blockingIssueCount:0,blockingTextIssueCount:0}).ready).toBe(false);
 });

 it('reads as current against the viewport it was taken at',()=>{
  const snapshot=snapshotFromCapture(capture);
  expect(isSnapshotStale(snapshot,snapshot.fingerprint)).toBe(false);
 });
});
