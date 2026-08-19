import {describe,expect,it} from 'vitest';
import {CropProjection} from '../../src/geometry/projection/cropProjection';
import {buildMarkerSceneObjects,markerGeographicStatus} from '../../src/geometry/scene/markers';
import {setOverride,resetOverrideFields} from '../../src/geometry/scene/overrides';
import {caldronFallsProject} from '../fixtures/caldronFalls';
import type {MapMarker, MapProject} from '../../src/types/project';

const crop=caldronFallsProject.map.crop!;
const projection=new CropProjection(crop,caldronFallsProject.dimensions.widthMm,caldronFallsProject.dimensions.heightMm);

const baseMarker=(overrides:Partial<MapMarker>={}):MapMarker=>({
 id:'marker-1',markerType:'pin',sizeMm:8,rotationDeg:0,showLabel:false,labelSizeMm:3,visible:true,operation:'engrave',keepOutEnabled:false,keepOutPaddingMm:2,
 ...overrides,
});

describe('buildMarkerSceneObjects: geographic projection',()=>{
 it('projects a geocoded marker through the SAME CropProjection used everywhere else, not a duplicate implementation',()=>{
  const lng=-88.207,lat=45.3685; // inside the caldronFalls crop
  const marker=baseMarker({lat,lng});
  const [obj]=buildMarkerSceneObjects([marker],projection,caldronFallsProject.dimensions.widthMm,caldronFallsProject.dimensions.heightMm,{});
  const expected=projection.project({lng,lat});
  expect(obj.xMm).toBeCloseTo(expected.x,9);
  expect(obj.yMm).toBeCloseTo(expected.y,9);
 });

 it('omits markers that have not been geocoded yet (lat/lng undefined) rather than placing them at a default origin',()=>{
  const objs=buildMarkerSceneObjects([baseMarker()],projection,caldronFallsProject.dimensions.widthMm,caldronFallsProject.dimensions.heightMm,{});
  expect(objs).toHaveLength(0);
 });

 it('flags a marker whose true address falls outside the generated map bounds',()=>{
  const marker=baseMarker({lat:0,lng:0}); // nowhere near the Caldron Falls crop
  const [obj]=buildMarkerSceneObjects([marker],projection,caldronFallsProject.dimensions.widthMm,caldronFallsProject.dimensions.heightMm,{});
  expect(obj.geographicInsideBounds).toBe(false);
 });

 it('markerGeographicStatus reuses the shared projection for the same result, for UI use before a scene exists',()=>{
  const lng=-88.207,lat=45.3685;
  const marker=baseMarker({lat,lng});
  const status=markerGeographicStatus(caldronFallsProject,marker);
  const [obj]=buildMarkerSceneObjects([marker],projection,caldronFallsProject.dimensions.widthMm,caldronFallsProject.dimensions.heightMm,{});
  expect(status?.xMm).toBeCloseTo(obj.xMm,9);
  expect(status?.yMm).toBeCloseTo(obj.yMm,9);
  expect(status?.insideBounds).toBe(true);
 });

 it('markerGeographicStatus returns undefined before geocoding or before a crop exists',()=>{
  expect(markerGeographicStatus(caldronFallsProject,baseMarker())).toBeUndefined();
  const noCrop:MapProject={...caldronFallsProject,map:{...caldronFallsProject.map,crop:undefined}};
  expect(markerGeographicStatus(noCrop,baseMarker({lat:45,lng:-88}))).toBeUndefined();
 });
});

describe('true location vs artistic offset (drag/reset)',()=>{
 const lng=-88.207,lat=45.3685;
 const marker=baseMarker({lat,lng});

 it('dragging (an override) changes the resolved position without touching lat/lng',()=>{
  const geographic=projection.project({lng,lat});
  const overrides=setOverride({...caldronFallsProject,overrides:{}},marker.id,{xMm:geographic.x+15,yMm:geographic.y-8}).overrides;
  const [obj]=buildMarkerSceneObjects([marker],projection,caldronFallsProject.dimensions.widthMm,caldronFallsProject.dimensions.heightMm,overrides);
  expect(obj.xMm).toBeCloseTo(geographic.x+15,9);
  expect(obj.yMm).toBeCloseTo(geographic.y-8,9);
  expect(marker.lat).toBe(lat); // never rewritten by a drag
  expect(marker.lng).toBe(lng);
 });

 it('Reset to Exact Address (resetOverrideFields) returns the marker to the geographic position',()=>{
  const geographic=projection.project({lng,lat});
  let project={...caldronFallsProject,overrides:{}};
  project=setOverride(project,marker.id,{xMm:geographic.x+15,yMm:geographic.y-8});
  project=resetOverrideFields(project,marker.id);
  const [obj]=buildMarkerSceneObjects([marker],projection,caldronFallsProject.dimensions.widthMm,caldronFallsProject.dimensions.heightMm,project.overrides);
  expect(obj.xMm).toBeCloseTo(geographic.x,9);
  expect(obj.yMm).toBeCloseTo(geographic.y,9);
 });
});

describe('multiple markers are independent',()=>{
 it('three markers keep distinct ids/types/labels/offsets, and dropping one does not affect the others',()=>{
  const m1=baseMarker({id:'marker-a',lat:45.36,lng:-88.2,markerType:'star',label:'Cabin'});
  const m2=baseMarker({id:'marker-b',lat:45.37,lng:-88.21,markerType:'anchor',label:'Dock'});
  const m3=baseMarker({id:'marker-c',lat:45.38,lng:-88.22,markerType:'fish',label:'Fishing Spot'});
  let project={...caldronFallsProject,overrides:{}};
  project=setOverride(project,'marker-a',{xMm:10,yMm:10});
  const objs=buildMarkerSceneObjects([m1,m2,m3],projection,caldronFallsProject.dimensions.widthMm,caldronFallsProject.dimensions.heightMm,project.overrides);
  expect(objs.map(o=>o.id)).toEqual(['marker-a','marker-b','marker-c']);
  expect(objs[0].xMm).toBeCloseTo(10,9);
  expect(objs[1].xMm).not.toBeCloseTo(10,1);
  const remaining=[m1,m3]; // simulate deleting marker-b
  const afterDelete=buildMarkerSceneObjects(remaining,projection,caldronFallsProject.dimensions.widthMm,caldronFallsProject.dimensions.heightMm,project.overrides);
  expect(afterDelete.map(o=>o.marker.label)).toEqual(['Cabin','Fishing Spot']);
 });
});
