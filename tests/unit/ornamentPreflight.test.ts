import {describe,expect,it} from 'vitest';
import type {MultiPolygonMm} from '../../src/geometry/shoreline/polygonEngine';
import {createDefaultOrnamentProject} from '../../src/ornament/defaults';
import {buildOrnamentGeometry} from '../../src/ornament/geometry/ornamentShape';
import {
 PREFLIGHT_CHECKS,
 pathHasNonFinite,
 pathSubpathsAreClosed,
 preflightSummary,
 ringIsClosed,
 ringSelfIntersects,
 runPreflight,
 segmentsCross,
 type PreflightCheckId,
} from '../../src/ornament/export/preflight';
import {buildOrnamentPieces,type OrnamentGroupId,type OrnamentPieceSet} from '../../src/ornament/export/pieces';
import {layoutOrnamentText} from '../../src/ornament/text/ornamentText';
import type {OrnamentProject} from '../../src/ornament/types';

// The eight preflight checks, each exercised by a design that actually fails it.
//
// Every failure case here is injected into the *placed* geometry rather than produced by a setting,
// because that is where preflight runs and because most of these cannot be produced by a setting at
// all — a self-intersecting cut ring is a bug in the pipeline, not a choice. What is being tested is
// that if one ever appeared, the file would not be written.

const baseProject=(over:Partial<OrnamentProject>={}):OrnamentProject=>({...createDefaultOrnamentProject(),...over});

function setup(project=baseProject()){
 const geometry=buildOrnamentGeometry(project.ornament);
 const textLayout=layoutOrnamentText(project,geometry);
 const pieces=buildOrnamentPieces({project,geometry,textLayout});
 return {project,geometry,textLayout,pieces};
}

// Replaces one group's contents, keeping everything else exactly as the layout produced it.
const withGroup=(pieces:OrnamentPieceSet,id:OrnamentGroupId,patch:{geometry?:MultiPolygonMm;paths?:string[]}):OrnamentPieceSet=>({
 ...pieces,
 groups:pieces.groups.map(group=>group.id===id?{...group,...patch}:group),
});

const codes=(findings:{code:string}[])=>findings.map(item=>item.code);
const errorsOf=(report:{findings:{severity:string;code:string;check:PreflightCheckId}[]})=>report.findings.filter(item=>item.severity==='error');

