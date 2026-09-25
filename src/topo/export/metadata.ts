import {APP_VERSION,escapeXml} from '../../ornament/export/metadata';
import {OPENFREEMAP} from '../../ornament/map/provider';
import {DEFAULT_TERRAIN_TILES_URL} from '../../server/terrain/tilePath';
import type {TopoCapture} from '../capture/topoCapture';
import type {TerrainResult} from '../terrain/pipeline';
import type {TopoProject} from '../types';

// What a topo SVG says about where it came from (plan §6: "metadata containing app version,
// viewport, elevation source, generation timestamp, and settings").
//
// The same discipline as the ornament's export metadata and the bathymetry module's source records
// (src/bathymetry/model.ts: provider, dataset, title, retrieved-at, quality): a cut file outlives
// the session that made it, and the bytes in the file are then the only answer to "what was this
// made from, and can it be made again". Attribution travels in the file because the licences follow
// the derived work, not the browser tab it was designed in.

export interface TopoProvider{
 id:string;
 role:'basemap'|'elevation';
 title:string;
 attribution:string;
 // Where the data came from, for the elevation source the tile URL template.
 source:string;
 // Retrieved during this generation. The bathymetry records carry the same field.
 retrievedAt:string;
 quality:string;
}

export interface TopoExportMetadata{
 appVersion:string;
 projectSchemaVersion:number;
 // ISO 8601. The one field that is not a function of the inputs, so it is an argument: tests pin it.
 generatedAt:string;
 viewport:{center:[number,number];zoom:number;bearing:0;pitch:0;place?:string;frameWidthPx:number;frameHeightPx:number;bounds:[number,number,number,number]};
 board:{widthMm:number;heightMm:number};
 providers:TopoProvider[];
 terrain:{tileZoom:number;tileCount:number;grid:string;smoothingRadius:number;elevationMinM:number;elevationMaxM:number;layers:{index:number;thresholdM:number|null;coveragePercent:number}[];contourElevationsM:number[]};
 capture?:{takenAt:string;water:number;roads:number;duplicateRoads:number;labels:number};
 bridges:{spans:number;narrowestTabMm?:number};
 // The project, with a loaded route summarised rather than inlined: the route is already in the file
 // as a line, and a 250,000-point track would dwarf everything else. The project JSON exported
 // alongside carries it whole.
 settings:unknown;
}

const round=(value:number,digits=3)=>{const r=Number(value.toFixed(digits));return Object.is(r,-0)?0:r};

export const ELEVATION_PROVIDER_ID='aws-terrain-tiles';

export interface TopoMetadataInput{
 project:TopoProject;
 terrain:TerrainResult;
 capture?:TopoCapture;
 generatedAt:Date;
 bridges:{spans:number;narrowestTabMm?:number};
 appVersion?:string;
}

export function buildTopoMetadata(input:TopoMetadataInput):TopoExportMetadata{
 const {project,terrain,capture}=input;
 const view=terrain.view;
 const retrieved=capture?new Date(capture.capturedAt).toISOString():input.generatedAt.toISOString();
 return {
  appVersion:input.appVersion??APP_VERSION,
  projectSchemaVersion:project.schemaVersion,
  generatedAt:input.generatedAt.toISOString(),
  viewport:{
   center:[round(view.center[0],7),round(view.center[1],7)],
   zoom:round(view.zoom,4),
   bearing:0,pitch:0,
   ...(project.viewport.selectedPlaceLabel?{place:project.viewport.selectedPlaceLabel}:{}),
   frameWidthPx:round(view.frameWidthPx),frameHeightPx:round(view.frameHeightPx),
   bounds:[round(view.bounds.west,7),round(view.bounds.south,7),round(view.bounds.east,7),round(view.bounds.north,7)],
  },
  board:{widthMm:round(view.widthMm),heightMm:round(view.heightMm)},
  providers:[
   {id:OPENFREEMAP.id,role:'basemap',title:OPENFREEMAP.label,attribution:OPENFREEMAP.attribution,source:OPENFREEMAP.tileJsonUrl,retrievedAt:retrieved,
    quality:capture?'Water, roads and labels captured from the rendered vector tiles in the frozen view.':'No map features were captured for this board.'},
   {id:ELEVATION_PROVIDER_ID,role:'elevation',title:'Terrain Tiles (Terrarium encoding)',attribution:'Terrain Tiles: Mapzen, hosted by the AWS Open Data Registry; sources include USGS, NOAA and others (github.com/tilezen/joerd/blob/master/docs/attribution.md)',source:DEFAULT_TERRAIN_TILES_URL,retrievedAt:retrieved,
    quality:`Zoom ${terrain.grid.tileZoom}, ${terrain.grid.tileCount} tiles, resampled to ${terrain.grid.columns}×${terrain.grid.rows}. Terrarium includes bathymetry; water captured from the map is cut out of every layer. Not survey data.`},
  ],
  terrain:{
   tileZoom:terrain.grid.tileZoom,tileCount:terrain.grid.tileCount,grid:`${terrain.grid.columns}x${terrain.grid.rows}`,
   smoothingRadius:terrain.settings.smoothingRadius,
   elevationMinM:round(terrain.elevation.minM,2),elevationMaxM:round(terrain.elevation.maxM,2),
   layers:terrain.layers.map(layer=>({index:layer.index,thresholdM:layer.thresholdM===null?null:round(layer.thresholdM,2),coveragePercent:round(layer.coveragePercent,2)})),
   contourElevationsM:terrain.contours.map(level=>round(level.elevation,2)),
  },
  ...(capture?{capture:{takenAt:new Date(capture.capturedAt).toISOString(),water:capture.features.water.length,roads:capture.features.roads.length,duplicateRoads:capture.features.counts.duplicateRoads,labels:capture.labels.length}}:{}),
  bridges:input.bridges,
  settings:{...project,route:project.route?{source:project.route.source,...(project.route.name?{name:project.route.name}:{}),pointCount:project.route.pointCount,widthMm:project.route.widthMm,segments:`${project.route.segments.length} segment(s), in the project JSON`}:null},
 };
}

