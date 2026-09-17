import {describe,expect,it} from 'vitest';
import {createDefaultOrnamentProject} from '../../src/ornament/defaults';
import {buildFeatureGeometry} from '../../src/ornament/geometry/featureGeometry';
import {buildOrnamentGeometry} from '../../src/ornament/geometry/ornamentShape';
import {ORNAMENT_GROUP_ORDER,buildOrnamentPieces,geometryBounds,registrationDots} from '../../src/ornament/export/pieces';
import {layoutOrnamentText} from '../../src/ornament/text/ornamentText';
import type {BuildMode,OrnamentProject} from '../../src/ornament/types';
import {GOLDEN_FIXTURES} from '../fixtures/ornament/captures';
import {fixtureCapture} from '../helpers/ornamentCapture';

// The nine semantic groups, which pieces they belong to, and where those pieces land on the sheet.

const projectWith=(over:Partial<OrnamentProject>={}):OrnamentProject=>({
 ...createDefaultOrnamentProject(),
 ...over,
 viewport:{...createDefaultOrnamentProject().viewport,selectedPlaceLabel:'Lake Geneva, WI',...over.viewport},
});

const buildFor=(mode:BuildMode,withMap=true)=>{
 const project=projectWith({buildMode:mode});
 const geometry=buildOrnamentGeometry(project.ornament);
 const textLayout=layoutOrnamentText(project,geometry);
 const featureGeometry=withMap
  ?buildFeatureGeometry({
    revision:1,
    capture:fixtureCapture(GOLDEN_FIXTURES.lake(),{detail:'high'}),
    settings:{
     diameterMm:project.ornament.diameterMm,
     detail:'high',
     widthScale:1,
     buildMode:mode,
     land:project.land,
    },
   })
  :undefined;
 return {project,geometry,textLayout,featureGeometry,pieces:buildOrnamentPieces({project,geometry,textLayout,featureGeometry})};
};

