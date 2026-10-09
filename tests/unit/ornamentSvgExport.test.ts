import {describe,expect,it,vi} from 'vitest';
import {createDefaultOrnamentProject} from '../../src/ornament/defaults';
import {buildFeatureGeometry,type FeatureGeometryResult} from '../../src/ornament/geometry/featureGeometry';
import {buildOrnamentGeometry} from '../../src/ornament/geometry/ornamentShape';
import {BLOB_REVOKE_DELAY_MS,DOWNLOAD_STAGGER_MS,downloadFiles,PROJECT_MIME,SVG_MIME,type DownloadHost} from '../../src/ornament/export/download';
import {exportFileNames,exportOrnament} from '../../src/ornament/export/exportOrnament';
import {CUT_STROKE_MM} from '../../src/ornament/export/lightburn';
import {METADATA_NAMESPACE} from '../../src/ornament/export/metadata';
import {ORNAMENT_GROUP_ORDER} from '../../src/ornament/export/pieces';
import {layoutOrnamentText} from '../../src/ornament/text/ornamentText';
import type {BuildMode,OrnamentProject} from '../../src/ornament/types';
import {FIXTURE_CENTER,GOLDEN_FIXTURES,type GoldenFixtureName} from '../fixtures/ornament/captures';
import {fixtureCapture} from '../helpers/ornamentCapture';

// The file itself: what is in it, that it is in millimetres, and that the same design produces the
// same bytes twice.

const FIXED_DATE=new Date('2026-09-17T09:30:00.000Z');

const makeProject=(over:Partial<OrnamentProject>={}):OrnamentProject=>{
 const base=createDefaultOrnamentProject();
 return {
  ...base,
  ...over,
  viewport:{...base.viewport,center:[FIXTURE_CENTER[0],FIXTURE_CENTER[1]],selectedPlaceLabel:'Lake Geneva, WI',selectedPlaceCenter:[FIXTURE_CENTER[0],FIXTURE_CENTER[1]],...over.viewport},
  text:{
   ...base.text,
   subtitle:{value:'Walworth County',fontId:'inter',sizeMm:3.4,letterSpacingMm:.4},
   title:{value:'Lake Geneva',fontId:'great-vibes',sizeMm:9,letterSpacingMm:0},
   date:{value:'2026',fontId:'inter',sizeMm:3,letterSpacingMm:.3},
   ...over.text,
  },
 };
};

function runExport(mode:BuildMode,fixture:GoldenFixtureName='lake',over:Partial<OrnamentProject>={}){
 const project=makeProject({buildMode:mode,...over});
 const geometry=buildOrnamentGeometry(project.ornament);
 const textLayout=layoutOrnamentText(project,geometry);
 const capture=fixtureCapture(GOLDEN_FIXTURES[fixture](),{detail:'high'});
 const featureGeometry:FeatureGeometryResult=buildFeatureGeometry({
  revision:1,
  capture,
  settings:{
   diameterMm:project.ornament.diameterMm,
   detail:'high',
   widthScale:1,
   buildMode:mode,
   land:project.land,
  },
 });
 return exportOrnament({project,geometry,textLayout,featureGeometry,capture,generatedAt:FIXED_DATE});
}

const groupIdsIn=(svg:string):string[]=>[...svg.matchAll(/<g id="([^"]+)"/g)].map(match=>match[1]);
const attribute=(svg:string,name:string):string|undefined=>new RegExp(`${name}="([^"]*)"`).exec(svg)?.[1];

