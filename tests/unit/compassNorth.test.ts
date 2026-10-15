import {describe,expect,it} from 'vitest';
import {buildScene} from '../../src/export/buildScene';
import {cropFromCorners,mercator} from '../../src/geometry/projection/cropProjection';
import {fitCropToBoard} from '../../src/geometry/projection/cropAspect';
import {caldronFallsFeatures,caldronFallsProject} from '../fixtures/caldronFalls';
import type {CropGeography,MapProject} from '../../src/types/project';
import type {ManufacturingScene} from '../../src/export/scene';

// The map used to rotate (drag with the right button, or the compass control) while the compass was
// always drawn pointing straight up the board. The map no longer rotates; a project saved while it
// did gets its compass turned to true north.

const unmercator=(x:number,y:number)=>({lng:x*360-180,lat:Math.atan(Math.sinh(Math.PI*(1-2*y)))*180/Math.PI});
// The fixture's crop as the map measures it at `bearing`: the same frame, turned on the ground.
function turned(crop:CropGeography,bearing:number):CropGeography{
 const [nw,ne,se,sw]=[crop.nw,crop.ne,crop.se,crop.sw].map(mercator),c={x:(nw.x+ne.x+se.x+sw.x)/4,y:(nw.y+ne.y+se.y+sw.y)/4},t=bearing*Math.PI/180;
 const at=(p:{x:number;y:number})=>{const dx=p.x-c.x,dy=p.y-c.y;return unmercator(c.x+dx*Math.cos(t)-dy*Math.sin(t),c.y+dx*Math.sin(t)+dy*Math.cos(t))};
 return cropFromCorners(at(nw),at(ne),at(se),at(sw));
}
const compassRotation=(scene:ManufacturingScene)=>{
 const transform=JSON.stringify(scene).match(/"id":"compass"[^}]*"transform":"[^"]*rotate\(([-\d.e]+)\)/);
 return Number(transform![1]);
};
// Fitted to the board first: on a crop of the wrong shape north would be stretched off -bearing too.
const {widthMm:w,heightMm:h}=caldronFallsProject.dimensions,fitted=fitCropToBoard(caldronFallsProject.map.crop!,w,h);
const at=(bearing:number):MapProject=>({...caldronFallsProject,map:{...caldronFallsProject.map,bearing,crop:turned(fitted,bearing)}});

describe('compass and map bearing',()=>{
 it('an unrotated crop keeps the compass exactly as set',()=>{
  expect(compassRotation(buildScene(caldronFallsProject,caldronFallsFeatures))).toBe(caldronFallsProject.compass.rotationDeg);
 });
 it('a crop saved at bearing 30 turns the compass by -30 degrees, on top of its own rotation',()=>{
  expect(compassRotation(buildScene(at(30),caldronFallsFeatures))).toBeCloseTo(-30,1);
  const tilted={...at(30),compass:{...caldronFallsProject.compass,rotationDeg:10}};
  expect(compassRotation(buildScene(tilted,caldronFallsFeatures))).toBeCloseTo(-20,1);
 });
});
