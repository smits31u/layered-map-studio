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

export type TopoGroupId=
 |'cut/frame'|'cut/terrain-1'|'cut/terrain-2'|'cut/terrain-3'|'cut/terrain-4'|'cut/water'|'cut/roads'
 |'score/contours'|'score/route'
 |'engrave/labels'|'engrave/title'|'engrave/compass';

export const TOPO_GROUP_ORDER:readonly TopoGroupId[]=['cut/frame','cut/terrain-1','cut/terrain-2','cut/terrain-3','cut/terrain-4','cut/water','cut/roads','score/contours','score/route','engrave/labels','engrave/title','engrave/compass'];

export type TopoOperation='cut'|'score'|'engrave';
// pieces: closed regions that are material (the pieces a maker picks up). openings: closed regions
// removed from material. lines: open score paths. glyphs: closed engrave outlines.
export type TopoGroupKind='pieces'|'openings'|'lines'|'glyphs';

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
 widthMm:number;heightMm:number;
 groups:TopoExportGroup[];
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
 const land=terrain.layers[0]?.geometry??[];
 const water=terrain.water;
 const overlay=buildOverlay({capture,view,water,settings:{roads:project.roads,labels:project.labels,frame:project.frame,title:project.title,route:project.route},font:input.font}).overlay;

 const roads=capture&&project.roads.enabled?buildTopoRoads(capture.features.roads,view,{detail:project.roads.detail,thicknessScale:project.roads.thicknessScale},land,{water,tunnelRoadKeys:capture.tunnelRoadKeys,simplifyToleranceMm:capture.simplifyToleranceMm}):undefined;
 const routeLines=overlay.route&&!overlay.route.lines.outsideBoard?overlay.route.lines.lines:undefined;
 const route=routeLines&&project.route?buildRouteGeometry(routeLines,project.route.widthMm,land,water,{widthMm:W,heightMm:H}):undefined;

 const tabParts=[roads?.bridgeTabs??[],route?.bridgeTabs??[]].filter(part=>part.length);
 const bridgeTabs=tabParts.length>1?unionAll(tabParts,'Bridge tabs'):tabParts[0]??[];
 const terrainOne=bridgeTabs.length?unionAll([land,bridgeTabs],'Terrain layer 1'):land;
 const openings=bridgeTabs.length?subtract(water,bridgeTabs,'Water'):water;

 const empty=(id:TopoGroupId,kind:TopoGroupKind,reason:string):TopoExportGroup=>({id,operation:operationOf(id),kind,geometry:[],lines:[],glyphs:[],emptyReason:reason});
 const group=(id:TopoGroupId,kind:TopoGroupKind,parts:Partial<TopoExportGroup>):TopoExportGroup=>({id,operation:operationOf(id),kind,geometry:[],lines:[],glyphs:[],...parts});
 const layer=(k:number)=>terrain.layers.find(l=>l.index===k);

 const groups:TopoExportGroup[]=[
  overlay.frame?group('cut/frame','pieces',{geometry:overlay.frame.geometry}):empty('cut/frame','pieces','The frame is off.'),
  group('cut/terrain-1','pieces',{geometry:terrainOne}),
  ...[2,3,4].map(k=>{const l=layer(k);return l?group(`cut/terrain-${k}` as TopoGroupId,'pieces',{geometry:l.geometry}):empty(`cut/terrain-${k}` as TopoGroupId,'pieces',`The board has ${terrain.layers.length} layer${terrain.layers.length===1?'':'s'}.`)}),
  openings.length?group('cut/water','openings',{geometry:openings}):empty('cut/water','openings','No water on this board.'),
  roads&&roads.geometry.length?group('cut/roads','openings',{geometry:roads.geometry}):empty('cut/roads','openings',project.roads.enabled?'No roads on this board.':'Roads are off.'),
  terrain.contours.length?group('score/contours','lines',{lines:terrain.contours.map(level=>({lines:level.lines,label:`${Number(level.elevation.toFixed(2))} m`}))}):empty('score/contours','lines',project.terrain.contoursEnabled?'No contours on this board.':'Contours are off.'),
  routeLines&&project.route?group('score/route','lines',{lines:[{lines:clipLinesToArea(routeLines,terrainOne),...(project.route.name?{label:project.route.name}:{})}],strokeWidthMm:project.route.widthMm}):empty('score/route','lines',project.route?'The route does not cross this board.':'No route is loaded.'),
  overlay.labels.visible&&overlay.labels.layer?.placed.length?group('engrave/labels','glyphs',{glyphs:overlay.labels.layer.placed.map(l=>({d:l.d,name:l.name}))}):empty('engrave/labels','glyphs','No labels are placed.'),
  overlay.title?group('engrave/title','glyphs',{glyphs:[{d:overlay.title.d,name:overlay.title.text}]}):empty('engrave/title','glyphs','No title.'),
  empty('engrave/compass','glyphs','The compass is not built yet.'),
 ];
 return {
  widthMm:W,heightMm:H,groups,bridgeTabs,
  ...(roads?{roads}:{}),...(route?{route}:{}),
  overlay,
  warnings:[...overlay.warnings,...(roads?.warnings??[]),...(route?.warnings??[])],
 };
}
