import {render} from '@testing-library/react';
import {describe,expect,it} from 'vitest';
import type {MultiPolygonMm} from '../../src/geometry/shoreline/polygonEngine';
import {createDefaultOrnamentProject} from '../../src/ornament/defaults';
import {measureLoopNeck} from '../../src/ornament/export/neck';
import {PIECE_GAP_MM,SHEET_MARGIN_MM,buildOrnamentPieces,loopPieceFor,type OrnamentPieceSet} from '../../src/ornament/export/pieces';
import {runPreflight} from '../../src/ornament/export/preflight';
import {circle} from '../../src/ornament/geometry/circle';
import {buildOrnamentGeometry,buildThreePieceShapes,extendLandToRim} from '../../src/ornament/geometry/ornamentShape';
import {geometryAreaMm2,intersect,subtract} from '../../src/ornament/geometry/polygonRepair';
import {layoutOrnamentText} from '../../src/ornament/text/ornamentText';
import type {BuildMode,OrnamentProject} from '../../src/ornament/types';
import {StackDiagram} from '../../src/ornament/ui/StackDiagram';
import {goldenExport} from '../helpers/ornamentSheetGolden';
import {svgGroupBounds,svgGroupRingCount} from '../helpers/ornamentSvgGroups';

// Water-cutout (three-piece) mode hangs the ornament from the backing rather than the frame. These
// pin the four things that move with it: the backing carries a connected loop, the frame carries no
// trace of one, the neck check follows the loop to the backing, and the sheet makes room for it.

type OrnamentSpec=OrnamentProject['ornament'];
type Loop=OrnamentSpec['hangingLoop'];

const DEFAULT_LOOP:Loop=createDefaultOrnamentProject().ornament.hangingLoop;
const loopWith=(over:Partial<Loop>):Loop=>({...DEFAULT_LOOP,...over});

const project=(mode:BuildMode,over:Partial<OrnamentSpec>={}):OrnamentProject=>{
 const base=createDefaultOrnamentProject();
 return {...base,buildMode:mode,ornament:{...base.ornament,...over}};
};

const build=(mode:BuildMode,over:Partial<OrnamentSpec>={})=>{
 const p=project(mode,over);
 const geometry=buildOrnamentGeometry(p.ornament);
 const textLayout=layoutOrnamentText(p,geometry);
 const pieces=buildOrnamentPieces({project:p,geometry,textLayout});
 return {project:p,geometry,textLayout,pieces};
};

const piece=(pieces:OrnamentPieceSet,id:'base'|'frame')=>pieces.pieces.find(item=>item.id===id)!;
const cutGroup=(pieces:OrnamentPieceSet,id:'piece/base/cut'|'piece/frame/cut')=>pieces.groups.find(group=>group.id===id)!;
const withCut=(pieces:OrnamentPieceSet,id:'piece/base/cut'|'piece/frame/cut',geometry:MultiPolygonMm):OrnamentPieceSet=>
 ({...pieces,groups:pieces.groups.map(group=>group.id===id?{...group,geometry}:group)});

// The smallest and largest ornaments the editor accepts. 25mm needs a narrower rim and a lower
// map/text boundary than the defaults to leave both a map window and a text band at all; the rim
// stays 1mm over the 3mm minimum feature width, which a rim of exactly 3mm trips in either mode.
const SMALL:Partial<OrnamentSpec>={diameterMm:25,rimWidthMm:4,mapToTextBoundaryMm:2};
const LARGE:Partial<OrnamentSpec>={diameterMm:300};
const EXTREMES:[string,Partial<OrnamentSpec>][]=[['25mm (minimum)',SMALL],['300mm (maximum)',LARGE]];

