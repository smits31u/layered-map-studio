import ClipperLib from 'clipper-lib';
import type {MultiPolygonMm} from '../../geometry/shoreline/polygonEngine';
import {clip,toPaths} from '../../geometry/terrain/nestedBands';
import {clipPolylineToRect,polylineLengthMm,type PolylineMm} from '../../ornament/geometry/clipLine';
import {projectLine} from '../../ornament/geometry/mapProjection';
import {offsetPaths} from '../../ornament/geometry/offsetPaths';
import {assertFinite,geometryAreaMm2,unionAll} from '../../ornament/geometry/polygonRepair';
import {bridgeTabWarnings,bridgeTabs,findBridgeSpans,type BridgeSpan} from './bridges';
import {capArcToleranceMm} from '../../ornament/geometry/roadGeometry';
import {simplifyLine} from '../../ornament/geometry/simplify';
import type {FrozenTerrainView} from '../terrain/pipeline';
import type {TopoRoute} from '../types';
import {boardProjection} from './projection';
import type {TopoFeatureWarning} from './warnings';

// The GPX route on the board (plan §5 GPX). Phase 1 parsed it and drew it over the live map; this is
// where it reaches the board.
//
// Two products, like roads:
//   - centrelines: projected with the board projection, thinned to 0.02 mm (a long track has far more
//     fixes than a board can show), and clipped to the board — a route that leaves the crop stops at
//     its edge and resumes where it comes back, never drawn across the gap. The preview strokes these
//     at the route's physical width, so width changes are instant; they are also the score line.
//   - geometry: the centrelines buffered to the route width with round caps and joins (the
//     ornament's offsetter, as for roads), clipped to the land, since water is cut out beneath it.
//     Built in the feature worker.

export const ROUTE_SIMPLIFY_TOLERANCE_MM=.02;

export interface RouteLines{lines:PolylineMm[];lengthMm:number;inputPoints:number;outsideBoard:boolean}

export function projectRouteLines(route:TopoRoute,view:FrozenTerrainView):RouteLines{
 const project=boardProjection(view);
 const lines:PolylineMm[]=[];
 for(const segment of route.segments){
  const projected=simplifyLine(projectLine(segment,project),ROUTE_SIMPLIFY_TOLERANCE_MM);
  lines.push(...clipPolylineToRect(projected,0,0,view.widthMm,view.heightMm));
 }
 return {lines,lengthMm:lines.reduce((sum,line)=>sum+polylineLengthMm(line),0),inputPoints:route.pointCount,outsideBoard:lines.length===0};
}

export interface TopoRouteLayer{geometry:MultiPolygonMm;bridgeTabs:MultiPolygonMm;bridgeSpans:number;bridgeSpanLines:BridgeSpan[];areaMm2:number;removedOverWaterMm2:number;warnings:TopoFeatureWarning[]}

// With `water`, a route that genuinely crosses it — over a bridge, say — keeps a tab of material as
// wide as the route across the gap, exactly as roads do (bridges.ts); a route that runs out over the
// water and ends there does not.
export function buildRouteGeometry(lines:readonly PolylineMm[],widthMm:number,land:MultiPolygonMm,water:MultiPolygonMm=[],board?:{widthMm:number;heightMm:number}):TopoRouteLayer{
 const buffered=offsetPaths([...lines],widthMm/2,{joinStyle:'round',endStyle:'open-round',arcToleranceMm:capArcToleranceMm(widthMm/2)});
 const spans=water.length&&board?findBridgeSpans(lines.map(line=>({line,widthMm})),water,board.widthMm,board.heightMm).spans:[];
 const tabs=bridgeTabs(spans);
 const deck=tabs.length?unionAll([land,tabs],'Route bridge deck'):land;
 const geometry=buffered.length&&deck.length?clip(ClipperLib.ClipType.ctIntersection,buffered,toPaths(deck),ClipperLib.PolyFillType.pftEvenOdd,'route','Topo route'):[];
 assertFinite(geometry,'Route');
 const areaMm2=geometryAreaMm2(geometry),removed=Math.max(0,geometryAreaMm2(buffered)-areaMm2);
 const warnings:TopoFeatureWarning[]=[];
 // The round caps that reach past the board edge are clipped too; only a real stretch counts.
 if(removed>widthMm*widthMm*4)warnings.push({code:'route-over-water',message:`About ${Math.round(removed/widthMm)} mm of the route runs out over water without reaching land again, so that part has nothing under it and was left off.`});
 warnings.push(...bridgeTabWarnings(spans,'route'));
 return {geometry,bridgeTabs:tabs,bridgeSpans:spans.length,bridgeSpanLines:spans,areaMm2,removedOverWaterMm2:removed,warnings};
}
