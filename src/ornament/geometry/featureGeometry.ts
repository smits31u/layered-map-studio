import type {MultiPolygonMm} from '../../geometry/shoreline/polygonEngine';
import type {FeatureCapture} from '../capture/featureTypes';
import type {BuildMode,RoadDetail} from '../types';
import type {MapWindow} from './clipLine';
import {applyIslandPolicy,totalIslandAreaMm2,type IslandPolicyResult,type LandIslandPolicy} from './landIslands';
import {createMapProjection,projectLine,projectRings} from './mapProjection';
import type {OrnamentIssue} from './ornamentShape';
import {countVertices,geometryAreaMm2} from './polygonRepair';
import {buildRoadEngraving,type ProjectedRoad,type RoadGeometryMetrics} from './roadGeometry';
import {buildLandPiece,buildWaterRegion,type ProjectedWater,type WaterGeometryMetrics} from './waterGeometry';

// Phase 3's entry point: one pure function from a capture to every piece of fabrication geometry the
// map contributes.
//
// Pure and serializable in both directions, because this is what runs inside the Web Worker. No
// MapLibre, no React, no `Date.now()`, no `Math.random()` — the same input produces byte-identical
// output, which is the plan's exit criterion ("fixed city, coast, island, and rural fixtures
// generate deterministic, valid geometry") and what makes a golden fixture possible at all.
//
// What this does *not* do is lay pieces out, emit SVG, or convert text and markers to paths. That is
// Phase 4. The boundary is deliberate: everything here is in ornament millimetres with the centre at
// (0,0), and Phase 4 translates whole pieces into a sheet.

export interface LandSettings{
 islandPolicy:LandIslandPolicy;
 minIslandAreaMm2:number;
 bridgeWidthMm:number;
 structuralRingWidthMm:number;
}

export interface FeatureGeometrySettings{
 diameterMm:number;
 detail:RoadDetail;
 widthScale:number;
 buildMode:BuildMode;
 land:LandSettings;
}

export interface FeatureGeometryInput{
 // Echoed back untouched so a result arriving after the user has moved on can be recognised and
 // discarded. The plan: "reject stale export results if the project revision changed."
 revision:number;
 capture:FeatureCapture;
 settings:FeatureGeometrySettings;
}

export interface FeatureGeometryMetrics{
 roads:RoadGeometryMetrics;
 water:WaterGeometryMetrics;
 landAreaMm2:number;
 landVertices:number;
 durationMs?:number;
}

export interface FeatureGeometryResult{
 revision:number;
 buildMode:BuildMode;
 // Classic mode. Roads engrave on the land/base piece; water engraves lightly on the base.
 roadsEngrave:MultiPolygonMm;
 waterEngrave:MultiPolygonMm;
 // Water-cutout mode. Empty in classic mode rather than undefined, so consumers do not branch on
 // presence as well as on build mode.
 landCut:MultiPolygonMm;
 waterCut:MultiPolygonMm;
 structuralRing:MultiPolygonMm;
 islands:IslandPolicyResult;
 warnings:OrnamentIssue[];
 metrics:FeatureGeometryMetrics;
}

const issue=(code:string,severity:OrnamentIssue['severity'],message:string):OrnamentIssue=>({code,severity,message});

const round2=(value:number)=>Math.round(value*100)/100;

