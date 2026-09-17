import {useCallback,useEffect,useMemo,useReducer,useState} from 'react';
import {preloadAllFonts} from '../../text/fontRegistry';
import {createDefaultOrnamentProject} from '../defaults';
import {mapWindowOf,type PointMm} from '../geometry/clipLine';
import {buildOrnamentGeometry} from '../geometry/ornamentShape';
import {buildOrnamentMarker,markerFitIssues} from '../markers/ornamentMarker';
import {clearOrnamentProject,loadOrnamentProject,saveOrnamentProject} from '../persistence';
import {exportReadiness,viewportFingerprint,type GeometrySnapshot} from '../snapshot';
import {ornamentReducer} from '../store';
import {fitTextScale,layoutOrnamentText} from '../text/ornamentText';
import {OrnamentControls} from './OrnamentControls';
import {OrnamentPreview} from './OrnamentPreview';

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
 const [markerOffsetMm,setMarkerOffsetMm]=useState<PointMm|undefined>(undefined);
 // Bumped rather than cleared, so choosing the same result twice still re-fits the map.
 const [fitBounds,setFitBounds]=useState<{bounds:[number,number,number,number];token:number}|undefined>(undefined);

 useEffect(()=>{let live=true;preloadAllFonts().then(()=>{if(live)setFontsReady(true)});return()=>{live=false}},[]);
 useEffect(()=>{saveOrnamentProject(project)},[project]);

 const geometry=useMemo(()=>buildOrnamentGeometry(project.ornament),[project.ornament]);
 // fontsReady participates in the key so the layout recomputes when a font finishes loading; the
 // layout function itself reads the registry synchronously.
 const textLayout=useMemo(()=>layoutOrnamentText(project,geometry),[project,geometry,fontsReady]);
 const marker=useMemo(()=>buildOrnamentMarker(project.marker.kind,project.marker.sizeMm),[project.marker.kind,project.marker.sizeMm]);

 const mapWindow=useMemo(()=>mapWindowOf(geometry),[geometry]);
 const markerIssues=useMemo(()=>markerOffsetMm?markerFitIssues(marker,markerOffsetMm,mapWindow):[],[marker,markerOffsetMm,mapWindow]);

 const fingerprint=useMemo(()=>viewportFingerprint(project,geometry.innerRadiusMm),[project,geometry.innerRadiusMm]);
 const readiness=useMemo(()=>exportReadiness({
  snapshot,
  current:fingerprint,
  hasSelectedPlace:Boolean(project.viewport.selectedPlaceCenter),
  blockingIssueCount:geometry.issues.filter(issue=>issue.severity==='error').length,
  blockingTextIssueCount:textLayout.issues.filter(issue=>issue.severity==='error').length,
 }),[snapshot,fingerprint,project.viewport.selectedPlaceCenter,geometry.issues,textLayout.issues]);

 // Identity-stable so the map's effects do not re-run on every parent render.
 const onViewportChange=useCallback((view:{center:[number,number];zoom:number})=>{
  dispatch({type:'setViewport',patch:{center:view.center,zoom:view.zoom}});
 },[]);
 const onMarkerOffsetMm=useCallback((offset:PointMm|undefined)=>setMarkerOffsetMm(offset),[]);
 const onStatus=useCallback((message:string)=>setStatus(message),[]);

 return <main>
  <OrnamentControls
   project={project}
   dispatch={dispatch}
   geometry={geometry}
   textLayout={textLayout}
   markerIssues={markerIssues}
   readiness={readiness}
   snapshot={snapshot}
   onReset={()=>{clearOrnamentProject();setSnapshot(undefined);setMarkerOffsetMm(undefined);setFitBounds(undefined);setStatus('');dispatch({type:'reset'})}}
   onFitText={()=>dispatch({type:'scaleText',factor:fitTextScale(textLayout)})}
   onSelectPlace={(candidate,fit)=>{
    dispatch({type:'selectPlace',label:candidate.label,center:candidate.coordinates});
    if(fit&&candidate.boundingBox)setFitBounds({bounds:candidate.boundingBox,token:Date.now()});
    // Choosing a different place invalidates any capture taken of the previous one — including the
    // status line announcing it, which would otherwise keep claiming a capture that no longer exists.
    setSnapshot(undefined);
    setStatus('');
   }}
   onCaptureGeometry={()=>{setSnapshot({fingerprint,takenAt:Date.now()});setStatus('Map geometry captured for this view.')}}
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
    marker={marker}
    dirty={readiness.dirty}
    fitBounds={fitBounds}
    onViewportChange={onViewportChange}
    onMarkerOffsetMm={onMarkerOffsetMm}
    onStatus={onStatus}
   />
  </section>
 </main>;
}
