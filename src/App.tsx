import {useCallback,useEffect,useRef,useState} from 'react';
import {Controls} from './components/controls/Controls';
import {GeneratedPreview} from './components/preview/GeneratedPreview';
import {MapViewer} from './map/mapViewer/MapViewer';
import {defaultProject} from './state/defaultProject';
import type {ExtractedFeatures,MapProject} from './types/project';
import type {GeocoderResult} from './map/geocoding/GeocoderService';
import {assertManufacturingSceneUsable,type ManufacturingScene} from './export/scene';
import {buildScene,buildPresentationScene} from './export/buildScene';
import {getCachedGeometryLayers,type GeometryCache} from './export/geometryCache';
import {individualSvgsZip,individualZipName,sceneToSvg} from './export/svg/exportSvg';
import {preloadAllFonts} from './text/fontRegistry';
import {OrnamentPage} from './ornament/ui/OrnamentPage';
const empty:ExtractedFeatures={water:[],roads:[],places:[]};
const download=(name:string,data:string|Uint8Array,type='image/svg+xml')=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data as BlobPart],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
// M-LIVE: presentation-tier edits from the Controls sidebar (text/number/select fields) are
// lightly debounced so rapid typing/clicking coalesces into one rebuild instead of one per
// keystroke, while still feeling live — see docs/v1-milestones.md.
const LIVE_DEBOUNCE_MS=120;

export default function App(){
 const[project,setProjectState]=useState<MapProject>(defaultProject),[features,setFeatures]=useState(empty),[scene,setScene]=useState<ManufacturingScene>(),[status,setStatus]=useState('Ready'),[mode,setMode]=useState<'map'|'generated'>('map'),[fly,setFly]=useState<{lng:number;lat:number;zoom?:number}>(),[error,setError]=useState('');
 // Which product is being designed. The ornament is a separate manufacturing target that shares this
 // repo's text/geometry/SVG code but none of its project state, so it owns its own store rather than
 // adding an unused branch to MapProject.
 const[tool,setTool]=useState<'lake-map'|'ornament'>('lake-map');
 // GEOMETRY CHANGE tier cache (M-LIVE): the expensive polygon-boolean shoreline/depth work,
 // reused across presentation-only rebuilds. featuresRef lets the debounced callback below always
 // read the latest extracted geography without becoming stale across re-renders.
 const geometryCacheRef=useRef<GeometryCache>(undefined);
 const featuresRef=useRef(features);
 featuresRef.current=features;
 const debounceRef=useRef<number|undefined>(undefined);

 useEffect(()=>{preloadAllFonts()},[]);

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
 const generate=()=>{setStatus('Processing shoreline and roads…');try{const {cache,result}=getCachedGeometryLayers(geometryCacheRef.current,project,features);geometryCacheRef.current=cache;setScene(buildPresentationScene(project,features,result));setMode('generated');setStatus('Done');setError('')}catch(e){setStatus('Generate failed');setError((e as Error).message)}};
 const exportIt=()=>{try{const s=scene??buildScene(project,features);assertManufacturingSceneUsable(s);setStatus('Building SVG…');if(project.exportSettings.layout==='individual')download(individualZipName(s),individualSvgsZip(s),'application/zip');else download(`layered-map-${project.exportSettings.layout}.svg`,sceneToSvg(s,project.exportSettings.layout,project.exportSettings.panelGapMm,project.exportSettings.annotations));setStatus('Export complete');setError('')}catch(e){setStatus('Export failed');setError(`SVG export failed: ${(e as Error).message}`)}};
 // Drag/nudge/flip/hide/reset from the generated-map editor: never debounced (each already fires
 // once per discrete user action, not per keystroke) but goes through the same cache-aware path.
 const commitOverride=(updater:(p:MapProject)=>MapProject)=>{
  const next=updater(project);
  setProjectState(next);
  if(debounceRef.current){window.clearTimeout(debounceRef.current);debounceRef.current=undefined}
  rebuildScene(next);
 };
 const loaded=features.water.length+features.roads.length+features.places.length>0;
 // Every hook above has already run, so this early return is stable across renders.
 if(tool==='ornament')return <OrnamentPage onExit={()=>setTool('lake-map')}/>;
 return <main><Controls project={project} setProject={setProjectLive} onSelect={select} onGenerate={generate} onExport={exportIt} status={status} generateError={error} counts={{water:features.water.length,roads:features.roads.length,namedRoads:features.roads.filter(r=>r.name).length,places:features.places.length}}/><section className="workspace"><nav><button className={mode==='map'?'active':''} onClick={()=>setMode('map')}>Map Mode</button><button className={mode==='generated'?'active':''} onClick={()=>setMode('generated')}>Generated Map</button><button onClick={()=>setTool('ornament')}>Ornament Studio →</button>{error&&<span className="nav-error error" role="alert" title={error}>{error}</span>}</nav>{mode==='map'?<MapViewer project={project} flyTo={fly} onView={m=>setProjectState(p=>({...p,map:m}))} onCrop={crop=>setProjectState(p=>({...p,map:{...p.map,crop}}))} onStatus={setStatus} onFeatures={f=>{setFeatures(f);setScene(undefined);geometryCacheRef.current=undefined;const total=f.water.length+f.roads.length+f.places.length;setStatus(total?`Loaded ${f.water.length} water, ${f.roads.length} roads, ${f.places.length} places`:'No vector features found in the selected crop.')}}/>:<GeneratedPreview scene={scene} featuresLoaded={loaded} project={project} error={error} onCommitOverride={commitOverride}/>}</section></main>;
}