export function buildFeatureGeometry(input:FeatureGeometryInput):FeatureGeometryResult{
 const {capture,settings}=input;
 const warnings:OrnamentIssue[]=[];
 const project=createMapProjection(capture.viewport,capture.mmPerPx);
 // The same MapWindow shape Phase 1's clipper takes: the inner disk, plus the chord that keeps
 // engraving off the text band. Built from the capture rather than from live ornament geometry, so
 // rebuilding from a stored capture clips exactly where the capture said it would.
 const window:MapWindow={innerRadiusMm:capture.innerRadiusMm,chordYMm:capture.chordYMm};

 // Projection is a separate pass rather than being folded into the clip so that the two can be
 // reasoned about — and measured — independently. It is also where a capture stops being geographic:
 // nothing after this line knows what a longitude is.
 const roads:ProjectedRoad[]=capture.features.roads.map(road=>({roadClass:road.roadClass,line:projectLine(road.line,project)}));
 const water:ProjectedWater[]=capture.features.water.map(polygon=>({rings:projectRings(polygon.rings,project)}));

 const roadResult=buildRoadEngraving(roads,{
  detail:settings.detail,
  widths:{diameterMm:settings.diameterMm,widthScale:settings.widthScale},
  window,
 });

 const waterResult=buildWaterRegion(water,{innerRadiusMm:capture.innerRadiusMm});

 if(capture.features.counts.unusableFeatures>0)
  warnings.push(issue('capture-unusable',
   'warning',
   capture.features.counts.unusableFeatures+' captured feature(s) had a geometry type the ornament cannot use and were skipped.'));
 if(waterResult.metrics.rejectedRings>0)
  warnings.push(issue('water-rings-rejected',
   'warning',
   waterResult.metrics.rejectedRings+' water ring(s) were degenerate and could not be used.'));
 // A filled hole is an island that has stopped existing. That is exactly the class of silent loss
 // the plan forbids, so it is reported here even though the island never reached the land piece.
 if(waterResult.metrics.filledHoles>0)
  warnings.push(issue('water-holes-filled',
   'warning',
   waterResult.metrics.filledHoles+' island(s) inside the water were smaller than the minimum cuttable size and have been filled in.'));
 if(roadResult.metrics.droppedIslands>0)
  warnings.push(issue('road-islands-dropped',
   'warning',
   roadResult.metrics.droppedIslands+' road fragment(s) were below the minimum engravable size and were removed.'));
 if(!roadResult.geometry.length&&capture.features.roads.length>0)
  warnings.push(issue('roads-empty','warning','No roads fell inside the ornament’s map window at this framing.'));

 const cutout=settings.buildMode==='water-cutout-3-piece';
 let landCut:MultiPolygonMm=[],waterCut:MultiPolygonMm=[],ring:MultiPolygonMm=[];
 let islands:IslandPolicyResult={geometry:[],detected:[],omitted:[],bridges:[],unbridged:[],remaining:[]};

 if(cutout){
  const piece=buildLandPiece(waterResult.geometry,{
   innerRadiusMm:capture.innerRadiusMm,
   structuralRingWidthMm:settings.land.structuralRingWidthMm,
  });
  ring=piece.ring;
  waterCut=piece.waterCut;
  islands=applyIslandPolicy(piece.land,{
   policy:settings.land.islandPolicy,
   minIslandAreaMm2:settings.land.minIslandAreaMm2,
   bridgeWidthMm:settings.land.bridgeWidthMm,
  });
  landCut=islands.geometry;
  warnings.push(...describeIslands(islands,settings.land));
 }

 return {
  revision:input.revision,
  buildMode:settings.buildMode,
  roadsEngrave:roadResult.geometry,
  waterEngrave:cutout?[]:waterResult.geometry,
  landCut,
  waterCut,
  structuralRing:ring,
  islands,
  warnings,
  metrics:{
   roads:roadResult.metrics,
   water:waterResult.metrics,
   landAreaMm2:geometryAreaMm2(landCut),
   landVertices:countVertices(landCut),
  },
 };
}

// One warning per outcome, each naming a count and an area, because "there are loose pieces" without
// a size is not actionable. The severity is `warning` rather than `error` throughout: a loose island
// is a decision the user has to make, not a reason the ornament cannot be built, and blocking export
// on it would push people towards whichever policy silences the message fastest.
function describeIslands(result:IslandPolicyResult,settings:LandSettings):OrnamentIssue[]{
 const issues:OrnamentIssue[]=[];
 if(!result.detected.length)return issues;
 const area=round2(totalIslandAreaMm2(result.detected));
 issues.push(issue('land-islands-detected',
  'warning',
  'Cutting the water out leaves '+result.detected.length+' land piece(s) not attached to the rest of the ornament, '+area+'mm² in total.'));
 if(result.omitted.length)
  issues.push(issue('land-islands-omitted',
   'warning',
   result.omitted.length+' of them were below the '+settings.minIslandAreaMm2+'mm² threshold and have been removed from the cut, largest '+round2(Math.max(...result.omitted.map(island=>island.areaMm2)))+'mm².'));
 if(result.bridges.length)
  issues.push(issue('land-islands-bridged',
   'warning',
   result.bridges.length+' were joined to the ornament with '+settings.bridgeWidthMm+'mm tabs, which will be visible on the finished piece.'));
 if(result.unbridged.length)
  issues.push(issue('land-islands-unbridged',
   'warning',
   result.unbridged.length+' were too far from the rest of the ornament to bridge and remain loose.'));
 if(result.remaining.length)
  issues.push(issue('land-islands-remaining',
   'warning',
   result.remaining.length+' loose piece(s) will be cut separately and must be glued back in place — check them before running the job.'));
 return issues;
}

export const emptyFeatureGeometry=(revision:number,buildMode:BuildMode):FeatureGeometryResult=>({
 revision,
 buildMode,
 roadsEngrave:[],
 waterEngrave:[],
 landCut:[],
 waterCut:[],
 structuralRing:[],
 islands:{geometry:[],detected:[],omitted:[],bridges:[],unbridged:[],remaining:[]},
 warnings:[],
 metrics:{
  roads:{inputRoads:0,roadsOutsideDetail:0,clippedPieces:0,widthGroups:0,widthsMm:[],areaMm2:0,vertices:0,droppedIslands:0,filledHoles:0},
  water:{inputPolygons:0,rejectedRings:0,components:0,holes:0,filledHoles:0,droppedComponents:0,areaMm2:0,vertices:0},
  landAreaMm2:0,
  landVertices:0,
 },
});

