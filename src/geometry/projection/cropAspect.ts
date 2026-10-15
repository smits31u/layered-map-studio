import type {CropGeography,LngLat} from '../../types/project';
import {CropProjection,cropFromCorners,mercator,type PointMm} from './cropProjection';
// CropProjection maps the crop's four corners onto the board's four corners, x and y independently.
// Web Mercator is conformal and the map is never pitched, so a crop measured off the screen is a true
// rectangle in Mercator units, and its edge lengths there are its true shape on the ground. When that
// shape is not the board's, every exported panel is stretched by the quotient — on the audit of
// 2026-10-15 by x0.956 on a 1600x1000 window and x1.127 after a board resize. Nothing may build from
// such a crop; these are the checks and the refit.

// 0.5%: a crop measured off the screen is a whole number of CSS pixels per side, about 0.15% on a
// 700 px frame, so a real mismatch is always well outside this and rounding never is.
export const CROP_ASPECT_TOLERANCE=.005;
const unmercator=(p:PointMm):LngLat=>({lng:p.x*360-180,lat:Math.atan(Math.sinh(Math.PI*(1-2*p.y)))*180/Math.PI});
const sub=(a:PointMm,b:PointMm)=>({x:a.x-b.x,y:a.y-b.y}),mid=(a:PointMm,b:PointMm)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
// The crop's centre and its two edge vectors in Mercator units, each edge averaged with its opposite.
function frame(crop:CropGeography){
 const [nw,ne,se,sw]=[crop.nw,crop.ne,crop.se,crop.sw].map(mercator);
 return{centre:mid(mid(nw,ne),mid(se,sw)),u:mid(sub(ne,nw),sub(se,sw)),v:mid(sub(sw,nw),sub(se,ne))};
}
// Width over height of the crop on the ground.
export function cropAspect(crop:CropGeography):number{const {u,v}=frame(crop);return Math.hypot(u.x,u.y)/Math.hypot(v.x,v.y)}
// How much an export of this crop on this board stretches the map horizontally: 1 is true shape.
export const cropStretch=(crop:CropGeography,widthMm:number,heightMm:number)=>(widthMm/heightMm)/cropAspect(crop);
export const cropMatchesBoard=(crop:CropGeography,widthMm:number,heightMm:number)=>Math.abs(cropStretch(crop,widthMm,heightMm)-1)<=CROP_ASPECT_TOLERANCE;
export function assertCropMatchesBoard(crop:CropGeography,widthMm:number,heightMm:number){
 const stretch=cropStretch(crop,widthMm,heightMm);
 if(!(Math.abs(stretch-1)<=CROP_ASPECT_TOLERANCE))throw new Error(`The map crop is not the board's shape: it would stretch the map x${stretch.toFixed(3)}. Go to Map Mode and press Generate to re-measure it.`);
}
// The largest crop of the board's shape inside `crop`, about the same centre and on the same axes.
// Used when the board size changes away from the map: everything inside it was captured with `crop`,
// so it builds without a recapture, and refitting from the captured crop each time (never from the
// last refit) means 14x11 -> 18x12 -> 14x11 comes back to the same crop.
export function fitCropToBoard(crop:CropGeography,widthMm:number,heightMm:number):CropGeography{
 const {centre,u,v}=frame(crop),target=widthMm/heightMm,aspect=Math.hypot(u.x,u.y)/Math.hypot(v.x,v.y);
 const su=target>=aspect?.5:.5*target/aspect,sv=target>=aspect?.5*aspect/target:.5;
 const at=(a:number,b:number)=>unmercator({x:centre.x+a*su*u.x+b*sv*v.x,y:centre.y+a*su*u.y+b*sv*v.y});
 return cropFromCorners(at(-1,-1),at(1,-1),at(1,1),at(-1,1));
}
// Whether every corner of `inner` lies inside `outer`, so features captured for `outer` cover it.
// The slack absorbs floating point in a refit's round trip through degrees, not a real overhang.
export function cropContains(outer:CropGeography,inner:CropGeography,slack=1e-6):boolean{
 const unit=new CropProjection(outer,1,1);
 return[inner.nw,inner.ne,inner.se,inner.sw].every(p=>{const q=unit.project(p);return q.x>=-slack&&q.x<=1+slack&&q.y>=-slack&&q.y<=1+slack});
}
// Clockwise angle, in degrees, from the board's "up" to true north at the crop's centre. Zero for
// every crop the map can measure now that it cannot rotate; projects saved while it could carry a
// bearing, and their compass has to turn with the map.
export function cropNorthDeg(crop:CropGeography,widthMm:number,heightMm:number):number{
 const projection=new CropProjection(crop,widthMm,heightMm),centre=projection.unproject({x:widthMm/2,y:heightMm/2});
 const a=projection.project(centre),b=projection.project({lng:centre.lng,lat:centre.lat+1e-4});
 return Math.atan2(b.x-a.x,a.y-b.y)*180/Math.PI;
}
