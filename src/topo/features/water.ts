import ClipperLib from 'clipper-lib';
import type {MultiPolygonMm} from '../../geometry/shoreline/polygonEngine';
import {clip} from '../../geometry/terrain/nestedBands';
import type {CapturedWater} from '../../ornament/capture/featureTypes';
import {projectRings} from '../../ornament/geometry/mapProjection';
import {countVertices,geometryAreaMm2,repairGeometry} from '../../ornament/geometry/polygonRepair';
import {simplifyRing} from '../../ornament/geometry/simplify';
import {DEFAULT_MIN_WATER_COMPONENT_AREA_MM2,DEFAULT_MIN_WATER_HOLE_AREA_MM2,buildWaterRegionWithin,type WaterGeometryResult} from '../../ornament/geometry/waterGeometry';
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
//
// Then one pass for cutting (Phase 4). The shared pipeline simplifies before its final repair, and
// on a real capture that can leave a ring that doubles back on itself: a needle out and straight back,
// pinched at a vertex the ring passes through twice (found by export preflight on downtown San
// Francisco, where a small pond came out that way). Fine to draw; not fine to cut, since a laser
// following it cuts a slit. A strictly-simple Clipper union splits every such ring at its pinch into
// simple rings, and the needle left over — far under the pipeline's own 0.25 mm² floor — is dropped.
// Done here rather than in the shared pipeline so the ornament's output, pinned by its goldens, cannot
// move.
export function buildBoardWater(water:readonly CapturedWater[],view:FrozenTerrainView,simplifyToleranceMm=0):WaterGeometryResult{
 const project=boardProjection(view);
 const projected=water.map(polygon=>{
  const rings=projectRings(polygon.rings,project);
  return {rings:simplifyToleranceMm>0?rings.map(ring=>simplifyRing(ring,simplifyToleranceMm)):rings};
 });
 const region=buildWaterRegionWithin(projected,boardRectangle(view.widthMm,view.heightMm));
 const geometry=simpleForCutting(region.geometry);
 return {geometry,metrics:{...region.metrics,components:geometry.length,holes:geometry.reduce((n,p)=>n+p.length-1,0),areaMm2:geometryAreaMm2(geometry),vertices:countVertices(geometry)}};
}

export function simpleForCutting(geometry:MultiPolygonMm):MultiPolygonMm{
 if(!geometry.length)return geometry;
 const simple=clip(ClipperLib.ClipType.ctUnion,geometry,[],ClipperLib.PolyFillType.pftEvenOdd,'water','Topo water');
 return repairGeometry(simple,'Water',{minComponentAreaMm2:DEFAULT_MIN_WATER_COMPONENT_AREA_MM2,minHoleAreaMm2:DEFAULT_MIN_WATER_HOLE_AREA_MM2}).geometry;
}
