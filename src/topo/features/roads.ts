import ClipperLib from 'clipper-lib';
import type {MultiPolygonMm} from '../../geometry/shoreline/polygonEngine';
import {clip,toPaths} from '../../geometry/terrain/nestedBands';
import type {CapturedRoad} from '../../ornament/capture/featureTypes';
import {clipPolylineToRect,type PolylineMm} from '../../ornament/geometry/clipLine';
import {projectLine} from '../../ornament/geometry/mapProjection';
import {countVertices,geometryAreaMm2,unionAll} from '../../ornament/geometry/polygonRepair';
import {roadKey} from '../capture/topoCapture';
import {bridgeTabWarnings,bridgeTabs,findBridgeSpans,type BridgeCandidate} from './bridges';
import {buildRoadEngraving,type RoadGeometryMetrics} from '../../ornament/geometry/roadGeometry';
import {MIN_ENGRAVABLE_WIDTH_MM,ROAD_WIDTH_TABLE_MM,UNKNOWN_ROAD_WIDTH_MM,diameterWidthFactor,roadClassesForDetailSet,roadWidthMm,type RoadWidthSettings} from '../../ornament/geometry/roadWidths';
import {simplifyLine} from '../../ornament/geometry/simplify';
import {boardRectangle} from '../terrain/bands';
import type {FrozenTerrainView} from '../terrain/pipeline';
import type {TopoDetail} from '../types';
import {boardProjection} from './projection';
import type {TopoFeatureWarning} from './warnings';

// Road centrelines → engraving geometry on the board (plan §5 Roads).
//
// The ornament's road pipeline, reused whole (src/ornament/geometry/roadGeometry.ts): classes
// filtered by the same Low/Medium/High tiers, clipped *before* buffering so every end is a real end
// with a real round cap, buffered to a physical width in millimetres from the ornament's width table
// (roadWidths.ts) — never from the map style's pixel widths — then unioned, simplified and repaired.
// Only two things are topo-specific:
//
//   * the clip is the board rectangle rather than the ornament's disk and chord; and
//   * the result is clipped to the land (layer 1) plus its bridge tabs. Water is cut out of every
//     layer; where a road genuinely crosses it (a bridge, a causeway) a tab of material as wide as
//     the road is kept across the gap (bridges.ts), and the road is engraved on it. A road that only
//     runs out over water — a pier, a boat launch — has nothing under it and is removed, and how much
//     was removed is reported. The round caps the buffer puts past the board edge go too.
//
// Width scaling: the ornament's table is set at a 101.6 mm reference diameter and grows with the
// square root of the ornament's size. The board's shorter side stands in for the diameter: a 9 in
// board draws a residential street 0.63 mm wide, a motorway 1.35 mm. The user's thickness scale
// multiplies that, and nothing goes below the minimum engravable width.

export interface TopoRoadSettings{detail:TopoDetail;thicknessScale:number}

export interface TopoRoadLayer{
 // The engraving: roads on land and on bridge tabs, in board millimetres.
 geometry:MultiPolygonMm;
 // Material kept across water where a road genuinely crosses it. Belongs to terrain layer 1: the
 // export (Phase 4) cuts layer 1 as the land plus these.
 bridgeTabs:MultiPolygonMm;
 bridges:{spans:number;lengthMm:number;narrowestTabMm?:number;widestTabMm?:number;deadEndsOverWater:number;tunnelsOverWater:number};
 metrics:RoadGeometryMetrics&{overWaterAreaMm2:number;finalAreaMm2:number;finalVertices:number};
 warnings:TopoFeatureWarning[];
}

export const topoRoadWidthSettings=(view:FrozenTerrainView,thicknessScale:number):RoadWidthSettings=>({diameterMm:Math.min(view.widthMm,view.heightMm),widthScale:thicknessScale});

// Road classes in the capture whose physical width was raised to the engravable minimum. Those keep
// their road but lose the hierarchy the width table gives them: a warning, not an error.
export function flooredRoadClasses(roads:readonly CapturedRoad[],detail:TopoDetail,widths:RoadWidthSettings):string[]{
 const allowed=roadClassesForDetailSet(detail),classes=new Set<string>();
 const factor=diameterWidthFactor(widths.diameterMm)*(widths.widthScale>0?widths.widthScale:1);
 for(const road of roads)if(allowed.has(road.roadClass)&&(ROAD_WIDTH_TABLE_MM[road.roadClass]??UNKNOWN_ROAD_WIDTH_MM)*factor<MIN_ENGRAVABLE_WIDTH_MM)classes.add(road.roadClass);
 return [...classes].sort();
}

