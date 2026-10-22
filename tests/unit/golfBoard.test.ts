import {strFromU8,unzipSync} from 'fflate';
import {beforeAll,describe,expect,it} from 'vitest';
import {clipLinesToArea} from '../../src/geometry/terrain/contourLines';
import {polylineLengthMm} from '../../src/ornament/geometry/clipLine';
import {coverageKey} from '../../src/golf/coverage';
import {createDefaultGolfProject} from '../../src/golf/defaults';
import {courseSlug,exportGolf} from '../../src/golf/export/exportGolf';
import {runGolfPreflight} from '../../src/golf/export/preflight';
import {buildGolfBoard,locationFromLabel,type GolfBoard} from '../../src/golf/geometry/board';
import {area,circle,intersect} from '../../src/golf/geometry/ops';
import {dilateGeometry} from '../../src/ornament/export/morphology';
import type {GolfProject} from '../../src/golf/types';
import {golfBoardToJob} from '../../src/production/adapters/golfBoard';
import {getLoadedFont} from '../../src/text/fontRegistry';
import {midValleeSnapshot} from '../helpers/golfFixture';

// The board on the recorded Mid Vallee fixture (docs/GOLF_MODULE_PLAN.md §5, §7, §9): the
// exposed-region properties, marks, hole badges, preflight and a byte-stable export.

const snapshot=midValleeSnapshot();
const course={osmType:'way' as const,osmId:29060461,label:'Mid Vallee Golf Course, De Pere, Wisconsin, United States'};
const projectFor=(patch:Partial<GolfProject>={}):GolfProject=>({...createDefaultGolfProject(),course,coverageConfirmedFor:coverageKey(snapshot),...patch});
const stock=()=>3.175;

let board:GolfBoard;
beforeAll(()=>{board=buildGolfBoard({project:projectFor(),snapshot,font:getLoadedFont})},120_000);

describe('golf board: sheets and exposed regions (§5.1)',()=>{
 it('is three whole-board sheets, floor, ground and surface pieces',()=>{
  expect(board.sheets.map(s=>s.role)).toEqual(['floor','ground','surface-pieces']);
  expect(board.widthMm).toBeCloseTo(457.2,6);
  expect(board.heightMm).toBeCloseTo(304.8,6);
  expect(board.sheets[1].pieces.length).toBeGreaterThan(0);
  expect(board.sheets[2].pieces.length).toBeGreaterThan(20);
 });

 it('tiles the board with exposed regions that never overlap',()=>{
  const [e0,e1,e2]=board.sheets.map(s=>s.exposed);
  expect(area(e0)+area(e1)+area(e2)).toBeCloseTo(board.widthMm*board.heightMm,0);
  expect(area(intersect(e0,e1))).toBeLessThan(.05);
  expect(area(intersect(e0,e2))).toBeLessThan(.05);
  expect(area(intersect(e1,e2))).toBeLessThan(.05);
 });

 it('never exposes a region that a higher sheet covers',()=>{
  for(const lower of board.sheets)for(const upper of board.sheets.filter(s=>s.index>lower.index))
   expect(area(intersect(lower.exposed,upper.material))).toBeLessThan(.05);
 });

 it('keeps every mark inside the exposed region of its sheet',()=>{
  for(const sheet of board.sheets)for(const group of sheet.groups.filter(g=>!g.id.startsWith('cut/'))){
   if(group.geometry.length)expect(area(group.geometry)-area(intersect(group.geometry,sheet.exposed))).toBeLessThan(.05+area(group.geometry)*.001);
   if(group.lines.length){
    const total=group.lines.reduce((s,l)=>s+polylineLengthMm(l),0);
    const inside=clipLinesToArea(group.lines,sheet.exposed).reduce((s,l)=>s+polylineLengthMm(l),0);
    expect(total-inside).toBeLessThan(Math.max(.1,total*.01));
   }
  }
 });

 it('puts the water on the floor, where it shows through the ground',()=>{
  expect(board.sheets[0].groups.find(g=>g.id==='engrave/water')?.geometry.length).toBeGreaterThan(0);
  expect(board.sheets[1].groups.find(g=>g.id==='engrave/water')).toBeUndefined();
 });

 it('stops routing short of every green',()=>{
  const greens=board.features.greens;
  for(const sheet of board.sheets){
   const routing=sheet.groups.find(g=>g.id==='score/routing');
   if(!routing)continue;
   const onGreens=clipLinesToArea(routing.lines,greens).reduce((s,l)=>s+polylineLengthMm(l),0);
   expect(onGreens).toBeLessThan(.05);
  }
 });

 it('places hole numbers clear of greens and of each other, each wholly on one sheet',()=>{
  expect(board.holes).toHaveLength(18);
  expect(board.badges.length).toBeGreaterThanOrEqual(16);
  const greens=dilateGeometry(board.features.greens,.4);
  for(const b of board.badges){
   const disc=[circle(b.centerMm[0],b.centerMm[1],b.radiusMm)];
   expect(area(intersect(disc,greens))).toBeLessThan(.01);
   expect(area(intersect(disc,board.sheets[b.sheet].exposed))).toBeGreaterThan(area(disc)*.99);
   for(const other of board.badges.filter(o=>o!==b))expect(Math.hypot(other.centerMm[0]-b.centerMm[0],other.centerMm[1]-b.centerMm[1])).toBeGreaterThanOrEqual(2*b.radiusMm);
  }
  // Every hole either has its number or a warning saying it does not.
  expect(board.badges.length+board.warnings.filter(w=>w.code==='badge-unplaced').length).toBe(18);
 });

 it('tags every piece uniquely, top of the board first',()=>{
  for(const sheet of board.sheets.slice(1)){
   const tags=sheet.pieces.map(p=>p.tag);
   expect(new Set(tags).size).toBe(tags.length);
   expect(tags[0]).toMatch(/^[GS]0*1$/);
  }
 });

 it('keeps the header title on the floor, clear of the course',()=>{
  expect(board.title?.lines.map(l=>l.text)).toEqual(['Mid Vallee Golf Course','De Pere, WI','Par 70']);
  const b=board.title!.box;
  const titleBox=[[[[b.x,b.y],[b.x+b.width,b.y],[b.x+b.width,b.y+b.height],[b.x,b.y+b.height],[b.x,b.y]]]] as [number,number][][][];
  expect(area(intersect(titleBox,board.sheets[1].material))).toBe(0);
 });
});

