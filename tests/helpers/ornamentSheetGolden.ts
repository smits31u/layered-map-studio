import {createHash} from 'node:crypto';
import {createDefaultOrnamentProject} from '../../src/ornament/defaults';
import {exportOrnament} from '../../src/ornament/export/exportOrnament';
import {ornamentSvg} from '../../src/ornament/export/svg';
import {buildFeatureGeometry} from '../../src/ornament/geometry/featureGeometry';
import {buildOrnamentGeometry} from '../../src/ornament/geometry/ornamentShape';
import {layoutOrnamentText} from '../../src/ornament/text/ornamentText';
import type {BuildMode,ExportPreset,OrnamentProject} from '../../src/ornament/types';
import {FIXTURE_CENTER,GOLDEN_FIXTURES,type GoldenFixtureName} from '../fixtures/ornament/captures';
import {fixtureCapture} from './ornamentCapture';

// A full export of a golden fixture, shared by the sheet goldens and the tests that read the SVG.
// Date, app version, place label and text are pinned so the bytes depend only on the pipeline.

export const SHEET_GOLDEN_DATE=new Date('2026-09-17T09:30:00.000Z');

export const sheetGoldenProject=(mode:BuildMode,preset:ExportPreset='semantic',over:Partial<OrnamentProject['ornament']>={}):OrnamentProject=>{
 const base=createDefaultOrnamentProject();
 return {
  ...base,
  buildMode:mode,
  exportPreset:preset,
  ornament:{...base.ornament,...over},
  viewport:{...base.viewport,center:[FIXTURE_CENTER[0],FIXTURE_CENTER[1]],selectedPlaceLabel:'Golden fixture',selectedPlaceCenter:[FIXTURE_CENTER[0],FIXTURE_CENTER[1]]},
  text:{
   ...base.text,
   subtitle:{value:'Walworth County',fontId:'inter',sizeMm:3.4,letterSpacingMm:.4},
   title:{value:'Lake Geneva',fontId:'great-vibes',sizeMm:9,letterSpacingMm:0},
   date:{value:'2026',fontId:'inter',sizeMm:3,letterSpacingMm:.3},
  },
 };
};

export function goldenExport(name:GoldenFixtureName,mode:BuildMode,preset:ExportPreset='semantic',over:Partial<OrnamentProject['ornament']>={}){
 const project=sheetGoldenProject(mode,preset,over);
 const geometry=buildOrnamentGeometry(project.ornament);
 const textLayout=layoutOrnamentText(project,geometry);
 const capture=fixtureCapture(GOLDEN_FIXTURES[name](),{detail:'high'});
 const featureGeometry=buildFeatureGeometry({
  revision:1,
  capture,
  settings:{diameterMm:project.ornament.diameterMm,detail:'high',widthScale:1,buildMode:mode,land:project.land},
 });
 const result=exportOrnament({project,geometry,textLayout,featureGeometry,capture,generatedAt:SHEET_GOLDEN_DATE,appVersion:'golden'});
 // Serialised directly rather than read off `result.svg`, so a fixture that preflight blocks still
 // has its bytes pinned: the file that would have been written is the thing under test.
 const svg=ornamentSvg(result.pieces,result.metadata,{preset});
 return {project,geometry,result,svg};
}

export const sha256=(text:string)=>createHash('sha256').update(text,'utf8').digest('hex');
