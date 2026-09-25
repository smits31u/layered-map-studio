import type * as opentype from 'opentype.js';
import type {MultiPolygonMm} from '../../geometry/shoreline/polygonEngine';
import type {PolylineMm} from '../../ornament/geometry/clipLine';
import type {FontId} from '../../types/project';
import type {TopoCapture} from '../capture/topoCapture';
import type {FrozenTerrainView} from '../terrain/pipeline';
import type {TopoProject} from '../types';
import {buildFrame,type TopoFrame} from './frame';
import {placeLabels,type TopoLabelLayer} from './labels';
import {findBridgeSpans} from './bridges';
import {roadBridgeCandidates,roadCentrelines,topoRoadWidthMm,type RoadCentrelines} from './roads';
import {projectRouteLines,type RouteLines} from './route';
import {buildTitle,type TopoTitle} from './title';
import type {TopoFeatureWarning} from './warnings';

// The board's overlay — roads, route, labels, title, frame — as the preview draws it, rebuilt only
// where its inputs changed.
//
// This is the lake tool's split between the geometry cache and the presentation layer
// (src/export/geometryCache.ts, buildScene.ts), applied to the topo board. There, the expensive
// polygon work is cached under a key of only the inputs that shape it, and label, title and override
// changes never touch it. Here:
//
//   terrain        the worker's job, keyed by terrainRunKey (regeneration.ts) — the terrain settings
//                  and smoothing only. Nothing in this file is in that key, so no overlay control can
//                  regenerate terrain.
//   overlay parts  each cached below under a key of what shapes it. Captures and terrain results
//                  are compared by identity, as geometryCache compares extracted features: a new
//                  object exists only when a new capture or a new terrain run happened.
//   presentation   the enabled flags, road thickness and route width. They change what is drawn or
//                  a stroke width, never a cached value.
//
// buildOverlay reports which parts it rebuilt, so "a toggle rebuilds nothing" is something a test can
// check directly rather than infer from timing.

export type OverlaySettings=Pick<TopoProject,'roads'|'labels'|'frame'|'title'|'route'>;

export interface OverlayInputs{
 capture:TopoCapture|undefined;
 view:FrozenTerrainView;
 // From the terrain result: the water cut out of every layer. Labels and the title avoid it.
 water:MultiPolygonMm;
 settings:OverlaySettings;
 font:(id:FontId)=>opentype.Font|undefined;
}

export interface OverlayRoadClass{roadClass:string;widthMm:number;d:string;lines:number}

export interface BoardOverlay{
 roads:{visible:boolean;classes:OverlayRoadClass[];bridges:OverlayRoadClass[]};
 route?:{d:string;widthMm:number;lines:RouteLines;bridgesD:string};
 labels:{visible:boolean;layer?:TopoLabelLayer};
 frame?:TopoFrame;
 title?:TopoTitle;
 warnings:TopoFeatureWarning[];
}

export type OverlayPart='roadLines'|'roadBridges'|'routeLines'|'routeBridges'|'frame'|'title'|'labels';

export interface OverlayCache{entries:Partial<Record<OverlayPart,{key:string;value:unknown}>>}

// Stable ids for objects compared by identity, so a key can be a string.
const ids=new WeakMap<object,number>();
let nextId=1;
const idOf=(value:object|undefined|null)=>{
 if(!value)return 0;
 let id=ids.get(value);
 if(id===undefined){id=nextId++;ids.set(value,id)}
 return id;
};

// Preview path data at 0.01 mm: finer than any stroke, and a fraction of the full-precision size.
export const linesPath=(lines:readonly PolylineMm[])=>lines.map(line=>line.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join('')).join('');

