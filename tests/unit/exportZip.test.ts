import {strFromU8,unzipSync} from 'fflate';
import {describe,expect,it} from 'vitest';
import {buildScene} from '../../src/export/buildScene';
import {individualSvgs,individualSvgsZip,individualZipName} from '../../src/export/svg/exportSvg';
import {caldronFallsFeatures,caldronFallsProject} from '../fixtures/caldronFalls';
import type {MapProject} from '../../src/types/project';

const scene=buildScene(caldronFallsProject,caldronFallsFeatures);
const unzip=(bytes:Uint8Array)=>Object.fromEntries(Object.entries(unzipSync(bytes)).map(([name,data])=>[name,strFromU8(data)]));

describe('individual-file export packaging',()=>{
 it('packages every panel into one archive instead of one download per panel',()=>{
  const entries=unzip(individualSvgsZip(scene));
  expect(Object.keys(entries).sort()).toEqual(Object.keys(individualSvgs(scene)).sort());
  expect(Object.keys(entries)).toHaveLength(scene.layers.length);
 });

 it('round-trips each panel byte-for-byte, so zipping never alters manufacturing geometry',()=>{
  const entries=unzip(individualSvgsZip(scene));
  for(const [name,svg] of Object.entries(individualSvgs(scene)))expect(entries[name]).toBe(svg);
 });

 it('produces byte-identical archives for the same scene, so a re-export can be diffed',()=>{
  expect(individualSvgsZip(scene)).toEqual(individualSvgsZip(scene));
 });

 it('names the archive deterministically from the physical panel size',()=>{
  expect(individualZipName(scene)).toBe('layered-map-individual-355.6x279.4mm.zip');
  expect(individualZipName({...scene,widthMm:200,heightMm:150})).toBe('layered-map-individual-200x150mm.zip');
 });

 it('still refuses to package a scene with manufacturing warnings',()=>{
  expect(()=>individualSvgsZip({...scene,manufacturingWarnings:['Layer 3 collapsed at the selected Artistic Depth offset and duplicates the Base geometry.']})).toThrow(/collapsed/);
 });

 it('carries vectorized label geometry into the archive with no live <text> surviving the round trip',()=>{
  const project:MapProject={...caldronFallsProject,title:{...caldronFallsProject.title,text:'CALDRON FALLS'},subtitle:{...caldronFallsProject.subtitle,text:'WISCONSIN'}};
  const entries=unzip(individualSvgsZip(buildScene(project,caldronFallsFeatures)));
  for(const svg of Object.values(entries))expect(new DOMParser().parseFromString(svg,'image/svg+xml').querySelectorAll('text')).toHaveLength(0);
  expect(Object.values(entries).some(svg=>svg.includes('id="title"'))).toBe(true);
 });
});
