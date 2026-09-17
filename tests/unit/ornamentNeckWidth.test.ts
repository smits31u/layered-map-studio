import {describe,expect,it} from 'vitest';
import type {MultiPolygonMm} from '../../src/geometry/shoreline/polygonEngine';
import {createDefaultOrnamentProject} from '../../src/ornament/defaults';
import {circle} from '../../src/ornament/geometry/circle';
import {buildOrnamentGeometry} from '../../src/ornament/geometry/ornamentShape';
import {subtract} from '../../src/ornament/geometry/polygonRepair';
import {exportOrnament} from '../../src/ornament/export/exportOrnament';
import {measureLoopNeck,neckProbes} from '../../src/ornament/export/neck';
import {runPreflight} from '../../src/ornament/export/preflight';
import {buildOrnamentPieces} from '../../src/ornament/export/pieces';
import {layoutOrnamentText} from '../../src/ornament/text/ornamentText';
import type {OrnamentProject} from '../../src/ornament/types';

// The hanging loop's neck, measured on the geometry that would be cut.
//
// This is the test that stops the product shipping broken. Everything here is built around one
// distinction: the editor checks the loop from its *parameters* (two diameters and an overlap), and
// this check reads the *polygon*. A test that only exercised a healthy ornament, or that only made
// the parameters bad, would pass just as happily against the parameter check — and would therefore
// not be testing the thing that was asked for. So the damaged cases below leave every parameter
// valid and untouched, and corrupt only the frame geometry. If someone ever replaces the measurement
// with `geometry.loop.junctionWidthMm`, these fail.

const build=(over:Partial<OrnamentProject['ornament']>={})=>{
 const project=createDefaultOrnamentProject();
 const ornament={...project.ornament,...over,hangingLoop:{...project.ornament.hangingLoop,...over.hangingLoop}};
 return {project:{...project,ornament},geometry:buildOrnamentGeometry(ornament)};
};

// A frame whose loop hole is larger than the project says it is. Every analytic check still passes —
// the stored inner diameter is untouched, so the editor computes a 4mm annulus and an 11.90mm
// junction — while the material actually connecting the loop to the body is now `8 - holeRadiusMm`
// millimetres thick.
const withEnlargedHole=(frame:MultiPolygonMm,centerY:number,holeRadiusMm:number):MultiPolygonMm=>
 subtract(frame,circle(0,centerY,holeRadiusMm,.02),'Damaged frame');

// A frame cut clean through between the loop and the body.
const withSeveredNeck=(frame:MultiPolygonMm,topYMm:number,bottomYMm:number):MultiPolygonMm=>
 subtract(frame,[[[[-200,topYMm],[200,topYMm],[200,bottomYMm],[-200,bottomYMm],[-200,topYMm]]]],'Severed frame');

const exportWithFrame=(project:OrnamentProject,geometry:ReturnType<typeof buildOrnamentGeometry>,frame:MultiPolygonMm)=>{
 const damaged={...geometry,frame};
 const textLayout=layoutOrnamentText(project,damaged);
 return exportOrnament({project,geometry:damaged,textLayout,generatedAt:new Date('2026-01-01T00:00:00Z')});
};

