import type {CropGeography,MapProject,ObjectOverride} from '../types/project';
import {fitCropToBoard} from '../geometry/projection/cropAspect';
import {cornerPosition,type CompassCorner} from '../geometry/scene/compass';

type Size={widthMm:number;heightMm:number};
const scaled=(o:ObjectOverride,sx:number,sy:number):ObjectOverride=>({...o,...(o.xMm!==undefined?{xMm:o.xMm*sx}:{}),...(o.yMm!==undefined?{yMm:o.yMm*sy}:{})});

// A board size change, applied to everything that was laid out for the old size. `project` already
// carries the new dimensions; `previous` is the size it was laid out for.
//
// The crop: CropProjection maps the crop's corners onto the board's, so a crop kept from the old size
// stretches the map by the change in aspect (x1.127 for 14x11 -> 18x12 on the 2026-10-15 audit). It
// is refit to the new shape inside the crop the features were captured for (`captured`, else the
// current crop), so the scene rebuilds at once from geography it already has. Map Mode re-measures
// its frame on top of this; Generate then captures what the frame shows. A request that sets a new
// crop together with the size (the crop JSON tool) keeps its own crop.
//
// Title, subtitle and compass: these are absolute millimetres, so a title at y=265 mm on a 11 in
// board fell off a 10 in one. They move in proportion; a corner compass stays in its corner.
export function resizeBoard(project:MapProject,previous:Size&{crop?:CropGeography},captured?:CropGeography):MapProject{
 const {widthMm:w,heightMm:h}=project.dimensions;
 if(w===previous.widthMm&&h===previous.heightMm)return project;
 const sx=w/previous.widthMm,sy=h/previous.heightMm,{compass,title,subtitle,overrides}=project;
 const corner=compass.position!=='custom'&&compass.position!=='off';
 const base=project.map.crop===previous.crop?captured??project.map.crop:undefined;
 return{
  ...project,
  map:base?{...project.map,crop:fitCropToBoard(base,w,h)}:project.map,
  title:{...title,xMm:title.xMm*sx,yMm:title.yMm*sy},
  subtitle:{...subtitle,xMm:subtitle.xMm*sx,yMm:subtitle.yMm*sy},
  compass:{...compass,...(corner?cornerPosition(compass.position as CompassCorner,w,h,compass.sizeMm):{xMm:compass.xMm*sx,yMm:compass.yMm*sy})},
  overrides:{...overrides,...Object.fromEntries((['title','subtitle','compass'] as const).filter(id=>overrides[id]).map(id=>[id,scaled(overrides[id]!,sx,sy)]))},
 };
}
