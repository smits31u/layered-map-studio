import {useCallback,useEffect,useMemo,useReducer,useRef,useState} from 'react';
import {preloadAllFonts} from '../../text/fontRegistry';
import type {CaptureResult,CaptureWarning} from '../capture/mapCapture';
import type {FeatureCapture} from '../capture/featureTypes';
import {createDefaultOrnamentProject} from '../defaults';
import {downloadFiles,PROJECT_MIME,SVG_MIME} from '../export/download';
import {exportOrnament} from '../export/exportOrnament';
import type {PreflightReport} from '../export/preflight';
import {preflightSummary} from '../export/preflight';
import type {FeatureGeometryResult,FeatureGeometrySettings} from '../geometry/featureGeometry';
import {buildOrnamentGeometry} from '../geometry/ornamentShape';
import {clearOrnamentProject,loadOrnamentProject,saveOrnamentProject} from '../persistence';
import {exportReadiness,snapshotFromCapture,viewportFingerprint,type GeometrySnapshot} from '../snapshot';
import {ornamentReducer} from '../store';
import {fitTextScale,layoutOrnamentText} from '../text/ornamentText';
import {createGeometryRunner,isCancelled,isTimeout,type GeometryRunner} from '../worker/geometryRunner';
import {OrnamentControls} from './OrnamentControls';
import {OrnamentPreview} from './OrnamentPreview';

export type CaptureOutcome={ok:true;result:CaptureResult}|{ok:false;message:string};

// What the pipeline is doing, as one value rather than three booleans that can disagree. It is what
// the controls announce through their live region, and what `aria-busy` is derived from, so a
// screen reader hears the same state the button label shows.
export type PipelinePhase='idle'|'capturing'|'building'|'exporting';

// The capture watchdog. Capture is driven by an effect in the map component and reports back through
// a callback; if that report never arrives -- the map unmounted mid-capture, a provider wedged, an
// exception swallowed somewhere between the two -- nothing else would ever clear the working state,
// and the button would read "Working..." for the rest of the session. This is the outer bound on
// that. It is deliberately longer than the capture's own 8s idle timeout: exceeding that one is a
// warning and the capture continues, and this must not fire underneath it.
export const CAPTURE_TIMEOUT_MS=20_000;

