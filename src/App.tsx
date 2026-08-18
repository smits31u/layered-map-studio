import {useState} from 'react';
import {Controls} from './components/controls/Controls';
import {GeneratedPreview} from './components/preview/GeneratedPreview';
import {MapViewer} from './map/mapViewer/MapViewer';
import {defaultProject} from './state/defaultProject';
import type {ExtractedFeatures,MapProject} from './types/project';
import type {GeocoderResult} from './map/geocoding/GeocoderService';
import type {ManufacturingScene} from './export/scene';
import {buildScene} from './export/buildScene';
import {individualSvgs,sceneToSvg} from './export/svg/exportSvg';
const empty:ExtractedFeatures={water:[],roads:[],places:[]};
const download=(name:string,data:string)=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type:'image/svg+xml'}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
export default function App(){const[project,setProject]=useState<MapProject>(defaultProject),[features,setFeatures]=useState(empty),[scene,setScene]=useState<ManufacturingScene>(),[status,setStatus]=useState('Ready'),[mode,setMode]=useState<'map'|'generated'>('map'),[fly,setFly]=useState<{lng:number;lat:number;zoom?:number}>();
 const select=(r:GeocoderResult)=>{setFly({lng:r.longitude,lat:r.latitude,zoom:12});setMode('map')};const generate=()=>{setStatus('Processing shoreline and roads…');try{const s=buildScene(project,features);setScene(s);setMode('generated');setStatus('Done')}catch(e){setStatus((e as Error).message)}};
 const exportIt=()=>{try{const s=scene??buildScene(project,features);setStatus('Building SVG…');if(project.exportSettings.layout==='individual')Object.entries(individualSvgs(s)).forEach(([n,v])=>download(n,v));else download(`layered-map-${project.exportSettings.layout}.svg`,sceneToSvg(s,project.exportSettings.layout,project.exportSettings.panelGapMm,project.exportSettings.annotations));setStatus('Export complete')}catch(e){setStatus(`SVG export failed: ${(e as Error).message}`)}};
 const loaded=features.water.length+features.roads.length+features.places.length>0;
 return <main><Controls project={project} setProject={p=>{setProject(p);setScene(undefined)}} onSelect={select} onGenerate={generate} onExport={exportIt} status={status} counts={{water:features.water.length,roads:features.roads.length,namedRoads:features.roads.filter(r=>r.name).length,places:features.places.length}}/><section className="workspace"><nav><button className={mode==='map'?'active':''} onClick={()=>setMode('map')}>Map Mode</button><button className={mode==='generated'?'active':''} onClick={()=>setMode('generated')}>Generated Map</button></nav>{mode==='map'?<MapViewer project={project} flyTo={fly} onView={m=>setProject(p=>({...p,map:m}))} onCrop={crop=>setProject(p=>({...p,map:{...p.map,crop}}))} onStatus={setStatus} onFeatures={f=>{setFeatures(f);setScene(undefined);const total=f.water.length+f.roads.length+f.places.length;setStatus(total?`Loaded ${f.water.length} water, ${f.roads.length} roads, ${f.places.length} places`:'No vector features found in the selected crop.')}}/>:<GeneratedPreview scene={scene} featuresLoaded={loaded}/>}</section></main>}
