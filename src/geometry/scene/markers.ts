import type {MapMarker,MapProject,ObjectOverride} from '../../types/project';
import {CropProjection} from '../projection/cropProjection';
import {resolvePlacement} from './overrides';

// Resolved per-marker placement, following the same "generated default + ObjectOverride" pattern
// as buildPlaceLabelObjects/buildRoadLabelCandidates — xMm/yMm here is the *default*, always
// recomputed from marker.lat/lng through the canonical CropProjection (never stored), so a marker
// survives a crop/dimension regeneration without going stale. Dragging a marker only ever writes
// to overrides[marker.id] (the same mechanism title/compass/labels already use); resetting that
// override is exactly "Reset to Exact Address" — there is no separate offsetXMm/offsetYMm field to
// keep in sync.
export type MarkerSceneObject={
 id:string;
 marker:MapMarker;
 xMm:number;
 yMm:number;
 rotationDeg:number;
 visible:boolean;
 // Two distinct notions of "outside bounds" (section 14 of the M-MARKERS brief): the TRUE geocoded
 // address may already be off-map before any drag (geographicInsideBounds), independent of whether
 // the user has since dragged the marker to/from the visible area (resolvedInsideBounds).
 geographicInsideBounds:boolean;
 resolvedInsideBounds:boolean;
};

const inBounds=(x:number,y:number,widthMm:number,heightMm:number)=>x>=0&&y>=0&&x<=widthMm&&y<=heightMm;

export function buildMarkerSceneObjects(markers:MapMarker[],projection:CropProjection,widthMm:number,heightMm:number,overrides:Record<string,ObjectOverride>):MarkerSceneObject[]{
 const out:MarkerSceneObject[]=[];
 for(const marker of markers){
  if(marker.lat==null||marker.lng==null)continue; // not yet geocoded — nothing to project/place
  const point=projection.project({lng:marker.lng,lat:marker.lat});
  const resolved=resolvePlacement({xMm:point.x,yMm:point.y,rotationDeg:marker.rotationDeg,visible:marker.visible},overrides[marker.id]);
  out.push({
   id:marker.id,marker,xMm:resolved.xMm,yMm:resolved.yMm,rotationDeg:resolved.rotationDeg,visible:resolved.visible,
   geographicInsideBounds:inBounds(point.x,point.y,widthMm,heightMm),
   resolvedInsideBounds:inBounds(resolved.xMm,resolved.yMm,widthMm,heightMm),
  });
 }
 return out;
}

// UI-facing helper (Controls.tsx): is this marker's true geocoded address within the currently
// generated map's bounds? Calls the same shared CropProjection class buildScene.ts uses — not a
// reimplementation of the projection math — so the sidebar can show "outside the current map area"
// immediately after geocoding, before the user clicks Generate.
export function markerGeographicStatus(project:MapProject,marker:MapMarker):{xMm:number;yMm:number;insideBounds:boolean}|undefined{
 if(!project.map.crop||marker.lat==null||marker.lng==null)return undefined;
 const projection=new CropProjection(project.map.crop,project.dimensions.widthMm,project.dimensions.heightMm);
 const point=projection.project({lng:marker.lng,lat:marker.lat});
 return{xMm:point.x,yMm:point.y,insideBounds:inBounds(point.x,point.y,project.dimensions.widthMm,project.dimensions.heightMm)};
}
