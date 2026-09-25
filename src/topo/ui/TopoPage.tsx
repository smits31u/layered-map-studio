import {useEffect,useReducer,useRef,useState} from 'react';
import {PlaceSearch} from '../../ornament/ui/PlaceSearch';
import {inchesToMm,mmToInches} from '../../utils/units';
import {createDefaultTopoProject,DEFAULT_ROUTE_WIDTH_MM} from '../defaults';
import {GPX_LIMITS,GpxError,parseGpx,routeBounds} from '../gpx';
import {loadTopoProject,saveTopoProject} from '../persistence';
import {topoReducer} from '../store';
import {TerrainError} from '../terrain/errors';
import {DEFAULT_SMOOTHING_RADIUS,freezeTerrainView,type FrozenTerrainView,type TerrainSettings} from '../terrain/pipeline';
import {MAX_SMOOTHING_RADIUS} from '../terrain/smooth';
import {TOPO_CONTOUR_COUNTS,TOPO_LIMITS,type TopoProject,type TopoUnit} from '../types';
import {TerrainPreview} from './TerrainPreview';
import {TopoMap,type TopoMapHandle} from './TopoMap';
import {useTerrainGeneration,type GenerationStage,type TerrainGenerationDeps} from './useTerrainGeneration';
import './topo.css';

// The topographic laser-map builder (docs/CLAUDE_TOPO_MAP_BUILD_PLAN.md).
//
// Map mode (Phase 1): place search, board size, pan/zoom, and a GPX route, with state that survives
// a reload. Edit mode (Phase 2): "Generate terrain" freezes the view, downloads Terrarium tiles
// through /api/terrain, and builds quantile layers and contours in a worker, shown as a preview.
// Roads, water, labels and export are later phases.
//
// Not reachable from the running app yet. App.tsx does not import this, by instruction: the topo
// builder stays isolated until it is ready to be looked at.
//
// Search reuses the ornament's PlaceSearch and, through it, the existing /api/geocode proxy (ADR
// 0003) — search on submit only, up to five candidates, the provider named and switchable. There is
// deliberately no second geocoder.

const SOURCE_LABELS={track:'track',route:'route',waypoints:'waypoints'} as const;
const CONTOUR_LABELS:Record<number,string>={3:'Sparse (3)',5:'Light (5)',8:'Normal (8)',12:'Dense (12)',18:'Very dense (18)'};
const STAGE_LABELS:Record<GenerationStage,string>={download:'Downloading elevation tiles',decode:'Decoding elevation tiles',resample:'Cropping and resampling',smooth:'Smoothing',bands:'Building terrain layers',contours:'Building terrain layers and contours'};
const readText=(file:File)=>typeof file.text==='function'?file.text():new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsText(file)});
const fmt=(n:number,digits:number)=>String(Number(n.toFixed(digits)));
const terrainSettings=(terrain:TopoProject['terrain'],smoothingRadius:number):TerrainSettings=>({...terrain,smoothingRadius});

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