// Fonts resolve asynchronously but text vectorization is synchronous, so the page re-renders once
// they land rather than reading a half-loaded registry (same contract buildScene relies on).
export function OrnamentPage({onExit}:{onExit:()=>void}){
 const [project,dispatch]=useReducer(ornamentReducer,undefined,()=>loadOrnamentProject()??createDefaultOrnamentProject());
 const [fontsReady,setFontsReady]=useState(false);
 const [status,setStatus]=useState('');
 // The geometry snapshot is transient by design. The plan keeps captured features out of the
 // serializable project, and a snapshot that survived a reload would assert that geography had been
 // captured in a session where it never was.
 const [snapshot,setSnapshot]=useState<GeometrySnapshot|undefined>(undefined);
 // The captured features themselves, kept so that changing a setting which does not change *which*
 // geography was captured — road width, build mode, the loose-piece policy — rebuilds the geometry
 // without going back to the map. Transient for the same reason the snapshot is.
 const [capture,setCapture]=useState<FeatureCapture|undefined>(undefined);
 const [captureWarnings,setCaptureWarnings]=useState<CaptureWarning[]>([]);
 const [featureGeometry,setFeatureGeometry]=useState<FeatureGeometryResult|undefined>(undefined);
 const [phase,setPhase]=useState<PipelinePhase>('idle');
 // Bumped rather than cleared, so choosing the same result twice still re-fits the map.
 const [fitBounds,setFitBounds]=useState<{bounds:[number,number,number,number];token:number}|undefined>(undefined);
 const [captureRequest,setCaptureRequest]=useState<{token:number}|undefined>(undefined);
 // The last preflight run. Transient like the capture it was run against, and cleared whenever the
 // capture is, so a stale "preflight passed" can never sit next to geometry it did not check.
 const [preflight,setPreflight]=useState<PreflightReport|undefined>(undefined);
 const [exporting,setExporting]=useState(false);

 // Derived rather than stored, so "the capture button says Working" and "the pipeline is busy" can
 // never drift apart.
 const building=phase==='capturing'||phase==='building';

 // Cleared when a capture reports, fired when one never does. Held in a ref with its token so a
 // report arriving after the watchdog has given up is recognised and ignored rather than reviving a
 // capture the user was already told had failed.
 const captureDeadline=useRef<{token:number;timer:ReturnType<typeof setTimeout>}|undefined>(undefined);
 const clearCaptureWatchdog=useCallback(()=>{
  if(!captureDeadline.current)return;
  clearTimeout(captureDeadline.current.timer);
  captureDeadline.current=undefined;
 },[]);
 useEffect(()=>()=>{if(captureDeadline.current)clearTimeout(captureDeadline.current.timer)},[]);

 // The plan's "reject stale export results if the project revision changed". Every build carries the
 // revision it started under; a result whose revision is not the current one is dropped on arrival
 // rather than overwriting geometry the user has already moved past. A ref rather than state because
 // the comparison happens inside a promise callback, which would otherwise close over a stale value.
 const revision=useRef(0);
 const runner=useRef<GeometryRunner|undefined>(undefined);
 if(!runner.current)runner.current=createGeometryRunner();
 useEffect(()=>()=>{runner.current?.dispose();runner.current=undefined},[]);

 useEffect(()=>{let live=true;preloadAllFonts().then(()=>{if(live)setFontsReady(true)});return()=>{live=false}},[]);
 useEffect(()=>{saveOrnamentProject(project)},[project]);

 const geometry=useMemo(()=>buildOrnamentGeometry(project.ornament),[project.ornament]);
 // fontsReady participates in the key so the layout recomputes when a font finishes loading; the
 // layout function itself reads the registry synchronously.
 const textLayout=useMemo(()=>layoutOrnamentText(project,geometry),[project,geometry,fontsReady]);

 const fingerprint=useMemo(()=>viewportFingerprint(project,geometry.innerRadiusMm),[project,geometry.innerRadiusMm]);
 const readiness=useMemo(()=>exportReadiness({
  snapshot,
  current:fingerprint,
  hasSelectedPlace:Boolean(project.viewport.selectedPlaceCenter),
  blockingIssueCount:geometry.issues.filter(issue=>issue.severity==='error').length,
  blockingTextIssueCount:textLayout.issues.filter(issue=>issue.severity==='error').length,
 }),[snapshot,fingerprint,project.viewport.selectedPlaceCenter,geometry.issues,textLayout.issues]);

 // The settings that can be re-applied to an *existing* capture, memoised on primitives rather than
 // on `project.land` — the reducer clamps into fresh objects on every action, so an object identity
 // here would rebuild the geometry every time the user panned the map.
 //
 // Road detail is included because the build filters by it a second time, but changing it also
 // changes the snapshot fingerprint, so in practice it arrives with a fresh capture. Anything that
 // moves the map window is absent: that makes the capture stale rather than re-derivable, and the
 // fingerprint already says so.
 const {islandPolicy,minIslandAreaMm2,bridgeWidthMm,structuralRingWidthMm}=project.land;
 const settings=useMemo<FeatureGeometrySettings>(()=>({
  diameterMm:project.ornament.diameterMm,
  detail:project.roads.detail,
  widthScale:project.roads.widthScale,
  buildMode:project.buildMode,
  land:{islandPolicy,minIslandAreaMm2,bridgeWidthMm,structuralRingWidthMm},
 }),[project.ornament.diameterMm,project.roads.detail,project.roads.widthScale,project.buildMode,islandPolicy,minIslandAreaMm2,bridgeWidthMm,structuralRingWidthMm]);

 const forgetCapture=useCallback(()=>{
  revision.current+=1;
  setSnapshot(undefined);
  setCapture(undefined);
  setCaptureWarnings([]);
  setFeatureGeometry(undefined);
  setPhase('idle');
  clearCaptureWatchdog();
  setPreflight(undefined);
 },[clearCaptureWatchdog]);

 // Export is one synchronous pass: build the pieces, preflight them, and only then serialise. A
 // blocked preflight downloads nothing at all — the report is the entire result, and the controls
 // render it where the "why is this disabled" list already lives.
 const onExport=useCallback(()=>{
  if(!readiness.ready)return;
  setExporting(true);
  setPhase('exporting');
  try{
   const result=exportOrnament({project,geometry,textLayout,featureGeometry,capture});
   setPreflight(result.preflight);
   if(!result.ok||!result.svg){
    setStatus(preflightSummary(result.preflight));
    return;
   }
   const wrote=downloadFiles([
    {name:result.fileNames.svg,content:result.svg,type:SVG_MIME},
    {name:result.fileNames.project,content:result.projectJson,type:PROJECT_MIME},
   ]);
   setStatus(wrote
    ?`Exported ${result.fileNames.svg} and ${result.fileNames.project} · ${preflightSummary(result.preflight)}`
    :'This browser would not accept the download. The geometry passed preflight — try a different browser.');
  }catch(error){
   setPreflight(undefined);
   setStatus(`The export could not be built: ${(error as Error).message}`);
  }finally{
   setExporting(false);
   setPhase('idle');
  }
 },[readiness.ready,project,geometry,textLayout,featureGeometry,capture]);

 const onCapture=useCallback((outcome:CaptureOutcome)=>{
  // The watchdog has already reported this capture as failed and the user has been told so. A late
  // arrival is dropped rather than quietly re-enabling export behind that message.
  if(!captureDeadline.current)return;
  clearCaptureWatchdog();
  if(!outcome.ok){
   setPhase('idle');
   setStatus(outcome.message);
   return;
  }
  const {capture:taken,warnings}=outcome.result;
  setCaptureWarnings(warnings);
  setCapture(taken);
  // Built from the capture rather than from the current fingerprint: see `snapshotFromCapture`. If
  // the map moved while this capture was in flight, the snapshot it produces is stale on arrival,
  // which blocks export and says why -- instead of stamping a moved viewport onto features that were
  // read before it moved.
  setSnapshot(snapshotFromCapture(taken));
  setPhase('building');
  // The build itself is left to the effect below, so that a fresh capture and a changed road width
  // take exactly the same path into the worker. Kicking it off here as well would run every capture
  // through the pipeline twice.
 },[clearCaptureWatchdog]);

 // The one place geometry is built. Re-derives from the capture already in hand whenever a purely
 // physical setting changes, which is the point of keeping the capture: dragging the road-width
 // slider must not re-query a single tile.
 const lastBuilt=useRef<{capture:FeatureCapture;settings:FeatureGeometrySettings}|undefined>(undefined);
 useEffect(()=>{
  const active=runner.current;
  if(!capture||!active)return;
  if(lastBuilt.current&&lastBuilt.current.capture===capture&&lastBuilt.current.settings===settings)return;
  lastBuilt.current={capture,settings};
  revision.current+=1;
  const token=revision.current;
  setPhase('building');
  // A preflight report describes one specific set of geometry. The moment a rebuild starts, the
  // report on screen is about geometry that is being replaced, so it stops being shown.
  setPreflight(undefined);
  const handle=active.run({revision:token,capture,settings});
  handle.result.then(result=>{
   // Stale-result guard. A run the user has already superseded resolves here with an old revision
   // and is dropped rather than repainting the preview with geometry for a view they left.
   if(result.revision!==revision.current)return;
   setFeatureGeometry(result);
   setPhase('idle');
   const roads=result.metrics.roads.clippedPieces,water=result.metrics.water.components;
   setStatus(`Built ${roads} road piece${roads===1?'':'s'} and ${water} water area${water===1?'':'s'} in ${result.metrics.durationMs??0}ms.`);
  }).catch(error=>{
   if(isCancelled(error)||revision.current!==token)return;
   setPhase('idle');
   // A timeout is not a bug report, it is an instruction: the view was too heavy for the machine
   // running it, and the two things that reliably make it lighter are less detail and less ground.
   setStatus(isTimeout(error)
    ? `${(error as Error).message} Set road detail to Medium or Low, or zoom in, then capture again.`
    : `The captured geometry could not be built: ${(error as Error).message}`);
  });
  // Cancelling on cleanup is what makes the worker cancellable in practice: a second setting change
  // while the first build is still running terminates it instead of queueing behind it.
  return ()=>handle.cancel();
 },[capture,settings]);

 // Identity-stable so the map's effects do not re-run on every parent render.
 const onViewportChange=useCallback((view:{center:[number,number];zoom:number})=>{
  dispatch({type:'setViewport',patch:{center:view.center,zoom:view.zoom}});
 },[]);
 const onStatus=useCallback((message:string)=>setStatus(message),[]);

 return <main>
  <OrnamentControls
   project={project}
   dispatch={dispatch}
   geometry={geometry}
   textLayout={textLayout}
   readiness={readiness}
   snapshot={snapshot}
   featureGeometry={featureGeometry}
   captureWarnings={captureWarnings}
   building={building}
   phase={phase}
   offMainThread={runner.current?.offMainThread??false}
   exporting={exporting}
   preflight={preflight}
   onExport={onExport}
   onReset={()=>{clearOrnamentProject();forgetCapture();setFitBounds(undefined);setCaptureRequest(undefined);setStatus('');dispatch({type:'reset'})}}
   onFitText={()=>dispatch({type:'scaleText',factor:fitTextScale(textLayout)})}
   onSelectPlace={(candidate,fit)=>{
    dispatch({type:'selectPlace',label:candidate.label,center:candidate.coordinates});
    if(fit&&candidate.boundingBox)setFitBounds({bounds:candidate.boundingBox,token:Date.now()});
    // Choosing a different place invalidates any capture taken of the previous one — including the
    // status line announcing it, which would otherwise keep claiming a capture that no longer exists.
    forgetCapture();
    setStatus('');
   }}
   onCaptureGeometry={()=>{
    const token=Date.now();
    clearCaptureWatchdog();
    setPhase('capturing');
    setStatus('Capturing map geometry…');
    captureDeadline.current={token,timer:setTimeout(()=>{
     captureDeadline.current=undefined;
     setPhase('idle');
     setCaptureRequest(undefined);
     setStatus(`The map did not finish capturing within ${Math.round(CAPTURE_TIMEOUT_MS/1000)} seconds. Check that map tiles are loading, then capture again.`);
    },CAPTURE_TIMEOUT_MS)};
    setCaptureRequest({token});
   }}
  />
  <section className="workspace">
   <nav>
    <button type="button" onClick={onExit}>← Lake map studio</button>
    <span className="mode-note" role="status" aria-live="polite">{status||(project.viewport.selectedPlaceLabel??'Ornament template · search for a place to begin')}</span>
   </nav>
   <OrnamentPreview
    project={project}
    geometry={geometry}
    textLayout={textLayout}
    featureGeometry={featureGeometry}
    dirty={readiness.dirty}
    fitBounds={fitBounds}
    captureRequest={captureRequest}
    onCapture={onCapture}
    onViewportChange={onViewportChange}
    onStatus={onStatus}
   />
  </section>
 </main>;
}