describe('three-piece mode: the backing carries the hanging loop',()=>{
 it('says which piece carries the loop in each mode',()=>{
  expect(loopPieceFor('classic-2-piece')).toBe('frame');
  expect(loopPieceFor('water-cutout-3-piece')).toBe('base');
  expect(build('classic-2-piece').pieces.loopPiece).toBe('frame');
  expect(build('water-cutout-3-piece').pieces.loopPiece).toBe('base');
 });

 it('builds the backing as disk ∪ loop disk − loop hole, in one connected piece',()=>{
  const {geometry,pieces}=build('water-cutout-3-piece');
  const backing=piece(pieces,'base').cutLocal;
  const {loop}=geometry;
  const body=circle(0,0,geometry.outerRadiusMm);
  const annulus=subtract(circle(0,loop.centerY,loop.outerRadiusMm),circle(0,loop.centerY,loop.innerRadiusMm),'Annulus');
  // One piece, with exactly one hole: the one the ribbon goes through.
  expect(backing).toHaveLength(1);
  expect(backing[0]).toHaveLength(2);
  // Its top is the top of the loop, not the top of the disk.
  expect(piece(pieces,'base').localBounds.minY).toBeCloseTo(loop.centerY-loop.outerRadiusMm,2);
  // Area is the disk plus the loop's protruding part, less the hole.
  expect(geometryAreaMm2(backing)).toBeCloseTo(geometryAreaMm2(body)+geometryAreaMm2(subtract(annulus,body,'Protrusion')),1);
  // And the loop really is in it: the loop's annulus outside the body is all backing material.
  const inset=subtract(circle(0,loop.centerY,loop.outerRadiusMm-.05),circle(0,loop.centerY,loop.innerRadiusMm+.05),'Inset annulus');
  expect(geometryAreaMm2(subtract(subtract(inset,body,'Inset protrusion'),backing,'Missing loop'))).toBeLessThan(1e-3);
 });

 it('builds the frame as ring + text band only: no loop and no bridge stub',()=>{
  const {geometry,pieces}=build('water-cutout-3-piece');
  const frame=piece(pieces,'frame').cutLocal;
  const {loop}=geometry;
  const body=circle(0,0,geometry.outerRadiusMm);
  // Nothing above the rim.
  expect(piece(pieces,'frame').localBounds.minY).toBeGreaterThanOrEqual(-geometry.outerRadiusMm-1e-3);
  // Not one square micron of the loop's footprint outside the body survives on the frame.
  const loopOutsideBody=subtract(circle(0,loop.centerY,loop.outerRadiusMm),body,'Loop footprint');
  expect(geometryAreaMm2(intersect(frame,loopOutsideBody,'Stub'))).toBe(0);
  // Exactly the body less the map window: the default loop hole sits wholly above the body.
  expect(geometryAreaMm2(frame)).toBeCloseTo(geometryAreaMm2(body)-geometryAreaMm2(geometry.mapOpening),2);
  expect(frame).toHaveLength(1);
 });

 it('notches the frame where a deep loop hole dips into the rim, so the stack does not block it',()=>{
  const {geometry}=build('water-cutout-3-piece',{hangingLoop:loopWith({overlapMm:6})});
  const {frame}=buildThreePieceShapes(geometry);
  const hole=circle(0,geometry.loop.centerY,geometry.loop.innerRadiusMm);
  expect(geometryAreaMm2(intersect(circle(0,0,geometry.outerRadiusMm),hole,'Hole in body'))).toBeGreaterThan(0);
  expect(geometryAreaMm2(intersect(frame,hole,'Hole on frame'))).toBeLessThan(1e-6);
 });

 it('leaves classic mode as it was: plain disk base, looped frame',()=>{
  const {geometry,pieces}=build('classic-2-piece');
  const base=piece(pieces,'base');
  expect(base.cutLocal).toHaveLength(1);
  expect(base.cutLocal[0]).toHaveLength(1);
  expect(base.localBounds.minY).toBeCloseTo(-geometry.outerRadiusMm,2);
  expect(piece(pieces,'frame').cutLocal).toBe(geometry.frame);
 });

 it('falls back to a loopless disk when the ornament failed its own checks, so preflight blocks',()=>{
  const {geometry,pieces,project:p,textLayout}=build('water-cutout-3-piece',{hangingLoop:loopWith({overlapMm:.5,minNeckWidthMm:6})});
  expect(geometry.frame).toHaveLength(0);
  expect(piece(pieces,'base').localBounds.minY).toBeCloseTo(-geometry.outerRadiusMm,2);
  const report=runPreflight({project:p,geometry,textLayout,pieces});
  expect(report.blocked).toBe(true);
  expect(report.findings.map(f=>f.code)).toContain('loop-detached-in-export');
 });
});

