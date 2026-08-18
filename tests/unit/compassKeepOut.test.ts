import {describe,expect,it} from 'vitest';
import {buildGeometryLayers,buildPresentationScene} from '../../src/export/buildScene';
import {sceneToSvg} from '../../src/export/svg/exportSvg';
import {caldronFallsFeatures,caldronFallsProject} from '../fixtures/caldronFalls';
import type {ExtractedFeatures,MapProject} from '../../src/types/project';
import type {Shape} from '../../src/export/scene';

// A road running the exact diagonal of the crop (nw -> se) projects to the exact diagonal of the
// physical product, (0,0) -> (widthMm,heightMm) — CropProjection.project(nw) and .project(se)
// converge to the crop's own corners by construction, so this needs no knowledge of the mercator
// math to predict: it's a straight, fully deterministic line across the whole panel, passing close
// to a top-left compass and far from a top-right one. That determinism is what makes these
// keep-out tests exact rather than approximate.
const crop=caldronFallsProject.map.crop!;
// Inset 2% from each corner rather than using crop.nw/crop.se exactly: CropProjection.project()
// converges to those corners only up to floating-point error (occasionally a hair below 0 or
// above widthMm/heightMm), which projectRoads' inBounds filter then rejects outright. A 2% inset
// keeps the line's mm endpoints deep inside [0,widthMm]x[0,heightMm] with a comfortable margin
// while still spanning virtually the whole diagonal.
const insetLng=(crop.se.lng-crop.nw.lng)*.02,insetLat=(crop.se.lat-crop.nw.lat)*.02;
const diagonalFeatures:ExtractedFeatures={...caldronFallsFeatures,roads:[{id:'diagonal',class:'secondary',coordinates:[{lng:crop.nw.lng+insetLng,lat:crop.nw.lat+insetLat},{lng:crop.se.lng-insetLng,lat:crop.se.lat-insetLat}]}]};
const geometry=buildGeometryLayers(caldronFallsProject,diagonalFeatures);

const withCompass=(patch:Partial<MapProject['compass']>)=>buildPresentationScene({...caldronFallsProject,compass:{...caldronFallsProject.compass,...patch}},diagonalFeatures,geometry);
const roadShapes=(scene:ReturnType<typeof withCompass>)=>scene.layers.find(l=>l.id==='layer-land')!.shapes.filter(s=>s.group==='roads-major');

describe('M-COMPASS: dynamic keep-out for road/label geometry',()=>{
 it('splits the diagonal road into two clear segments when the default top-left compass overlaps it',()=>{
  const scene=withCompass({});
  const shapes=roadShapes(scene);
  expect(shapes.length).toBe(2);
 });

 it('leaves the road as one unbroken segment when the compass is off',()=>{
  const scene=withCompass({position:'off'});
  const shapes=roadShapes(scene);
  expect(shapes.length).toBe(1);
 });

 it('restores the road to one unbroken segment when the compass moves away from it',()=>{
  const far=withCompass({xMm:336.6,yMm:19}); // top-right area — geometrically far from the nw->se diagonal (see module comment)
  expect(roadShapes(far).length).toBe(1);
 });

 it('moving the compass back over the road re-clears it — nothing was permanently deleted by the earlier clip',()=>{
  const back=withCompass({xMm:caldronFallsProject.compass.xMm,yMm:caldronFallsProject.compass.yMm});
  expect(roadShapes(back).length).toBe(2);
 });

 it('a larger clearance removes more of the road around the compass than a smaller one',()=>{
  const tight=roadShapes(withCompass({keepOutPaddingMm:0}));
  const loose=roadShapes(withCompass({keepOutPaddingMm:12}));
  const removedLength=(shapes:Shape[])=>{
   const total=Math.hypot(geometry.widthMm,geometry.heightMm);
   const remaining=shapes.reduce((sum,s)=>{
    const nums=[...s.d!.matchAll(/-?\d+\.\d+/g)].map(m=>+m[0]);
    return sum+Math.hypot(nums[2]-nums[0],nums[3]-nums[1]);
   },0);
   return total-remaining;
  };
  expect(removedLength(loose)).toBeGreaterThan(removedLength(tight));
 });

 it('never touches shoreline/depth/base cut geometry — only engraving/presentation shapes differ',()=>{
  const on=withCompass({}),off=withCompass({position:'off'});
  for(const layer of ['layer-land','layer-depth-2','layer-depth-3','layer-depth-4','layer-base']){
   const cutsOn=on.layers.find(l=>l.id===layer)!.shapes.filter(s=>s.operation==='cut');
   const cutsOff=off.layers.find(l=>l.id===layer)!.shapes.filter(s=>s.operation==='cut');
   expect(cutsOn).toEqual(cutsOff);
  }
 });

 it('keeps exported physical dimensions identical regardless of compass state',()=>{
  const on=withCompass({}),off=withCompass({position:'off'}),moved=withCompass({xMm:200,yMm:200});
  expect(on.widthMm).toBe(off.widthMm);
  expect(on.heightMm).toBe(off.heightMm);
  expect(moved.widthMm).toBe(on.widthMm);
  expect(moved.heightMm).toBe(on.heightMm);
 });

 it('suppresses a place label whole (not half-clipped) when its anchor falls inside the keep-out circle, and restores it when the compass moves away',()=>{
  // Caldron Falls (the hamlet fixture place) sits at the map's focus point, not necessarily near
  // the compass — so drive this from the compass side: put the compass directly on top of the
  // label's resolved position instead of guessing the label's mm location.
  const baseline=withCompass({position:'off'});
  const label=baseline.objects.find(o=>o.group==='place-labels');
  expect(label).toBeTruthy();
  const [, xStr,yStr]=/translate\(([-\d.]+) ([-\d.]+)\)/.exec(label!.transform!)!;
  const covering=withCompass({xMm:+xStr,yMm:+yStr,sizeMm:22,keepOutPaddingMm:4});
  expect(covering.objects.some(o=>o.group==='place-labels')).toBe(false);
  const movedAway=withCompass({xMm:+xStr+500,yMm:+yStr+500});
  expect(movedAway.objects.some(o=>o.group==='place-labels')).toBe(true);
 });

 it('renders the compass as a single named SVG group containing one multi-subpath vector, never <text>',()=>{
  const scene=withCompass({});
  const svg=sceneToSvg(scene,'registered');
  const doc=new DOMParser().parseFromString(svg,'image/svg+xml');
  const group=doc.querySelector('#compass');
  expect(group).toBeTruthy();
  const paths=group!.querySelectorAll('path');
  expect(paths.length).toBe(1);
  expect((paths[0].getAttribute('d')!.match(/M/g)||[]).length).toBeGreaterThanOrEqual(7); // ring + star + center + 4 letters, at minimum
  expect(doc.querySelectorAll('text').length).toBe(0);
 });
});
