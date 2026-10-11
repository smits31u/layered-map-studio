import {useState} from 'react';
import type {GeocoderResult} from '../../map/geocoding/GeocoderService';
import {ProxyGeocoder} from '../../map/geocoding/GeocoderService';
import type {MapProject} from '../../types/project';
import {inchesToMm,mmToInches,validateDimensionMm} from '../../utils/units';
import {importDepthRegionGeoJson} from '../../bathymetry/model';
import {BathymetryResolver,LocalStorageBathymetryCache} from '../../bathymetry/resolver';
import {NoaaNceiProvider,StateRoutedProvider,UsgsProvider} from '../../bathymetry/providers';
import type {GeoMultiPolygon} from '../../bathymetry/model';
import {interiorPoint} from '../../bathymetry/geo';
import {ARTISTIC_DEPTH_PRESETS,type ArtisticDepthPresetName} from '../../geometry/shoreline/artisticDepth';
import {applyCropSnapshot,hashCropSnapshot,serializeCropSnapshot,type CropSnapshot} from '../../geometry/projection/cropSnapshot';
import {FONT_REGISTRY} from '../../text/fontRegistry';
import {cornerPosition,MIN_COMPASS_SIZE_MM,type CompassCorner} from '../../geometry/scene/compass';
import {DEFAULT_MARKER_SIZE_MM} from '../../geometry/scene/markerRegistry';
import {resetOverrideFields} from '../../geometry/scene/overrides';
import type {MapMarker} from '../../types/project';
import {MarkerCard} from './MarkerCard';
import {TerrainControls} from './TerrainControls';
const fontOptions=FONT_REGISTRY.map(f=><option key={f.id} value={f.id}>{f.label}</option>);
export function Controls({project,setProject,onSelect,onGenerate,onExport,status,generateError,counts,selectedWater}:{project:MapProject;setProject:(p:MapProject)=>void;onSelect:(r:GeocoderResult)=>void;onGenerate:()=>void;onExport:()=>void;status:string;generateError?:string;counts:{water:number;roads:number;namedRoads:number;places:number};selectedWater?:()=>Promise<GeoMultiPolygon>}){const[q,setQ]=useState('Caldron Falls, Wisconsin'),[results,setResults]=useState<GeocoderResult[]>([]),[error,setError]=useState(''),[searching,setSearching]=useState(false),[checkingDepth,setCheckingDepth]=useState(false),[cropJsonText,setCropJsonText]=useState(''),[cropStatus,setCropStatus]=useState('');const patch=(x:Partial<MapProject>)=>setProject({...project,...x});const search=async()=>{setSearching(true);setError('');try{const r=await new ProxyGeocoder('photon').search(q);setResults(r);if(!r.length)setError('No search results found')}catch(e){setError((e as Error).message)}finally{setSearching(false)}};
 const cropHash=project.map.crop?hashCropSnapshot(serializeCropSnapshot(project)):undefined;
 const copyCropJson=async()=>{try{const json=JSON.stringify(serializeCropSnapshot(project),null,2);setCropJsonText(json);if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(json);setCropStatus('Crop JSON copied to clipboard.')}else{setCropStatus('Clipboard unavailable — copy the JSON below manually.')}}catch(e){setCropStatus((e as Error).message)}};
 const applyCropJson=()=>{try{setProject(applyCropSnapshot(project,JSON.parse(cropJsonText) as CropSnapshot));setCropStatus('Crop applied from JSON. Reload visible vector features to match the restored framing.')}catch(e){setCropStatus(`Apply failed: ${(e as Error).message}`)}};
 const dim=(key:'widthMm'|'heightMm',raw:number)=>{const mm=project.dimensions.displayUnit==='in'?inchesToMm(raw):raw;if(validateDimensionMm(mm))patch({dimensions:{...project.dimensions,[key]:mm}})};
 // Asks about the selected water body (captured first if needed), routed to the DNR of the state it
 // is in. Cache prefix v3: v2 entries include Wisconsin "matches" with WBIC 0 for out-of-state lakes.
 const checkBathymetry=async()=>{setCheckingDepth(true);const resolver=new BathymetryResolver([new StateRoutedProvider(),new NoaaNceiProvider(),new UsgsProvider()],new LocalStorageBathymetryCache('lms:bathymetry:v3:'));try{let water:GeoMultiPolygon|undefined;if(selectedWater){try{water=await selectedWater()}catch(reason){patch({bathymetry:{...project.bathymetry,status:'error',statusMessage:`Could not identify the selected water body: ${(reason as Error).message}`,dataset:undefined,datasetId:undefined}});return}}const[longitude,latitude]=water?interiorPoint(water):[project.map.longitude,project.map.latitude],found=await resolver.resolve({longitude,latitude,waterbodyName:q,water}),result=found.find(item=>item.status==='available')??found[0],available=result.status==='available';patch({bathymetry:{...project.bathymetry,mode:available?'true-bathymetry':project.bathymetry.mode,provider:result.provider==='none'?undefined:result.provider,status:available?'available':result.status==='unsupported'?'unsupported':'unavailable',statusMessage:result.message,dataset:result.dataset,datasetId:result.dataset?.source.datasetId}})}finally{setCheckingDepth(false)}};
 const importBathymetry=async(file?:File)=>{if(!file)return;try{const dataset=importDepthRegionGeoJson(JSON.parse(await file.text()),file.name);patch({bathymetry:{...project.bathymetry,mode:'true-bathymetry',provider:'user',datasetId:dataset.source.datasetId,dataset,status:'available',statusMessage:`Loaded ${dataset.contours.length} verified depth-region levels from ${file.name}.`,thresholdsMeters:[]}})}catch(reason){patch({bathymetry:{...project.bathymetry,status:'error',statusMessage:(reason as Error).message}})}};
 const bathymetryDataset=project.bathymetry.dataset;
 const addMarker=()=>{const marker:MapMarker={id:`marker-${crypto.randomUUID()}`,markerType:'pin',sizeMm:DEFAULT_MARKER_SIZE_MM,rotationDeg:0,showLabel:false,labelSizeMm:3,visible:true,operation:'engrave',keepOutEnabled:false,keepOutPaddingMm:2};patch({markers:[...project.markers,marker]})};
 const patchMarker=(id:string,fields:Partial<MapMarker>)=>patch({markers:project.markers.map(m=>m.id===id?{...m,...fields}:m)});
 const deleteMarker=(id:string)=>{const {[id]:_removed,...overrides}=project.overrides;patch({markers:project.markers.filter(m=>m.id!==id),overrides})};
 const unit=project.dimensions.displayUnit;
 const sizeText=unit==='in'?`${+mmToInches(project.dimensions.widthMm).toFixed(2)} × ${+mmToInches(project.dimensions.heightMm).toFixed(2)} in`:`${+project.dimensions.widthMm.toFixed(1)} × ${+project.dimensions.heightMm.toFixed(1)} mm`;
 const depthStatus=project.bathymetry.status;
 const placeClassCount=Object.values(project.placeLabels.classes).filter(Boolean).length;
 const layerLabel=(i:number)=>i===0?'Land':i===6?'Base':`Layer ${i+1}`;
 // Sections are grouped by what they decide: the lake and its depth first (open), then what is drawn
 // on the map (closed, each summarising its current setting), then a developer tool. The two actions
 // live in a panel pinned to the foot of the sidebar, so Export is never scrolled out of reach and the
 // one primary button on the screen is the one that produces the file.
 return <aside>
  <header className="studio-brand"><div className="studio-wordmark">Layered Map Studio</div><h1 className="studio-tool">Lake depth map</h1></header>
  <div className="sidebar-scroll">
   <details open><summary>Location</summary><div className="section-body">
    <div className="search-row"><input aria-label="Lake or place name" value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==='Enter'&&search()}/><button onClick={search} disabled={searching}>{searching?'Searching…':'Search'}</button></div>
    {error&&<p className="error">{error}</p>}
    {results.length>0&&<div className="results">{results.map(r=><button key={r.id} onClick={()=>onSelect(r)}>{r.displayName}</button>)}</div>}
   </div></details>

   <details open><summary>Physical size<span className="summary-meta">{sizeText}</span></summary><div className="section-body">
    <label>Units <select value={unit} onChange={e=>patch({dimensions:{...project.dimensions,displayUnit:e.target.value as 'in'|'mm'}})}><option value="in">Inches</option><option value="mm">Millimeters</option></select></label>
    <div className="field-pair">
     <label>Width ({unit}) <input type="number" step="0.1" value={unit==='in'?mmToInches(project.dimensions.widthMm):project.dimensions.widthMm} onChange={e=>dim('widthMm',+e.target.value)}/></label>
     <label>Height ({unit}) <input type="number" step="0.1" value={unit==='in'?mmToInches(project.dimensions.heightMm):project.dimensions.heightMm} onChange={e=>dim('heightMm',+e.target.value)}/></label>
    </div>
    <span className="readout">{project.dimensions.widthMm.toFixed(3)} × {project.dimensions.heightMm.toFixed(3)} mm</span>
   </div></details>

   <details open><summary>Depth data<span className="summary-meta">{project.bathymetry.mode==='true-bathymetry'?'True bathymetry':project.bathymetry.mode==='procedural-terrain'?'Procedural terrain':'Artistic depth'}</span></summary><div className="section-body">
    <label>Mode <select value={project.bathymetry.mode} onChange={e=>patch({bathymetry:{...project.bathymetry,mode:e.target.value as MapProject['bathymetry']['mode']}})}><option value="true-bathymetry">True Bathymetry</option><option value="decorative-offsets">Artistic Depth</option><option value="procedural-terrain">Procedural Terrain</option></select></label>
    {project.bathymetry.mode==='procedural-terrain'&&<TerrainControls project={project} patch={patch}/>}
    <button onClick={checkBathymetry} disabled={checkingDepth}>{checkingDepth?'Checking providers…':'Check Bathymetry'}</button>
    <label className="field-stack">Import depth-region GeoJSON <input type="file" accept=".geojson,.json,application/geo+json,application/json" onChange={e=>importBathymetry(e.target.files?.[0])}/></label>
    <small className="notice" data-severity={depthStatus==='available'?'success':depthStatus==='unsupported'?'warning':depthStatus==='error'?'error':undefined}>{depthStatus==='unsupported'?`Waterbody found — no usable digital contours yet. ${project.bathymetry.statusMessage??''}`:(project.bathymetry.statusMessage??'Bathymetry has not been checked. Artistic Depth is shoreline-derived, not surveyed depth.')}</small>
    {bathymetryDataset&&<><label>Thresholds <select value={project.bathymetry.selection} onChange={e=>patch({bathymetry:{...project.bathymetry,selection:e.target.value as 'automatic'|'manual'}})}><option value="automatic">Automatic</option><option value="manual">Manual</option></select></label><small>Range: {(bathymetryDataset.minDepthMeters/0.3048).toFixed(1)}–{(bathymetryDataset.maxDepthMeters/0.3048).toFixed(1)} ft · {bathymetryDataset.source.title}{bathymetryDataset.source.attribution&&` · Data: ${bathymetryDataset.source.attribution}`} · NOT FOR NAVIGATION</small>{project.bathymetry.selection==='manual'&&[1,2,3,4,5].filter(i=>project.shoreline.enabledLayers[i]).map((_,position)=><label key={position}>Depth layer {position+1}<select value={project.bathymetry.thresholdsMeters[position]??bathymetryDataset.contours[position]?.depthMeters} onChange={e=>{const values=[...project.bathymetry.thresholdsMeters];values[position]=+e.target.value;patch({bathymetry:{...project.bathymetry,thresholdsMeters:values}})}}>{bathymetryDataset.contours.map(contour=><option key={contour.depthMeters} value={contour.depthMeters}>{(contour.depthMeters/0.3048).toFixed(1)} ft</option>)}</select></label>)}</>}
   </div></details>

   <details open><summary>Depth layers<span className="summary-meta">{project.shoreline.enabledLayers.filter(Boolean).length} panels</span></summary><div className="section-body">
    <label>Water <select value={project.shoreline.waterMode??'primary'} onChange={e=>patch({shoreline:{...project.shoreline,waterMode:e.target.value as 'all'|'primary'}})}><option value="primary">Primary Water Body</option><option value="all">All Water</option></select></label>
    <label>Preset <select value={project.shoreline.preset} onChange={e=>{const preset=e.target.value as ArtisticDepthPresetName;patch({shoreline:{...project.shoreline,preset,...(preset==='custom'?{}:{artisticOffsetsNormalized:[...ARTISTIC_DEPTH_PRESETS[preset].normalizedOffsets]})}})}}>{['xfine','fine','narrow','normal','wide','custom'].map(value=><option value={value} key={value}>{value==='xfine'?'XFine':value[0].toUpperCase()+value.slice(1)}</option>)}</select></label>
    <small>Offsets are normalized design units, not surveyed depths.</small>
    {project.bathymetry.mode==='procedural-terrain'&&<small className="mode-note notice">Procedural Terrain is selected: the preset above does not apply; the layer checkboxes below choose which depth panels are cut.</small>}
    <label>Minimum area mm² <input type="number" min="0" step="1" value={project.shoreline.minWaterAreaMm2??1} onChange={e=>patch({shoreline:{...project.shoreline,minWaterAreaMm2:Math.max(0,+e.target.value)}})}/></label>
    <div className="toggle-grid" role="group" aria-label="Panels to cut">{project.shoreline.enabledLayers.map((v,i)=><label key={i} className="toggle-chip"><input type="checkbox" checked={v} onChange={e=>{const a=[...project.shoreline.enabledLayers];a[i]=e.target.checked;patch({shoreline:{...project.shoreline,enabledLayers:a}})}}/>{layerLabel(i)}</label>)}</div>
   </div></details>

   <p className="group-label">On the map</p>

   <details><summary>Roads<span className="summary-meta">{project.roads.mode==='all'?'All roads':project.roads.mode==='main'?'Main roads':'Off'}</span></summary><div className="section-body">
    <label>Mode <select value={project.roads.mode} onChange={e=>patch({roads:{...project.roads,mode:e.target.value as any}})}><option value="all">All</option><option value="main">Main</option><option value="off">Off</option></select></label>
    <div className="field-pair">
     <label>Major width mm <input type="number" min="0.05" step="0.05" value={project.roads.majorWidthMm} onChange={e=>patch({roads:{...project.roads,majorWidthMm:+e.target.value}})}/></label>
     <label>Minor width mm <input type="number" min="0.05" step="0.05" value={project.roads.minorWidthMm} onChange={e=>patch({roads:{...project.roads,minorWidthMm:+e.target.value}})}/></label>
    </div>
   </div></details>

   <details><summary>Road labels<span className="summary-meta">{project.roadLabels.visible?'Shown':'Hidden'}</span></summary><div className="section-body">
    <label className="check"><input type="checkbox" checked={project.roadLabels.visible} onChange={e=>patch({roadLabels:{...project.roadLabels,visible:e.target.checked}})}/> Show</label>
    <label>Font <select value={project.roadLabels.font} onChange={e=>patch({roadLabels:{...project.roadLabels,font:e.target.value as any}})}>{fontOptions}</select></label>
    <div className="field-pair">
     <label>Size mm <input type="number" min="0.5" step="0.1" value={project.roadLabels.sizeMm} onChange={e=>patch({roadLabels:{...project.roadLabels,sizeMm:+e.target.value}})}/></label>
     <label>Road offset mm <input type="number" min="0" step="0.1" value={project.roadLabels.offsetMm} onChange={e=>patch({roadLabels:{...project.roadLabels,offsetMm:+e.target.value}})}/></label>
    </div>
    <label className="check"><input type="checkbox" checked={project.roadLabels.flipAllSides} onChange={e=>patch({roadLabels:{...project.roadLabels,flipAllSides:e.target.checked}})}/> Flip All Sides</label>
    <small>Named roads only; one label per named road, oriented along its longest straight segment. Labels that do not fit their segment are skipped — see Label metrics after generating.</small>
   </div></details>

   <details><summary>Place labels<span className="summary-meta">{placeClassCount?`${placeClassCount} of 4 kinds`:'Hidden'}</span></summary><div className="section-body">
    <div className="toggle-grid" role="group" aria-label="Places to label">{(['city','town','village','hamlet'] as const).map(cls=><label key={cls} className="toggle-chip"><input type="checkbox" checked={project.placeLabels.classes[cls]} onChange={e=>patch({placeLabels:{...project.placeLabels,classes:{...project.placeLabels.classes,[cls]:e.target.checked}}})}/>{cls[0].toUpperCase()+cls.slice(1)}{cls==='city'?'ies':'s'}</label>)}</div>
    <label>Font <select value={project.placeLabels.font} onChange={e=>patch({placeLabels:{...project.placeLabels,font:e.target.value as any}})}>{fontOptions}</select></label>
    <label>Size mm <input type="number" min="0.5" step="0.1" value={project.placeLabels.sizeMm} onChange={e=>patch({placeLabels:{...project.placeLabels,sizeMm:+e.target.value}})}/></label>
   </div></details>

   <details><summary>Compass<span className="summary-meta">{project.compass.position==='off'?'Off':project.compass.position}</span></summary><div className="section-body">
    <label>Style <select value={project.compass.style} onChange={e=>patch({compass:{...project.compass,style:e.target.value as any}})}><option value="classic-rose">Classic Rose</option><option value="classic">Classic North Arrow</option><option value="rose">Simple Rose</option><option value="minimal">Minimal N Arrow</option></select></label>
    <label>Position <select value={project.compass.position} onChange={e=>{const position=e.target.value as MapProject['compass']['position'];const corner=(position==='custom'||position==='off')?undefined:cornerPosition(position as CompassCorner,project.dimensions.widthMm,project.dimensions.heightMm,project.compass.sizeMm);patch({compass:{...project.compass,position,...(corner??{})}})}}>{['top-left','top-right','bottom-left','bottom-right','custom','off'].map(x=><option key={x} value={x}>{x}</option>)}</select></label>
    <div className="field-pair">
     <label>Size mm <input type="number" min={MIN_COMPASS_SIZE_MM} step="1" value={project.compass.sizeMm} onChange={e=>patch({compass:{...project.compass,sizeMm:+e.target.value}})}/></label>
     <label>Rotation ° <input type="number" step="1" value={project.compass.rotationDeg} onChange={e=>patch({compass:{...project.compass,rotationDeg:+e.target.value}})}/></label>
    </div>
    <label>Clearance mm <input type="number" min="0" max="20" step="0.5" value={project.compass.keepOutPaddingMm} onChange={e=>patch({compass:{...project.compass,keepOutPaddingMm:+e.target.value}})}/></label>
    <small>Roads and labels automatically clear around the compass by this margin — drag the compass directly in the Generated Map preview (Individual Layer → Land/Top) for custom placement.</small>
   </div></details>

   <details><summary>Location markers<span className="summary-meta">{project.markers.length||'None'}</span></summary><div className="section-body">
    <button onClick={addMarker}>+ Add Marker</button>
    {project.markers.map((marker,index)=><MarkerCard key={marker.id} marker={marker} project={project} index={index} onUpdate={fields=>patchMarker(marker.id,fields)} onResetPosition={()=>setProject(resetOverrideFields(project,marker.id))} onDelete={()=>deleteMarker(marker.id)}/>)}
    {!project.markers.length&&<small>No markers yet — Add Marker, then search for an address.</small>}
   </div></details>

   <details><summary>Title and subtitle<span className="summary-meta">{project.title.visible&&project.title.text?project.title.text:'No title'}</span></summary><div className="section-body">
    <label>Title text <input value={project.title.text} onChange={e=>patch({title:{...project.title,text:e.target.value}})}/></label>
    <label>Title font <select value={project.title.font} onChange={e=>patch({title:{...project.title,font:e.target.value as any}})}>{fontOptions}</select></label>
    <label>Title size mm <input type="number" min="1" step="0.5" value={project.title.sizeMm} onChange={e=>patch({title:{...project.title,sizeMm:+e.target.value}})}/></label>
    <label className="check"><input type="checkbox" checked={project.title.visible} onChange={e=>patch({title:{...project.title,visible:e.target.checked}})}/> Show title</label>
    <label>Backer <select value={project.title.backer} onChange={e=>patch({title:{...project.title,backer:e.target.value as any}})}><option value="none">None</option><option value="offset">Offset (rounded halo)</option><option value="rectangle">Rectangle</option></select></label>
    {project.title.backer!=='none'&&<label>Backer padding mm <input type="number" min="0" step="0.5" value={project.title.backerPaddingMm} onChange={e=>patch({title:{...project.title,backerPaddingMm:+e.target.value}})}/></label>}
    <label>Subtitle text <input value={project.subtitle.text} onChange={e=>patch({subtitle:{...project.subtitle,text:e.target.value}})}/></label>
    <label>Subtitle font <select value={project.subtitle.font} onChange={e=>patch({subtitle:{...project.subtitle,font:e.target.value as any}})}>{fontOptions}</select></label>
    <div className="field-pair">
     <label>Subtitle size mm <input type="number" min="1" step="0.5" value={project.subtitle.sizeMm} onChange={e=>patch({subtitle:{...project.subtitle,sizeMm:+e.target.value}})}/></label>
     <label>Gap mm <input type="number" min="0" step="0.5" value={project.subtitle.gapMm} onChange={e=>patch({subtitle:{...project.subtitle,gapMm:+e.target.value}})}/></label>
    </div>
    <label className="check"><input type="checkbox" checked={project.subtitle.visible} onChange={e=>patch({subtitle:{...project.subtitle,visible:e.target.checked}})}/> Show subtitle</label>
    <small>Drag title/subtitle directly in the Generated Map preview for custom placement; manual placement is preserved until Reset.</small>
   </div></details>

   <details className="section-muted"><summary>Developer: crop reproducibility</summary><div className="section-body">
    <small>{cropHash?`Crop ID: ${cropHash}`:'No crop selected yet — load visible vector features first.'}</small>
    <button onClick={copyCropJson} disabled={!project.map.crop}>Copy Crop JSON</button>
    <textarea rows={6} value={cropJsonText} onChange={e=>setCropJsonText(e.target.value)} placeholder="Paste a saved Crop JSON here to restore it exactly"/>
    <button onClick={applyCropJson} disabled={!cropJsonText.trim()}>Apply Crop JSON</button>
    {cropStatus&&<small>{cropStatus}</small>}
   </div></details>
  </div>

  <details open className="action-panel"><summary onClick={e=>e.preventDefault()}>Generate and export</summary>
   <label>Layout <select value={project.exportSettings.layout} onChange={e=>patch({exportSettings:{...project.exportSettings,layout:e.target.value as any}})}><option value="production">Production Sheet</option><option value="registered">Registered Layers</option><option value="individual">Individual SVG files</option></select></label>
   <div className="action-row"><button onClick={onGenerate}>Generate scene</button><button className="btn-primary" onClick={onExport}>Export SVG</button></div>
   {generateError&&<p className="error" role="alert">{generateError}</p>}
   <div className="diagnostics"><b className={generateError?'error':undefined}>{status}</b><span>Water polygons: {counts.water}</span><span>Road features: {counts.roads}</span><span>Named roads: {counts.namedRoads}</span><span>Places: {counts.places}</span></div>
  </details>
 </aside>}