describe('three-piece mode: the minimum neck width is enforced on the backing',()=>{
 it('measures the neck on the backing, not the frame',()=>{
  const {geometry,pieces,project:p,textLayout}=build('water-cutout-3-piece');
  const report=runPreflight({project:p,geometry,textLayout,pieces});
  expect(report.neck.attachedAtAll).toBe(true);
  expect(report.neck.meetsMinimum).toBe(true);
  // The frame has no loop, so measuring it finds none; preflight found one, so it measured the
  // backing.
  const onFrame=measureLoopNeck(cutGroup(pieces,'piece/frame/cut').geometry,geometry,p.ornament,{offsetMm:piece(pieces,'frame').offsetMm});
  expect(onFrame.attachedAtAll).toBe(false);
 });

 it('measures the same neck the classic frame did, because it is the same loop',()=>{
  const classic=build('classic-2-piece'),cutout=build('water-cutout-3-piece');
  const a=runPreflight(classic).neck,b=runPreflight(cutout).neck;
  expect(Math.abs(a.measuredMm-b.measuredMm)).toBeLessThan(.05);
  expect(b.analyticNeckMm).toBe(a.analyticNeckMm);
 });

 describe.each(EXTREMES)('at %s',(_label,over)=>{
  it('passes a healthy loop, measured on the backing at or above the minimum',()=>{
   const {geometry,pieces,project:p,textLayout}=build('water-cutout-3-piece',over);
   expect(geometry.issues.filter(i=>i.severity==='error')).toEqual([]);
   const report=runPreflight({project:p,geometry,textLayout,pieces});
   expect(report.neck.attachedAtAll).toBe(true);
   expect(report.neck.measuredMm).toBeGreaterThanOrEqual(p.ornament.hangingLoop.minNeckWidthMm);
   expect(report.findings.filter(f=>f.check==='minimum-width')).toEqual([]);
  },30_000);

  it('blocks a backing whose emitted neck is below the minimum, and says so about the backing',()=>{
   const {geometry,pieces,project:p,textLayout}=build('water-cutout-3-piece',over);
   const placed=piece(pieces,'base').offsetMm;
   // Enlarge the hole on the emitted backing only: every parameter-level check still passes, and a
   // 7mm-radius hole in a 16mm loop leaves 1mm of material against the 3mm minimum.
   const damaged=subtract(cutGroup(pieces,'piece/base/cut').geometry,circle(placed[0],placed[1]+geometry.loop.centerY,7),'Damaged backing');
   const report=runPreflight({project:p,geometry,textLayout,pieces:withCut(pieces,'piece/base/cut',damaged)});
   expect(report.blocked).toBe(true);
   const neckFinding=report.findings.find(f=>f.code==='loop-neck-too-narrow-in-export');
   expect(neckFinding?.message).toMatch(/exported backing joins the hanging loop/);
   expect(report.neck.measuredMm).toBeLessThan(p.ornament.hangingLoop.minNeckWidthMm);
  },30_000);

  it('refuses a loop whose material is thinner than the minimum before it reaches the backing',()=>{
   const {geometry,pieces,project:p,textLayout}=build('water-cutout-3-piece',{...over,hangingLoop:loopWith({minNeckWidthMm:4.5})});
   expect(geometry.issues.map(i=>i.code)).toContain('loop-annulus-too-thin');
   expect(runPreflight({project:p,geometry,textLayout,pieces}).blocked).toBe(true);
  },30_000);
 });

 it('treats sub-minimum features on the backing as structural errors, as it does on the frame',()=>{
  const {geometry,pieces,project:p,textLayout}=build('water-cutout-3-piece');
  const [x,y]=piece(pieces,'base').offsetMm;
  const backing=cutGroup(pieces,'piece/base/cut').geometry;
  // A 1mm sliver hanging off the bottom of the disk: thin, but nowhere near the loop's path.
  const sliver:MultiPolygonMm=[[[[x-.5,y+50],[x+.5,y+50],[x+.5,y+58],[x-.5,y+58],[x-.5,y+50]]]];
  const report=runPreflight({project:p,geometry,textLayout,pieces:withCut(pieces,'piece/base/cut',[...backing,...subtract(sliver,backing,'Sliver')])});
  const thin=report.findings.find(f=>f.code==='feature-below-minimum-width'&&f.message.startsWith('piece/base/cut'));
  expect(thin?.severity).toBe('error');
  expect(thin?.message).toMatch(/backing, which carries the hanging loop/);
 });
});

