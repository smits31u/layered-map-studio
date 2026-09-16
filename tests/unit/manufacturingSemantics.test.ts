import {describe,expect,it} from 'vitest';
import {buildScene} from '../../src/export/buildScene';
import {sceneToSvg,individualSvgs} from '../../src/export/svg/exportSvg';
import {caldronFallsFeatures,caldronFallsProject} from '../fixtures/caldronFalls';
import type {ExtractedFeatures,MapProject} from '../../src/types/project';

// A richer fixture that exercises every new object type at once: named road, place, title,
// subtitle, compass, and road labels all enabled together.
const features:ExtractedFeatures={
 ...caldronFallsFeatures,
 roads:[...caldronFallsFeatures.roads,{id:'named-road',class:'primary',name:'County Road C',coordinates:[{lng:-88.3,lat:45.35},{lng:-88.1,lat:45.36}]}],
};
const project:MapProject={
 ...caldronFallsProject,
 roadLabels:{...caldronFallsProject.roadLabels,visible:true},
 title:{...caldronFallsProject.title,text:'CALDRON FALLS',backer:'rectangle'},
 subtitle:{...caldronFallsProject.subtitle,text:'WISCONSIN'},
};

describe('manufacturing semantics for labels, title, subtitle, and compass',()=>{
 const scene=buildScene(project,features);
 const land=scene.layers.find(l=>l.id==='layer-land')!;
 const others=scene.layers.filter(l=>l.id!=='layer-land');

 it('renders place labels, road labels, title, subtitle, and compass into scene.objects (Land only)',()=>{
  const ids=scene.objects.map(o=>o.objectId);
  expect(ids).toContain('compass');
  expect(ids).toContain('title');
  expect(ids.some(id=>id?.startsWith('place-'))).toBe(true);
  expect(ids.some(id=>id?.startsWith('road-label-'))).toBe(true);
 });

 it('every scene.objects entry is engrave or cut, never bled into intermediate/Base layers',()=>{
  for(const layer of others)expect(layer.shapes.every(s=>s.operation==='cut')).toBe(true);
 });

 it('the exported SVG places all label/title/compass groups only inside layer-land',()=>{
  const svg=sceneToSvg(scene,'registered');
  const doc=new DOMParser().parseFromString(svg,'image/svg+xml');
  for(const group of ['place-labels','road-labels','title','compass']){
   const matches=doc.querySelectorAll(`#${group}`);
   expect(matches.length,`#${group}`).toBeGreaterThan(0);
   for(const match of matches)expect(match.closest('[id^="layer-"]')?.id.startsWith('layer-land')).toBe(true);
  }
 });

 it('exported manufacturing SVG contains no live <text> elements — everything is vector paths',()=>{
  const svg=sceneToSvg(scene,'production');
  expect(svg).not.toContain('<text');
  for(const individual of Object.values(individualSvgs(scene)))expect(individual).not.toContain('<text');
 });

 // The string check above catches a literal "<text" regression; this parses instead, so a <text>
 // node arriving by any other spelling (namespaced, whitespace in the tag) still fails the build.
 it('parses every export layout and finds zero text nodes in the DOM',()=>{
  const documents=[sceneToSvg(scene,'production'),sceneToSvg(scene,'registered'),...Object.values(individualSvgs(scene))];
  for(const svg of documents){
   const doc=new DOMParser().parseFromString(svg,'image/svg+xml');
   expect(doc.querySelector('parsererror')).toBeNull();
   expect(doc.querySelectorAll('text')).toHaveLength(0);
   expect(doc.getElementsByTagNameNS('http://www.w3.org/2000/svg','text')).toHaveLength(0);
  }
 });

 // Every glyph must close its contours or the cutter has an open path to chase. A letter can
 // contribute more than one closed contour (the counter inside an A or O), never fewer than one.
 it('vectorizes each title character into at least one closed contour',()=>{
  const title=scene.objects.find(o=>o.id==='title-text')!;
  const letters=[...'CALDRON FALLS'].filter(c=>c!==' ').length;
  expect(title.d).toBeDefined();
  expect((title.d!.match(/Z/gi)??[]).length).toBeGreaterThanOrEqual(letters);
  expect(title.d!.trimStart().startsWith('M')).toBe(true);
 });

 it('every label/title/compass path is valid finite path data with no NaN/Infinity',()=>{
  for(const shape of scene.objects){
   expect(shape.d).toBeDefined();
   expect(shape.d).not.toMatch(/NaN|Infinity/);
  }
 });

 it('exact physical panel dimensions are preserved',()=>{
  expect(scene.widthMm).toBe(355.6);
  expect(scene.heightMm).toBe(279.4);
 });

 it('reports label counts via labelMetrics rather than silently dropping objects',()=>{
  expect(scene.labelMetrics).toBeDefined();
  expect(scene.labelMetrics!.placeLabels).toBeGreaterThan(0);
  expect(scene.labelMetrics!.roadLabels).toBeGreaterThan(0);
 });
});

describe('title backer manufacturing geometry',()=>{
 it('emits a title-backer cut shape scoped to the title text bounds when backer mode is not none',()=>{
  const scene=buildScene(project,features);
  const backer=scene.objects.find(o=>o.id==='title-backer-panel');
  expect(backer).toBeDefined();
  expect(backer!.operation).toBe('cut');
  expect(backer!.transform).toBe(scene.objects.find(o=>o.id==='title-text')!.transform);
 });

 it('emits no backer shape when backer mode is none',()=>{
  const noBacker:MapProject={...project,title:{...project.title,backer:'none'}};
  const scene=buildScene(noBacker,features);
  expect(scene.objects.find(o=>o.id==='title-backer-panel')).toBeUndefined();
 });
});
