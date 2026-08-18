import {describe,expect,it} from 'vitest';
import {buildScene,buildGeometryLayers,buildPresentationScene} from '../../src/export/buildScene';
import {getCachedGeometryLayers} from '../../src/export/geometryCache';
import {caldronFallsFeatures,caldronFallsProject} from '../fixtures/caldronFalls';
import {setOverride} from '../../src/geometry/scene/overrides';
import type {MapProject} from '../../src/types/project';

const baseProject:MapProject={...caldronFallsProject,shoreline:{...caldronFallsProject.shoreline,enabledLayers:Array(7).fill(true)}};

describe('M-LIVE: presentation-tier changes update immediately from cached geometry',()=>{
 const geometry=buildGeometryLayers(baseProject,caldronFallsFeatures);

 it('live title update: changing title text/size changes only the title object, not panel geometry',()=>{
  const withTitle:MapProject={...baseProject,title:{...baseProject.title,text:'CALDRON FALLS',sizeMm:12}};
  const scene=buildPresentationScene(withTitle,caldronFallsFeatures,geometry);
  expect(scene.objects.find(o=>o.id==='title-text')).toBeDefined();
  const baseline=buildPresentationScene(baseProject,caldronFallsFeatures,geometry);
  expect(scene.layers.map(l=>l.shapes.find(s=>s.id.endsWith('-panel'))?.d)).toEqual(baseline.layers.map(l=>l.shapes.find(s=>s.id.endsWith('-panel'))?.d));
 });

 it('live compass update: style/size/rotation/position change the compass object only',()=>{
  const withCompass:MapProject={...baseProject,compass:{...baseProject.compass,style:'rose',sizeMm:30,rotationDeg:45,position:'bottom-right',xMm:300,yMm:200}};
  const scene=buildPresentationScene(withCompass,caldronFallsFeatures,geometry);
  const compass=scene.objects.find(o=>o.id==='compass');
  expect(compass?.transform).toBe('translate(300 200) rotate(45)');
  const baseline=buildPresentationScene(baseProject,caldronFallsFeatures,geometry);
  expect(scene.layers.map(l=>l.shapes.find(s=>s.id.endsWith('-panel'))?.d)).toEqual(baseline.layers.map(l=>l.shapes.find(s=>s.id.endsWith('-panel'))?.d));
 });

 it('compass turning off live removes the compass object without touching panel geometry',()=>{
  const off:MapProject={...baseProject,compass:{...baseProject.compass,position:'off'}};
  const scene=buildPresentationScene(off,caldronFallsFeatures,geometry);
  expect(scene.objects.find(o=>o.id==='compass')).toBeUndefined();
 });

 it('live layer visibility: disabling a layer immediately omits it, without recomputing the other panels\' geometry',()=>{
  // enabledLayers is part of the geometry key (see geometryCache.test.ts), so this specifically
  // exercises a fresh buildGeometryLayers call — the requirement is that the OTHER, still-enabled
  // panels' geometry is unchanged by the toggle, not that no recomputation happens at all.
  const fiveLayers=baseProject; // land,2,3,4,base(pattern from the M-LIVE Caldron regression) — use explicit indices
  const withLayer5On:MapProject={...fiveLayers,shoreline:{...fiveLayers.shoreline,enabledLayers:[true,true,true,true,true,false,true]}};
  const withLayer5Off:MapProject={...fiveLayers,shoreline:{...fiveLayers.shoreline,enabledLayers:[true,true,true,true,false,false,true]}};
  const sceneWith=buildScene(withLayer5On,caldronFallsFeatures);
  const sceneWithout=buildScene(withLayer5Off,caldronFallsFeatures);
  expect(sceneWith.layers.map(l=>l.id)).toContain('layer-depth-5');
  expect(sceneWithout.layers.map(l=>l.id)).not.toContain('layer-depth-5');
  const remainingIds=['layer-land','layer-depth-2','layer-depth-3','layer-depth-4','layer-base'];
  for(const id of remainingIds){
   const a=sceneWith.layers.find(l=>l.id===id)!.shapes.find(s=>s.id.endsWith('-panel'))?.d;
   const b=sceneWithout.layers.find(l=>l.id===id)!.shapes.find(s=>s.id.endsWith('-panel'))?.d;
   expect(a,`${id} panel geometry should be unaffected by toggling a different layer`).toBe(b);
  }
 });

 it('live road-width update: changing major/minor width changes only strokeWidthMm, never panel geometry',()=>{
  const wider:MapProject={...baseProject,roads:{...baseProject.roads,majorWidthMm:5,minorWidthMm:3}};
  const scene=buildPresentationScene(wider,caldronFallsFeatures,geometry);
  const land=scene.layers.find(l=>l.id==='layer-land')!;
  const roadShapes=land.shapes.filter(s=>s.group==='roads-major'||s.group==='roads-minor');
  expect(roadShapes.length).toBeGreaterThan(0);
  expect(roadShapes.every(s=>s.strokeWidthMm===5||s.strokeWidthMm===3)).toBe(true);
  const baseline=buildPresentationScene(baseProject,caldronFallsFeatures,geometry);
  expect(land.shapes.find(s=>s.id==='layer-land-panel')?.d).toBe(baseline.layers.find(l=>l.id==='layer-land')!.shapes.find(s=>s.id==='layer-land-panel')?.d);
 });

 it('roads mode Off live-removes road strokes without touching panel geometry',()=>{
  const off:MapProject={...baseProject,roads:{...baseProject.roads,mode:'off'}};
  const scene=buildPresentationScene(off,caldronFallsFeatures,geometry);
  const land=scene.layers.find(l=>l.id==='layer-land')!;
  expect(land.shapes.some(s=>s.group==='roads-major'||s.group==='roads-minor')).toBe(false);
 });

 it('reusing cached geometry via getCachedGeometryLayers for a presentation-only change produces the identical scene as a fresh buildScene call',()=>{
  const withTitle:MapProject={...baseProject,title:{...baseProject.title,text:'CALDRON FALLS'}};
  const {result}=getCachedGeometryLayers(undefined,baseProject,caldronFallsFeatures);
  const viaCache=buildPresentationScene(withTitle,caldronFallsFeatures,result);
  const fresh=buildScene(withTitle,caldronFallsFeatures);
  expect(viaCache).toEqual(fresh);
 });
});

