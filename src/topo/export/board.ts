import type * as opentype from 'opentype.js';
import type {MultiPolygonMm} from '../../geometry/shoreline/polygonEngine';
import {clipLinesToArea,type LineMm} from '../../geometry/terrain/contourLines';
import {subtract,unionAll} from '../../ornament/geometry/polygonRepair';
import type {FontId} from '../../types/project';
import type {TopoCapture} from '../capture/topoCapture';
import {buildOverlay,type BoardOverlay} from '../features/overlay';
import {buildTopoRoads,type TopoRoadLayer} from '../features/roads';
import {buildRouteGeometry,type TopoRouteLayer} from '../features/route';
import type {TopoFeatureWarning} from '../features/warnings';
import {boardRectangle} from '../terrain/bands';
import type {TerrainResult} from '../terrain/pipeline';
import type {TopoProject} from '../types';

// The board as it will be cut: every piece of geometry the SVG will contain, in the plan's semantic
// groups (§6), in board millimetres.
//
// Built from scratch from the project, the capture and the terrain result — the same pure functions
// the preview and the feature worker use (buildOverlay, buildTopoRoads, buildRouteGeometry) — so what
// is exported is a function of the current settings and never of whatever a worker last finished.
// Terrain is *not* rebuilt: the terrain result is an input, exactly as in the preview, and nothing
// here can trigger a terrain run.
//
// Where things go:
//   cut/terrain-1   the land plus the bridge tabs. Phase 3 built the tabs as layer-1 material (the
//                   roads are clipped to land ∪ tabs), so this is where they are cut: one connected
//                   piece across each crossing, not a separate loose strip.
//   cut/water       the water minus the tabs — exactly the openings left in layer 1, so terrain-1 and
//                   water tile the board without overlapping.
//   cut/terrain-2…4 the elevation bands, nested inside terrain-1.
//   cut/roads       the buffered roads, on land and bridge tabs.
//   cut/frame       the frame ring.
//   score/contours  contour centrelines, open paths, one per elevation.
//   score/route     the GPX route's centreline, clipped to the land and its tabs.
//   engrave/labels, engrave/title   glyph outlines, positions baked in.
//   engrave/compass the compass is not built yet (docs/topo-implementation-status.md), so this group
//                   is always present and always empty.
// Every group is always emitted, in this order, so an importer can rely on the structure; an unused
// one is empty and says so.
//
// A street map (project.style 'street') is one flat board, so it has its own order, STREET_GROUP_ORDER:
//   cut/base            the board. A rectangle, unless water is cut out: then the land plus bridge
//                       tabs, holes and all, exactly like cut/terrain-1. There is no cut/water: the
//                       shoreline is cut once, as the base's holes, not a second time as openings.
//   cut/roads           the roads as openings, when street.roads is 'cut' (a top sheet over a backing).
//   score/route         the GPX route's centreline.
//   engrave-light/water the water, engraved lightly, when street.water is 'engrave'. The roads are
//                       subtracted from it, so no area is burned twice where a bridge crosses.
//   engrave/roads       the roads as filled areas, when street.roads is 'engrave' (the default).
//   engrave/labels, engrave/title   as on a topo board.
// When water is not cut out, roads are kept over it (a bridge is engraved across the water, not
// tabbed), since nothing under them is removed.

export type TopoGroupId=
 |'cut/frame'|'cut/terrain-1'|'cut/terrain-2'|'cut/terrain-3'|'cut/terrain-4'|'cut/water'|'cut/roads'
 |'score/contours'|'score/route'
 |'engrave/labels'|'engrave/title'|'engrave/compass'
 |'cut/base'|'engrave-light/water'|'engrave/roads';

export const TOPO_GROUP_ORDER:readonly TopoGroupId[]=['cut/frame','cut/terrain-1','cut/terrain-2','cut/terrain-3','cut/terrain-4','cut/water','cut/roads','score/contours','score/route','engrave/labels','engrave/title','engrave/compass'];
export const STREET_GROUP_ORDER:readonly TopoGroupId[]=['cut/frame','cut/base','cut/roads','score/route','engrave-light/water','engrave/roads','engrave/labels','engrave/title'];

