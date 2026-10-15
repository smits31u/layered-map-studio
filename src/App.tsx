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
import {fileSlug} from './production/download';
import {ProjectPanel} from './components/projects/ProjectPanel';
import {useProjectSession,type SessionApply} from './state/projects/useProjectSession';
import {assertCropMatchesBoard,cropContains,cropMatchesBoard,fitCropToBoard} from './geometry/projection/cropAspect';
import {resizeBoard} from './state/boardResize';
// Bundle splitting (Phase 0 backlog item 5): the ornament and topo tools are separate manufacturing
// targets from the lake map (see the `tool` state comment below) and are only ever rendered once the
// user actually switches to them. Loading them lazily keeps their code — including each tool's own
// worker bundles and UI — out of the initial chunk instead of shipping all three tools up front.
const OrnamentPage=lazy(()=>import('./ornament/ui/OrnamentPage').then(m=>({default:m.OrnamentPage})));
const TopoPage=lazy(()=>import('./topo/ui/TopoPage').then(m=>({default:m.TopoPage})));
// The stacked 3D preview brings three.js; it loads the first time its tab is opened, never with the
// lake tool itself.
const Preview3D=lazy(()=>import('./production/preview3d/ui/Preview3D'));
const empty:ExtractedFeatures={water:[],roads:[],places:[]};
const cropKey=(crop?:CropGeography)=>crop&&JSON.stringify([crop.nw,crop.ne,crop.se,crop.sw]);
// Generated Map mode unmounts the map; Generate switches back and waits for it to register.
const MAP_MOUNT_TIMEOUT_MS=10000;
const download=(name:string,data:string|Uint8Array,type='image/svg+xml')=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data as BlobPart],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
// M-LIVE: presentation-tier edits from the Controls sidebar (text/number/select fields) are
// lightly debounced so rapid typing/clicking coalesces into one rebuild instead of one per
// keystroke, while still feeling live — see docs/v1-milestones.md.
const LIVE_DEBOUNCE_MS=120;
// Every build from the map refuses a crop that is not the board's shape (see cropAspect.ts): it would
// stretch every panel. buildScene itself does not check, so its fixtures stay as recorded.
const assertBoardShape=(p:MapProject)=>{if(p.map.crop)assertCropMatchesBoard(p.map.crop,p.dimensions.widthMm,p.dimensions.heightMm)};
const STALE_CAPTURE='The map has moved since its features were captured. Press Generate to capture the new view first.';
const APP_VERSION=typeof __APP_VERSION__==='string'?__APP_VERSION__:'0.0.0-dev';
// Identifies a crop together with the board size it was framed for. An opened project's crop stays
// pinned only while both are unchanged; resizing the board or moving the map lets the map re-measure.
const pinKey=(p:MapProject)=>p.map.crop?JSON.stringify([cropKey(p.map.crop),p.dimensions.widthMm,p.dimensions.heightMm]):undefined;
const sizeLabel=(job:{widthMm:number;heightMm:number})=>`${+(job.widthMm/25.4).toFixed(2)} x ${+(job.heightMm/25.4).toFixed(2)} in`;

