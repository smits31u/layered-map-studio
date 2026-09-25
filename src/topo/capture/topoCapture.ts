import {dedupeBy,lineKey} from '../../ornament/capture/dedupe';
import type {CapturedFeatures,CapturedRoad} from '../../ornament/capture/featureTypes';
import {CaptureError,DEFAULT_IDLE_TIMEOUT_MS,extractCapturedFeatures,readViewport,sameViewport,waitForIdle,type CaptureMap,type CaptureMapFeature,type CaptureWarning} from '../../ornament/capture/mapCapture';
import {ZeroSizedViewportError,type LngLatTuple,type ViewportSnapshot} from '../../ornament/geometry/mapProjection';
import {assessCaptureCapacity} from '../../ornament/limits';
import {OPENFREEMAP,type VectorTileProvider} from '../../ornament/map/provider';
import {boardProjection} from '../features/projection';
import {freezeTerrainView,type FrozenTerrainView} from '../terrain/pipeline';

// Feature capture for the topo builder: water, roads and labels from the frozen map view (plan
// §Map and feature capture, Phase 3 step 1).
//
// This is the ornament's capture (src/ornament/capture/mapCapture.ts) applied to a rectangle, and it
// reuses that module's steps rather than restating them:
//   - waitForIdle, then refuse an unloaded style;
//   - readViewport, which also refuses a rotated or tilted map;
//   - query only the layers that are needed, inside the crop frame only;
//   - extractCapturedFeatures, which deep-copies every coordinate out of MapLibre's tile memory and
//     dedupes across tiles and style layers with the quantised keys in dedupe.ts;
//   - assessCaptureCapacity, the same refusal limits (they are per rendered map pixel, and the topo
//     crop frame is the same few hundred pixels across as the ornament's map window);
//   - read the viewport again and refuse if it moved during the capture.
//
// What differs is how layers are found. The ornament draws its own minimal style and queries its own
// layer ids. The topo map shows the full OpenFreeMap basemap, whose layer ids belong to someone else
// and change with the style's version — so layers are discovered by source-layer, the plan's "Do not
// hard-code only style-layer IDs. Discover by `source-layer`, validate expected layers on load, and
// surface a clear compatibility error."
//
// Every road class is captured whatever the detail setting, because the map is gone once edit mode
// opens: road detail then filters the stored capture (roads.ts), with no second capture.

export const TOPO_LABEL_SOURCE_LAYERS={place:'place',poi:'poi'} as const;
export type TopoLabelKind=keyof typeof TOPO_LABEL_SOURCE_LAYERS;

export interface CapturedLabel{
 kind:TopoLabelKind;
 name:string;
 // OpenMapTiles' class: city/town/village/suburb/… for places, park/school/… for POIs.
 labelClass:string;
 // OpenMapTiles' rank, lower is more important; 99 when absent.
 rank:number;
 point:LngLatTuple;
}

export interface TopoCaptureLayers{water:string[];roads:string[];labels:string[]}

// The serializable record of one capture: plain arrays and numbers, like the ornament's
// FeatureCapture, so it crosses to a worker, is what a fixture stores, and is what a test replays.
export interface TopoCapture{
 // The view the terrain is generated for, frozen from the same map read as the features.
 view:FrozenTerrainView;
 viewport:ViewportSnapshot;
 features:CapturedFeatures;
 labels:CapturedLabel[];
 duplicateLabels:number;
 // roadKey()s of the roads the tiles mark as tunnels (OpenMapTiles `brunnel=tunnel`). A tunnel under
 // water is never bridged (features/bridges.ts). Optional so a capture recorded without it replays.
 tunnelRoadKeys?:string[];
 layers:TopoCaptureLayers;
 // Set when the capture was thin enough to need simplifying (the ornament's capacity rule).
 simplifyToleranceMm?:number;
 capturedAt:number;
}

export interface TopoCaptureResult{capture:TopoCapture;warnings:CaptureWarning[]}

export type TopoCaptureErrorCode='incompatible-style';
export class TopoCaptureError extends Error{
 constructor(readonly code:TopoCaptureErrorCode,message:string){super(message);this.name='TopoCaptureError'}
}

export interface StyleLayerLike{id:string;type?:string;source?:string;'source-layer'?:string}
export interface StyleLike{sources?:Record<string,{type?:string}|undefined>;layers?:StyleLayerLike[]}

