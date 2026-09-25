import type {CapturedWater} from '../../ornament/capture/featureTypes';
import {projectRings} from '../../ornament/geometry/mapProjection';
import {simplifyRing} from '../../ornament/geometry/simplify';
import {buildWaterRegionWithin,type WaterGeometryResult} from '../../ornament/geometry/waterGeometry';
import {boardRectangle} from '../terrain/bands';
import type {FrozenTerrainView} from '../terrain/pipeline';
import {boardProjection} from './projection';

// Captured water polygons → one water region in board millimetres, clipped to the board.
//
// The ornament's water pipeline (buildWaterRegionWithin), unchanged: rings stay paired so islands
// survive, tile pieces and duplicates union rather than cancel, then clip, simplify and repair. The
// only topo-specific input is the clip region — the board rectangle instead of the ornament's disk.
//
// This region is what the terrain pipeline subtracts from every elevation layer (bands.ts). Before
// Phase 3 nothing fed it, so the sea floor that Terrarium tiles include was layered as land.
export function buildBoardWater(water:readonly CapturedWater[],view:FrozenTerrainView,simplifyToleranceMm=0):WaterGeometryResult{
 const project=boardProjection(view);
 const projected=water.map(polygon=>{
  const rings=projectRings(polygon.rings,project);
  return {rings:simplifyToleranceMm>0?rings.map(ring=>simplifyRing(ring,simplifyToleranceMm)):rings};
 });
 return buildWaterRegionWithin(projected,boardRectangle(view.widthMm,view.heightMm));
}
