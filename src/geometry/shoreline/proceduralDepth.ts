import {extractDepthContours,type DepthContours} from '../terrain/depthContours';
import {generateDepthTerrain,type DepthTerrain} from '../terrain/depthTerrain';
import {DEFAULT_SIMPLE_TERRAIN_CONTROLS,expandSimpleControls,type SimpleTerrainControls} from '../terrain/terrainParams';
import {multiPolygonArea,type MultiPolygonMm} from './polygonEngine';

// The Procedural Terrain depth mode: the lake tool's adapter onto the terrain engine
// (geometry/terrain, docs/depth-terrain.md). buildScene hands it the same primary-water
// MultiPolygonMm that Artistic Depth erodes and True Bathymetry clips — buildWaterModel's output is
// already the shoreline format generateDepthTerrain takes, so nothing is converted — and gets back
// one opening per enabled depth panel, which becomes a panel exactly as the other modes' openings
// do (panel = product rect − opening).
//
// Where the panels are cut. With n enabled depth panels the terrain is terraced at n+1 global
// benches, k/(n+1) of full depth, and panel j is cut at (j+½)/(n+1): midway between bench j and
// bench j+1, so every cut lands on a riser between two flat benches rather than on a bench itself.
// (It cannot sit on the first bench: terracing never lowers water to depth 0, so every terraced
// cell is at bench 1 or deeper and a cut there would open the whole lake.) The same planes are used
// with terracing off, so the terracing slider changes the shape of the layers, not where they are.
//
// The planes are absolute depths, independent of Max depth. That is what gives Max depth a meaning
// in a cut stack: below 100% the terrain stops short of the deepest planes, those panels come out
// empty, and buildScene reports them as collapsed layers (export blocked), exactly as it does for a
// collapsed Artistic Depth layer.

export type ProceduralDepthOpening={threshold:number;geometry:MultiPolygonMm;areaMm2:number};

export const terrainControlsOf=(settings?:Partial<SimpleTerrainControls>):SimpleTerrainControls=>({...DEFAULT_SIMPLE_TERRAIN_CONTROLS,...settings});

export const proceduralThresholds=(panelCount:number)=>Array.from({length:panelCount},(_,j)=>(j+1.5)/(panelCount+1));

export function proceduralDepthOpenings(water:MultiPolygonMm,panelCount:number,settings?:Partial<SimpleTerrainControls>):ProceduralDepthOpening[]{
 if(panelCount<=0)return [];
 const params={...expandSimpleControls(terrainControlsOf(settings)),terraceLevels:panelCount+1};
 let terrain:DepthTerrain;
 try{terrain=generateDepthTerrain(water,params)}
 catch(error){throw new Error(`PROCEDURAL TERRAIN selected, but this shoreline cannot be modelled as terrain: ${(error as Error).message} Choose Artistic Depth, or adjust the crop.`)}
 if(!terrain.bodies.some(body=>!body.dropped))throw new Error('PROCEDURAL TERRAIN selected, but the water in this crop is too small or too narrow to model as terrain at this product size. Choose Artistic Depth, zoom in, or enlarge the product.');
 const thresholds=proceduralThresholds(panelCount);
 let contours:DepthContours;
 try{contours=extractDepthContours(terrain,water,thresholds)}
 catch(error){throw new Error(`PROCEDURAL TERRAIN contour extraction failed: ${(error as Error).message}`)}
 // Bodies are disjoint, so a level's polygons across bodies form a valid MultiPolygon as they are.
 return contours.thresholds.map((threshold,k)=>{
  const geometry=contours.bodies.flatMap(body=>body.levels[k].geometry);
  return {threshold,geometry,areaMm2:multiPolygonArea(geometry)};
 });
}