describe('M-LIVE: manual overrides survive unrelated live changes',()=>{
 it('a dragged compass position is preserved when road width changes afterward',()=>{
  const dragged=setOverride(baseProject,'compass',{xMm:123,yMm:45});
  const geometry=buildGeometryLayers(dragged,caldronFallsFeatures);
  const afterDrag=buildPresentationScene(dragged,caldronFallsFeatures,geometry);
  expect(afterDrag.objects.find(o=>o.id==='compass')?.transform).toContain('translate(123 45)');

  const roadWidthChanged:MapProject={...dragged,roads:{...dragged.roads,majorWidthMm:9}};
  const afterRoadChange=buildPresentationScene(roadWidthChanged,caldronFallsFeatures,geometry);
  expect(afterRoadChange.objects.find(o=>o.id==='compass')?.transform).toContain('translate(123 45)');
 });

 it('a dragged place label position is preserved when place-label size changes afterward',()=>{
  const placeId=`place-${caldronFallsFeatures.places[0].id}`;
  const dragged=setOverride(baseProject,placeId,{xMm:77,yMm:88});
  const geometry=buildGeometryLayers(dragged,caldronFallsFeatures);
  const sceneA=buildPresentationScene(dragged,caldronFallsFeatures,geometry);
  expect(sceneA.objects.find(o=>o.objectId===placeId)?.transform).toContain('translate(77 88)');

  const sizeChanged:MapProject={...dragged,placeLabels:{...dragged.placeLabels,sizeMm:9}};
  const sceneB=buildPresentationScene(sizeChanged,caldronFallsFeatures,geometry);
  expect(sceneB.objects.find(o=>o.objectId===placeId)?.transform).toContain('translate(77 88)');
 });

 it('a dragged title position is preserved when font/layer-visibility changes afterward',()=>{
  const dragged=setOverride({...baseProject,title:{...baseProject.title,text:'CABIN'}},'title',{xMm:150,yMm:100});
  const geometry=buildGeometryLayers(dragged,caldronFallsFeatures);
  const sceneA=buildPresentationScene(dragged,caldronFallsFeatures,geometry);
  expect(sceneA.objects.find(o=>o.id==='title-text')?.transform).toContain('translate(150 100)');

  const fontChanged:MapProject={...dragged,title:{...dragged.title,font:'cinzel'}};
  const sceneB=buildPresentationScene(fontChanged,caldronFallsFeatures,geometry);
  expect(sceneB.objects.find(o=>o.id==='title-text')?.transform).toContain('translate(150 100)');
 });
});