describe('golf preflight and export (§7)',()=>{
 it('passes preflight once coverage is confirmed, and blocks before',()=>{
  const ok=runGolfPreflight({board,snapshot,project:projectFor()});
  expect(ok.findings.filter(f=>f.severity==='error')).toEqual([]);
  const unconfirmed=runGolfPreflight({board,snapshot,project:projectFor({coverageConfirmedFor:null})});
  expect(unconfirmed.blocked).toBe(true);
  expect(unconfirmed.findings.find(f=>f.severity==='error')?.code).toBe('coverage-unconfirmed');
 },60_000);

 it('writes a byte-identical ZIP of one SVG per sheet plus a manifest',()=>{
  const first=exportGolf({project:projectFor(),snapshot,font:getLoadedFont,stockMm:stock,board});
  const second=exportGolf({project:projectFor(),snapshot,font:getLoadedFont,stockMm:stock,board:buildGolfBoard({project:projectFor(),snapshot,font:getLoadedFont})});
  expect(first.ok).toBe(true);
  expect(Buffer.from(first.zip!).equals(Buffer.from(second.zip!))).toBe(true);
  const files=unzipSync(first.zip!);
  expect(Object.keys(files)).toEqual(['mid-vallee-L0-floor-3.175mm.svg','mid-vallee-L1-ground-3.175mm.svg','mid-vallee-L2-surface-pieces-3.175mm.svg','manifest.json']);
  for(const name of Object.keys(files).filter(n=>n.endsWith('.svg'))){
   const svg=strFromU8(files[name]);
   expect(svg).toContain('width="457.2mm" height="304.8mm"');
   expect(svg).toContain('viewBox="0 0 457.2 304.8"');
   expect(svg).not.toMatch(/NaN|Infinity|<text|transform=/);
  }
  const manifest=JSON.parse(strFromU8(files['manifest.json']));
  expect(manifest.course.osm).toMatchObject({type:'way',id:29060461});
  expect(manifest.snapshot.fetchedAt).toBe(snapshot.fetchedAt);
  expect(manifest.attribution).toMatch(/OpenStreetMap contributors/);
  expect(manifest.stack.map((s:{role:string})=>s.role)).toEqual(['floor','ground','surface-pieces']);
  expect(manifest.pieces.filter((p:{sheet:number})=>p.sheet===2)).toHaveLength(board.sheets[2].pieces.length);
  expect(manifest.par).toBe(70);
 },120_000);

 it('writes no ZIP when preflight blocks',()=>{
  const result=exportGolf({project:projectFor({coverageConfirmedFor:null}),snapshot,font:getLoadedFont,stockMm:stock,board});
  expect(result.ok).toBe(false);
  expect(result.zip).toBeUndefined();
 });

 it('feeds the estimate and 3D preview one piece per sheet',()=>{
  const job=golfBoardToJob(board);
  expect(job.product).toBe('golf-map');
  expect(job.pieces.map(p=>p.id)).toEqual(['golf-L2','golf-L1','golf-L0']);
  expect(job.pieces[0].shapes.filter(s=>s.outline)).toHaveLength(board.sheets[2].pieces.length);
 });
});

