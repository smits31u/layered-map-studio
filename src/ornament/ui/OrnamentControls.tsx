import {useId} from 'react';
import {FONT_REGISTRY} from '../../text/fontRegistry';
import {mmToInches} from '../../utils/units';
import type {GeocodeCandidate} from '../../server/geocode/types';
import type {CaptureWarning} from '../capture/mapCapture';
import type {FeatureGeometryResult} from '../geometry/featureGeometry';
import {LAND_ISLAND_POLICIES,type LandIslandPolicy} from '../geometry/landIslands';
import type {OrnamentAction,OrnamentTextKey} from '../store';
import {ORNAMENT_LIMITS,type BuildMode,type ExportPreset,type MarkerKind,type MarkerOutput,type NumericLimit,type OrnamentProject,type RoadDetail,type TextLine} from '../types';
import {fromDisplay} from '../validation';
import type {OrnamentTextLayout} from '../text/ornamentText';
import type {OrnamentGeometry,OrnamentIssue} from '../geometry/ornamentShape';
import type {ExportReadiness,GeometrySnapshot} from '../snapshot';
import {StackDiagram} from './StackDiagram';
import {PlaceSearch} from './PlaceSearch';

type Props={
 project:OrnamentProject;
 dispatch:(action:OrnamentAction)=>void;
 geometry:OrnamentGeometry;
 textLayout:OrnamentTextLayout;
 markerIssues:OrnamentIssue[];
 readiness:ExportReadiness;
 snapshot:GeometrySnapshot|undefined;
 featureGeometry:FeatureGeometryResult|undefined;
 captureWarnings:CaptureWarning[];
 building:boolean;
 offMainThread:boolean;
 onReset:()=>void;
 onFitText:()=>void;
 onSelectPlace:(candidate:GeocodeCandidate,fitBounds:boolean)=>void;
 onCaptureGeometry:()=>void;
};

const displayNumber=(mm:number,unit:OrnamentProject['displayUnit'])=>Number((unit==='in'?mmToInches(mm):mm).toFixed(3));

// Slider and number input are two views of one stored value — never two states that have to be kept
// in sync. The visible label is bound to the number input by id and the slider carries its own
// accessible name, so each control is individually addressable rather than sharing one ambiguous
// label (plan §Accessibility: "Real labels for all text and range inputs", "Numeric values
// adjacent to sliders and editable directly").
function NumberField({label,value,limit,onChange,suffix}:{label:string;value:number;limit:NumericLimit;onChange:(n:number)=>void;suffix?:string}){
 const id=useId();
 return <div className="ornament-field">
  <label htmlFor={id}>{label}</label>
  <span className="ornament-number">
   <input type="range" aria-label={`${label} slider`} min={limit.min} max={limit.max} step={limit.step} value={value} onChange={e=>onChange(Number(e.target.value))}/>
   <input id={id} type="number" min={limit.min} max={limit.max} step={limit.step} value={value} onChange={e=>onChange(Number(e.target.value))}/>
   {suffix?<small>{suffix}</small>:null}
  </span>
 </div>;
}

function Segmented<T extends string>({label,value,options,onChange}:{label:string;value:T;options:readonly {value:T;label:string}[];onChange:(v:T)=>void}){
 return <fieldset className="ornament-segmented">
  <legend>{label}</legend>
  {options.map(option=><button key={option.value} type="button" aria-pressed={value===option.value} className={value===option.value?'active':''} onClick={()=>onChange(option.value)}>{option.label}</button>)}
 </fieldset>;
}

const TEXT_LABELS:Record<OrnamentTextKey,string>={subtitle:'Subtitle',title:'Title',date:'Date'};

function TextLineFields({keyName,line,dispatch}:{keyName:OrnamentTextKey;line:TextLine;dispatch:(a:OrnamentAction)=>void}){
 const label=TEXT_LABELS[keyName];
 return <div className="ornament-textline">
  <div className="ornament-field">
   <label htmlFor={`${keyName}-value`}>{label}</label>
   <input id={`${keyName}-value`} type="text" value={line.value} onChange={e=>dispatch({type:'setTextLine',key:keyName,patch:{value:e.target.value}})}/>
  </div>
  <div className="ornament-field">
   <label htmlFor={`${keyName}-font`}>{label} font</label>
   <select id={`${keyName}-font`} value={line.fontId} onChange={e=>dispatch({type:'setTextLine',key:keyName,patch:{fontId:e.target.value as TextLine['fontId']}})}>
    {FONT_REGISTRY.map(font=><option key={font.id} value={font.id}>{font.label}</option>)}
   </select>
  </div>
  <NumberField label={`${label} size`} suffix="mm" value={line.sizeMm} limit={ORNAMENT_LIMITS.textSizeMm} onChange={n=>dispatch({type:'setTextLine',key:keyName,patch:{sizeMm:n}})}/>
  <NumberField label={`${label} letter spacing`} suffix="mm" value={line.letterSpacingMm} limit={ORNAMENT_LIMITS.letterSpacingMm} onChange={n=>dispatch({type:'setTextLine',key:keyName,patch:{letterSpacingMm:n}})}/>
 </div>;
}

