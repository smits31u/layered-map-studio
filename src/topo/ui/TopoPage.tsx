import {useEffect,useMemo,useReducer,useRef,useState} from 'react';
import type {CaptureWarning} from '../../ornament/capture/mapCapture';
import {roadWidthMm} from '../../ornament/geometry/roadWidths';
import {PlaceSearch} from '../../ornament/ui/PlaceSearch';
import {FONT_REGISTRY,getLoadedFont,loadFont} from '../../text/fontRegistry';
import type {FontId} from '../../types/project';
import {inchesToMm,mmToInches} from '../../utils/units';
import type {TopoCapture,TopoCaptureResult} from '../capture/topoCapture';
import {buildOverlay,type OverlayCache} from '../features/overlay';
import type {FeatureRunner} from '../features/worker/featureRunner';
import {terrainRunKey,terrainSettingsOf} from '../regeneration';
import {createDefaultTopoProject,DEFAULT_ROUTE_WIDTH_MM} from '../defaults';
import {GPX_LIMITS,GpxError,parseGpx,routeBounds} from '../gpx';
import {loadTopoProject,saveTopoProject} from '../persistence';
import {topoReducer} from '../store';
import {TerrainError} from '../terrain/errors';
import {DEFAULT_SMOOTHING_RADIUS,freezeTerrainView,type FrozenTerrainView,type TerrainSettings} from '../terrain/pipeline';
import {MAX_SMOOTHING_RADIUS} from '../terrain/smooth';
import {TOPO_CONTOUR_COUNTS,TOPO_LIMITS,type NumericLimit,type TopoProject,type TopoUnit} from '../types';
import {TerrainPreview} from './TerrainPreview';
import {TopoMap,type TopoMapHandle} from './TopoMap';
import {useFeatureFabrication} from './useFeatureFabrication';
import {downloadFiles,PROJECT_MIME,SVG_MIME} from '../../ornament/export/download';
import {exportTopo} from '../export/exportTopo';
import {topoPreflightSummary,type TopoPreflightReport} from '../export/preflight';
import {useTerrainGeneration,type GenerationStage,type TerrainGenerationDeps} from './useTerrainGeneration';
import {Slider} from '../../components/ui/Slider';
import {ThemeToggle} from '../../components/ui/ThemeToggle';
import './topo.css';

// The topographic laser-map builder (docs/CLAUDE_TOPO_MAP_BUILD_PLAN.md).
//
// Map mode (Phase 1): place search, board size, pan/zoom, and a GPX route, with state that survives
// a reload. Edit mode (Phase 2): "Generate terrain" freezes the view, downloads Terrarium tiles
// through /api/terrain, and builds quantile layers and contours in a worker, shown as a preview.
// Phase 3: "Generate terrain" first captures water, roads and labels from the live map (the map is
// gone once edit mode opens); the water is cut out of every terrain layer in the worker, and roads,
// labels, the frame, the title and the GPX route are drawn over the terrain as an overlay that never
// regenerates it (features/overlay.ts, regeneration.ts). Laser SVG export is Phase 4.
//
// Reached from the lake tool's nav ("Topo Map Builder →"), the way the ornament was introduced:
// App.tsx switches tools and onExit returns to the lake tool.
//
// Search reuses the ornament's PlaceSearch and, through it, the existing /api/geocode proxy (ADR
// 0003) — search on submit only, up to five candidates, the provider named and switchable. There is
// deliberately no second geocoder.