describe('golf board options',()=>{
 it('rotates to fit when north-up is off, never at a smaller scale',()=>{
  const turned=buildGolfBoard({project:projectFor({board:{...projectFor().board,northUp:false},marks:{...projectFor().marks,holeNumbers:false}}),snapshot,font:getLoadedFont});
  expect(turned.fit.mmPerMetre).toBeGreaterThanOrEqual(board.fit.mmPerMetre-1e-9);
 },60_000);

 it('puts a corner title on the floor, trimming the course under it if it has to, and still passes preflight',()=>{
  const base=projectFor();
  const p=projectFor({title:{...base.title,layout:'corner',sizeMm:20,show:{...base.title.show,personal:true},text:{...base.title.text,personal:'Our first round together'}}});
  const b=buildGolfBoard({project:p,snapshot,font:getLoadedFont});
  const title=b.sheets[0].groups.find(g=>g.id==='engrave/title');
  expect(title?.glyphs.map(g=>g.name)).toEqual(['name','location','stats','personal']);
  const box=b.title!.box;
  const titleBox=[[[[box.x,box.y],[box.x+box.width,box.y],[box.x+box.width,box.y+box.height],[box.x,box.y+box.height],[box.x,box.y]]]] as [number,number][][][];
  expect(area(intersect(titleBox,b.sheets[1].material))).toBeLessThan(.01);
  const report=runGolfPreflight({board:b,snapshot,project:p});
  expect(report.findings.filter(f=>f.severity==='error')).toEqual([]);
 },60_000);

 it('scores bunkers as outlines when asked, and drops marks set to none',()=>{
  const p=projectFor({marks:{...projectFor().marks,bunkers:'score',tees:'none',holeNumbers:false}});
  const b=buildGolfBoard({project:p,snapshot,font:getLoadedFont});
  const groups=b.sheets.flatMap(s=>s.groups.map(g=>g.id));
  expect(groups).toContain('score/bunkers');
  expect(groups).not.toContain('engrave/bunkers');
  expect(groups.some(g=>g.endsWith('/tees'))).toBe(false);
 },60_000);
});

describe('names',()=>{
 it('slugs a course name the plan\'s way',()=>{
  expect(courseSlug('Mid Vallee Golf Course')).toBe('mid-vallee');
  expect(courseSlug('Brown County Golf Course')).toBe('brown-county');
  expect(courseSlug('Château Country Club')).toBe('chateau');
  expect(courseSlug('Golf Course')).toBe('golf-course');
 });
 it('reads a location from a Photon or a Nominatim label',()=>{
  expect(locationFromLabel('Mid Vallee Golf Course, De Pere, Wisconsin, United States','Mid Vallee Golf Course')).toBe('De Pere, Wisconsin');
  expect(locationFromLabel('Mid Vallee Golf Course, 3850, Mid Valley Drive, De Pere, Brown County, Wisconsin, 54115, United States','Mid Vallee Golf Course')).toBe('De Pere, Wisconsin');
 });
});