export interface TopoCaptureMap extends CaptureMap{getStyle():StyleLike|undefined}

// The style layers drawing each feature family from a vector source. Water is a fill, roads are
// lines, labels are symbols; a road casing and its fill are both lines on `transportation`, which is
// fine — the same road returned twice is exactly what the dedupe removes.
export function discoverCaptureLayers(style:StyleLike|undefined,provider:VectorTileProvider=OPENFREEMAP):TopoCaptureLayers{
 const vector=new Set(Object.entries(style?.sources??{}).filter(([,source])=>source?.type==='vector').map(([id])=>id));
 const pick=(sourceLayers:readonly string[],type:string)=>(style?.layers??[])
  .filter(layer=>layer.type===type&&layer.source!==undefined&&vector.has(layer.source)&&sourceLayers.includes(layer['source-layer']??''))
  .map(layer=>layer.id);
 const layers={
  water:pick([provider.sourceLayers.water],'fill'),
  roads:pick([provider.sourceLayers.transportation],'line'),
  labels:pick(Object.values(TOPO_LABEL_SOURCE_LAYERS),'symbol'),
 };
 const missing=[...(layers.water.length?[]:['water']),...(layers.roads.length?[]:['roads'])];
 if(missing.length)throw new TopoCaptureError('incompatible-style',`The map style draws no ${missing.join(' or ')} from its vector tiles (source-layer "${missing.map(m=>m==='water'?provider.sourceLayers.water:provider.sourceLayers.transportation).join('", "')}"), so they cannot be captured. The basemap style may have changed.`);
 return layers;
}

const LABEL_NAME_PROPERTIES=['name:latin','name:en','name'];

// Place and POI points with a name. Latin-script names are preferred because the bundled fonts are
// Latin (ADR 0002); a name only in another script would engrave as .notdef boxes.
export function extractTopoLabels(features:readonly CaptureMapFeature[]):{labels:CapturedLabel[];duplicates:number}{
 const labels:CapturedLabel[]=[];
 for(const feature of features){
  const kind=feature.sourceLayer===TOPO_LABEL_SOURCE_LAYERS.place?'place':feature.sourceLayer===TOPO_LABEL_SOURCE_LAYERS.poi?'poi':undefined;
  if(!kind)continue;
  const properties=feature.properties??{};
  const name=LABEL_NAME_PROPERTIES.map(key=>properties[key]).find((value):value is string=>typeof value==='string'&&value.trim()!=='')?.trim();
  if(!name)continue;
  const {type,coordinates}=feature.geometry;
  const points=type==='Point'?[coordinates]:type==='MultiPoint'&&Array.isArray(coordinates)?coordinates:[];
  const rank=Number(properties.rank);
  for(const point of points){
   if(!Array.isArray(point)||!Number.isFinite(point[0])||!Number.isFinite(point[1]))continue;
   labels.push({kind,name,labelClass:String(properties.class??''),rank:Number.isFinite(rank)?rank:99,point:[point[0],point[1]]});
  }
 }
 // A label repeats across tiles (each tile's buffer carries its neighbour's points) and across style
 // layers; the quantised point key is the ornament's.
 const deduped=dedupeBy(labels,label=>`${label.kind}|${label.labelClass}|${label.name}|${lineKey([label.point])}`);
 return {labels:deduped.items,duplicates:deduped.duplicates};
}

// The identity the capture dedupes roads by (extractCapturedFeatures): class plus quantised geometry.
export const roadKey=(road:CapturedRoad)=>`${road.roadClass} ${lineKey(road.line)}`;

// Keys of the tunnel roads among raw rendered features, matching roadKey() of the captured roads.
export function tunnelRoadKeys(features:readonly CaptureMapFeature[],provider:VectorTileProvider=OPENFREEMAP):string[]{
 const keys=new Set<string>();
 for(const feature of features){
  if(feature.sourceLayer!==provider.sourceLayers.transportation||feature.properties?.brunnel!=='tunnel')continue;
  const roadClass=String(feature.properties?.[provider.roadClassProperty]??'');
  const {type,coordinates}=feature.geometry;
  const lines=type==='LineString'?[coordinates]:type==='MultiLineString'&&Array.isArray(coordinates)?coordinates:[];
  for(const line of lines)if(Array.isArray(line)&&line.length>=2)keys.add(roadKey({roadClass,line:line as [number,number][]}));
 }
 return [...keys];
}