export default function App(){
 const[project,setProjectState]=useState<MapProject>(defaultProject),[features,setFeatures]=useState(empty),[scene,setScene]=useState<ManufacturingScene>(),[status,setStatus]=useState('Ready'),[mode,setMode]=useState<'map'|'generated'|'3d'>('map'),[fly,setFly]=useState<{lng:number;lat:number;zoom?:number}>(),[error,setError]=useState('');
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
 // missing one: they cover any crop inside it (a board resize refits the crop inside it), and
 // nothing else.
 const captureRef=useRef<MapCapture|undefined>(undefined);
 const capturedCropRef=useRef<CropGeography|undefined>(undefined);
 const debounceRef=useRef<number|undefined>(undefined);
 // Set when a saved project is opened or the session restored: the map keeps that crop (see
 // MapViewer's keepCrop) so the saved geography still matches it. mapKey remounts the map so it
 // starts at the opened project's view.
 const[pinnedCrop,setPinnedCrop]=useState<string>();
 const[mapKey,setMapKey]=useState(0);

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
  // The map has moved since the capture: building would pair the new crop with geography captured
  // for the old one. The last good scene stays on screen, and Generate recaptures.
  if(needsCapture(nextProject)){setStatus('Update refused');setError(STALE_CAPTURE);return}
  try{
   assertBoardShape(nextProject);
   const {cache,result}=getCachedGeometryLayers(geometryCacheRef.current,nextProject,currentFeatures);
   geometryCacheRef.current=cache;
   setScene(buildPresentationScene(nextProject,currentFeatures,result));
   setStatus('Updated');setError('');
  }catch(e){setStatus('Update failed');setError((e as Error).message)}
 },[]);

 // A board size change also refits the crop and moves the title and compass (resizeBoard).
 const setProjectLive=useCallback((requested:MapProject)=>{
  const previous=projectRef.current,next=resizeBoard(requested,{...previous.dimensions,crop:previous.map.crop},capturedCropRef.current);
  projectRef.current=next;
  setProjectState(next);
  if(debounceRef.current)window.clearTimeout(debounceRef.current);
  debounceRef.current=window.setTimeout(()=>rebuildScene(next),LIVE_DEBOUNCE_MS);
 },[rebuildScene]);

 const select=(r:GeocoderResult)=>{setFly({lng:r.longitude,lat:r.latitude,zoom:12});setMode('map')};
 // Generate now means "capture/update the editable project from the currently extracted
 // geography" — the first build, or an explicit refresh after a new geographic extraction. It is
 // no longer required after routine presentation edits (title/compass/roads/labels/layers), which
 // update live via setProjectLive/commitOverride above and below.
 const applyFeatures=(f:ExtractedFeatures,crop:CropGeography|undefined)=>{featuresRef.current=f;setFeatures(f);setScene(undefined);geometryCacheRef.current=undefined;capturedCropRef.current=crop};
 function needsCapture(p=projectRef.current){const crop=p.map.crop,captured=capturedCropRef.current;return Boolean(crop)&&!(captured&&cropContains(captured,crop!))}
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
 const buildFrom=(current:ExtractedFeatures)=>{setStatus('Processing shoreline and roads…');try{const p=projectRef.current;assertBoardShape(p);const {cache,result}=getCachedGeometryLayers(geometryCacheRef.current,p,current);geometryCacheRef.current=cache;setScene(buildPresentationScene(p,current,result));setMode('generated');setStatus('Done');setError('')}catch(e){setStatus('Generate failed');setError((e as Error).message)}};
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
 // without the title, with no error. Now the same failure refuses the export, and so does a map
 // moved since the capture, which used to cut the new crop from the old crop's geography.
 const exportIt=()=>{try{const p=projectRef.current,current=featuresRef.current;if(current.water.length&&needsCapture(p))throw new Error(STALE_CAPTURE);assertBoardShape(p);let s;if(p.map.crop&&current.water.length){const {cache,result}=getCachedGeometryLayers(geometryCacheRef.current,p,current);geometryCacheRef.current=cache;s=buildPresentationScene(p,current,result);setScene(s)}else s=buildScene(p,current);assertManufacturingSceneUsable(s);setStatus('Building SVG…');if(project.exportSettings.layout==='individual')download(individualZipName(s),individualSvgsZip(s),'application/zip');else download(`layered-map-${project.exportSettings.layout}.svg`,sceneToSvg(s,project.exportSettings.layout,project.exportSettings.panelGapMm,project.exportSettings.annotations));setStatus('Export complete');setError('')}catch(e){setStatus('Export failed');setError(`SVG export failed: ${(e as Error).message}`)}};
 // Drag/nudge/flip/hide/reset from the generated-map editor: never debounced (each already fires
 // once per discrete user action, not per keystroke) but goes through the same cache-aware path.
 const commitOverride=(updater:(p:MapProject)=>MapProject)=>{
  const next=updater(project);
  setProjectState(next);
  if(debounceRef.current){window.clearTimeout(debounceRef.current);debounceRef.current=undefined}
  rebuildScene(next);
 };
 const loaded=features.water.length+features.roads.length+features.places.length>0;
 // Opening a saved project, restoring the last session, or starting a new one: the project and its
 // saved geography replace what is on screen, and the scene is rebuilt from that geography (once the
 // fonts are in), without touching the map. That is what makes a reopened project identical to the
 // one that was saved, even if the map data has changed since.
 const applyProject:SessionApply=(opened,savedFeatures,how)=>{
  if(debounceRef.current){window.clearTimeout(debounceRef.current);debounceRef.current=undefined}
  // Projects saved before the crop frame kept the board's shape carry a crop a few percent off it.
  // Their geography covers the largest crop of the right shape inside it, so they reopen as that.
  const crop=opened.map.crop,{widthMm:w,heightMm:h}=opened.dimensions,next=crop&&savedFeatures&&!cropMatchesBoard(crop,w,h)?{...opened,map:{...opened.map,crop:fitCropToBoard(crop,w,h)}}:opened;
  projectRef.current=next;
  setProjectState(next);
  applyFeatures(savedFeatures??empty,savedFeatures?crop:undefined);
  if(!savedFeatures)capturedCropRef.current=undefined;
  setError('');
  setPinnedCrop(savedFeatures?pinKey(next):undefined);
  setMapKey(k=>k+1);
  if(how==='new'||!savedFeatures||!next.map.crop){setMode('map');setStatus(how==='new'?'Ready':'Opened: search or move the map, then Generate.');return}
  setStatus('Rebuilding the saved project…');
  preloadAllFonts().then(()=>{if(projectRef.current!==next)return;rebuildScene(next);setMode(m=>m==='3d'?m:'generated')});
 };
 const session=useProjectSession({project,features,defaultProject,apply:applyProject,appVersion:APP_VERSION});
 const projectPanel=<ProjectPanel session={session} suggestedName={(project.title.text.trim()||'Lake map')+' '+(+(project.dimensions.widthMm/25.4).toFixed(2))+'x'+(+(project.dimensions.heightMm/25.4).toFixed(2))} onDownload={(name,json)=>download(fileSlug(name,'lake-project')+'.lmsproject.json',json,'application/json')}/>;
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
 return <main className="studio lake-page"><Controls project={project} setProject={setProjectLive} onSelect={select} onGenerate={generate} onExport={exportIt} status={status} generateError={error} counts={{water:features.water.length,roads:features.roads.length,namedRoads:features.roads.filter(r=>r.name).length,places:features.places.length}} selectedWater={selectedWater} estimate={estimate} projects={projectPanel}/><section className="workspace"><nav><div className="nav-tabs" role="group" aria-label="View"><button className={mode==='map'?'active':''} onClick={()=>setMode('map')}>Map Mode</button><button className={mode==='generated'?'active':''} onClick={()=>setMode('generated')}>Generated Map</button><button className={mode==='3d'?'active':''} onClick={()=>setMode('3d')}>3D Preview</button></div>{error&&<span className="nav-error error" role="alert" title={error}>{error}</span>}<div className="nav-tools"><button onClick={()=>setTool('ornament')}>Ornament Studio →</button><button onClick={()=>setTool('topo')}>Topo Map Builder →</button></div><ThemeToggle/></nav><FontLoadNotice/>{mode==='map'?<MapViewer key={mapKey} keepCrop={pinnedCrop!==undefined&&pinnedCrop===pinKey(project)} project={project} flyTo={fly} onView={m=>setProjectState(p=>({...p,map:m}))} onCrop={crop=>setProjectState(p=>({...p,map:{...p.map,crop}}))} onStatus={setStatus} captureRef={captureRef} onFeatures={f=>{applyFeatures(f,projectRef.current.map.crop);const total=f.water.length+f.roads.length+f.places.length;setStatus(total?`Loaded ${f.water.length} water, ${f.roads.length} roads, ${f.places.length} places`:'No vector features found in the selected crop.')}}/>:mode==='3d'?(job?<Suspense fallback={<div className="empty">Loading 3D preview…</div>}><Preview3D job={job} config={estimateConfig} title={project.title.text} sizeLabel={sizeLabel(job)} appVersion={APP_VERSION}/></Suspense>:<div className="empty">Generate the scene to see it as a stacked 3D object.</div>):<GeneratedPreview scene={scene} featuresLoaded={loaded} project={project} error={error} onCommitOverride={commitOverride}/>}</section></main>;
}