describe('ornament SVG export',()=>{
 it('exports the classic two-piece mode from real captured geometry',()=>{
  const result=runExport('classic-2-piece');
  expect(result.ok).toBe(true);
  expect(result.preflight.blocked).toBe(false);
  expect(result.svg).toBeDefined();

  const ids=groupIdsIn(result.svg!);
  expect(ids).toContain('piece/base/cut');
  expect(ids).toContain('piece/base/water-light-engrave');
  expect(ids).toContain('piece/land/roads-engrave');
  expect(ids).toContain('piece/frame/cut');
  expect(ids).toContain('piece/frame/text-engrave');
  expect(ids).not.toContain('piece/land/cut');
 });

 it('exports the water-cutout three-piece mode from real captured geometry',()=>{
  const result=runExport('water-cutout-3-piece');
  expect(result.ok).toBe(true);

  const ids=groupIdsIn(result.svg!);
  expect(ids).toContain('piece/land/cut');
  expect(ids).not.toContain('piece/base/water-light-engrave');
  expect(result.pieces.pieces.map(piece=>piece.id)).toEqual(['base','land','frame']);
 });

 it('emits the groups in the contract order',()=>{
  const ids=groupIdsIn(runExport('water-cutout-3-piece').svg!);
  const expected=ORNAMENT_GROUP_ORDER.filter(id=>id!=='piece/base/water-light-engrave');
  expect(ids).toEqual([...expected]);
 });

 it('is a millimetre document whose viewBox matches its physical size',()=>{
  const result=runExport('classic-2-piece');
  const svg=result.svg!;
  const width=attribute(svg,'width')!;
  const height=attribute(svg,'height')!;
  const viewBox=attribute(svg,'viewBox')!;

  expect(width).toMatch(/mm$/);
  expect(height).toMatch(/mm$/);
  expect(viewBox).toBe(`0 0 ${width.replace('mm','')} ${height.replace('mm','')}`);
  expect(attribute(svg,'data-units')).toBe('mm');
  expect(Number(width.replace('mm',''))).toBeCloseTo(result.pieces.sheet.widthMm,3);
 });

 it('cuts the finished ornament to the specified diameter within a tenth of a millimetre',()=>{
  const reference=createDefaultOrnamentProject();
  for(const diameterMm of [50,76.2,101.6,150]){
   // Everything else scales with the ornament. A 50mm disk with 101.6mm text would fail preflight on
   // text overflow, which is the text check doing its job rather than anything to do with diameter.
   const k=diameterMm/reference.ornament.diameterMm;
   const scale=(line:typeof reference.text.title)=>({...line,sizeMm:Number((line.sizeMm*k).toFixed(2))});
   const result=runExport('classic-2-piece','lake',{
    ornament:{
     ...reference.ornament,
     diameterMm,
     rimWidthMm:Number((reference.ornament.rimWidthMm*k).toFixed(2)),
     mapToTextBoundaryMm:Number((reference.ornament.mapToTextBoundaryMm*k).toFixed(2)),
     hangingLoop:{
      outerDiameterMm:Number((reference.ornament.hangingLoop.outerDiameterMm*k).toFixed(2)),
      innerDiameterMm:Number((reference.ornament.hangingLoop.innerDiameterMm*k).toFixed(2)),
      overlapMm:Number((reference.ornament.hangingLoop.overlapMm*k).toFixed(2)),
      minNeckWidthMm:Number((reference.ornament.hangingLoop.minNeckWidthMm*k).toFixed(2)),
     },
    },
    text:{
     subtitle:scale({value:'Walworth County',fontId:'inter',sizeMm:3.4,letterSpacingMm:.4}),
     title:scale({value:'Lake Geneva',fontId:'great-vibes',sizeMm:9,letterSpacingMm:0}),
     date:scale({value:'2026',fontId:'inter',sizeMm:3,letterSpacingMm:.3}),
     gap12Mm:Number((2*k).toFixed(2)),
     gap23Mm:Number((2*k).toFixed(2)),
    },
   });
   const blocking=result.preflight.findings.filter(item=>item.severity==='error');
   expect(blocking,`${diameterMm}mm: ${blocking.map(item=>item.message).join(' | ')}`).toHaveLength(0);
   expect(result.ok).toBe(true);
   expect(Math.abs(result.pieces.finishedDiameterMm-diameterMm)).toBeLessThanOrEqual(.1);
   expect(Number(attribute(result.svg!,'data-finished-diameter-mm'))).toBeCloseTo(diameterMm,1);
  }
 });

 it('closes every cut path in the emitted file',()=>{
  const svg=runExport('water-cutout-3-piece').svg!;
  for(const [,body] of svg.matchAll(/<g id="[^"]*\/cut"[^>]*>(.*?)<\/g>/gs))
   for(const [,d] of body.matchAll(/ d="([^"]+)"/g)){
    expect(d).toMatch(/Z\s*$/);
    // Every subpath, not only the last one.
    expect(d.split(/(?=M)/).filter(Boolean).every(sub=>/Z\s*$/.test(sub.trim()))).toBe(true);
   }
 });

 it('contains no live text and no transforms',()=>{
  const svg=runExport('classic-2-piece').svg!;
  expect(svg).not.toMatch(/<text[\s>]/);
  expect(svg).not.toMatch(/font-family/);
  expect(svg).not.toMatch(/transform=/);
 });

 it('rounds every coordinate to three decimals',()=>{
  const svg=runExport('water-cutout-3-piece').svg!;
  for(const [,d] of svg.matchAll(/ d="([^"]+)"/g))
   for(const number of d.match(/-?\d+\.\d+/g)??[])
    expect(number.split('.')[1].length).toBeLessThanOrEqual(3);
  expect(svg).not.toContain('-0 ');
 });

 it('produces byte-identical output for the same design',()=>{
  expect(runExport('water-cutout-3-piece').svg).toBe(runExport('water-cutout-3-piece').svg);
  expect(runExport('classic-2-piece','coast').svg).toBe(runExport('classic-2-piece','coast').svg);
 });

 it('records the metadata the file has to carry on its own',()=>{
  const result=runExport('classic-2-piece');
  const svg=result.svg!;
  expect(svg).toContain(METADATA_NAMESPACE);
  expect(svg).toContain('<lms:app-version>');
  expect(svg).toContain('<lms:project-schema>1</lms:project-schema>');
  expect(svg).toContain('<lms:build-mode>classic-2-piece</lms:build-mode>');
  expect(svg).toContain(`<lms:generated-at>${FIXED_DATE.toISOString()}</lms:generated-at>`);
  expect(svg).toContain('OpenStreetMap contributors');
  expect(svg).toContain('<lms:viewport ');
  expect(svg).toContain('<lms:dimensions ');
  expect(svg).toContain('<lms:capture ');
  expect(svg).toContain('<![CDATA[');

  expect(result.metadata.projectSchemaVersion).toBe(1);
  expect(result.metadata.providers[0].attribution).toContain('OpenStreetMap');
  expect(result.metadata.dimensions.specifiedDiameterMm).toBe(101.6);
 });

 it('escapes a place name that would otherwise break the XML',()=>{
  const result=runExport('classic-2-piece','lake',{
   viewport:{...createDefaultOrnamentProject().viewport,selectedPlaceLabel:'Bob & "Sue" <Lake>',selectedPlaceCenter:[-88.4,42.6]},
  });
  expect(result.svg).toContain('place="Bob &amp; &quot;Sue&quot; &lt;Lake&gt;"');
  expect(result.svg).toContain('<title>Ornament · Bob &amp; &quot;Sue&quot; &lt;Lake&gt;');
  // The only place the raw name may appear is inside the CDATA block, where it is character data
  // rather than markup.
  const outsideCdata=result.svg!.replace(/<!\[CDATA\[.*?\]\]>/gs,'');
  expect(outsideCdata).not.toContain('<Lake>');
 });

 it('carries the project itself, so the SVG alone can be reloaded',()=>{
  const result=runExport('classic-2-piece');
  const embedded=/<lms:project><!\[CDATA\[(.*?)\]\]><\/lms:project>/s.exec(result.svg!)?.[1];
  expect(embedded).toBeDefined();
  const parsed=JSON.parse(embedded!) as OrnamentProject;
  expect(parsed.schemaVersion).toBe(1);
  expect(parsed.ornament.diameterMm).toBe(101.6);
  expect(parsed.text.title.value).toBe('Lake Geneva');
 });

 it('colours cut red and engraving black under the LightBurn preset',()=>{
  const svg=runExport('classic-2-piece','lake',{exportPreset:'lightburn-colors'}).svg!;
  const cut=/<g id="piece\/frame\/cut"([^>]*)>/.exec(svg)?.[1]??'';
  const engrave=/<g id="piece\/land\/roads-engrave"([^>]*)>/.exec(svg)?.[1]??'';
  const water=/<g id="piece\/base\/water-light-engrave"([^>]*)>/.exec(svg)?.[1]??'';

  expect(cut).toContain('stroke="#FF0000"');
  expect(cut).toContain('fill="none"');
  expect(cut).toContain(`stroke-width="${CUT_STROKE_MM}"`);
  expect(engrave).toContain('fill="#000000"');
  expect(water).toContain('fill="#0000FF"');
 });

 it('keeps the group ids identical under either preset, because they are the contract',()=>{
  const semantic=groupIdsIn(runExport('classic-2-piece','lake',{exportPreset:'semantic'}).svg!);
  const lightburn=groupIdsIn(runExport('classic-2-piece','lake',{exportPreset:'lightburn-colors'}).svg!);
  expect(lightburn).toEqual(semantic);
 });

 it('marks registration and label groups as non-production',()=>{
  const svg=runExport('classic-2-piece').svg!;
  expect(/<g id="registration\/optional"[^>]*data-production="false"/.test(svg)).toBe(true);
  expect(/<g id="labels\/non-production"[^>]*data-production="false"/.test(svg)).toBe(true);
  expect(/<g id="piece\/frame\/cut"[^>]*data-production="true"/.test(svg)).toBe(true);
 });

 // The generator emits nothing marker-related at all any more: no group, no piece, no path, and no
 // trace of the keep-out that briefly reserved space for one.
 it('emits nothing marker-related in either mode',()=>{
  for(const mode of ['classic-2-piece','water-cutout-3-piece'] as BuildMode[]){
   const svg=runExport(mode).svg!;
   expect(svg).not.toContain('marker');
   expect(svg).not.toContain('Marker');
   expect(svg.toLowerCase()).not.toContain('keepout');
   expect(svg.toLowerCase()).not.toContain('keep-out');
   expect(svg).not.toContain('heart');
  }
 });

 it('names the files after the place, the size and the mode',()=>{
  expect(exportFileNames(makeProject({buildMode:'classic-2-piece'}))).toEqual({
   svg:'ornament-lake-geneva-wi-101.6mm-2piece.svg',
   project:'ornament-lake-geneva-wi-101.6mm-2piece.json',
  });
  expect(exportFileNames(makeProject({buildMode:'water-cutout-3-piece'})).svg).toContain('3piece');
 });

 it('emits project JSON that loads back as a project',()=>{
  const result=runExport('classic-2-piece');
  const parsed=JSON.parse(result.projectJson) as OrnamentProject;
  expect(parsed.schemaVersion).toBe(1);
  expect(parsed.buildMode).toBe('classic-2-piece');
  expect(result.projectJson.endsWith('\n')).toBe(true);
 });

 // Two anchor clicks in one task give one download in Chromium and Safari: the second cancels the
 // first, so "Export SVG" used to save only the .json. The SVG must be clicked synchronously, inside
 // the user's gesture, and the project file must wait for a later task.
 it('hands the browser the SVG at once and the project file in a later task',()=>{
  const written:string[]=[];
  const revoked:string[]=[];
  const queue:{run:()=>void;at:number}[]=[];
  let created=0;
  const host:DownloadHost={
   createObjectURL:()=>`blob:${created++}`,
   revokeObjectURL:url=>{revoked.push(url)},
   createAnchor:()=>({href:'',download:'',rel:'',click(){written.push(this.download)}}),
   schedule:(run,ms)=>{queue.push({run,at:ms})},
  };
  const result=runExport('classic-2-piece');
  const ok=downloadFiles([
   {name:result.fileNames.svg,content:result.svg!,type:SVG_MIME},
   {name:result.fileNames.project,content:result.projectJson,type:PROJECT_MIME},
  ],host);

  expect(ok).toBe(true);
  // Synchronously: the SVG and nothing else.
  expect(written).toEqual([result.fileNames.svg]);
  // The project file is queued at the stagger, the SVG's URL is freed long after its click.
  expect(queue.map(item=>item.at).sort((a,b)=>a-b)).toEqual([DOWNLOAD_STAGGER_MS,BLOB_REVOKE_DELAY_MS]);
  expect(revoked).toEqual([]);

  queue.splice(queue.findIndex(item=>item.at===DOWNLOAD_STAGGER_MS),1)[0].run();
  expect(written).toEqual([result.fileNames.svg,result.fileNames.project]);

  for(const item of queue.splice(0))item.run();
  expect(revoked.sort()).toEqual(['blob:0','blob:1']);
 });

 it('falls back to real timers when the host cannot schedule, still clicking the first file at once',()=>{
  vi.useFakeTimers();
  try{
   const written:string[]=[];
   const host:DownloadHost={
    createObjectURL:()=>'blob:x',
    revokeObjectURL:()=>{},
    createAnchor:()=>({href:'',download:'',rel:'',click(){written.push(this.download)}}),
   };
   downloadFiles([{name:'a.svg',content:'x',type:SVG_MIME},{name:'a.json',content:'{}',type:PROJECT_MIME}],host);
   expect(written).toEqual(['a.svg']);
   vi.advanceTimersByTime(DOWNLOAD_STAGGER_MS);
   expect(written).toEqual(['a.svg','a.json']);
  }finally{
   vi.useRealTimers();
  }
 });

 it('reports rather than throws when a download host is unavailable',()=>{
  expect(downloadFiles([{name:'a.svg',content:'x',type:SVG_MIME}],null)).toBe(false);
  expect(downloadFiles([],null)).toBe(false);
 });

 it('blocks and writes nothing when the frame geometry is poisoned with NaN',()=>{
  const project=makeProject();
  const geometry=buildOrnamentGeometry(project.ornament);
  const poisoned={...geometry,frame:geometry.frame.map(polygon=>polygon.map(ring=>ring.map(([x,y],index)=>index===3?[Number.NaN,y] as [number,number]:[x,y] as [number,number])))};
  const result=exportOrnament({project,geometry:poisoned,textLayout:layoutOrnamentText(project,geometry),generatedAt:FIXED_DATE});

  expect(result.ok).toBe(false);
  expect(result.svg).toBeUndefined();
  const codes=result.preflight.findings.map(item=>item.code);
  expect(codes).toContain('geometry-non-finite');
  // And the neck is reported as unmeasured rather than quietly passing.
  expect(codes).toContain('neck-unmeasurable');
  expect(result.preflight.neck.meetsMinimum).toBe(false);
 });

 it('exports every golden fixture in both modes without blocking',()=>{
  for(const fixture of ['city','coast','lake','rural'] as GoldenFixtureName[])
   for(const mode of ['classic-2-piece','water-cutout-3-piece'] as BuildMode[]){
    const result=runExport(mode,fixture);
    const errors=result.preflight.findings.filter(item=>item.severity==='error');
    expect(errors,`${fixture}/${mode}: ${errors.map(item=>item.message).join(' | ')}`).toHaveLength(0);
    expect(result.svg).toBeDefined();
   }
 });
});
