import {useState} from 'react';
import type {GeocoderResult} from '../../map/geocoding/GeocoderService';
import {FallbackGeocoder} from '../../map/geocoding/GeocoderService';
import {MARKER_REGISTRY,MIN_MARKER_SIZE_MM} from '../../geometry/scene/markerRegistry';
import {markerGeographicStatus} from '../../geometry/scene/markers';
import type {MapMarker,MapProject,MarkerType} from '../../types/project';

// One marker's full editor block (address search + geocode status + type/size/rotation/label/
// operation/keep-out/visibility + reset/delete). Pulled into its own component — unlike every
// other Controls.tsx section — because a marker carries substantially more *local, per-item* UI
// state (address input text, searching flag, ambiguous-result list, error) than any single-object
// section does; cramming N of these into the same dense single-JSX-expression style as the rest of
// Controls.tsx would make the array-mapped markup unreadable.
export function MarkerCard({marker,project,index,onUpdate,onResetPosition,onDelete}:{marker:MapMarker;project:MapProject;index:number;onUpdate:(patch:Partial<MapMarker>)=>void;onResetPosition:()=>void;onDelete:()=>void}){
 const[addressInput,setAddressInput]=useState(marker.address??'');
 const[searching,setSearching]=useState(false);
 const[error,setError]=useState('');
 const[results,setResults]=useState<GeocoderResult[]>([]);

 const apply=(r:GeocoderResult)=>{onUpdate({address:r.displayName,lat:r.latitude,lng:r.longitude});setAddressInput(r.displayName);setResults([]);setError('')};

 const geocode=async()=>{
  if(!addressInput.trim()){setError('Enter an address first');return}
  setSearching(true);setError('');setResults([]);
  try{
   const found=await new FallbackGeocoder().search(addressInput);
   if(!found.length){setError('Address not found');return}
   if(found.length===1)apply(found[0]);else setResults(found);
  }catch(e){setError((e as Error).message)}
  finally{setSearching(false)}
 };

 const status=searching?'Searching…':marker.lat!=null?'Found':error?'Not Found':'—';
 const geoStatus=markerGeographicStatus(project,marker);

 return <details className="marker-card"><summary>{index+1}. {marker.label||marker.address||'New marker'}</summary>
  <label>Address <input value={addressInput} onChange={e=>setAddressInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&geocode()}/></label>
  <button onClick={geocode} disabled={searching}>{searching?'Searching…':'Find Address'}</button>
  <small>Status: {status}</small>
  {error&&<p className="error">{error}</p>}
  {results.length>0&&<div className="results">{results.map(r=><button key={r.id} onClick={()=>apply(r)}>{r.displayName}</button>)}</div>}
  {geoStatus&&!geoStatus.insideBounds&&<p className="error">Address is outside the current map area.</p>}
  <label>Marker <select value={marker.markerType} onChange={e=>onUpdate({markerType:e.target.value as MarkerType})}>{MARKER_REGISTRY.map(d=><option key={d.type} value={d.type}>{d.displayName}</option>)}</select></label>
  <label>Size mm <input type="number" min={MIN_MARKER_SIZE_MM} step="0.5" value={marker.sizeMm} onChange={e=>onUpdate({sizeMm:+e.target.value})}/></label>
  <label>Rotation ° <input type="number" step="1" value={marker.rotationDeg} onChange={e=>onUpdate({rotationDeg:+e.target.value})}/></label>
  <label>Label <input value={marker.label??''} onChange={e=>onUpdate({label:e.target.value})}/></label>
  <label><input type="checkbox" checked={marker.showLabel} onChange={e=>onUpdate({showLabel:e.target.checked})}/> Show Label</label>
  {marker.showLabel&&<label>Label size mm <input type="number" min="1" step="0.5" value={marker.labelSizeMm} onChange={e=>onUpdate({labelSizeMm:+e.target.value})}/></label>}
  <label>Operation <select value={marker.operation} onChange={e=>onUpdate({operation:e.target.value as 'engrave'|'cut'})}><option value="engrave">Engrave</option><option value="cut">Cut</option></select></label>
  <label><input type="checkbox" checked={marker.keepOutEnabled} onChange={e=>onUpdate({keepOutEnabled:e.target.checked})}/> Clear Roads Around Marker</label>
  {marker.keepOutEnabled&&<label>Clearance mm <input type="number" min="0" max="20" step="0.5" value={marker.keepOutPaddingMm} onChange={e=>onUpdate({keepOutPaddingMm:+e.target.value})}/></label>}
  <label><input type="checkbox" checked={marker.visible} onChange={e=>onUpdate({visible:e.target.checked})}/> Visible</label>
  <small>Drag the marker directly in the Generated Map preview for artistic placement; the geocoded address is preserved until Reset.</small>
  <div className="marker-card-actions"><button onClick={onResetPosition}>Reset to Exact Address</button><button onClick={onDelete}>Delete Marker</button></div>
 </details>;
}