describe('ornament pieces and semantic groups',()=>{
 it('names the nine groups from the export contract, in order',()=>{
  expect([...ORNAMENT_GROUP_ORDER]).toEqual([
   'piece/base/cut',
   'piece/base/water-light-engrave',
   'piece/land/cut',
   'piece/land/roads-engrave',
   'piece/frame/cut',
   'piece/frame/text-engrave',
   'registration/optional',
   'labels/non-production',
  ]);
 });

 it('emits every group, and marks the classic-only one applicable in classic mode',()=>{
  const {pieces}=buildFor('classic-2-piece');
  expect(pieces.groups.map(group=>group.id)).toEqual([...ORNAMENT_GROUP_ORDER]);

  const applicable=pieces.groups.filter(group=>group.applicable).map(group=>group.id);
  expect(applicable).toContain('piece/base/water-light-engrave');
  expect(applicable).not.toContain('piece/land/cut');
 });

 it('marks the three-piece-only group applicable in water-cutout mode and drops the water shading',()=>{
  const {pieces}=buildFor('water-cutout-3-piece');
  const applicable=pieces.groups.filter(group=>group.applicable).map(group=>group.id);
  expect(applicable).toContain('piece/land/cut');
  expect(applicable).not.toContain('piece/base/water-light-engrave');
 });

 it('lays out two pieces in classic mode and three in water-cutout mode',()=>{
  expect(buildFor('classic-2-piece').pieces.pieces.map(piece=>piece.id)).toEqual(['base','frame']);
  expect(buildFor('water-cutout-3-piece').pieces.pieces.map(piece=>piece.id)).toEqual(['base','land','frame']);
 });

 it('puts roads on the base piece in classic mode and on the land piece in water-cutout mode',()=>{
  const classic=buildFor('classic-2-piece').pieces.groups.find(group=>group.id==='piece/land/roads-engrave');
  const cutout=buildFor('water-cutout-3-piece').pieces.groups.find(group=>group.id==='piece/land/roads-engrave');
  expect(classic?.piece).toBe('base');
  expect(cutout?.piece).toBe('land');
 });

 it('cuts the base piece at the full ornament diameter',()=>{
  const {project,pieces}=buildFor('classic-2-piece');
  expect(pieces.finishedDiameterMm).toBeGreaterThan(project.ornament.diameterMm-.1);
  expect(pieces.finishedDiameterMm).toBeLessThan(project.ornament.diameterMm+.1);
 });

 it('places pieces side by side without overlapping',()=>{
  const {pieces}=buildFor('water-cutout-3-piece');
  const spans=pieces.pieces.map(piece=>({
   left:piece.offsetMm[0]+piece.localBounds.minX,
   right:piece.offsetMm[0]+piece.localBounds.maxX,
  }));
  for(let index=1;index<spans.length;index++)
   expect(spans[index].left).toBeGreaterThanOrEqual(spans[index-1].right);
 });

 it('keeps every piece on the same origin line, so pieces that stack are drawn in register',()=>{
  const {pieces}=buildFor('water-cutout-3-piece');
  const originY=pieces.pieces.map(piece=>piece.offsetMm[1]);
  expect(new Set(originY.map(value=>value.toFixed(6))).size).toBe(1);
 });

 it('fits every piece inside the sheet it reports',()=>{
  const {pieces}=buildFor('water-cutout-3-piece');
  for(const group of pieces.groups){
   const bounds=geometryBounds(group.geometry);
   if(!bounds)continue;
   expect(bounds.minX).toBeGreaterThanOrEqual(0);
   expect(bounds.minY).toBeGreaterThanOrEqual(0);
   expect(bounds.maxX).toBeLessThanOrEqual(pieces.sheet.widthMm);
   expect(bounds.maxY).toBeLessThanOrEqual(pieces.sheet.heightMm);
  }
 });

 it('puts registration marks on the stacking pieces and never on the frame',()=>{
  const {pieces}=buildFor('water-cutout-3-piece');
  const registration=pieces.groups.find(group=>group.id==='registration/optional');
  expect(registration?.piece).not.toBe('frame');
  expect(registration?.production).toBe(false);
  // Four dots per stacking piece, and in water-cutout mode there are two such pieces.
  expect(registration?.geometry.length).toBe(8);
 });

 it('builds four registration dots at the structural ring radius',()=>{
  const project=createDefaultOrnamentProject();
  const geometry=buildOrnamentGeometry(project.ornament);
  const dots=registrationDots(geometry,project.land.structuralRingWidthMm);
  expect(dots).toHaveLength(4);
  for(const dot of dots){
   const bounds=geometryBounds([dot])!;
   const radius=Math.hypot((bounds.minX+bounds.maxX)/2,(bounds.minY+bounds.maxY)/2);
   expect(radius).toBeCloseTo(geometry.innerRadiusMm-project.land.structuralRingWidthMm/2,2);
  }
 });

 it('marks labels as non-production',()=>{
  const {pieces}=buildFor('classic-2-piece');
  const labels=pieces.groups.find(group=>group.id==='labels/non-production');
  expect(labels?.production).toBe(false);
  expect(labels?.operation).toBe('annotation');
  expect(labels?.paths.length).toBe(2);
 });

 it('converts the personalisation text to path data rather than leaving live text',()=>{
  const project=projectWith({
   text:{...createDefaultOrnamentProject().text,title:{value:'Geneva',fontId:'great-vibes',sizeMm:9,letterSpacingMm:0}},
  });
  const geometry=buildOrnamentGeometry(project.ornament);
  const textLayout=layoutOrnamentText(project,geometry);
  const pieces=buildOrnamentPieces({project,geometry,textLayout});
  const text=pieces.groups.find(group=>group.id==='piece/frame/text-engrave');
  expect(text?.paths.length).toBe(1);
  expect(text?.paths[0]).toMatch(/^M /);
  expect(text?.paths[0]).toMatch(/Z\s*$/);
 });

 // The generator produces no marker at all: no piece, no group, no warnings about one.
 it('produces no marker piece and no marker group',()=>{
  for(const mode of ['classic-2-piece','water-cutout-3-piece'] as BuildMode[]){
   const {pieces}=buildFor(mode);
   expect(pieces.pieces.map(piece=>piece.id)).not.toContain('marker');
   expect(pieces.groups.map(group=>String(group.id))).not.toContain('piece/marker/cut-or-engrave');
   for(const code of pieces.warnings.map(warning=>warning.code))expect(code.startsWith('marker')).toBe(false);
  }
 });

 it('warns when water-cutout mode has no land geometry to cut',()=>{
  const {pieces}=buildFor('water-cutout-3-piece',false);
  expect(pieces.warnings.map(warning=>warning.code)).toContain('land-piece-empty');
 });

 it('produces the same pieces twice from the same input',()=>{
  const first=buildFor('water-cutout-3-piece').pieces;
  const second=buildFor('water-cutout-3-piece').pieces;
  expect(JSON.stringify(second.groups)).toBe(JSON.stringify(first.groups));
  expect(second.sheet).toEqual(first.sheet);
 });
});
