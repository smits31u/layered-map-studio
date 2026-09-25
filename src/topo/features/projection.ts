import {createMapProjection,MAPLIBRE_TILE_SIZE,type ProjectPoint} from '../../ornament/geometry/mapProjection';
import type {FrozenTerrainView} from '../terrain/pipeline';

// Geography → board millimetres, from the frozen view alone.
//
// The ornament's projection (createMapProjection) with the board's origin moved from the map centre
// to the crop frame's top-left corner. It is the same Web Mercator mapping the terrain resampler uses
// (elevationGrid.ts: the board maps linearly onto the frozen bounds in Mercator), so a captured
// shoreline and the elevation samples beneath it land on the same millimetre. topoFeatures.test.ts
// checks the two agree at the board's corners.
//
// Pure: a worker can rebuild it from the serializable view, and nothing here reads a live map.
export function boardProjection(view:FrozenTerrainView):ProjectPoint{
 const mmPerPx=view.widthMm/view.frameWidthPx;
 const project=createMapProjection({
  center:[view.center[0],view.center[1]],
  zoom:view.zoom,
  bearing:0,
  pitch:0,
  widthPx:view.frameWidthPx,
  heightPx:view.frameHeightPx,
  bounds:[view.bounds.west,view.bounds.south,view.bounds.east,view.bounds.north],
  tileSize:MAPLIBRE_TILE_SIZE,
 },mmPerPx);
 const halfW=view.widthMm/2,halfH=view.heightMm/2;
 return (lng,lat)=>{const [x,y]=project(lng,lat);return [x+halfW,y+halfH]};
}