// The group that is the board's base material: what is cut out and what everything sits on.
export const baseGroupId=(style:TopoProject['style']):TopoGroupId=>style==='street'?'cut/base':'cut/terrain-1';

export type TopoOperation='cut'|'score'|'engrave'|'engrave-light';
// pieces: closed regions that are material (the pieces a maker picks up). openings: closed regions
// removed from material. lines: open score paths. glyphs: closed engrave outlines. areas: closed
// regions engraved as a fill (a street map's roads and water).
export type TopoGroupKind='pieces'|'openings'|'lines'|'glyphs'|'areas';

export interface TopoGlyph{d:string;name:string}
export interface TopoScoreLine{lines:LineMm[];label?:string}

export interface TopoExportGroup{
 id:TopoGroupId;
 operation:TopoOperation;
 kind:TopoGroupKind;
 geometry:MultiPolygonMm;
 lines:TopoScoreLine[];
 glyphs:TopoGlyph[];
 // Score lines' stroke width, when the width is physical (the route).
 strokeWidthMm?:number;
 // Why an empty group is empty.
 emptyReason?:string;
}

export interface TopoBoard{
 style:TopoProject['style'];
 widthMm:number;heightMm:number;
 groups:TopoExportGroup[];
 // The water openings in the base. On a topo board this is cut/water's geometry; a street map does
 // not emit it as a group (the base's holes are the cut), so preflight reads it from here.
 waterOpenings:MultiPolygonMm;
 bridgeTabs:MultiPolygonMm;
 roads?:TopoRoadLayer;
 route?:TopoRouteLayer;
 overlay:BoardOverlay;
 // Warnings from building the features, carried into preflight.
 warnings:TopoFeatureWarning[];
}

export interface TopoBoardInput{
 project:TopoProject;
 terrain:TerrainResult;
 capture?:TopoCapture;
 font:(id:FontId)=>opentype.Font|undefined;
}

const operationOf=(id:TopoGroupId):TopoOperation=>id.split('/')[0] as TopoOperation;