describe('three-piece mode: sheet layout makes room for the loop on the backing',()=>{
 const placedBounds=(pieces:OrnamentPieceSet)=>pieces.pieces.map(p=>({
  id:p.id,
  minX:p.localBounds.minX+p.offsetMm[0],maxX:p.localBounds.maxX+p.offsetMm[0],
  minY:p.localBounds.minY+p.offsetMm[1],maxY:p.localBounds.maxY+p.offsetMm[1],
 }));

 const cases:[string,Partial<OrnamentSpec>][]=[
  ['default',{}],
  ...EXTREMES,
  // A loop wider than the ornament itself: the backing's width is the loop's, not the disk's.
  ['loop wider than the disk',{...SMALL,hangingLoop:loopWith({outerDiameterMm:30,innerDiameterMm:20,overlapMm:5})}],
 ];

 it.each(cases)('%s: no two pieces overlap, and every piece sits inside the sheet margins',(_label,over)=>{
  const {pieces,geometry}=build('water-cutout-3-piece',over);
  expect(geometry.issues.filter(i=>i.severity==='error')).toEqual([]);
  const boxes=placedBounds(pieces);
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
   const a=boxes[i],b=boxes[j];
   expect(Math.max(b.minX-a.maxX,a.minX-b.maxX),`${a.id} and ${b.id}`).toBeGreaterThanOrEqual(PIECE_GAP_MM-1e-6);
  }
  for(const box of boxes){
   expect(box.minX).toBeGreaterThanOrEqual(SHEET_MARGIN_MM-1e-6);
   expect(box.minY).toBeGreaterThanOrEqual(SHEET_MARGIN_MM-1e-6);
   expect(box.maxX).toBeLessThanOrEqual(pieces.sheet.widthMm-SHEET_MARGIN_MM+1e-6);
   expect(box.maxY).toBeLessThanOrEqual(pieces.sheet.heightMm-SHEET_MARGIN_MM-pieces.sheet.labelBandMm+1e-6);
  }
  // The backing is the tallest piece now, so it sets the top margin.
  expect(boxes.find(b=>b.id==='base')!.minY).toBeCloseTo(SHEET_MARGIN_MM,6);
 });

 it('keeps every piece in register on one shared origin line',()=>{
  const {pieces}=build('water-cutout-3-piece');
  expect(new Set(pieces.pieces.map(p=>p.offsetMm[1])).size).toBe(1);
 });

 it('measures the finished diameter on the loopless frame, not the taller backing',()=>{
  const {pieces,project:p}=build('water-cutout-3-piece');
  expect(Math.abs(pieces.finishedDiameterMm-p.ornament.diameterMm)).toBeLessThan(.1);
 });
});

describe('three-piece SVG: the loop is in the backing group and absent from the frame group',()=>{
 it('writes the loop into piece/base/cut and only the ring into piece/frame/cut',()=>{
  const {svg,geometry,result}=goldenExport('lake','water-cutout-3-piece');
  expect(result.ok).toBe(true);
  const base=svgGroupBounds(svg,'piece/base/cut')!,frame=svgGroupBounds(svg,'piece/frame/cut')!;
  const {loop}=geometry;
  const protrusion=-(loop.centerY-loop.outerRadiusMm)-geometry.outerRadiusMm;
  // The backing reaches the loop's height above the shared rim line; the frame stops at the rim.
  // To 0.05mm: the flattened circle's topmost vertex sits a few microns inside the true circle.
  expect(frame.minY-base.minY).toBeCloseTo(protrusion,1);
  expect(frame.maxY-frame.minY).toBeCloseTo(geometry.outerRadiusMm*2,2);
  // Backing: outer outline + loop hole. Frame: outer outline + map window.
  expect(svgGroupRingCount(svg,'piece/base/cut')).toBe(2);
  expect(svgGroupRingCount(svg,'piece/frame/cut')).toBe(2);
 });

 it('still writes the loop into piece/frame/cut in classic mode',()=>{
  const {svg,geometry}=goldenExport('lake','classic-2-piece');
  const base=svgGroupBounds(svg,'piece/base/cut')!,frame=svgGroupBounds(svg,'piece/frame/cut')!;
  const protrusion=-(geometry.loop.centerY-geometry.loop.outerRadiusMm)-geometry.outerRadiusMm;
  expect(base.minY-frame.minY).toBeCloseTo(protrusion,1);
  expect(svgGroupRingCount(svg,'piece/base/cut')).toBe(1);
 });
});

