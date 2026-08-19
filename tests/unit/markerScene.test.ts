import {describe,expect,it} from 'vitest';
import {buildGeometryLayers,buildPresentationScene,buildScene} from '../../src/export/buildScene';
import {sceneToSvg} from '../../src/export/svg/exportSvg';
import {caldronFallsFeatures,caldronFallsProject} from '../fixtures/caldronFalls';
import type {ExtractedFeatures,MapMarker,MapProject} from '../../src/types/project';

const marker=(overrides:Partial<MapMarker>={}):MapMarker=>({
 id:'marker-1',markerType:'pin',sizeMm:8,rotationDeg:0,showLabel:false,labelSizeMm:3,visible:true,operation:'engrave',keepOutEnabled:false,keepOutPaddingMm:2,
 lat:45.3685,lng:-88.207, // inside the Caldron Falls crop / near the fixture's own place
 ...overrides,
});

const withMarkers=(markers:MapMarker[]):MapProject=>({...caldronFallsProject,markers});

describe('M-MARKERS: buildScene integration',()=>{
 it('renders a vector-only marker glyph (no <text>) at the projected geographic position, engrave by default',()=>{
  const scene=buildScene(withMarkers([marker()]),caldronFallsFeatures);
  const obj=scene.objects.find(o=>o.objectId==='marker-1'&&o.group==='markers-engrave');
  expect(obj).toBeTruthy();
  expect(obj!.d!.startsWith('M')).toBe(true);
  expect(obj!.operation).toBe('engrave');
  const svg=sceneToSvg(scene,'registered');
  expect(svg).not.toMatch(/<text/i);
 });

 it('renders a cut marker in the markers-cut group, never merged into road/land engraving',()=>{
  const scene=buildScene(withMarkers([marker({operation:'cut'})]),caldronFallsFeatures);
  const obj=scene.objects.find(o=>o.objectId==='marker-1');
  expect(obj?.group).toBe('markers-cut');
  expect(obj?.operation).toBe('cut');
 });

 it('marker type change swaps the rendered path data live (no cache dependency)',()=>{
  const pinD=buildScene(withMarkers([marker({markerType:'pin'})]),caldronFallsFeatures).objects.find(o=>o.objectId==='marker-1')!.d;
  const starD=buildScene(withMarkers([marker({markerType:'star'})]),caldronFallsFeatures).objects.find(o=>o.objectId==='marker-1')!.d;
  expect(pinD).not.toBe(starD);
 });

 it('marker size change scales the path extent',()=>{
  const extent=(d:string)=>Math.max(...[...d.matchAll(/-?\d+\.?\d*/g)].map(m=>Math.abs(+m[0])));
  const small=buildScene(withMarkers([marker({sizeMm:6})]),caldronFallsFeatures).objects.find(o=>o.objectId==='marker-1')!.d!;
  const large=buildScene(withMarkers([marker({sizeMm:20})]),caldronFallsFeatures).objects.find(o=>o.objectId==='marker-1')!.d!;
  expect(extent(large)).toBeGreaterThan(extent(small));
 });

 it('marker rotation is reflected in the shape transform',()=>{
  const scene=buildScene(withMarkers([marker({rotationDeg:35})]),caldronFallsFeatures);
  const obj=scene.objects.find(o=>o.objectId==='marker-1'&&o.group==='markers-engrave');
  expect(obj!.transform).toContain('rotate(35)');
 });

 it('an optional label renders as a separate vector shape in its own group, upright regardless of marker rotation',()=>{
  const scene=buildScene(withMarkers([marker({rotationDeg:40,showLabel:true,label:'OUR CABIN'})]),caldronFallsFeatures);
  const label=scene.objects.find(o=>o.objectId==='marker-1'&&o.group==='marker-labels');
  expect(label).toBeTruthy();
  expect(label!.d!.length).toBeGreaterThan(0);
  expect(label!.transform).toContain('rotate(0)');
 });

 it('label is omitted when showLabel is false, even if label text is set',()=>{
  const scene=buildScene(withMarkers([marker({showLabel:false,label:'HIDDEN'})]),caldronFallsFeatures);
  expect(scene.objects.some(o=>o.group==='marker-labels')).toBe(false);
 });

 it('marker only appears on the land/top panel, never on depth/base panels',()=>{
  const scene=buildScene(withMarkers([marker()]),caldronFallsFeatures);
  const land=scene.layers.find(l=>l.id==='layer-land')!;
  expect(land.shapes.some(s=>s.objectId==='marker-1')).toBe(false); // objects are merged at serialization time, not stored on the layer itself
  for(const layer of scene.layers)expect(layer.shapes.some(s=>s.objectId==='marker-1')).toBe(false);
  const svg=sceneToSvg(scene,'registered');
  const doc=new DOMParser().parseFromString(svg,'image/svg+xml');
  const landGroup=doc.querySelector('#layer-land');
  expect(landGroup?.querySelector('[id="marker-1"]')).toBeTruthy();
  for(const otherId of ['layer-depth-2','layer-depth-3','layer-depth-4','layer-base']){
   const group=doc.querySelector(`#${otherId}`);
   expect(group?.querySelector('[id="marker-1"]')).toBeNull();
  }
 });

 it('deleting a marker removes only that marker, leaving others and all other geometry untouched',()=>{
  const m1=marker({id:'marker-a',lat:45.36,lng:-88.2}),m2=marker({id:'marker-b',lat:45.37,lng:-88.21});
  const before=buildScene(withMarkers([m1,m2]),caldronFallsFeatures);
  expect(before.objects.filter(o=>o.group==='markers-engrave')).toHaveLength(2);
  const after=buildScene(withMarkers([m2]),caldronFallsFeatures); // marker-a deleted
  const markerShapes=after.objects.filter(o=>o.group==='markers-engrave');
  expect(markerShapes).toHaveLength(1);
  expect(markerShapes[0].objectId).toBe('marker-b');
 });

 it('adding/resizing/deleting markers never changes exported physical panel dimensions',()=>{
  const none=buildScene(withMarkers([]),caldronFallsFeatures);
  const withOne=buildScene(withMarkers([marker({sizeMm:40})]),caldronFallsFeatures);
  expect(withOne.widthMm).toBe(none.widthMm);
  expect(withOne.heightMm).toBe(none.heightMm);
  expect(withOne.widthMm).toBe(355.6);
  expect(withOne.heightMm).toBe(279.4);
 });

 it('markers never alter shoreline/depth/base cut geometry',()=>{
  const none=buildScene(withMarkers([]),caldronFallsFeatures);
  const withOne=buildScene(withMarkers([marker({keepOutEnabled:true})]),caldronFallsFeatures);
  for(const id of ['layer-land','layer-depth-2','layer-depth-3','layer-depth-4','layer-base']){
   const a=none.layers.find(l=>l.id===id)!.shapes.filter(s=>s.operation==='cut');
   const b=withOne.layers.find(l=>l.id===id)!.shapes.filter(s=>s.operation==='cut');
   expect(a).toEqual(b);
  }
 });

 it('a marker survives geometry regeneration (crop/dimension change) — reprojected fresh, not lost, not stale',()=>{
  const project=withMarkers([marker()]);
  const geometry1=buildGeometryLayers(project,caldronFallsFeatures);
  const scene1=buildPresentationScene(project,caldronFallsFeatures,geometry1);
  const obj1=scene1.objects.find(o=>o.objectId==='marker-1')!;
  // Regenerate geometry with different physical dimensions (same crop) — a real "regeneration" the
  // way changing panel size or re-cropping would trigger.
  const resized:MapProject={...project,dimensions:{...project.dimensions,widthMm:400,heightMm:300}};
  const geometry2=buildGeometryLayers(resized,caldronFallsFeatures);
  const scene2=buildPresentationScene(resized,caldronFallsFeatures,geometry2);
  const obj2=scene2.objects.find(o=>o.objectId==='marker-1');
  expect(obj2).toBeTruthy(); // never silently dropped
  expect(obj2!.transform).not.toBe(obj1.transform); // freshly reprojected against the new physical size, not a stale cached position
 });
});