export const TOPO_METADATA_NAMESPACE='https://oldglorydecor.com/ns/layered-map-studio/topo/1';

export function topoMetadataXml(metadata:TopoExportMetadata):string{
 const element=(name:string,value:string|number|undefined)=>value===undefined||value===''?'':`<lms:${name}>${escapeXml(String(value))}</lms:${name}>`;
 const attrs=(record:Record<string,string|number|undefined>)=>Object.entries(record).filter(([,v])=>v!==undefined).map(([k,v])=>` ${k}="${escapeXml(String(v))}"`).join('');
 const {viewport,board,terrain,capture,bridges}=metadata;
 return [
  `<metadata><lms:topo xmlns:lms="${TOPO_METADATA_NAMESPACE}">`,
  element('app-version',metadata.appVersion),
  element('project-schema',metadata.projectSchemaVersion),
  element('generated-at',metadata.generatedAt),
  `<lms:viewport${attrs({center:`${viewport.center[0]} ${viewport.center[1]}`,zoom:viewport.zoom,bearing:0,pitch:0,place:viewport.place,'frame-px':`${viewport.frameWidthPx} ${viewport.frameHeightPx}`,bounds:viewport.bounds.join(' ')})}/>`,
  `<lms:board${attrs({'width-mm':board.widthMm,'height-mm':board.heightMm})}/>`,
  '<lms:providers>',
  ...metadata.providers.map(p=>`<lms:provider${attrs({id:p.id,role:p.role,title:p.title,source:p.source,'retrieved-at':p.retrievedAt,quality:p.quality})}>${escapeXml(p.attribution)}</lms:provider>`),
  '</lms:providers>',
  `<lms:terrain${attrs({'tile-zoom':terrain.tileZoom,tiles:terrain.tileCount,grid:terrain.grid,smoothing:terrain.smoothingRadius,'elevation-min-m':terrain.elevationMinM,'elevation-max-m':terrain.elevationMaxM,contours:terrain.contourElevationsM.join(' ')})}>${terrain.layers.map(l=>`<lms:layer${attrs({index:l.index,'threshold-m':l.thresholdM===null?'all land':l.thresholdM,'coverage-percent':l.coveragePercent})}/>`).join('')}</lms:terrain>`,
  capture?`<lms:capture${attrs({'taken-at':capture.takenAt,water:capture.water,roads:capture.roads,'duplicate-roads':capture.duplicateRoads,labels:capture.labels})}/>`:'',
  `<lms:bridges${attrs({spans:bridges.spans,'narrowest-tab-mm':bridges.narrowestTabMm})}/>`,
  // As the ornament does: `]]>` split defensively, so the project can never close the CDATA early.
  `<lms:project><![CDATA[${JSON.stringify(metadata.settings).replace(/]]>/g,']]]]><![CDATA[>')}]]></lms:project>`,
  '</lms:topo></metadata>',
 ].filter(Boolean).join('');
}
