import {describe,expect,it} from 'vitest';
import {applyCropSnapshot,cropGeographyFromSnapshot,hashCropSnapshot,serializeCropSnapshot} from '../../src/geometry/projection/cropSnapshot';
import {defaultProject} from '../../src/state/defaultProject';
import {cropFromCorners} from '../../src/geometry/projection/cropProjection';
import type {MapProject} from '../../src/types/project';

const crop=cropFromCorners({lng:-88.32,lat:45.45},{lng:-88.08,lat:45.45},{lng:-88.08,lat:45.29},{lng:-88.32,lat:45.29});
const project:MapProject={...defaultProject,map:{...defaultProject.map,latitude:45.37,longitude:-88.2,zoom:11.5,bearing:12,crop},dimensions:{...defaultProject.dimensions,widthMm:355.6,heightMm:279.4}};

describe('crop snapshot serialization',()=>{
 it('throws a clear error when no crop has been selected yet',()=>{
  expect(()=>serializeCropSnapshot({...project,map:{...project.map,crop:undefined}})).toThrow('No crop selected');
 });

 it('exports the exact four corners, derived bbox, center, zoom, bearing, and physical dimensions',()=>{
  const snapshot=serializeCropSnapshot(project);
  expect(snapshot.center).toEqual({lat:45.37,lon:-88.2});
  expect(snapshot.zoom).toBe(11.5);
  expect(snapshot.bearing).toBe(12);
  expect(snapshot.crop.nw).toEqual({lng:-88.32,lat:45.45});
  expect(snapshot.crop.ne).toEqual({lng:-88.08,lat:45.45});
  expect(snapshot.crop.se).toEqual({lng:-88.08,lat:45.29});
  expect(snapshot.crop.sw).toEqual({lng:-88.32,lat:45.29});
  expect(snapshot.crop.bbox).toEqual({north:45.45,south:45.29,east:-88.08,west:-88.32});
  expect(snapshot.dimensions).toEqual({widthMm:355.6,heightMm:279.4});
 });

 it('round-trips through JSON with no precision loss',()=>{
  const snapshot=serializeCropSnapshot(project);
  const roundTripped=JSON.parse(JSON.stringify(snapshot));
  expect(roundTripped).toEqual(snapshot);
 });

 it('reconstructs an equivalent CropGeography from a snapshot',()=>{
  const snapshot=serializeCropSnapshot(project);
  expect(cropGeographyFromSnapshot(snapshot)).toEqual(crop);
 });

 it('restoring a saved snapshot reproduces the exact same crop geometry, center, zoom, bearing, and dimensions',()=>{
  const snapshot=serializeCropSnapshot(project);
  const blank:MapProject={...defaultProject,map:{...defaultProject.map,crop:undefined},dimensions:{...defaultProject.dimensions,widthMm:100,heightMm:100}};
  const restored=applyCropSnapshot(blank,snapshot);
  expect(restored.map.crop).toEqual(crop);
  expect(restored.map.latitude).toBeCloseTo(project.map.latitude,9);
  expect(restored.map.longitude).toBeCloseTo(project.map.longitude,9);
  expect(restored.map.zoom).toBe(project.map.zoom);
  expect(restored.map.bearing).toBe(project.map.bearing);
  expect(restored.dimensions.widthMm).toBe(project.dimensions.widthMm);
  expect(restored.dimensions.heightMm).toBe(project.dimensions.heightMm);
 });

 it('serialize -> apply -> serialize is idempotent (deterministic round trip)',()=>{
  const first=serializeCropSnapshot(project);
  const restored=applyCropSnapshot({...defaultProject,map:{...defaultProject.map,crop:undefined}},first);
  const second=serializeCropSnapshot(restored);
  expect(second).toEqual(first);
 });

 it('leaves unrelated project state untouched when applying a crop snapshot',()=>{
  const snapshot=serializeCropSnapshot(project);
  const withCustomPreset:MapProject={...defaultProject,shoreline:{...defaultProject.shoreline,preset:'wide'}};
  const restored=applyCropSnapshot(withCustomPreset,snapshot);
  expect(restored.shoreline.preset).toBe('wide');
 });

 it('produces a stable, deterministic hash for identical crops and a different hash for a different crop',()=>{
  const snapshot=serializeCropSnapshot(project);
  expect(hashCropSnapshot(snapshot)).toBe(hashCropSnapshot(serializeCropSnapshot(project)));
  const otherCrop=cropFromCorners({lng:-88.33,lat:45.46},{lng:-88.07,lat:45.46},{lng:-88.07,lat:45.28},{lng:-88.33,lat:45.28});
  const otherSnapshot=serializeCropSnapshot({...project,map:{...project.map,crop:otherCrop}});
  expect(hashCropSnapshot(otherSnapshot)).not.toBe(hashCropSnapshot(snapshot));
 });
});
