import {Suspense,lazy,useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Controls} from './components/controls/Controls';
import {GeneratedPreview} from './components/preview/GeneratedPreview';
import {MapViewer,type MapCapture} from './map/mapViewer/MapViewer';
import {defaultProject} from './state/defaultProject';
import type {CropGeography,ExtractedFeatures,MapProject} from './types/project';
import {selectedWaterGeo} from './bathymetry/selectedWater';
import type {GeocoderResult} from './map/geocoding/GeocoderService';
import {assertManufacturingSceneUsable,type ManufacturingScene} from './export/scene';
import {buildScene,buildPresentationScene} from './export/buildScene';
import {getCachedGeometryLayers,type GeometryCache} from './export/geometryCache';
import {individualSvgsZip,individualZipName,sceneToSvg} from './export/svg/exportSvg';
import {preloadAllFonts,subscribeFonts} from './text/fontRegistry';
import {FontLoadNotice} from './components/ui/FontLoadNotice';
import {ThemeToggle} from './components/ui/ThemeToggle';
import {lakeSceneToJob} from './production/adapters/lakeScene';
import {EstimatePanel} from './production/estimate/ui/EstimatePanel';
import {useEstimateConfig} from './production/estimate/ui/useEstimateConfig';
// Bundle splitting (Phase 0 backlog item 5): the ornament and topo tools are separate manufacturing
// targets from the lake map (see the `tool` state comment below) and are only ever rendered once the
// user actually switches to them. Loading them lazily keeps their code — including each tool's own
// worker bundles and UI — out of the initial chunk instead of shipping all three tools up front.
const OrnamentPage=lazy(()=>import('./ornament/ui/OrnamentPage').then(m=>({default:m.OrnamentPage})));
const TopoPage=lazy(()=>import('./topo/ui/TopoPage').then(m=>({default:m.TopoPage})));
const empty:ExtractedFeatures={water:[],roads:[],places:[]};
const cropKey=(crop?:CropGeography)=>crop&&JSON.stringify([crop.nw,crop.ne,crop.se,crop.sw]);
// Generated Map mode unmounts the map; Generate switches back and waits for it to register.
const MAP_MOUNT_TIMEOUT_MS=10000;
const download=(name:string,data:string|Uint8Array,type='image/svg+xml')=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data as BlobPart],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
// M-LIVE: presentation-tier edits from the Controls sidebar (text/number/select fields) are
// lightly debounced so rapid typing/clicking coalesces into one rebuild instead of one per
// keystroke, while still feeling live — see docs/v1-milestones.md.
const LIVE_DEBOUNCE_MS=120;
const APP_VERSION=typeof __APP_VERSION__==='string'?__APP_VERSION__:'0.0.0-dev';