// Same commit-on-blur behaviour for a coverage percentage.
function PercentField({label,value,onCommit}:{label:string;value:number;onCommit:(value:number)=>void}){
 const [draft,setDraft]=useState<string|null>(null);
 const commit=()=>{if(draft===null)return;const n=Number(draft);if(draft.trim()!==''&&Number.isFinite(n))onCommit(n);setDraft(null)};
 return <label>{label}<span className="topo-dimension"><input type="number" aria-label={label} min={TOPO_LIMITS.coveragePercent.min} max={TOPO_LIMITS.coveragePercent.max} step={1} value={draft??String(value)} onChange={e=>setDraft(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')commit()}}/>%</span></label>;
}

export function TopoPage({onExit,terrainDeps}:{onExit?:()=>void;terrainDeps?:TerrainGenerationDeps}={}){
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
 const {state:generation,generate,cancel}=useTerrainGeneration(terrainDeps);
 const fit=(bounds:[number,number,number,number])=>setFitRequest(previous=>({bounds,token:(previous?.token??0)+1}));

 useEffect(()=>{saveTopoProject(project)},[project]);

 const {output,displayUnit:unit,route,terrain}=project;
 const min=TOPO_LIMITS.outputMm.min,max=TOPO_LIMITS.outputMm.max;
 const settings=terrainSettings(terrain,smoothingRadius);
 const settingsKey=JSON.stringify(settings);

 const startGeneration=()=>{
  const frame=mapHandle.current?.frozenFrame()??{center:project.viewport.center,zoom:project.viewport.zoom,frameWidthPx:480};
  let view:FrozenTerrainView;
  try{view=freezeTerrainView(frame.center,frame.zoom,frame.frameWidthPx,output.widthMm,output.heightMm)}
  catch(error){setViewError(error instanceof TerrainError?error.message:String(error));return}
  setViewError(undefined);
  setFrozen(view);
  setMode('edit');
  lastRunSettings.current=settingsKey;
  void generate(view,settings);
 };

 // In edit mode, a change to the terrain settings reruns the pipeline on the frozen view's tiles.
 useEffect(()=>{
  if(mode!=='edit'||!frozen||lastRunSettings.current===settingsKey)return;
  lastRunSettings.current=settingsKey;
  void generate(frozen,JSON.parse(settingsKey) as TerrainSettings,{keepResult:true});
 },[mode,frozen,settingsKey,generate]);

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
 const boardChanged=Boolean(frozen&&(frozen.widthMm!==output.widthMm||frozen.heightMm!==output.heightMm));
 const progressText=working&&generation.stage?`${STAGE_LABELS[generation.stage]}${generation.stage==='download'&&generation.total?` (${generation.done}/${generation.total})`:''}…`:'';

 return <main className="topo-page">
  <aside>
   <h1>Topographic Map Builder</h1>
   {onExit&&<button onClick={onExit}>← Back</button>}
   <details open><summary>1. Place</summary>
    <PlaceSearch selectedLabel={project.viewport.selectedPlaceLabel} onSelect={(candidate,fitToResult)=>{
     dispatch({type:'selectPlace',label:candidate.label,center:candidate.coordinates});
     if(fitToResult&&candidate.boundingBox)fit(candidate.boundingBox);
    }}/>
   </details>
   <details open><summary>2. Board size</summary>
    <div className="topo-segmented" role="group" aria-label="Units">
     {(['in','mm'] as const).map(value=><button key={value} type="button" aria-pressed={unit===value} className={unit===value?'active':''} onClick={()=>dispatch({type:'setDisplayUnit',value})}>{value==='in'?'Inches':'Millimetres'}</button>)}
    </div>
    <DimensionField label="Width" valueMm={output.widthMm} unit={unit} onCommit={widthMm=>dispatch({type:'setOutput',patch:{widthMm}})}/>
    <DimensionField label="Height" valueMm={output.heightMm} unit={unit} onCommit={heightMm=>dispatch({type:'setOutput',patch:{heightMm}})}/>
    <small>{fmt(output.widthMm,3)} × {fmt(output.heightMm,3)} mm. Allowed {min}–{max} mm ({fmt(mmToInches(min),2)}–{fmt(mmToInches(max),2)} in); values outside are clamped.</small>
   </details>
   <details open><summary>3. Map zoom</summary>
    <label>Zoom <span className="topo-zoom"><input type="range" aria-label="Zoom" disabled={mode==='edit'} min={TOPO_LIMITS.zoom.min} max={TOPO_LIMITS.zoom.max} step={TOPO_LIMITS.zoom.step} value={project.viewport.zoom} onChange={e=>dispatch({type:'setZoom',value:+e.target.value})}/><output>{fmt(project.viewport.zoom,2)}</output></span></label>
   </details>
   <details open><summary>4. GPX route</summary>
    <label>{route?'Replace GPX':'Load GPX'}<input ref={fileInput} type="file" aria-label={route?'Replace GPX file':'Load GPX file'} accept=".gpx,application/gpx+xml,application/xml,text/xml" onChange={e=>loadGpx(e.target.files?.[0])}/></label>
    {route&&<div className="topo-route-summary">
     <span>{route.name??'Unnamed route'} · {route.pointCount.toLocaleString('en-US')} points from the {SOURCE_LABELS[route.source]}</span>
     <button type="button" disabled={mode==='edit'} onClick={()=>fit(routeBounds(route.segments))}>Fit to route</button>
     <button type="button" onClick={()=>{dispatch({type:'clearRoute'});setGpxNote(undefined)}}>Clear route</button>
    </div>}
    {gpxNote&&<p className={gpxNote.kind==='error'?'error':'topo-note'} role={gpxNote.kind==='error'?'alert':'status'}>{gpxNote.text}</p>}
    <small>The route is read in your browser and is not saved between sessions; load the file again after a reload.</small>
   </details>
   <details open><summary>5. Terrain</summary>
    <div className="topo-segmented" role="group" aria-label="Terrain layers">
     {([1,2,3,4] as const).map(value=><button key={value} type="button" aria-pressed={terrain.layerCount===value} className={terrain.layerCount===value?'active':''} onClick={()=>dispatch({type:'setTerrain',patch:{layerCount:value}})}>{value} {value===1?'layer':'layers'}</button>)}
    </div>
    {([2,3,4] as const).filter(k=>k<=terrain.layerCount).map(k=><PercentField key={k} label={`Layer ${k} coverage`} value={terrain.coveragePercent[k-1]} onCommit={value=>{const next=[...terrain.coveragePercent];next[k-1]=value;dispatch({type:'setTerrain',patch:{coveragePercent:next}})}}/>)}
    <label>Contours<input type="checkbox" aria-label="Contours" checked={terrain.contoursEnabled} onChange={e=>dispatch({type:'setTerrain',patch:{contoursEnabled:e.target.checked}})}/></label>
    <label>Contour density<select aria-label="Contour density" disabled={!terrain.contoursEnabled} value={terrain.contourCount} onChange={e=>dispatch({type:'setTerrain',patch:{contourCount:Number(e.target.value) as TopoProject['terrain']['contourCount']}})}>{TOPO_CONTOUR_COUNTS.map(n=><option key={n} value={n}>{CONTOUR_LABELS[n]}</option>)}</select></label>
    <label>Smoothing <span className="topo-zoom"><input type="range" aria-label="Smoothing" min={0} max={MAX_SMOOTHING_RADIUS/2} step={1} value={smoothingRadius} onChange={e=>setSmoothingRadius(+e.target.value)}/><output>{smoothingRadius}</output></span></label>
    <small>Layer 1 is all land on the board. Each further layer covers the highest share of it you set, and must not cover more than the layer below.</small>
   </details>
   <button type="button" className="topo-reset" onClick={()=>{dispatch({type:'reset'});setGpxNote(undefined);setSmoothingRadius(DEFAULT_SMOOTHING_RADIUS)}}>Reset to defaults</button>
  </aside>
  <section className="workspace">
   {mode==='map'?<>
    <nav>
     <span className="topo-mode">Map mode</span>
     <button type="button" className="topo-primary" onClick={startGeneration}>Generate terrain</button>
     {viewError&&<span className="error" role="alert">{viewError}</span>}
     <span className="topo-attribution">Map © OpenStreetMap contributors · OpenFreeMap</span>
    </nav>
    <TopoMap center={project.viewport.center} zoom={project.viewport.zoom} widthMm={output.widthMm} heightMm={output.heightMm} route={route} fitRequest={fitRequest} handleRef={mapHandle} onViewportChange={view=>dispatch({type:'setViewport',...view})}/>
   </>:<>
    <nav>
     <span className="topo-mode">Edit mode</span>
     <button type="button" onClick={backToMap}>← Back to map</button>
     {working&&<button type="button" onClick={cancel}>Cancel</button>}
     <span className="topo-progress" role="status" aria-live="polite">{progressText}</span>
     <span className="topo-attribution">Elevation: Terrain Tiles (Mapzen, AWS Open Data) · Map © OpenStreetMap contributors</span>
    </nav>
    <div className="topo-edit">
     {boardChanged&&<p className="topo-banner" role="status">The board size changed after this terrain was generated. Go back to the map and generate again to use the new size.</p>}
     {generation.status==='error'&&generation.error&&<div className="topo-banner error" role="alert">
      <strong>{generation.error.code==='missing-tile'?'Elevation data is missing for this area.':'Terrain could not be generated.'}</strong> {generation.error.message}
      {frozen&&<button type="button" onClick={()=>{lastRunSettings.current=settingsKey;void generate(frozen,settings)}}>Try again</button>}
     </div>}
     {result?.warnings.map(w=><p key={w.code} className="topo-banner warning" role="status">{w.message}</p>)}
     <div className={`topo-preview-frame${working?' busy':''}`}>
      {result?<TerrainPreview result={result}/>:working?<p className="topo-note">{progressText}</p>:null}
     </div>
     {result&&<dl className="topo-terrain-stats" aria-label="Terrain details">
      {result.elevation.landSamples>0&&<div><dt>Elevation</dt><dd>{fmt(result.elevation.minM,1)}–{fmt(result.elevation.maxM,1)} m (range {fmt(result.elevation.rangeM,1)} m)</dd></div>}
      {result.layers.map(layer=><div key={layer.index}><dt>Layer {layer.index}</dt><dd>{layer.thresholdM===null?'all land':`≥ ${fmt(layer.thresholdM,1)} m`} · {fmt(layer.coveragePercent,1)}% of land</dd></div>)}
      {result.contours.length>0&&<div><dt>Contours</dt><dd>{result.contours.length} elevations, every {fmt(result.elevation.rangeM/(result.contours.length+1),1)} m</dd></div>}
      <div><dt>Source</dt><dd>{result.grid.tileCount} tiles at zoom {result.grid.tileZoom} · {result.grid.columns}×{result.grid.rows} samples · {Math.round(result.durationMs)} ms</dd></div>
     </dl>}
    </div>
   </>}
  </section>
 </main>;
}