describe('stack diagram',()=>{
 it('draws the loop on the backing in three-piece mode',()=>{
  const {container}=render(<StackDiagram mode="water-cutout-3-piece"/>);
  const looped=[...container.querySelectorAll('[data-loop="true"]')].map(g=>g.getAttribute('data-layer'));
  expect(looped).toEqual(['Backing / water']);
  expect(container.querySelector('[data-layer="Backing / water"] circle.stack-diagram-loop')).not.toBeNull();
  expect(container.querySelector('[data-layer="Frame + text"] circle')).toBeNull();
  expect(container.querySelector('svg')?.getAttribute('aria-label')).toContain('hanging loop on Backing / water');
  expect(container.textContent).toContain('no loop');
 });

 it('draws the loop on the frame in classic mode',()=>{
  const {container}=render(<StackDiagram mode="classic-2-piece"/>);
  const looped=[...container.querySelectorAll('[data-loop="true"]')].map(g=>g.getAttribute('data-layer'));
  expect(looped).toEqual(['Frame + text']);
 });
});

describe('three-piece mode: backing, land and frame are all the full ornament diameter',()=>{
 const width=(pieces:OrnamentPieceSet,id:'base'|'land'|'frame')=>{
  const b=pieces.pieces.find(item=>item.id===id)!.localBounds;
  return b.maxX-b.minX;
 };

 it('cuts the land piece at the full diameter, not the map window',()=>{
  const {project:p,result}=goldenExport('lake','water-cutout-3-piece');
  const {pieces}=result;
  expect(width(pieces,'land')).toBeCloseTo(p.ornament.diameterMm,2);
  expect(width(pieces,'frame')).toBeCloseTo(p.ornament.diameterMm,2);
  expect(width(pieces,'base')).toBeCloseTo(p.ornament.diameterMm,2);
 });

 it('keeps the captured land exactly inside the map window, and adds only the band under the rim',()=>{
  const {geometry}=build('water-cutout-3-piece');
  const window=circle(0,0,geometry.innerRadiusMm);
  // Captured land with a lake in it, as the feature pipeline would hand over.
  const captured=subtract(window,circle(10,5,15),'Captured land');
  const land=extendLandToRim(captured,geometry,2);
  // Inside the window: the same land, the lake still open. The visible map is unchanged.
  expect(geometryAreaMm2(intersect(land,window,'Visible land'))).toBeCloseTo(geometryAreaMm2(captured),2);
  expect(geometryAreaMm2(intersect(land,circle(10,5,14.9),'Lake'))).toBeLessThan(1e-6);
  // Outside it: the solid rim band, out to the full diameter.
  const band=subtract(circle(0,0,geometry.outerRadiusMm),window,'Rim band');
  expect(geometryAreaMm2(subtract(band,land,'Missing band'))).toBeLessThan(1e-3);
  expect(land).toHaveLength(1);
 });

 it('stays empty when nothing was captured, rather than becoming a bare ring',()=>{
  const {geometry}=build('water-cutout-3-piece');
  expect(extendLandToRim([],geometry,2)).toEqual([]);
  const {pieces}=build('water-cutout-3-piece');
  expect(pieces.pieces.find(item=>item.id==='land')!.cutLocal).toEqual([]);
  expect(pieces.warnings.map(w=>w.code)).toContain('land-piece-empty');
 });

 it('notches the land where a deep loop hole dips into the rim, as it does the frame',()=>{
  const {geometry}=build('water-cutout-3-piece',{hangingLoop:loopWith({overlapMm:6})});
  const captured=subtract(circle(0,0,geometry.innerRadiusMm),circle(0,0,10),'Captured land');
  const land=extendLandToRim(captured,geometry,2);
  const hole=circle(0,geometry.loop.centerY,geometry.loop.innerRadiusMm);
  expect(geometryAreaMm2(intersect(circle(0,0,geometry.outerRadiusMm),hole,'Hole in body'))).toBeGreaterThan(0);
  expect(geometryAreaMm2(intersect(land,hole,'Hole on land'))).toBeLessThan(1e-6);
 });

 it.each(EXTREMES)('reaches the full diameter at %s too',(_label,over)=>{
  const {geometry}=build('water-cutout-3-piece',over);
  const captured=circle(0,0,geometry.innerRadiusMm*.5);
  const land=extendLandToRim(captured,geometry,2);
  const xs=land.flat(2).map(([x])=>x);
  // To 0.05mm: the flattened circle sits within the 0.02mm arc tolerance of the true one.
  expect(Math.max(...xs)-Math.min(...xs)).toBeCloseTo(geometry.outerRadiusMm*2,1);
 });
});