const SOURCE_LABELS={track:'track',route:'route',waypoints:'waypoints'} as const;
const NO_WATER:[]=[];
const DETAIL_LABELS={low:'Low',medium:'Medium',high:'High'} as const;
const CONTOUR_LABELS:Record<number,string>={3:'Sparse (3)',5:'Light (5)',8:'Normal (8)',12:'Dense (12)',18:'Very dense (18)'};
const STAGE_LABELS:Record<GenerationStage,string>={download:'Downloading elevation tiles',decode:'Decoding elevation tiles',resample:'Cropping and resampling',smooth:'Smoothing',water:'Cutting out water',bands:'Building terrain layers',contours:'Building terrain layers and contours'};
// Said whenever terrain is generated without a capture, because the result is then exactly Phase 2's
// known-wrong coastal output and must not pass for a finished board.
const NO_CAPTURE_WARNING:CaptureWarning={code:'no-map',message:'The map is not available, so no water, roads or labels were captured. Sea and lake beds will be layered as land.'};
const readText=(file:File)=>typeof file.text==='function'?file.text():new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsText(file)});
const fmt=(n:number,digits:number)=>String(Number(n.toFixed(digits)));
const waterOptions=(capture:TopoCapture|undefined)=>capture?{water:capture.features.water,waterSimplifyToleranceMm:capture.simplifyToleranceMm}:{};