export function buildOverlay(inputs:OverlayInputs,previous:OverlayCache={entries:{}}):{overlay:BoardOverlay;cache:OverlayCache;rebuilt:OverlayPart[]}{
 const {capture,view,water,settings}=inputs;
 const entries:OverlayCache['entries']={};
 const rebuilt:OverlayPart[]=[];
 const cached=<T>(part:OverlayPart,key:string,build:()=>T):T=>{
  const hit=previous.entries[part];
  if(hit&&hit.key===key){entries[part]=hit;return hit.value as T}
  const value=build();
  entries[part]={key,value};
  rebuilt.push(part);
  return value;
 };
 const warnings:TopoFeatureWarning[]=[];
 const {widthMm:W,heightMm:H}=view;
 const viewKey=idOf(view);
 // No water is the same input however many empty arrays it arrives as.
 const waterKey=water.length?idOf(water):0;

 const roadLines=cached('roadLines',JSON.stringify([idOf(capture),viewKey,settings.roads.detail]),()=>
  capture?roadCentrelines(capture.features.roads,view,settings.roads.detail,capture.simplifyToleranceMm).map(group=>({...group,d:linesPath(group.lines)})):[] as (RoadCentrelines&{d:string})[]);
 // Bridge spans: where a road genuinely crosses the water cut out of the terrain (bridges.ts). They
 // are drawn over the water at the road's width — the tab and the road engraved on it — and, like
 // the rest of the roads, their width is presentation and never rebuilds them.
 const roadBridges=cached('roadBridges',JSON.stringify([idOf(capture),viewKey,settings.roads.detail,waterKey]),()=>{
  if(!capture||!water.length)return [] as (RoadCentrelines&{d:string})[];
  const {spans}=findBridgeSpans(roadBridgeCandidates(capture.features.roads,view,settings.roads.detail,capture.simplifyToleranceMm,capture.tunnelRoadKeys).map(c=>({...c,widthMm:topoRoadWidthMm(c.tag!,view,1)})),water,W,H);
  const byClass=new Map<string,PolylineMm[]>();
  for(const span of spans){const lines=byClass.get(span.tag!);if(lines)lines.push(span.line);else byClass.set(span.tag!,[span.line])}
  return [...byClass].map(([roadClass,lines])=>({roadClass,lines,d:linesPath(lines)}));
 });
 const strokes=(groups:readonly (RoadCentrelines&{d:string})[])=>groups.map(group=>({roadClass:group.roadClass,widthMm:topoRoadWidthMm(group.roadClass,view,settings.roads.thicknessScale),d:group.d,lines:group.lines.length}));
 const roads={visible:settings.roads.enabled,classes:strokes(roadLines),bridges:strokes(roadBridges)};

 const routeLines=cached('routeLines',JSON.stringify([idOf(settings.route?.segments),viewKey]),()=>settings.route?projectRouteLines(settings.route,view):undefined);
 const routeBridges=cached('routeBridges',JSON.stringify([idOf(settings.route?.segments),viewKey,waterKey]),()=>
  routeLines&&water.length?linesPath(findBridgeSpans(routeLines.lines.map(line=>({line,widthMm:1})),water,W,H).spans.map(span=>span.line)):'');
 const route=settings.route&&routeLines?{d:linesPath(routeLines.lines),widthMm:settings.route.widthMm,lines:routeLines,bridgesD:routeBridges}:undefined;
 if(route&&routeLines?.outsideBoard)warnings.push({code:'route-outside-board',message:'The loaded route does not cross this board, so it is not drawn.'});

 const framed=cached('frame',JSON.stringify([W,H,settings.frame.enabled,settings.frame.thicknessMm]),()=>settings.frame.enabled?buildFrame(W,H,settings.frame.thicknessMm):{warnings:[]});
 warnings.push(...framed.warnings);
 const insetMm=framed.frame?.insetMm??0;

 const titleFont=inputs.font(settings.title.fontId);
 const titled=cached('title',JSON.stringify([settings.title,W,H,insetMm,idOf(titleFont),waterKey]),()=>
  titleFont?buildTitle(settings.title,W,H,insetMm,titleFont,water):{warnings:settings.title.text.trim()?[{code:'font-loading',message:'The title font is still loading.'}]:[]} as ReturnType<typeof buildTitle>);
 warnings.push(...titled.warnings);

 const labelFont=inputs.font('inter');
 // Place names and points of interest are separate toggles (POIs off by default), so which kinds are
 // placed is part of the key: turning one off frees its space for the other.
 const kinds={place:settings.labels.enabled,poi:settings.labels.poiEnabled};
 const labelsVisible=kinds.place||kinds.poi;
 const labelLayer=cached('labels',JSON.stringify([idOf(capture),viewKey,settings.labels.sizeMm,kinds,insetMm,waterKey,titled.title?.box??null,idOf(labelFont)]),()=>
  capture&&labelFont?placeLabels(capture.labels.filter(label=>kinds[label.kind]),view,labelFont,{sizeMm:settings.labels.sizeMm,insetMm,water,keepOut:titled.title?[titled.title.box]:[]}):undefined);
 if(labelsVisible&&labelLayer)warnings.push(...labelLayer.warnings);
 if(labelsVisible&&capture&&!labelFont)warnings.push({code:'font-loading',message:'The label font is still loading.'});

 return {
  overlay:{roads,...(route?{route}:{}),labels:{visible:labelsVisible,...(labelLayer?{layer:labelLayer}:{})},...(framed.frame?{frame:framed.frame}:{}),...(titled.title?{title:titled.title}:{}),warnings},
  cache:{entries},
  rebuilt,
 };
}