describe('M-MARKERS: optional keep-out clears road engraving only',()=>{
 // caldronFallsProject carries M-COMPASS's own default (Classic Rose, top-left, always-on
 // keep-out) — leaving it on here would let the compass's own keep-out clip this same diagonal
 // road independently of anything the marker does, confounding these assertions. Turn the compass
 // off so only the marker's keep-out is under test; the compass+marker *interaction* is already
 // implicitly covered by every other test in this file, which builds scenes with the default
 // (compass on) project and never sees markers affect compass behavior or vice versa.
 const noCompass:MapProject={...caldronFallsProject,compass:{...caldronFallsProject.compass,position:'off'}};
 const crop=caldronFallsProject.map.crop!;
 const insetLng=(crop.se.lng-crop.nw.lng)*.02,insetLat=(crop.se.lat-crop.nw.lat)*.02;
 const diagonalFeatures:ExtractedFeatures={...caldronFallsFeatures,roads:[{id:'diagonal',class:'secondary',coordinates:[{lng:crop.nw.lng+insetLng,lat:crop.nw.lat+insetLat},{lng:crop.se.lng-insetLng,lat:crop.se.lat-insetLat}]}]};
 const geometry=buildGeometryLayers(noCompass,diagonalFeatures);
 const roadShapes=(scene:ReturnType<typeof buildPresentationScene>)=>scene.layers.find(l=>l.id==='layer-land')!.shapes.filter(s=>s.group==='roads-major');

 it('clears roads around a keep-out-enabled marker positioned on the diagonal road',()=>{
  // Put the marker directly on the unclipped road's own path so there is no ambiguity about overlap.
  const baseline=buildPresentationScene(noCompass,diagonalFeatures,geometry);
  const road=roadShapes(baseline)[0];
  const nums=[...road.d!.matchAll(/-?\d+\.\d+/g)].map(m=>+m[0]);
  const midX=(nums[0]+nums[2])/2,midY=(nums[1]+nums[3])/2;
  const m=marker({keepOutEnabled:true,keepOutPaddingMm:4,sizeMm:8,lat:undefined,lng:undefined});
  // Place via a resolved override instead of lat/lng, to land exactly on the road's midpoint in mm.
  const project:MapProject={...noCompass,markers:[{...m,lat:noCompass.map.latitude,lng:noCompass.map.longitude}],overrides:{'marker-1':{xMm:midX,yMm:midY}}};
  const scene=buildPresentationScene(project,diagonalFeatures,geometry);
  expect(roadShapes(scene).length).toBe(2); // split around the marker
 });

 it('road geometry restores when keep-out is disabled',()=>{
  const baseline=buildPresentationScene(noCompass,diagonalFeatures,geometry);
  const road=roadShapes(baseline)[0];
  const nums=[...road.d!.matchAll(/-?\d+\.\d+/g)].map(m=>+m[0]);
  const midX=(nums[0]+nums[2])/2,midY=(nums[1]+nums[3])/2;
  const project:MapProject={...noCompass,markers:[{...marker({keepOutEnabled:false}),lat:noCompass.map.latitude,lng:noCompass.map.longitude}],overrides:{'marker-1':{xMm:midX,yMm:midY}}};
  const scene=buildPresentationScene(project,diagonalFeatures,geometry);
  expect(roadShapes(scene).length).toBe(1); // whole again — keep-out never mutated the source
 });

 it('marker keep-out does not suppress road/place labels (scope-reduced to roads only)',()=>{
  const project:MapProject={...noCompass,roadLabels:{...noCompass.roadLabels,visible:true},markers:[marker({keepOutEnabled:true,keepOutPaddingMm:50})]}; // huge padding — would suppress everything if it affected labels
  const scene=buildPresentationScene(project,diagonalFeatures,geometry);
  // place labels should still render normally for the fixture's own place, unaffected by marker keep-out
  const placeLabelsWithoutMarkerKeepOut=buildPresentationScene({...noCompass,roadLabels:{...noCompass.roadLabels,visible:true}},diagonalFeatures,geometry).objects.filter(o=>o.group==='place-labels').length;
  const placeLabelsWithMarkerKeepOut=scene.objects.filter(o=>o.group==='place-labels').length;
  expect(placeLabelsWithMarkerKeepOut).toBe(placeLabelsWithoutMarkerKeepOut);
 });
});