// A number field that commits on blur or Enter rather than on every keystroke. Committing each
// keystroke would clamp a half-typed "12" to the 2-inch minimum at "1" and never let it be typed.
function DimensionField({label,valueMm,unit,onCommit}:{label:string;valueMm:number;unit:TopoUnit;onCommit:(mm:number)=>void}){
 const [draft,setDraft]=useState<string|null>(null);
 const shown=unit==='in'?fmt(mmToInches(valueMm),3):fmt(valueMm,1);
 const commit=()=>{
  if(draft===null)return;
  const value=Number(draft);
  if(draft.trim()!==''&&Number.isFinite(value))onCommit(unit==='in'?inchesToMm(value):value);
  setDraft(null);
 };
 return <label>{label}<span className="topo-dimension"><input type="number" aria-label={`${label} (${unit})`} inputMode="decimal" step={unit==='in'?.125:1} value={draft??shown} onChange={e=>setDraft(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')commit()}}/>{unit}</span></label>;
}

// A slider over one of TOPO_LIMITS' ranges, with its value shown beside it: the shared Slider.
function RangeField({label,unit,limit,value,onChange,disabled}:{label:string;unit:string;limit:NumericLimit;value:number;onChange:(value:number)=>void;disabled?:boolean}){
 return <Slider label={label} min={limit.min} max={limit.max} step={limit.step} value={value} disabled={disabled} onChange={onChange} format={v=>`${fmt(v,2)}${unit==='×'?'×':unit?` ${unit}`:''}`}/>;
}

// Same commit-on-blur behaviour for a coverage percentage.
function PercentField({label,value,onCommit}:{label:string;value:number;onCommit:(value:number)=>void}){
 const [draft,setDraft]=useState<string|null>(null);
 const commit=()=>{if(draft===null)return;const n=Number(draft);if(draft.trim()!==''&&Number.isFinite(n))onCommit(n);setDraft(null)};
 return <label>{label}<span className="topo-dimension"><input type="number" aria-label={label} min={TOPO_LIMITS.coveragePercent.min} max={TOPO_LIMITS.coveragePercent.max} step={1} value={draft??String(value)} onChange={e=>setDraft(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')commit()}}/>%</span></label>;
}

export function TopoPage({onExit,terrainDeps,featureRunner}:{onExit?:()=>void;terrainDeps?:TerrainGenerationDeps;featureRunner?:()=>FeatureRunner}={}){
 const [project,dispatch]=useReducer(topoReducer,undefined,()=>loadTopoProject()??createDefaultTopoProject());
 const [fitRequest,setFitRequest]=useState<{bounds:[number,number,number,number];token:number}>();
 const [gpxNote,setGpxNote]=useState<{kind:'error'|'info';text:string}>();
 const [mode,setMode]=useState<'map'|'edit'>('map');
 const [frozen,setFrozen]=useState<FrozenTerrainView>();
 const [viewError,setViewError]=useState<string>();
 // Smoothing is a pipeline parameter with a sensible default, not part of the saved project: the
 // plan's domain model has no field for it, and it is a preview-quality knob rather than a design.
 const [smoothingRadius,setSmoothingRadius]=useState(DEFAULT_SMOOTHING_RADIUS);
 const fileInput=useRef<HTMLInputElement>(null);
 const mapHandle=useRef<TopoMapHandle|null>(null);
 const lastRunSettings=useRef('');
 const [capture,setCapture]=useState<TopoCapture>();
 const [captureWarnings,setCaptureWarnings]=useState<CaptureWarning[]>([]);
 const [capturing,setCapturing]=useState(false);
 const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false}},[]);
 const {state:generation,generate,cancel}=useTerrainGeneration(terrainDeps);
 // Fonts load asynchronously; the overlay reads them synchronously (getLoadedFont) and is rebuilt
 // once each one arrives -- or once one fails, so a genuine failure (getFontLoadError) reaches the
 // overlay's warnings instead of the UI being stuck showing "still loading" forever.
 const [fontTick,setFontTick]=useState(0);
 useEffect(()=>{
  let live=true;
  const bump=()=>{if(live)setFontTick(t=>t+1)};
  for(const id of new Set<FontId>(['inter',project.title.fontId]))if(!getLoadedFont(id))loadFont(id).then(bump,bump);
  return ()=>{live=false};
 },[project.title.fontId]);
 const fit=(bounds:[number,number,number,number])=>setFitRequest(previous=>({bounds,token:(previous?.token??0)+1}));

 useEffect(()=>{saveTopoProject(project)},[project]);

 const {output,displayUnit:unit,route,terrain}=project;
 const min=TOPO_LIMITS.outputMm.min,max=TOPO_LIMITS.outputMm.max;
 const settings=terrainSettingsOf(project,smoothingRadius);
 // The only thing that reruns terrain (regeneration.ts). Roads, labels, frame, title and the route
 // are not in it: they rebuild the overlay below, never the terrain.
 const settingsKey=terrainRunKey(project,smoothingRadius);

 // Capture first, while the map is still on screen: edit mode unmounts it. The view is frozen from
 // the same map read as the features, so the water subtracted is the water under the board.
 const startGeneration=async()=>{
  if(capturing)return;
  const handle=mapHandle.current;
  const pending=handle?.capture(output.widthMm,output.heightMm);
  let captured:TopoCaptureResult|undefined;
  if(pending){
   setCapturing(true);
   setViewError(undefined);
   try{captured=await pending}
   catch(error){if(mounted.current){setCapturing(false);setViewError(`The map features could not be captured: ${(error as Error)?.message??String(error)}`)}return}
   if(!mounted.current)return;
   setCapturing(false);
  }
  let view:FrozenTerrainView;
  if(captured)view=captured.capture.view;
  else{
   const frame=handle?.frozenFrame()??{center:project.viewport.center,zoom:project.viewport.zoom,frameWidthPx:480};
   try{view=freezeTerrainView(frame.center,frame.zoom,frame.frameWidthPx,output.widthMm,output.heightMm)}
   catch(error){setViewError(error instanceof TerrainError?error.message:String(error));return}
  }
  setViewError(undefined);
  setFrozen(view);
  setCapture(captured?.capture);
  setCaptureWarnings(captured?captured.warnings:[NO_CAPTURE_WARNING]);
  setMode('edit');
  lastRunSettings.current=settingsKey;
  void generate(view,settings,waterOptions(captured?.capture));
 };

 // In edit mode, a change to the terrain settings reruns the pipeline on the frozen view's tiles and
 // the same captured water.
 useEffect(()=>{
  if(mode!=='edit'||!frozen||lastRunSettings.current===settingsKey)return;
  lastRunSettings.current=settingsKey;
  void generate(frozen,JSON.parse(settingsKey) as TerrainSettings,{keepResult:true,...waterOptions(capture)});
 },[mode,frozen,settingsKey,generate,capture]);

 const backToMap=()=>{cancel();setMode('map')};

 const loadGpx=async(file?:File)=>{
  if(!file)return;
  try{
   if(file.size>GPX_LIMITS.maxBytes)throw new GpxError('too-large',`The file is larger than ${Math.round(GPX_LIMITS.maxBytes/1024/1024)} MB.`);
   const parsed=parseGpx(await readText(file));
   dispatch({type:'setRoute',route:{...parsed,widthMm:route?.widthMm??DEFAULT_ROUTE_WIDTH_MM}});
   fit(routeBounds(parsed.segments));
   setGpxNote({kind:'info',text:`Loaded ${parsed.pointCount.toLocaleString('en-US')} points from the file's ${SOURCE_LABELS[parsed.source]}${parsed.segments.length>1?` (${parsed.segments.length} segments)`:''}.`});
  }catch(reason){
   // A bad file never disturbs a route that is already loaded: "replace" happens only on success.
   const message=reason instanceof GpxError?reason.message:`The file could not be read: ${(reason as Error).message}`;
   setGpxNote({kind:'error',text:`${file.name}: ${message}${route?' The previous route is unchanged.':''}`});
  }finally{
   if(fileInput.current)fileInput.current.value='';
  }
 };

 const working=generation.status==='working';
 const result=generation.result;

 // The overlay: rebuilt part by part from its cache, never regenerating terrain (overlay.ts).
 const overlayCache=useRef<OverlayCache>({entries:{}});
 const overlayOut=useMemo(()=>{
  if(!frozen||!result)return undefined;
  const out=buildOverlay({capture,view:frozen,water:result.water,settings:{roads:project.roads,labels:project.labels,frame:project.frame,title:project.title,route:project.route},font:getLoadedFont},overlayCache.current);
  overlayCache.current=out.cache;
  return out;
  // fontTick: rebuild when a font arrives, since getLoadedFont is read synchronously.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[frozen,result,capture,project.roads,project.labels,project.frame,project.title,project.route,fontTick]);
 const overlay=overlayOut?.overlay;
 const fabrication=useFeatureFabrication({capture,view:frozen,land:result?.layers[0]?.geometry,water:result?.water??NO_WATER,roads:project.roads,routeLines:overlay?.route?.lines,routeWidthMm:route?.widthMm,createRunner:featureRunner});
 const featureWarnings=[
  ...(overlay?.warnings??[]),
  ...(project.roads.enabled?fabrication.roads?.warnings??[]:[]),
  ...(fabrication.route?.warnings??[]),
 ];

 const boardChanged=Boolean(frozen&&(frozen.widthMm!==output.widthMm||frozen.heightMm!==output.heightMm));

 // Export: the ornament's flow. Build the board from the current settings and the terrain as it
 // stands (never a terrain run), preflight it, and download only if preflight passed; a blocked
 // report is the whole result and is shown where the button is. Deferred one tick so "Exporting…"
 // paints before the ~1 s build.
 const [exportState,setExportState]=useState<{busy:boolean;report?:TopoPreflightReport;message?:string;ok?:boolean}>({busy:false});
 const canExport=mode==='edit'&&Boolean(result)&&!working&&!exportState.busy;
 useEffect(()=>{setExportState(previous=>previous.busy?previous:{busy:false})},[project,result,capture]);
 const onExport=()=>{
  if(!canExport||!result)return;
  setExportState({busy:true});
  setTimeout(()=>{
   try{
    const exported=exportTopo({project,terrain:result,capture,font:getLoadedFont});
    if(!exported.ok||!exported.svg){setExportState({busy:false,ok:false,report:exported.preflight,message:topoPreflightSummary(exported.preflight)});return}
    const wrote=downloadFiles([{name:exported.fileNames.svg,content:exported.svg,type:SVG_MIME},{name:exported.fileNames.project,content:exported.projectJson,type:PROJECT_MIME}]);
    setExportState({busy:false,ok:wrote,report:exported.preflight,message:wrote?`Exported ${exported.fileNames.svg} and ${exported.fileNames.project}. ${topoPreflightSummary(exported.preflight)}`:'This browser would not accept the download. The board passed preflight — try another browser.'});
   }catch(error){setExportState({busy:false,ok:false,message:`The export could not be built: ${(error as Error)?.message??String(error)}`})}
  },0);
 };
 const progressText=working&&generation.stage?`${STAGE_LABELS[generation.stage]}${generation.stage==='download'&&generation.total?` (${generation.done}/${generation.total})`:''}…`:'';

 // The design system's sidebar (styles/studio.css), as in the lake tool: the product wordmark over
 // this tool's name, the numbered steps scrolling beneath, and the export pinned to the foot.
 return <main className="studio topo-page">
  <aside>
   <header className="studio-brand">
    <div className="studio-wordmark">Layered Map Studio</div>
    <h1 className="studio-tool">Topographic Map Builder</h1>
    {onExit&&<button className="btn-quiet studio-back" onClick={onExit}>← Back</button>}
   </header>
   <div className="sidebar-scroll">
   <details open><summary>1. Place</summary><div className="section-body">
    <PlaceSearch selectedLabel={project.viewport.selectedPlaceLabel} hint="Search for the place this map is of." onSelect={(candidate,fitToResult)=>{
     dispatch({type:'selectPlace',label:candidate.label,center:candidate.coordinates});
     if(fitToResult&&candidate.boundingBox)fit(candidate.boundingBox);
    }}/>
   </div></details>
   <details open><summary>2. Board size</summary><div className="section-body">
    <div className="topo-segmented" role="group" aria-label="Units">
     {(['in','mm'] as const).map(value=><button key={value} type="button" aria-pressed={unit===value} className={unit===value?'active':''} onClick={()=>dispatch({type:'setDisplayUnit',value})}>{value==='in'?'Inches':'Millimetres'}</button>)}
    </div>
    <DimensionField label="Width" valueMm={output.widthMm} unit={unit} onCommit={widthMm=>dispatch({type:'setOutput',patch:{widthMm}})}/>
    <DimensionField label="Height" valueMm={output.heightMm} unit={unit} onCommit={heightMm=>dispatch({type:'setOutput',patch:{heightMm}})}/>
    <small>{fmt(output.widthMm,3)} × {fmt(output.heightMm,3)} mm. Allowed {min}–{max} mm ({fmt(mmToInches(min),2)}–{fmt(mmToInches(max),2)} in); values outside are clamped.</small>
   </div></details>
   <details open><summary>3. Map zoom</summary><div className="section-body">
    <RangeField label="Zoom" unit="" limit={TOPO_LIMITS.zoom} value={project.viewport.zoom} disabled={mode==='edit'} onChange={value=>dispatch({type:'setZoom',value})}/>
   </div></details>
   <details open><summary>4. GPX route</summary><div className="section-body">
    <label>{route?'Replace GPX':'Load GPX'}<input ref={fileInput} type="file" aria-label={route?'Replace GPX file':'Load GPX file'} accept=".gpx,application/gpx+xml,application/xml,text/xml" onChange={e=>loadGpx(e.target.files?.[0])}/></label>
    {route&&<div className="topo-route-summary">
     <span>{route.name??'Unnamed route'} · {route.pointCount.toLocaleString('en-US')} points from the {SOURCE_LABELS[route.source]}</span>
     <button type="button" disabled={mode==='edit'} onClick={()=>fit(routeBounds(route.segments))}>Fit to route</button>
     <button type="button" onClick={()=>{dispatch({type:'clearRoute'});setGpxNote(undefined)}}>Clear route</button>
     <RangeField label="Route width" unit="mm" limit={TOPO_LIMITS.routeWidthMm} value={route.widthMm} onChange={widthMm=>dispatch({type:'setRouteWidth',widthMm})}/>
    </div>}
    {gpxNote&&<p className={gpxNote.kind==='error'?'error':'topo-note'} role={gpxNote.kind==='error'?'alert':'status'}>{gpxNote.text}</p>}
    <small>The route is read in your browser and is not saved between sessions; load the file again after a reload.</small>
   </div></details>
   <details open><summary>5. Terrain</summary><div className="section-body">
    <div className="topo-segmented" role="group" aria-label="Terrain layers">
     {([1,2,3,4] as const).map(value=><button key={value} type="button" aria-pressed={terrain.layerCount===value} className={terrain.layerCount===value?'active':''} onClick={()=>dispatch({type:'setTerrain',patch:{layerCount:value}})}>{value} {value===1?'layer':'layers'}</button>)}
    </div>
    {([2,3,4] as const).filter(k=>k<=terrain.layerCount).map(k=><PercentField key={k} label={`Layer ${k} coverage`} value={terrain.coveragePercent[k-1]} onCommit={value=>{const next=[...terrain.coveragePercent];next[k-1]=value;dispatch({type:'setTerrain',patch:{coveragePercent:next}})}}/>)}
    <label>Contours<input type="checkbox" aria-label="Contours" checked={terrain.contoursEnabled} onChange={e=>dispatch({type:'setTerrain',patch:{contoursEnabled:e.target.checked}})}/></label>
    <label>Contour density<select aria-label="Contour density" disabled={!terrain.contoursEnabled} value={terrain.contourCount} onChange={e=>dispatch({type:'setTerrain',patch:{contourCount:Number(e.target.value) as TopoProject['terrain']['contourCount']}})}>{TOPO_CONTOUR_COUNTS.map(n=><option key={n} value={n}>{CONTOUR_LABELS[n]}</option>)}</select></label>
    <Slider label="Smoothing" min={0} max={MAX_SMOOTHING_RADIUS/2} step={1} value={smoothingRadius} onChange={setSmoothingRadius}/>
    <small>Layer 1 is all land on the board. Each further layer covers the highest share of it you set, and must not cover more than the layer below.</small>
   </div></details>
   <details open><summary>6. Roads</summary><div className="section-body">
    <label>Roads<input type="checkbox" aria-label="Roads" checked={project.roads.enabled} onChange={e=>dispatch({type:'setRoads',patch:{enabled:e.target.checked}})}/></label>
    <div className="topo-segmented" role="group" aria-label="Road detail">
     {(['low','medium','high'] as const).map(value=><button key={value} type="button" aria-pressed={project.roads.detail===value} className={project.roads.detail===value?'active':''} onClick={()=>dispatch({type:'setRoads',patch:{detail:value}})}>{DETAIL_LABELS[value]}</button>)}
    </div>
    <RangeField label="Road thickness" unit="×" limit={TOPO_LIMITS.roadThicknessScale} value={project.roads.thicknessScale} onChange={thicknessScale=>dispatch({type:'setRoads',patch:{thicknessScale}})}/>
    <small>Widths are physical millimetres, not screen pixels: at {fmt(project.roads.thicknessScale,2)}× a residential street on this board is {fmt(roadWidthMm('minor',{diameterMm:Math.min(output.widthMm,output.heightMm),widthScale:project.roads.thicknessScale}),2)} mm wide and a motorway {fmt(roadWidthMm('motorway',{diameterMm:Math.min(output.widthMm,output.heightMm),widthScale:project.roads.thicknessScale}),2)} mm. Bridge tabs are as wide as their road, so this also sets how sturdy bridges are; 1× is the standard width table.</small>
   </div></details>
   <details open><summary>7. Labels</summary><div className="section-body">
    <label>Place names<input type="checkbox" aria-label="Place names" checked={project.labels.enabled} onChange={e=>dispatch({type:'setLabels',patch:{enabled:e.target.checked}})}/></label>
    <label>Points of interest<input type="checkbox" aria-label="Points of interest" checked={project.labels.poiEnabled} onChange={e=>dispatch({type:'setLabels',patch:{poiEnabled:e.target.checked}})}/></label>
    <RangeField label="Label size" unit="mm" limit={TOPO_LIMITS.labelSizeMm} value={project.labels.sizeMm} onChange={sizeMm=>dispatch({type:'setLabels',patch:{sizeMm}})}/>
    <small>Points of interest (bus stops, shops, parks) are off by default: on a busy board they crowd out the place names.</small>
   </div></details>
   <details open><summary>8. Frame and title</summary><div className="section-body">
    <label>Frame<input type="checkbox" aria-label="Frame" checked={project.frame.enabled} onChange={e=>dispatch({type:'setFrame',patch:{enabled:e.target.checked}})}/></label>
    <RangeField label="Frame thickness" unit="mm" limit={TOPO_LIMITS.frameThicknessMm} value={project.frame.thicknessMm} onChange={thicknessMm=>dispatch({type:'setFrame',patch:{thicknessMm}})}/>
    <label>Title<input type="text" aria-label="Title" maxLength={200} value={project.title.text} onChange={e=>dispatch({type:'setTitle',patch:{text:e.target.value}})}/></label>
    <label>Title font<select aria-label="Title font" value={project.title.fontId} onChange={e=>dispatch({type:'setTitle',patch:{fontId:e.target.value as FontId}})}>{FONT_REGISTRY.map(font=><option key={font.id} value={font.id}>{font.label}</option>)}</select></label>
    <RangeField label="Title size" unit="mm" limit={TOPO_LIMITS.titleSizeMm} value={project.title.sizeMm} onChange={sizeMm=>dispatch({type:'setTitle',patch:{sizeMm}})}/>
    <label>Title offset<span className="topo-dimension">
     <input type="number" aria-label="Title offset X (mm)" step={TOPO_LIMITS.titleOffsetMm.step} value={project.title.dxMm} onChange={e=>dispatch({type:'setTitle',patch:{dxMm:Number(e.target.value)}})}/>
     <input type="number" aria-label="Title offset Y (mm)" step={TOPO_LIMITS.titleOffsetMm.step} value={project.title.dyMm} onChange={e=>dispatch({type:'setTitle',patch:{dyMm:Number(e.target.value)}})}/>mm</span></label>
    <small>The title sits at the bottom centre, inside the frame; the offset moves it from there.</small>
   </div></details>
   <button type="button" className="topo-reset btn-quiet" onClick={()=>{dispatch({type:'reset'});setGpxNote(undefined);setSmoothingRadius(DEFAULT_SMOOTHING_RADIUS)}}>Reset to defaults</button>
   </div>
   {/* Pinned to the foot of the sidebar and always open: the summary only titles it. */}
   <details open className="action-panel topo-export"><summary onClick={e=>e.preventDefault()}>Export</summary>
    <button type="button" className="btn-primary" disabled={!canExport} onClick={onExport}>{exportState.busy?'Exporting…':'Export SVG + project'}</button>
    {!canExport&&!exportState.busy&&<small>{mode!=='edit'||!result?'Generate terrain first; the export is built from it.':'Wait for the terrain to finish.'}</small>}
    {exportState.message&&<p className={exportState.ok?'topo-note':'error'} role={exportState.ok?'status':'alert'} data-testid="topo-export-status">{exportState.message}</p>}
    {exportState.report&&exportState.report.findings.length>0&&<ul className="topo-preflight" data-testid="topo-preflight" aria-label="Preflight findings">
     {[...exportState.report.findings].sort((a,b)=>a.severity===b.severity?0:a.severity==='error'?-1:1).map((f,i)=><li key={i} className={f.severity} data-code={f.code}><strong>{f.severity==='error'?'Blocks export':'Warning'}:</strong> {f.message}</li>)}
    </ul>}
   </details>
  </aside>
  <section className="workspace">
   {mode==='map'?<>
    <nav>
     <span className="topo-mode">Map mode</span>
     <button type="button" className="btn-primary" disabled={capturing} onClick={()=>void startGeneration()}>Generate terrain</button>
     {capturing&&<span className="topo-progress" role="status">Capturing water, roads and labels…</span>}
     {viewError&&<span className="error" role="alert">{viewError}</span>}
     <span className="topo-attribution">Map © OpenStreetMap contributors · OpenFreeMap</span>
     <ThemeToggle/>
    </nav>
    <TopoMap center={project.viewport.center} zoom={project.viewport.zoom} widthMm={output.widthMm} heightMm={output.heightMm} route={route} fitRequest={fitRequest} handleRef={mapHandle} onViewportChange={view=>dispatch({type:'setViewport',...view})}/>
   </>:<>
    <nav>
     <span className="topo-mode">Edit mode</span>
     <button type="button" onClick={backToMap}>← Back to map</button>
     {working&&<button type="button" onClick={cancel}>Cancel</button>}
     <span className="topo-progress" role="status" aria-live="polite">{progressText}</span>
     <span className="topo-attribution">Elevation: Terrain Tiles (Mapzen, AWS Open Data) · Map © OpenStreetMap contributors</span>
     <ThemeToggle/>
    </nav>
    <div className="topo-edit">
     {boardChanged&&<p className="topo-banner" role="status">The board size changed after this terrain was generated. Go back to the map and generate again to use the new size.</p>}
     {generation.status==='error'&&generation.error&&<div className="topo-banner error" role="alert">
      <strong>{generation.error.code==='missing-tile'?'Elevation data is missing for this area.':'Terrain could not be generated.'}</strong> {generation.error.message}
      {frozen&&<button type="button" onClick={()=>{lastRunSettings.current=settingsKey;void generate(frozen,settings,waterOptions(capture))}}>Try again</button>}
     </div>}
     {captureWarnings.map(w=><p key={w.code} className="topo-banner warning" role="status">{w.message}</p>)}
     {result?.warnings.map(w=><p key={w.code} className="topo-banner warning" role="status">{w.message}</p>)}
     {featureWarnings.map(w=><p key={w.code} className="topo-banner warning" role="status">{w.message}</p>)}
     <div className={`topo-preview-frame${working?' busy':''}`}>
      {result?<TerrainPreview result={result} overlay={overlay}/>:working?<p className="topo-note">{progressText}</p>:null}
     </div>
     {result&&<dl className="topo-terrain-stats" aria-label="Terrain details">
      {result.elevation.landSamples>0&&<div><dt>Elevation</dt><dd>{fmt(result.elevation.minM,1)}–{fmt(result.elevation.maxM,1)} m (range {fmt(result.elevation.rangeM,1)} m)</dd></div>}
      {result.layers.map(layer=><div key={layer.index}><dt>Layer {layer.index}</dt><dd>{layer.thresholdM===null?'all land':`≥ ${fmt(layer.thresholdM,1)} m`} · {fmt(layer.coveragePercent,1)}% of land</dd></div>)}
      {result.contours.length>0&&<div><dt>Contours</dt><dd>{result.contours.length} elevations, every {fmt(result.elevation.rangeM/(result.contours.length+1),1)} m</dd></div>}
      {result.waterMetrics&&<div><dt>Water</dt><dd>{fmt(result.waterMetrics.areaMm2/(result.widthMm*result.heightMm)*100,1)}% of the board, cut from every layer</dd></div>}
      <div><dt>Source</dt><dd>{result.grid.tileCount} tiles at zoom {result.grid.tileZoom} · {result.grid.columns}×{result.grid.rows} samples · {Math.round(result.durationMs)} ms</dd></div>
      {capture&&<div><dt>Captured</dt><dd>{capture.features.water.length} water · {capture.features.roads.length.toLocaleString('en-US')} roads ({capture.features.counts.duplicateRoads.toLocaleString('en-US')} duplicates removed) · {capture.labels.length} labels</dd></div>}
      {project.roads.enabled&&<div><dt>Roads</dt><dd>{fabrication.roads?`${fmt(fabrication.roads.metrics.finalAreaMm2,0)} mm² engraved, ${fabrication.roads.metrics.widthGroups} widths ${fabrication.roads.metrics.widthsMm.map(w=>fmt(w,2)).join('/')} mm`:fabrication.error?<span className="topo-fabrication-error" role="alert">Could not build road geometry: {fabrication.error}</span>:'building…'}</dd></div>}
      {project.roads.enabled&&fabrication.roads&&fabrication.roads.bridges.spans>0&&<div><dt>Bridges</dt><dd>{fabrication.roads.bridges.spans} span{fabrication.roads.bridges.spans>1?'s':''} kept across water on tabs, {fmt(fabrication.roads.bridges.lengthMm,1)} mm in all{fabrication.roads.bridges.narrowestTabMm!==undefined?`; tabs ${fmt(fabrication.roads.bridges.narrowestTabMm,2)}–${fmt(fabrication.roads.bridges.widestTabMm??fabrication.roads.bridges.narrowestTabMm,2)} mm wide`:''}</dd></div>}
      {overlay?.labels.visible&&overlay.labels.layer&&<div><dt>Labels</dt><dd>{overlay.labels.layer.placed.length} placed</dd></div>}
     </dl>}
    </div>
   </>}
  </section>
 </main>;
}