export default function App(){
 const[project,setProjectState]=useState<MapProject>(defaultProject),[features,setFeatures]=useState(empty),[scene,setScene]=useState<ManufacturingScene>(),[status,setStatus]=useState('Ready'),[mode,setMode]=useState<'map'|'generated'>('map'),[fly,setFly]=useState<{lng:number;lat:number;zoom?:number}>(),[error,setError]=useState('');
 // Which product is being designed. The ornament is a separate manufacturing target that shares this
 // repo's text/geometry/SVG code but none of its project state, so it owns its own store rather than
 // adding an unused branch to MapProject.
 const[tool,setTool]=useState<'lake-map'|'ornament'|'topo'>('lake-map');
 const[estimateConfig,setEstimateConfig]=useEstimateConfig();
 // GEOMETRY CHANGE tier cache (M-LIVE): the expensive polygon-boolean shoreline/depth work,
 // reused across presentation-only rebuilds. featuresRef lets the debounced callback below always
 // read the latest extracted geography without becoming stale across re-renders.
 const geometryCacheRef=useRef<GeometryCache>(undefined);
 const featuresRef=useRef(features);
 featuresRef.current=features;
 const projectRef=useRef(project);
 projectRef.current=project;
 // MapViewer registers its capture here while the map is mounted. capturedCropRef is the crop the
 // current features were captured for, so Generate can tell a fresh capture from a stale or
 // missing one.
 const captureRef=useRef<MapCapture|undefined>(undefined);
 const capturedCropRef=useRef<string|undefined>(undefined);
 const debounceRef=useRef<number|undefined>(undefined);

 useEffect(()=>{preloadAllFonts()},[]);
 // When a font arrives (a retry after a failure, or a slow first load) after a build that needed
 // it, rebuild so the preview stops showing the font error.
 const errorRef=useRef(error);
 errorRef.current=error;
 useEffect(()=>subscribeFonts(()=>{if(/font/i.test(errorRef.current))rebuildScene(projectRef.current)}),[]);

 // Rebuilds the generated scene from whatever geography is already cached — never re-fetches map
 // tiles or re-runs extraction. Reuses the expensive geometry stage whenever nothing that affects
 // it changed (geometryKeyOf), so presentation-only edits (title, compass, road width, label
 // visibility, layer toggles, ...) redo only the cheap remainder. If nothing has been extracted
 // yet, or a build fails transiently, this leaves the last good `scene` on screen rather than
 // clearing it — so a live edit can never blank out a previously-working preview.
 const rebuildScene=useCallback((nextProject:MapProject)=>{
  const currentFeatures=featuresRef.current;
  if(!nextProject.map.crop||!currentFeatures.water.length)return;
  try{
   const {cache,result}=getCachedGeometryLayers(geometryCacheRef.current,nextProject,currentFeatures);
   geometryCacheRef.current=cache;
   setScene(buildPresentationScene(nextProject,currentFeatures,result));
   setStatus('Updated');setError('');
  }catch(e){setStatus('Update failed');setError((e as Error).message)}
 },[]);

 const setProjectLive=useCallback((next:MapProject)=>{
  setProjectState(next);
  if(debounceRef.current)window.clearTimeout(debounceRef.current);
  debounceRef.current=window.setTimeout(()=>rebuildScene(next),LIVE_DEBOUNCE_MS);
 },[rebuildScene]);

 const select=(r:GeocoderResult)=>{setFly({lng:r.longitude,lat:r.latitude,zoom:12});setMode('map')};
 // Generate now means "capture/update the editable project from the currently extracted
 // geography" — the first build, or an explicit refresh after a new geographic extraction. It is
 // no longer required after routine presentation edits (title/compass/roads/labels/layers), which
 // update live via setProjectLive/commitOverride above and below.
 const applyFeatures=(f:ExtractedFeatures,crop:CropGeography|undefined)=>{featuresRef.current=f;setFeatures(f);setScene(undefined);geometryCacheRef.current=undefined;capturedCropRef.current=cropKey(crop)};
 const needsCapture=()=>{const crop=projectRef.current.map.crop;return Boolean(crop)&&capturedCropRef.current!==cropKey(crop)};
 const mapMounted=()=>new Promise<MapCapture>((resolve,reject)=>{const started=Date.now(),check=()=>{if(captureRef.current)resolve(captureRef.current);else if(Date.now()-started>MAP_MOUNT_TIMEOUT_MS)reject(new Error('the map did not open.'));else setTimeout(check,50)};check()});
 // The features for the current crop: the last capture when it was taken for this exact crop, a
 // new capture otherwise. Generate used to build from whatever had been captured — nothing at all
 // if "Load visible vector features" was never clicked — and reported that as "no water".
 const ensureFeatures=async():Promise<ExtractedFeatures>=>{
  if(!needsCapture())return featuresRef.current;
  let capture=captureRef.current;
  if(!capture){setMode('map');capture=await mapMounted()}
  const captured=await capture();
  applyFeatures(captured,projectRef.current.map.crop);
  return captured;
 };
 const buildFrom=(current:ExtractedFeatures)=>{setStatus('Processing shoreline and roads…');try{const p=projectRef.current,{cache,result}=getCachedGeometryLayers(geometryCacheRef.current,p,current);geometryCacheRef.current=cache;setScene(buildPresentationScene(p,current,result));setMode('generated');setStatus('Done');setError('')}catch(e){setStatus('Generate failed');setError((e as Error).message)}};
 // Synchronous when the capture is already fresh (or there is no crop yet, which buildScene
 // refuses), so a refusal is on screen the moment the button is pressed.
 const generate=()=>{
  if(!needsCapture()){buildFrom(featuresRef.current);return}
  setError('');
  ensureFeatures().then(buildFrom,(e:Error)=>{setStatus('Generate failed');setError(`Could not capture map features for the selected crop: ${e.message}`)});
 };
 const selectedWater=async()=>selectedWaterGeo(projectRef.current,await ensureFeatures());
 // Export builds from the current project, never from the scene on screen. A live update that
 // fails (a font that never loaded, say) leaves the last good scene in the preview by design. Export
 // used to cut that stale scene: type a title while its font is missing and the file went out
 // without the title, with no error. Now the same failure refuses the export.
 const exportIt=()=>{try{const p=projectRef.current,current=featuresRef.current;let s;if(p.map.crop&&current.water.length){const {cache,result}=getCachedGeometryLayers(geometryCacheRef.current,p,current);geometryCacheRef.current=cache;s=buildPresentationScene(p,current,result);setScene(s)}else s=buildScene(p,current);assertManufacturingSceneUsable(s);setStatus('Building SVG…');if(project.exportSettings.layout==='individual')download(individualZipName(s),individualSvgsZip(s),'application/zip');else download(`layered-map-${project.exportSettings.layout}.svg`,sceneToSvg(s,project.exportSettings.layout,project.exportSettings.panelGapMm,project.exportSettings.annotations));setStatus('Export complete');setError('')}catch(e){setStatus('Export failed');setError(`SVG export failed: ${(e as Error).message}`)}};
 // Drag/nudge/flip/hide/reset from the generated-map editor: never debounced (each already fires
 // once per discrete user action, not per keystroke) but goes through the same cache-aware path.
 const commitOverride=(updater:(p:MapProject)=>MapProject)=>{
  const next=updater(project);
  setProjectState(next);
  if(debounceRef.current){window.clearTimeout(debounceRef.current);debounceRef.current=undefined}
  rebuildScene(next);
 };
 const loaded=features.water.length+features.roads.length+features.places.length>0;
 // Production planning reads the scene on screen: it is rebuilt live for every layer, size and
 // setting change, and the estimate settings never feed back into it, so editing a price or a
 // speed recomputes the estimate without regenerating any geometry.
 const job=useMemo(()=>scene?lakeSceneToJob(scene):undefined,[scene]);
 const estimate={summary:scene?`${scene.layers.length} layers`:'Generate first',panel:<EstimatePanel job={job} title={project.title.text} product="Lake depth map" config={estimateConfig} setConfig={setEstimateConfig} appVersion={APP_VERSION}/>};
 // Every hook above has already run, so this early return is stable across renders. The Suspense
 // fallback only ever shows for the moment it takes to fetch that tool's chunk on first visit —
 // once loaded, React caches the lazy component so switching tools again is instant.
 if(tool==='ornament')return <Suspense fallback={<div className="tool-loading">Loading Ornament Studio…</div>}><OrnamentPage onExit={()=>setTool('lake-map')}/></Suspense>;
 if(tool==='topo')return <Suspense fallback={<div className="tool-loading">Loading Topo Map Builder…</div>}><TopoPage onExit={()=>setTool('lake-map')}/></Suspense>;
 return <main className="studio"><Controls project={project} setProject={setProjectLive} onSelect={select} onGenerate={generate} onExport={exportIt} status={status} generateError={error} counts={{water:features.water.length,roads:features.roads.length,namedRoads:features.roads.filter(r=>r.name).length,places:features.places.length}} selectedWater={selectedWater} estimate={estimate}/><section className="workspace"><nav><div className="nav-tabs" role="group" aria-label="View"><button className={mode==='map'?'active':''} onClick={()=>setMode('map')}>Map Mode</button><button className={mode==='generated'?'active':''} onClick={()=>setMode('generated')}>Generated Map</button></div>{error&&<span className="nav-error error" role="alert" title={error}>{error}</span>}<div className="nav-tools"><button onClick={()=>setTool('ornament')}>Ornament Studio →</button><button onClick={()=>setTool('topo')}>Topo Map Builder →</button></div><ThemeToggle/></nav><FontLoadNotice/>{mode==='map'?<MapViewer project={project} flyTo={fly} onView={m=>setProjectState(p=>({...p,map:m}))} onCrop={crop=>setProjectState(p=>({...p,map:{...p.map,crop}}))} onStatus={setStatus} captureRef={captureRef} onFeatures={f=>{applyFeatures(f,projectRef.current.map.crop);const total=f.water.length+f.roads.length+f.places.length;setStatus(total?`Loaded ${f.water.length} water, ${f.roads.length} roads, ${f.places.length} places`:'No vector features found in the selected crop.')}}/>:<GeneratedPreview scene={scene} featuresLoaded={loaded} project={project} error={error} onCommitOverride={commitOverride}/>}</section></main>;
}