export interface TopoRoadOptions{
 simplifyToleranceMm?:number;
 // The water cut out of the terrain. With it, genuine crossings keep a bridge tab (bridges.ts).
 water?:MultiPolygonMm;
 tunnelRoadKeys?:readonly string[];
}

export function buildTopoRoads(roads:readonly CapturedRoad[],view:FrozenTerrainView,settings:TopoRoadSettings,land:MultiPolygonMm,options:TopoRoadOptions={}):TopoRoadLayer{
 const project=boardProjection(view);
 const {widthMm:W,heightMm:H}=view;
 const simplifyToleranceMm=options.simplifyToleranceMm??0;
 const projected=roads.map(road=>{
  const line=projectLine(road.line,project);
  return {roadClass:road.roadClass,line:simplifyToleranceMm>0?simplifyLine(line,simplifyToleranceMm):line};
 });
 const widths=topoRoadWidthSettings(view,settings.thicknessScale);
 const built=buildRoadEngraving(projected,{detail:settings.detail,widths,window:line=>clipPolylineToRect(line,0,0,W,H)});

 // Bridges: tabs across genuine crossings, as wide as the road each one carries. The roads are then
 // kept on the land and on those tabs — the deck the bridge's own engraving sits on.
 const analysis=options.water?.length
  ?findBridgeSpans(roadBridgeCandidates(roads,view,settings.detail,simplifyToleranceMm,options.tunnelRoadKeys).map(c=>({...c,widthMm:roadWidthMm(c.tag!,widths)})),options.water,W,H)
  :{spans:[],deadEnds:0,tunnelsOverWater:0};
 const tabs=bridgeTabs(analysis.spans);
 const deck=tabs.length?unionAll([land,tabs],'Bridge deck'):land;
 const onLand=built.geometry.length&&deck.length?clip(ClipperLib.ClipType.ctIntersection,built.geometry,toPaths(deck),ClipperLib.PolyFillType.pftEvenOdd,'roads','Topo roads'):[];
 const finalAreaMm2=geometryAreaMm2(onLand);
 // What the clip removed, less the round caps that only overhung the board edge: roads left over water.
 const onBoard=built.geometry.length?clip(ClipperLib.ClipType.ctIntersection,built.geometry,toPaths(boardRectangle(W,H)),ClipperLib.PolyFillType.pftEvenOdd,'roads','Topo roads'):[];
 const overWaterAreaMm2=Math.max(0,geometryAreaMm2(onBoard)-finalAreaMm2);

 const warnings:TopoFeatureWarning[]=[];
 const floored=flooredRoadClasses(roads,settings.detail,widths);
 if(floored.length)warnings.push({code:'road-width-floor',message:`${floored.length} road class${floored.length>1?'es':''} (${floored.join(', ')}) would be narrower than the ${MIN_ENGRAVABLE_WIDTH_MM} mm the laser can engrave, so ${floored.length>1?'they were':'it was'} widened to it and no longer thinner than the rest.`});
 if(built.metrics.filledHoles)warnings.push({code:'road-gaps-filled',message:`${built.metrics.filledHoles} gap${built.metrics.filledHoles>1?'s':''} between roads ${built.metrics.filledHoles>1?'were':'was'} too small to leave standing and ${built.metrics.filledHoles>1?'were':'was'} filled in. Lower the road detail or thickness to keep them.`});
 if(built.metrics.droppedIslands)warnings.push({code:'road-fragments-dropped',message:`${built.metrics.droppedIslands} road fragment${built.metrics.droppedIslands>1?'s':''} too small to engrave ${built.metrics.droppedIslands>1?'were':'was'} dropped.`});
 // With the water known, what counts is roads that actually run out over it and stop (the bridge
 // analysis's dead ends); the rest of the clipped area is the road's half-width overhanging a
 // simplified shoreline. Without it, the area is all there is to go on.
 const deadEnds=options.water?.length?analysis.deadEnds:undefined;
 if(deadEnds!==undefined?deadEnds>0:overWaterAreaMm2>1)warnings.push({code:'roads-over-water',message:`${deadEnds?`${deadEnds} road${deadEnds>1?'s run':' runs'}`:'Roads run'} out over water without reaching land again (piers, boat launches, roads leaving the board). Water is cut out, so ${deadEnds===1?'it has':'they have'} nothing under ${deadEnds===1?'it':'them'} there and ${deadEnds===1?'that part was':'those parts were'} left off.`});
 warnings.push(...bridgeTabWarnings(analysis.spans,'road'));
 return {
  geometry:onLand,
  bridgeTabs:tabs,
  bridges:{spans:analysis.spans.length,lengthMm:analysis.spans.reduce((sum,s)=>sum+s.lengthMm,0),narrowestTabMm:analysis.spans.length?Math.min(...analysis.spans.map(s=>s.widthMm)):undefined,widestTabMm:analysis.spans.length?Math.max(...analysis.spans.map(s=>s.widthMm)):undefined,deadEndsOverWater:analysis.deadEnds,tunnelsOverWater:analysis.tunnelsOverWater},
  metrics:{...built.metrics,overWaterAreaMm2,finalAreaMm2,finalVertices:countVertices(onLand)},
  warnings,
 };
}