const coordinate=(pair:[number,number])=>`${pair[1].toFixed(5)}, ${pair[0].toFixed(5)}`;

const ISLAND_POLICY_LABELS:Record<LandIslandPolicy,string>={
 'keep-separate':'Keep as separate pieces',
 bridge:'Bridge with tabs',
 'omit-below-threshold':'Omit below threshold',
};

export function OrnamentControls({project,dispatch,geometry,textLayout,markerIssues,readiness,snapshot,featureGeometry,captureWarnings,building,offMainThread,onReset,onFitText,onSelectPlace,onCaptureGeometry}:Props){
 const unit=project.displayUnit;
 const diameterLimit:NumericLimit=unit==='in'
  ?{min:Number(mmToInches(ORNAMENT_LIMITS.diameterMm.min).toFixed(3)),max:Number(mmToInches(ORNAMENT_LIMITS.diameterMm.max).toFixed(3)),step:.05}
  :ORNAMENT_LIMITS.diameterMm;
 const issues=[...geometry.issues,...textLayout.issues,...markerIssues,...(featureGeometry?.warnings??[])];
 const errors=issues.filter(i=>i.severity==='error');
 const selectedPlace=project.viewport.selectedPlaceCenter;

 return <aside>
  <h1>Ornament Studio</h1>

  <p className="ornament-status" role="status" aria-live="polite">
   {errors.length?`${errors.length} problem${errors.length>1?'s':''} to resolve`:issues.length?`${issues.length} warning${issues.length>1?'s':''}`:'Ornament geometry is valid'}
  </p>

  <details open>
   <summary>Place</summary>
   <PlaceSearch selectedLabel={project.viewport.selectedPlaceLabel} onSelect={onSelectPlace}/>
  </details>

  <details open>
   <summary>Map</summary>
   <NumberField label="Zoom" value={project.viewport.zoom} limit={ORNAMENT_LIMITS.zoom} onChange={n=>dispatch({type:'setViewport',patch:{zoom:n}})}/>
   <Segmented<RoadDetail> label="Road detail" value={project.roads.detail} options={[{value:'low',label:'Low'},{value:'medium',label:'Medium'},{value:'high',label:'High'}]} onChange={v=>dispatch({type:'setRoads',patch:{detail:v}})}/>
   <NumberField label="Road width scale" value={project.roads.widthScale} limit={ORNAMENT_LIMITS.roadWidthScale} onChange={n=>dispatch({type:'setRoads',patch:{widthScale:n}})}/>
   <p className="ornament-readout">Centre {coordinate(project.viewport.center)} · bearing and tilt are fixed at 0 for this release.</p>
  </details>

  <details open>
   <summary>Ornament</summary>
   <label className="ornament-field">
    <span>Units</span>
    <select aria-label="Units" value={unit} onChange={e=>dispatch({type:'setDisplayUnit',value:e.target.value as OrnamentProject['displayUnit']})}>
     <option value="in">inches</option>
     <option value="mm">millimetres</option>
    </select>
   </label>
   <NumberField label="Diameter" suffix={unit} value={displayNumber(project.ornament.diameterMm,unit)} limit={diameterLimit} onChange={n=>dispatch({type:'setOrnament',patch:{diameterMm:fromDisplay(n,unit)}})}/>
   <NumberField label="Rim width" suffix="mm" value={project.ornament.rimWidthMm} limit={ORNAMENT_LIMITS.rimWidthMm} onChange={n=>dispatch({type:'setOrnament',patch:{rimWidthMm:n}})}/>
   <NumberField label="Map/text boundary" suffix="mm" value={project.ornament.mapToTextBoundaryMm} limit={ORNAMENT_LIMITS.mapToTextBoundaryMm} onChange={n=>dispatch({type:'setOrnament',patch:{mapToTextBoundaryMm:n}})}/>
   <p className="ornament-readout">Text band {geometry.textBandHeightMm.toFixed(1)}mm tall · map window {geometry.mapOpeningHeightMm.toFixed(1)}mm</p>
  </details>

  <details open>
   <summary>Hanging loop</summary>
   <NumberField label="Loop outer diameter" suffix="mm" value={project.ornament.hangingLoop.outerDiameterMm} limit={ORNAMENT_LIMITS.loopOuterDiameterMm} onChange={n=>dispatch({type:'setHangingLoop',patch:{outerDiameterMm:n}})}/>
   <NumberField label="Loop inner diameter" suffix="mm" value={project.ornament.hangingLoop.innerDiameterMm} limit={ORNAMENT_LIMITS.loopInnerDiameterMm} onChange={n=>dispatch({type:'setHangingLoop',patch:{innerDiameterMm:n}})}/>
   <NumberField label="Loop overlap" suffix="mm" value={project.ornament.hangingLoop.overlapMm} limit={ORNAMENT_LIMITS.loopOverlapMm} onChange={n=>dispatch({type:'setHangingLoop',patch:{overlapMm:n}})}/>
   <NumberField label="Minimum neck width" suffix="mm" value={project.ornament.hangingLoop.minNeckWidthMm} limit={ORNAMENT_LIMITS.loopMinNeckWidthMm} onChange={n=>dispatch({type:'setHangingLoop',patch:{minNeckWidthMm:n}})}/>
   <p className="ornament-readout">Joins body over {geometry.loop.junctionWidthMm.toFixed(2)}mm · loop material {geometry.loop.annulusWidthMm.toFixed(2)}mm</p>
  </details>

  <details open>
   <summary>Personalisation</summary>
   <TextLineFields keyName="subtitle" line={project.text.subtitle} dispatch={dispatch}/>
   <NumberField label="Gap subtitle to title" suffix="mm" value={project.text.gap12Mm} limit={ORNAMENT_LIMITS.lineGapMm} onChange={n=>dispatch({type:'setTextGap',key:'gap12Mm',value:n})}/>
   <TextLineFields keyName="title" line={project.text.title} dispatch={dispatch}/>
   <NumberField label="Gap title to date" suffix="mm" value={project.text.gap23Mm} limit={ORNAMENT_LIMITS.lineGapMm} onChange={n=>dispatch({type:'setTextGap',key:'gap23Mm',value:n})}/>
   <TextLineFields keyName="date" line={project.text.date} dispatch={dispatch}/>
   <button type="button" onClick={onFitText}>Fit text to band</button>
  </details>

  <details open>
   <summary>Build mode</summary>
   <Segmented<BuildMode> label="Fabrication stack" value={project.buildMode} options={[{value:'classic-2-piece',label:'Classic (2 piece)'},{value:'water-cutout-3-piece',label:'Water cutout (3 piece)'}]} onChange={v=>dispatch({type:'setBuildMode',value:v})}/>
   <StackDiagram mode={project.buildMode}/>
   <Segmented<ExportPreset> label="Export preset" value={project.exportPreset} options={[{value:'semantic',label:'Semantic'},{value:'lightburn-colors',label:'LightBurn'}]} onChange={v=>dispatch({type:'setExportPreset',value:v})}/>
  </details>

  <details open={project.buildMode==='water-cutout-3-piece'}>
   <summary>Loose land pieces</summary>
   {/* The plan's §Water requires this to be the user's decision, in these three words: "Offer three
       explicit policies: keep as separate pieces, bridge automatically using user-visible tabs, or
       omit below a size threshold. Default to warning, never silently discard meaningful islands."
       Every policy still reports what it found — see the warnings list at the bottom of this pane. */}
   <Segmented<LandIslandPolicy>
    label="When a water cutout leaves loose land"
    value={project.land.islandPolicy}
    options={LAND_ISLAND_POLICIES.map(policy=>({value:policy,label:ISLAND_POLICY_LABELS[policy]}))}
    onChange={v=>dispatch({type:'setLand',patch:{islandPolicy:v}})}
   />
   <NumberField label="Omit pieces below" suffix="mm²" value={project.land.minIslandAreaMm2} limit={ORNAMENT_LIMITS.minIslandAreaMm2} onChange={n=>dispatch({type:'setLand',patch:{minIslandAreaMm2:n}})}/>
   <NumberField label="Bridge tab width" suffix="mm" value={project.land.bridgeWidthMm} limit={ORNAMENT_LIMITS.bridgeWidthMm} onChange={n=>dispatch({type:'setLand',patch:{bridgeWidthMm:n}})}/>
   <NumberField label="Structural outer ring" suffix="mm" value={project.land.structuralRingWidthMm} limit={ORNAMENT_LIMITS.structuralRingWidthMm} onChange={n=>dispatch({type:'setLand',patch:{structuralRingWidthMm:n}})}/>
   <p className="ornament-readout">
    {project.buildMode==='water-cutout-3-piece'
     ?featureGeometry
      ?`${featureGeometry.islands.detected.length} loose piece(s) detected · ${featureGeometry.islands.remaining.length} still loose after this policy.`
      :'Capture the map geometry to find out whether this framing leaves loose land.'
     :'Only applies in water-cutout mode, where water is cut away rather than engraved.'}
   </p>
  </details>

  <details>
   <summary>Marker</summary>
   <Segmented<MarkerKind> label="Symbol" value={project.marker.kind} options={[{value:'heart',label:'Heart'},{value:'pin',label:'Pin'},{value:'house',label:'House'}]} onChange={v=>dispatch({type:'setMarker',patch:{kind:v}})}/>
   <NumberField label="Marker size" suffix="mm" value={project.marker.sizeMm} limit={ORNAMENT_LIMITS.markerSizeMm} onChange={n=>dispatch({type:'setMarker',patch:{sizeMm:n}})}/>
   <Segmented<MarkerOutput> label="Marker output" value={project.marker.output} options={[{value:'separate-cut-piece',label:'Separate cut piece'},{value:'engraved',label:'Engraved'}]} onChange={v=>dispatch({type:'setMarker',patch:{output:v}})}/>
   <p className="ornament-readout">Marker at {coordinate(project.marker.position)}</p>
   {/* Panning never moves the marker. The plan: "Position the marker at the selected place
       coordinate, not automatically at the current map center after panning. If the user wants the
       marker to move with the map center, expose a separate 'center marker' action." These are
       those actions, and they are the only two things that move it. */}
   <div className="ornament-actions">
    <button type="button" onClick={()=>dispatch({type:'centerMarkerOnView'})}>Move marker to map centre</button>
    <button type="button" disabled={!selectedPlace} onClick={()=>dispatch({type:'markerToSelectedPlace'})}>Return marker to selected place</button>
   </div>
  </details>

  <details open>
   <summary>Export</summary>
   {/* Capturing records which viewport the geometry belongs to. Feature extraction itself is
       Phase 3; what exists now is the guard that stops an export claiming geography the user has
       since panned away from. */}
   <button type="button" disabled={building} onClick={onCaptureGeometry}>{building?'Working…':snapshot?'Re-capture map geometry':'Capture map geometry'}</button>
   <p className="ornament-readout">
    {snapshot
     ?readiness.dirty?'The map has moved since the last capture.':`Captured ${snapshot.featureCount??0} feature(s) at zoom ${snapshot.fingerprint.zoom} · ${snapshot.fingerprint.detail} detail.`
     :'Nothing captured yet.'}
   </p>
   {featureGeometry?<p className="ornament-readout">
    {`${featureGeometry.metrics.roads.clippedPieces} road piece(s) at ${featureGeometry.metrics.roads.widthsMm.map(width=>width.toFixed(2)).join('/')}mm · ${featureGeometry.metrics.water.components} water area(s) with ${featureGeometry.metrics.water.holes} island(s) · ${featureGeometry.metrics.roads.vertices+featureGeometry.metrics.water.vertices} vertices`}
    {offMainThread?' · built in a background worker.':' · built on the main thread (no Web Worker available).'}
   </p>:null}
   {captureWarnings.length?<ul className="ornament-issues">{captureWarnings.map(warning=><li key={warning.code} className="warning">{warning.message}</li>)}</ul>:null}
   <button type="button" disabled={!readiness.ready} aria-describedby="ornament-export-blocked">
    Export SVG
   </button>
   <ul id="ornament-export-blocked" className="ornament-issues">
    {readiness.ready
     ?<li>Ready to export once Phase 4 adds SVG generation.</li>
     :readiness.reasons.map(reason=><li key={reason.code}>{reason.message}</li>)}
   </ul>
  </details>

  {issues.length?<ul className="ornament-issues">{issues.map((issue,index)=><li key={`${issue.code}-${index}`} className={issue.severity}>{issue.message}</li>)}</ul>:null}

  <button type="button" className="ornament-reset" onClick={onReset}>Reset to defaults</button>
 </aside>;
}