describe('hanging loop neck width, measured on the exported geometry',()=>{
 it('measures the default ornament at the width its dimensions predict',()=>{
  const {project,geometry}=build();
  const neck=measureLoopNeck(geometry.frame,geometry,project.ornament);

  expect(neck.attachedAtAll).toBe(true);
  expect(neck.meetsMinimum).toBe(true);
  // The load path's narrowest point is the loop's own annulus, not the much wider junction chord.
  // Measuring 4mm where the chord is 11.90mm is the measurement working, not failing.
  expect(neck.analyticJunctionMm).toBeGreaterThan(11);
  expect(neck.analyticNeckMm).toBeCloseTo(4,6);
  expect(neck.measuredMm).toBeGreaterThan(3.9);
  expect(neck.measuredMm).toBeLessThan(4.1);
  expect(Math.abs(neck.measuredMm-neck.analyticNeckMm)).toBeLessThan(neck.analyticNeckMm*.05);
 });

 it('reads the polygon rather than the parameters',()=>{
  const {project,geometry}=build();
  const damaged=withEnlargedHole(geometry.frame,geometry.loop.centerY,7);

  // Nothing about the project changed, so every parameter-derived figure still looks healthy.
  expect(geometry.loop.annulusWidthMm).toBeCloseTo(4,6);
  expect(geometry.loop.junctionWidthMm).toBeGreaterThan(11);
  expect(geometry.loop.connected).toBe(true);
  expect(geometry.issues.filter(issue=>issue.severity==='error')).toHaveLength(0);

  const neck=measureLoopNeck(damaged,geometry,project.ornament);
  expect(neck.attachedAtAll).toBe(true);
  expect(neck.measuredMm).toBeLessThan(1.5);
  expect(neck.meetsMinimum).toBe(false);
 });

 it('blocks the export when the neck is too thin, and produces no file at all',()=>{
  const {project,geometry}=build();
  const result=exportWithFrame(project,geometry,withEnlargedHole(geometry.frame,geometry.loop.centerY,7));

  expect(result.ok).toBe(false);
  expect(result.svg).toBeUndefined();
  expect(result.preflight.blocked).toBe(true);
  const codes=result.preflight.findings.filter(item=>item.severity==='error').map(item=>item.code);
  expect(codes).toContain('loop-neck-too-narrow-in-export');
 });

 it('names the measured width and the minimum in the message, so it is actionable',()=>{
  const {project,geometry}=build();
  const result=exportWithFrame(project,geometry,withEnlargedHole(geometry.frame,geometry.loop.centerY,7));
  const message=result.preflight.findings.find(item=>item.code==='loop-neck-too-narrow-in-export')?.message??'';

  expect(message).toMatch(/\d+\.\d+mm/);
  expect(message).toContain('3mm minimum neck width');
  expect(message).toContain('snaps off');
 });

 it('blocks when the loop has been cut clean off the body',()=>{
  const {project,geometry}=build();
  // A band spanning the gap between the top of the body and the bottom of the loop hole.
  const result=exportWithFrame(project,geometry,withSeveredNeck(geometry.frame,-52,-50));

  expect(result.ok).toBe(false);
  expect(result.svg).toBeUndefined();
  const codes=result.preflight.findings.filter(item=>item.severity==='error').map(item=>item.code);
  expect(codes).toContain('loop-detached-in-export');
  expect(result.preflight.neck.attachedAtAll).toBe(false);
  expect(result.preflight.neck.measuredMm).toBe(0);
 });

 it('reports the disagreement between prediction and measurement as its own finding',()=>{
  const {project,geometry}=build();
  const pieces=buildOrnamentPieces({
   project,
   geometry:{...geometry,frame:withEnlargedHole(geometry.frame,geometry.loop.centerY,7)},
   textLayout:layoutOrnamentText(project,geometry),
  });
  const report=runPreflight({project,geometry,textLayout:layoutOrnamentText(project,geometry),pieces});

  expect(report.findings.map(item=>item.code)).toContain('neck-measurement-disagrees');
 });

 it('measures a wider neck when the loop is given more material',()=>{
  const thin=build({hangingLoop:{outerDiameterMm:16,innerDiameterMm:10,overlapMm:3,minNeckWidthMm:3}});
  const thick=build({hangingLoop:{outerDiameterMm:16,innerDiameterMm:6,overlapMm:3,minNeckWidthMm:3}});

  const thinNeck=measureLoopNeck(thin.geometry.frame,thin.geometry,thin.project.ornament);
  const thickNeck=measureLoopNeck(thick.geometry.frame,thick.geometry,thick.project.ornament);

  expect(thinNeck.measuredMm).toBeGreaterThan(2.9);
  expect(thickNeck.measuredMm).toBeGreaterThan(thinNeck.measuredMm+1);
 });

 it('builds probes that describe real material on both sides of the join',()=>{
  const {geometry}=build();
  const probes=neckProbes(geometry);
  expect(probes.loop.length).toBeGreaterThan(0);
  expect(probes.body.length).toBeGreaterThan(0);
 });

 // The property the whole phase exists to guarantee, swept rather than asserted at one point: for
 // every loop the editor will accept, the export either refuses it or the material really is there.
 // "Silently ships a broken connection" is precisely the case this rules out.
 // 30s rather than the 5s default. The sweep builds 27 ornaments and binary-searches an erosion
 // measurement on each, which is around a dozen clipper offsets per ornament: about 4s on an idle
 // machine and over 5s when the rest of the suite is running beside it. The cost is the point — this
 // is the test that rules out shipping a broken neck — so it gets a budget rather than a smaller
 // sweep.
 it('never ships a loop joined by less than the configured minimum',{timeout:30_000},()=>{
  const combinations:OrnamentProject['ornament']['hangingLoop'][]=[];
  for(const outerDiameterMm of [8,12,16,24])
   for(const innerDiameterMm of [4,6,10])
    for(const overlapMm of [1,3,6])
     if(innerDiameterMm<outerDiameterMm)combinations.push({outerDiameterMm,innerDiameterMm,overlapMm,minNeckWidthMm:3});

  expect(combinations.length).toBeGreaterThan(20);
  let accepted=0;

  for(const hangingLoop of combinations){
   const {project,geometry}=build({hangingLoop});
   if(geometry.issues.some(issue=>issue.severity==='error')){
    // Refused before export. That is a pass: nothing reaches a machine.
    expect(geometry.frame).toHaveLength(0);
    continue;
   }
   const textLayout=layoutOrnamentText(project,geometry);
   const result=exportOrnament({project,geometry,textLayout,generatedAt:new Date('2026-01-01T00:00:00Z')});
   if(!result.ok){
    expect(result.svg).toBeUndefined();
    continue;
   }
   accepted++;
   // The only remaining branch: a file was produced. The material must actually be there.
   expect(result.preflight.neck.attachedAtAll).toBe(true);
   expect(result.preflight.neck.measuredMm).toBeGreaterThanOrEqual(hangingLoop.minNeckWidthMm);
  }

  // A sweep in which nothing was ever accepted would satisfy the assertion above vacuously.
  expect(accepted).toBeGreaterThan(0);
 });
});