export function buildTopoBoard(input:TopoBoardInput):TopoBoard{
 const {project,terrain,capture}=input;
 const view=terrain.view,W=view.widthMm,H=view.heightMm;
 const street=project.style==='street';
 const water=terrain.water;
 // Water removes material under the roads only where it is cut: a topo board always, a street map
 // only in cutout mode. Otherwise roads and the route lie on the whole board and need no tabs.
 const waterCut=!street||project.street.water==='cutout';
 const land=waterCut?terrain.layers[0]?.geometry??[]:boardRectangle(W,H);
 const cutWater=waterCut?water:[];
 const overlay=buildOverlay({capture,view,water,settings:{roads:project.roads,labels:project.labels,frame:project.frame,title:project.title,route:project.route},font:input.font}).overlay;

 const roads=capture&&project.roads.enabled?buildTopoRoads(capture.features.roads,view,{detail:project.roads.detail,thicknessScale:project.roads.thicknessScale},land,{water:cutWater,tunnelRoadKeys:capture.tunnelRoadKeys,simplifyToleranceMm:capture.simplifyToleranceMm}):undefined;
 const routeLines=overlay.route&&!overlay.route.lines.outsideBoard?overlay.route.lines.lines:undefined;
 const route=routeLines&&project.route?buildRouteGeometry(routeLines,project.route.widthMm,land,cutWater,{widthMm:W,heightMm:H}):undefined;

 const tabParts=[roads?.bridgeTabs??[],route?.bridgeTabs??[]].filter(part=>part.length);
 const bridgeTabs=tabParts.length>1?unionAll(tabParts,'Bridge tabs'):tabParts[0]??[];
 const base=bridgeTabs.length?unionAll([land,bridgeTabs],street?'Street base':'Terrain layer 1'):land;
 const openings=bridgeTabs.length?subtract(cutWater,bridgeTabs,'Water'):cutWater;

 const empty=(id:TopoGroupId,kind:TopoGroupKind,reason:string):TopoExportGroup=>({id,operation:operationOf(id),kind,geometry:[],lines:[],glyphs:[],emptyReason:reason});
 const group=(id:TopoGroupId,kind:TopoGroupKind,parts:Partial<TopoExportGroup>):TopoExportGroup=>({id,operation:operationOf(id),kind,geometry:[],lines:[],glyphs:[],...parts});
 const layer=(k:number)=>terrain.layers.find(l=>l.index===k);
 const roadsEmpty=project.roads.enabled?'No roads on this board.':'Roads are off.';

 const frame=overlay.frame?group('cut/frame','pieces',{geometry:overlay.frame.geometry}):empty('cut/frame','pieces','The frame is off.');
 const routeGroup=routeLines&&project.route?group('score/route','lines',{lines:[{lines:clipLinesToArea(routeLines,base),...(project.route.name?{label:project.route.name}:{})}],strokeWidthMm:project.route.widthMm}):empty('score/route','lines',project.route?'The route does not cross this board.':'No route is loaded.');
 const labels=overlay.labels.visible&&overlay.labels.layer?.placed.length?group('engrave/labels','glyphs',{glyphs:overlay.labels.layer.placed.map(l=>({d:l.d,name:l.name}))}):empty('engrave/labels','glyphs','No labels are placed.');
 const title=overlay.title?group('engrave/title','glyphs',{glyphs:[{d:overlay.title.d,name:overlay.title.text}]}):empty('engrave/title','glyphs','No title.');

 let groups:TopoExportGroup[];
 if(street){
  const roadGeometry=roads?.geometry??[];
  const engraveRoads=project.street.roads==='engrave';
  const engravedWater=project.street.water==='engrave'&&water.length?(roadGeometry.length?subtract(water,roadGeometry,'Engraved water'):water):[];
  const waterReason={engrave:'No water on this board.',cutout:'Water is cut out: its outline is the holes in cut/base.',none:'Water is left off.'}[project.street.water];
  groups=[
   frame,
   group('cut/base','pieces',{geometry:base}),
   !engraveRoads&&roadGeometry.length?group('cut/roads','openings',{geometry:roadGeometry}):empty('cut/roads','openings',engraveRoads?'Roads are engraved (engrave/roads).':roadsEmpty),
   routeGroup,
   engravedWater.length?group('engrave-light/water','areas',{geometry:engravedWater}):empty('engrave-light/water','areas',waterReason),
   engraveRoads&&roadGeometry.length?group('engrave/roads','areas',{geometry:roadGeometry}):empty('engrave/roads','areas',engraveRoads?roadsEmpty:'Roads are cut out (cut/roads).'),
   labels,
   title,
  ];
 }else groups=[
  frame,
  group('cut/terrain-1','pieces',{geometry:base}),
  ...[2,3,4].map(k=>{const l=layer(k);return l?group(`cut/terrain-${k}` as TopoGroupId,'pieces',{geometry:l.geometry}):empty(`cut/terrain-${k}` as TopoGroupId,'pieces',`The board has ${terrain.layers.length} layer${terrain.layers.length===1?'':'s'}.`)}),
  openings.length?group('cut/water','openings',{geometry:openings}):empty('cut/water','openings','No water on this board.'),
  roads&&roads.geometry.length?group('cut/roads','openings',{geometry:roads.geometry}):empty('cut/roads','openings',roadsEmpty),
  terrain.contours.length?group('score/contours','lines',{lines:terrain.contours.map(level=>({lines:level.lines,label:`${Number(level.elevation.toFixed(2))} m`}))}):empty('score/contours','lines',project.terrain.contoursEnabled?'No contours on this board.':'Contours are off.'),
  routeGroup,
  labels,
  title,
  empty('engrave/compass','glyphs','The compass is not built yet.'),
 ];
 return {
  style:project.style,
  widthMm:W,heightMm:H,groups,waterOpenings:openings,bridgeTabs,
  ...(roads?{roads}:{}),...(route?{route}:{}),
  overlay,
  warnings:[...overlay.warnings,...(roads?.warnings??[]),...(route?.warnings??[])],
 };
}