export interface TopoCaptureOptions{
 // The crop frame's CSS width. The frame is centred on the map, and its height follows from the
 // board's proportions (freezeTerrainView).
 frameWidthPx:number;
 widthMm:number;
 heightMm:number;
 provider?:VectorTileProvider;
 idleTimeoutMs?:number;
 now?:()=>number;
}

// Two decodings of the same pixel agree to well under a pixel; the ornament's tolerance.
const PROJECTION_TOLERANCE_PX=.5;

export async function captureTopoFeatures(map:TopoCaptureMap,options:TopoCaptureOptions):Promise<TopoCaptureResult>{
 const provider=options.provider??OPENFREEMAP;
 const warnings:CaptureWarning[]=[];
 const idle=await waitForIdle(map,options.idleTimeoutMs??DEFAULT_IDLE_TIMEOUT_MS);
 if(!idle)warnings.push({code:'not-idle',message:'The map was still loading tiles when its features were captured, so some water, roads or labels may be missing. Go back to the map and generate again once it has settled.'});
 if(!map.isStyleLoaded())throw new CaptureError('The map style has not finished loading, so there is nothing to capture yet.','not-ready');
 const layers=discoverCaptureLayers(map.getStyle(),provider);
 if(!layers.labels.length)warnings.push({code:'no-label-layers',message:'The map style draws no place or POI labels, so the board will have none.'});

 const before=readViewport(map);
 if(!(before.widthPx>0)||!(before.heightPx>0))throw new ZeroSizedViewportError('The map has not been measured yet (its rendered size is zero), so captured features have no physical scale.');
 const view=freezeTerrainView(before.center,before.zoom,options.frameWidthPx,options.widthMm,options.heightMm);
 assertBoardProjectionAgrees(map,view,before);

 const cx=before.widthPx/2,cy=before.heightPx/2;
 const box:[[number,number],[number,number]]=[[cx-view.frameWidthPx/2,cy-view.frameHeightPx/2],[cx+view.frameWidthPx/2,cy+view.frameHeightPx/2]];
 const rendered=map.queryRenderedFeatures(box,{layers:[...layers.water,...layers.roads]});
 const features=extractCapturedFeatures(rendered,provider);
 const tunnels=tunnelRoadKeys(rendered,provider);
 const capacity=assessCaptureCapacity(features);
 if(capacity.refusal)throw new CaptureError(capacity.refusal,'too-large');
 const {labels,duplicates}=extractTopoLabels(layers.labels.length?map.queryRenderedFeatures(box,{layers:layers.labels}):[]);

 if(!sameViewport(before,readViewport(map)))throw new CaptureError('The map moved while its features were being captured. Generate again once it has stopped.','moved');
 return {
  capture:{view,viewport:before,features,labels,duplicateLabels:duplicates,...(tunnels.length?{tunnelRoadKeys:tunnels}:{}),layers,...(capacity.simplifyToleranceMm?{simplifyToleranceMm:capacity.simplifyToleranceMm}:{}),capturedAt:(options.now??Date.now)()},
  warnings,
 };
}

// The board projection is pure Mercator arithmetic so it can run in a worker; this checks it against
// the live map once per capture, as the ornament does, at a point a quarter of the frame in from its
// centre on both axes.
function assertBoardProjectionAgrees(map:CaptureMap,view:FrozenTerrainView,viewport:ViewportSnapshot):void{
 const {west,south,east,north}=view.bounds;
 const probe:[number,number]=[view.center[0]+(east-west)/4,view.center[1]+(north-south)/4];
 const expected=boardProjection(view)(probe[0],probe[1]);
 const actual=map.project(probe);
 const mmPerPx=view.widthMm/view.frameWidthPx;
 const actualMm=[(actual.x-viewport.widthPx/2)*mmPerPx+view.widthMm/2,(actual.y-viewport.heightPx/2)*mmPerPx+view.heightMm/2];
 const tolerance=PROJECTION_TOLERANCE_PX*mmPerPx;
 if(!expected.every(Number.isFinite)||Math.abs(actualMm[0]-expected[0])>tolerance||Math.abs(actualMm[1]-expected[1])>tolerance)
  throw new CaptureError('The board and the map disagree about where map coordinates fall, so captured features would land in the wrong place. This usually means the tile provider is not using 512px tiles.','projection-mismatch');
}
