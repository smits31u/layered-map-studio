import type {GeoPlace,MapProject,ObjectOverride} from '../../types/project';
import type {CropProjection} from '../projection/cropProjection';
import {resolvePlacement} from './overrides';

export type PlaceLabelSceneObject={
 id:string;
 name:string;
 placeClass:GeoPlace['class'];
 defaultXMm:number;
 defaultYMm:number;
 xMm:number;
 yMm:number;
 visible:boolean;
};

const NUDGE_THRESHOLD_MM=2;
const NUDGE_STEP_MM=2.2;

export function buildPlaceLabelObjects(places:GeoPlace[],projection:CropProjection,widthMm:number,heightMm:number,config:MapProject['placeLabels'],overrides:Record<string,ObjectOverride>):PlaceLabelSceneObject[]{
 const seen=new Set<string>();
 const placed:{x:number;y:number}[]=[];
 const objects:PlaceLabelSceneObject[]=[];
 for(const place of places){
  if(!config.classes[place.class])continue;
  const dedupeKey=`${place.class}|${place.name.trim().toLowerCase()}`;
  if(seen.has(dedupeKey))continue; // avoid exact duplicates (same name+class)
  const point=projection.project(place.coordinate);
  if(point.x<0||point.y<0||point.x>widthMm||point.y>heightMm)continue; // outside product bounds
  seen.add(dedupeKey);
  let {x:defaultXMm,y:defaultYMm}=point;
  // light nudge for labels whose default position nearly coincides with an already-placed one
  for(const other of placed){
   if(Math.hypot(defaultXMm-other.x,defaultYMm-other.y)<NUDGE_THRESHOLD_MM){
    defaultYMm+=NUDGE_STEP_MM;
    break;
   }
  }
  placed.push({x:defaultXMm,y:defaultYMm});
  const id=`place-${place.id}`;
  const resolved=resolvePlacement({xMm:defaultXMm,yMm:defaultYMm},overrides[id]);
  objects.push({id,name:place.name,placeClass:place.class,defaultXMm,defaultYMm,xMm:resolved.xMm,yMm:resolved.yMm,visible:resolved.visible});
 }
 return objects;
}