describe('preflight',()=>{
 it('runs all eight checks and says so',()=>{
  const {project,geometry,textLayout,pieces}=setup();
  const report=runPreflight({project,geometry,textLayout,pieces});
  expect(report.checksRun).toHaveLength(8);
  expect(report.checksRun).toEqual(PREFLIGHT_CHECKS);
 });

 it('passes a valid ornament with no map geometry captured',()=>{
  const {project,geometry,textLayout,pieces}=setup();
  const report=runPreflight({project,geometry,textLayout,pieces});
  expect(errorsOf(report)).toHaveLength(0);
  expect(report.blocked).toBe(false);
  expect(preflightSummary(report)).toContain('of material joins the loop to the body');
 });

 // 1 — dimensions
 it('blocks when the exported ornament is not the size it was asked for',()=>{
  const {project,geometry,textLayout,pieces}=setup();
  const report=runPreflight({project,geometry,textLayout,pieces:{...pieces,finishedDiameterMm:pieces.finishedDiameterMm+.4}});
  expect(codes(errorsOf(report))).toContain('diameter-out-of-tolerance');
  expect(report.blocked).toBe(true);
 });

 it('accepts a diameter error inside the tolerance budget',()=>{
  const {project,geometry,textLayout,pieces}=setup();
  const report=runPreflight({project,geometry,textLayout,pieces:{...pieces,finishedDiameterMm:pieces.finishedDiameterMm+.05}});
  expect(codes(errorsOf(report))).not.toContain('diameter-out-of-tolerance');
 });

 it('blocks a sheet with no usable size',()=>{
  const {project,geometry,textLayout,pieces}=setup();
  const report=runPreflight({project,geometry,textLayout,pieces:{...pieces,sheet:{...pieces.sheet,widthMm:0}}});
  expect(codes(errorsOf(report))).toContain('sheet-invalid');
 });

 // 2 — open cut paths
 it('blocks an open cut ring',()=>{
  const {project,geometry,textLayout,pieces}=setup();
  const open:MultiPolygonMm=[[[[0,0],[10,0],[10,10]]]];
  const report=runPreflight({project,geometry,textLayout,pieces:withGroup(pieces,'piece/base/cut',{geometry:open})});
  expect(codes(errorsOf(report))).toContain('cut-ring-open');
 });

 it('blocks cut path data whose subpath never closes',()=>{
  const {project,geometry,textLayout,pieces}=setup();
  // Any cut group carrying path data will do; the text group is the one that has paths at all.
  const patched={...pieces,groups:pieces.groups.map(group=>
   group.id==='piece/frame/text-engrave'?{...group,operation:'cut' as const,paths:['M0 0 L5 0 L5 5']}:group)};
  const report=runPreflight({project,geometry,textLayout,pieces:patched});
  expect(codes(errorsOf(report))).toContain('cut-path-open');
 });

 it('recognises closed rings and closed path data',()=>{
  expect(ringIsClosed([[0,0],[1,0],[1,1],[0,0]])).toBe(true);
  expect(ringIsClosed([[0,0],[1,0],[1,1]])).toBe(false);
  expect(pathSubpathsAreClosed('M0 0 L1 0 Z M2 2 L3 3 Z')).toBe(true);
  expect(pathSubpathsAreClosed('M0 0 L1 0 Z M2 2 L3 3')).toBe(false);
  expect(pathSubpathsAreClosed('')).toBe(false);
 });

 // 3 — self-intersections
 it('blocks a cut ring that crosses itself',()=>{
  const {project,geometry,textLayout,pieces}=setup();
  const bowtie:MultiPolygonMm=[[[[0,0],[10,10],[10,0],[0,10],[0,0]]]];
  const report=runPreflight({project,geometry,textLayout,pieces:withGroup(pieces,'piece/base/cut',{geometry:bowtie})});
  expect(codes(errorsOf(report))).toContain('cut-ring-self-intersects');
 });

 it('detects crossing segments and leaves clean rings alone',()=>{
  expect(segmentsCross([0,0],[10,10],[0,10],[10,0])).toBe(true);
  expect(segmentsCross([0,0],[1,0],[0,1],[1,1])).toBe(false);
  expect(ringSelfIntersects([[0,0],[10,10],[10,0],[0,10],[0,0]])).toBeDefined();
  expect(ringSelfIntersects([[0,0],[10,0],[10,10],[0,10],[0,0]])).toBeUndefined();
 });

 it('finds a self-intersection in a ring dense enough to take the sweep path',()=>{
  const ring:[number,number][]=[];
  for(let index=0;index<200;index++){
   const angle=2*Math.PI*index/200;
   ring.push([20*Math.cos(angle),20*Math.sin(angle)]);
  }
  ring.push([ring[0][0],ring[0][1]]);
  expect(ringSelfIntersects(ring)).toBeUndefined();
  // Drag one vertex across the far side of the circle.
  const crossed=ring.map((point,index)=>index===50?[-30,0] as [number,number]:point);
  expect(ringSelfIntersects(crossed)).toBeDefined();
 });

 // 4 — disconnected pieces
 it('blocks a frame that cuts as more than one piece',()=>{
  const {project,geometry,textLayout,pieces}=setup();
  const split:MultiPolygonMm=[
   [[[0,0],[10,0],[10,10],[0,10],[0,0]]],
   [[[20,0],[30,0],[30,10],[20,10],[20,0]]],
  ];
  const report=runPreflight({project,geometry,textLayout,pieces:withGroup(pieces,'piece/frame/cut',{geometry:split})});
  expect(codes(errorsOf(report))).toContain('frame-disconnected');
 });

 it('warns rather than blocks when loose land is what the keep-separate policy asked for',()=>{
  const project=baseProject({buildMode:'water-cutout-3-piece',land:{...createDefaultOrnamentProject().land,islandPolicy:'keep-separate'}});
  const {geometry,textLayout,pieces}=setup(project);
  const twoPieces:MultiPolygonMm=[
   [[[0,0],[20,0],[20,20],[0,20],[0,0]]],
   [[[30,0],[40,0],[40,10],[30,10],[30,0]]],
  ];
  const report=runPreflight({project,geometry,textLayout,pieces:withGroup(pieces,'piece/land/cut',{geometry:twoPieces})});
  const finding=report.findings.find(item=>item.code==='land-disconnected');
  expect(finding?.severity).toBe('warning');
 });

 // Loose land never blocks, whatever the policy. An island too far to tab and too big to drop is a
 // real feature of a real lake, not a failure of the policy — see the note in preflight.ts. What it
 // must do is say so, name the policy, and say what to change.
 it('warns without blocking when bridging could not reach everything, and names the remedies',()=>{
  const project=baseProject({buildMode:'water-cutout-3-piece',land:{...createDefaultOrnamentProject().land,islandPolicy:'bridge'}});
  const {geometry,textLayout,pieces}=setup(project);
  const twoPieces:MultiPolygonMm=[
   [[[0,0],[20,0],[20,20],[0,20],[0,0]]],
   [[[30,0],[40,0],[40,10],[30,10],[30,0]]],
  ];
  const report=runPreflight({project,geometry,textLayout,pieces:withGroup(pieces,'piece/land/cut',{geometry:twoPieces})});
  const finding=report.findings.find(item=>item.code==='land-disconnected');
  expect(finding?.severity).toBe('warning');
  expect(report.blocked).toBe(false);
  expect(finding?.message).toContain('bridge');
  expect(finding?.message).toContain('gluing back');
  expect(finding?.message).toMatch(/Widen the bridge reach|raise the omit threshold/);
 });

 // 5 — tiny islands
 it('blocks a cut fragment too small to survive being cut',()=>{
  const {project,geometry,textLayout,pieces}=setup();
  const speck:MultiPolygonMm=[
   [[[0,0],[20,0],[20,20],[0,20],[0,0]]],
   [[[30,0],[30.2,0],[30.2,.2],[30,.2],[30,0]]],
  ];
  const report=runPreflight({project,geometry,textLayout,pieces:withGroup(pieces,'piece/base/cut',{geometry:speck})});
  expect(codes(errorsOf(report))).toContain('cut-fragment-too-small');
 });

 it('warns about a piece smaller than the size the user called meaningful',()=>{
  const {project,geometry,textLayout,pieces}=setup();
  const small:MultiPolygonMm=[
   [[[0,0],[20,0],[20,20],[0,20],[0,0]]],
   [[[30,0],[31,0],[31,1],[30,1],[30,0]]],
  ];
  const report=runPreflight({project,geometry,textLayout,pieces:withGroup(pieces,'piece/base/cut',{geometry:small})});
  expect(codes(report.findings)).toContain('cut-fragment-small');
 });

 // 6 — minimum feature width (the loop neck has its own suite)
 it('warns about sub-minimum-width features on a land piece without blocking',()=>{
  const project=baseProject({buildMode:'water-cutout-3-piece'});
  const {geometry,textLayout,pieces}=setup(project);
  // A blob with a 0.6mm spit hanging off it.
  const spit:MultiPolygonMm=[[[[0,0],[20,0],[20,20],[0,20],[0,0]]],[[[20,9.7],[34,9.7],[34,10.3],[20,10.3],[20,9.7]]]];
  const report=runPreflight({project,geometry,textLayout,pieces:withGroup(pieces,'piece/land/cut',{geometry:spit})});
  const finding=report.findings.find(item=>item.code==='feature-below-minimum-width');
  expect(finding).toBeDefined();
  expect(finding?.severity).toBe('warning');
 });

 // 7 — text overflow
 it('blocks text that does not fit the band, which the editor only warns about',()=>{
  const project=baseProject({
   text:{
    ...createDefaultOrnamentProject().text,
    title:{value:'An extremely long title that cannot possibly fit',fontId:'inter',sizeMm:14,letterSpacingMm:1},
   },
  });
  const {geometry,textLayout,pieces}=setup(project);
  // The editor's own severity for this is a warning: the user is still editing.
  expect(textLayout.issues.some(issue=>issue.severity==='error')).toBe(false);
  expect(textLayout.issues.length).toBeGreaterThan(0);

  const report=runPreflight({project,geometry,textLayout,pieces});
  expect(report.blocked).toBe(true);
  expect(codes(errorsOf(report)).some(code=>code==='text-line-too-wide'||code==='text-overflows-band')).toBe(true);
  expect(report.findings.find(item=>item.check==='text-overflow')?.message).toContain('Fit text to band');
 });

 // 8 — NaN / Infinity
 it('blocks a non-finite coordinate in geometry',()=>{
  const {project,geometry,textLayout,pieces}=setup();
  const poisoned:MultiPolygonMm=[[[[0,0],[10,0],[Number.NaN,10],[0,10],[0,0]]]];
  const report=runPreflight({project,geometry,textLayout,pieces:withGroup(pieces,'piece/base/cut',{geometry:poisoned})});
  expect(codes(errorsOf(report))).toContain('geometry-non-finite');
 });

 it('blocks a non-finite coordinate in path data',()=>{
  const {project,geometry,textLayout,pieces}=setup();
  const report=runPreflight({project,geometry,textLayout,pieces:withGroup(pieces,'piece/frame/text-engrave',{paths:['M0 0 L NaN 4 Z']})});
  expect(codes(errorsOf(report))).toContain('path-non-finite');
 });

 it('recognises non-finite path data directly',()=>{
  expect(pathHasNonFinite('M0 0 L10 Infinity Z')).toBe(true);
  expect(pathHasNonFinite('M0 0 L10 10 Z')).toBe(false);
 });

 it('summarises a blocked report as problems to fix rather than as a pass',()=>{
  const {project,geometry,textLayout,pieces}=setup();
  const report=runPreflight({project,geometry,textLayout,pieces:{...pieces,finishedDiameterMm:0}});
  expect(preflightSummary(report)).toMatch(/must be fixed before this can be exported/);
 });
});