// One bridge candidate per board-clipped piece of each road at the detail level, tagged with its road
// class (widths are applied by the caller, since they follow the thickness setting).
export function roadBridgeCandidates(roads:readonly CapturedRoad[],view:FrozenTerrainView,detail:TopoDetail,simplifyToleranceMm=0,tunnelKeys:readonly string[]=[]):BridgeCandidate[]{
 const project=boardProjection(view);
 const allowed=roadClassesForDetailSet(detail);
 const tunnels=new Set(tunnelKeys);
 const out:BridgeCandidate[]=[];
 for(const road of roads){
  if(!allowed.has(road.roadClass))continue;
  const line=projectLine(road.line,project);
  const tunnel=tunnels.size>0&&tunnels.has(roadKey(road));
  for(const piece of clipPolylineToRect(simplifyToleranceMm>0?simplifyLine(line,simplifyToleranceMm):line,0,0,view.widthMm,view.heightMm))out.push({line:piece,widthMm:0,tag:road.roadClass,...(tunnel?{tunnel}:{})});
 }
 return out;
}

// The physical width a class is drawn at on this board — the width the buffer uses, and the stroke
// width the preview draws its centrelines at.
export const topoRoadWidthMm=(roadClass:string,view:FrozenTerrainView,thicknessScale:number)=>roadWidthMm(roadClass,topoRoadWidthSettings(view,thicknessScale));

export interface RoadCentrelines{roadClass:string;lines:PolylineMm[]}

// The preview's roads: the same filtered, projected, board-clipped centrelines the buffer starts
// from, grouped by class and ordered minor first so major roads draw on top. Depends only on the
// capture and the detail level, so a thickness change re-strokes these without rebuilding them.
export function roadCentrelines(roads:readonly CapturedRoad[],view:FrozenTerrainView,detail:TopoDetail,simplifyToleranceMm=0):RoadCentrelines[]{
 const project=boardProjection(view);
 const allowed=roadClassesForDetailSet(detail);
 const byClass=new Map<string,PolylineMm[]>();
 for(const road of roads){
  if(!allowed.has(road.roadClass))continue;
  const line=projectLine(road.line,project);
  const pieces=clipPolylineToRect(simplifyToleranceMm>0?simplifyLine(line,simplifyToleranceMm):line,0,0,view.widthMm,view.heightMm);
  if(!pieces.length)continue;
  const bucket=byClass.get(road.roadClass);
  if(bucket)bucket.push(...pieces);else byClass.set(road.roadClass,[...pieces]);
 }
 const width=(roadClass:string)=>ROAD_WIDTH_TABLE_MM[roadClass]??UNKNOWN_ROAD_WIDTH_MM;
 return [...byClass].map(([roadClass,lines])=>({roadClass,lines})).sort((a,b)=>width(a.roadClass)-width(b.roadClass)||(a.roadClass<b.roadClass?-1:a.roadClass>b.roadClass?1:0));
}
