import {useEffect,useRef,useState} from 'react';
import type {ManufacturingScene} from '../../export/scene';
import {scenePreviewSvg,type PreviewMode} from '../../export/svg/previewSvg';
import {waterAreaOccupancy} from '../../geometry/shoreline/polygonEngine';
import type {MapProject} from '../../types/project';
import {resetOverrideFields,screenDeltaToMm,setOverride} from '../../geometry/scene/overrides';

type ObjectKind='title'|'subtitle'|'compass'|'place-label'|'road-label';
const kindOf=(objectId:string):ObjectKind=>objectId==='title'?'title':objectId==='subtitle'?'subtitle':objectId==='compass'?'compass':objectId.startsWith('place-')?'place-label':'road-label';
const parseTransform=(transform:string|null)=>{const t=/translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(transform??''),r=/rotate\(([-\d.]+)/.exec(transform??'');return{x:t?+t[1]:0,y:t?+t[2]:0,rotation:r?+r[1]:0}};
const MOVE_THRESHOLD_MM=.05;

export function GeneratedPreview({scene,featuresLoaded=false,project,onCommitOverride}:{scene?:ManufacturingScene;featuresLoaded?:boolean;project?:MapProject;onCommitOverride?:(updater:(p:MapProject)=>MapProject)=>void}){
 const[view,setView]=useState<PreviewMode>('individual'),[layer,setLayer]=useState(0);
 const[selectedId,setSelectedId]=useState<string>();
 const[selectedPose,setSelectedPose]=useState<{x:number;y:number;rotation:number}>();
 const containerRef=useRef<HTMLDivElement>(null);
 const editable=Boolean(project&&onCommitOverride);

 const readPose=(objectId:string)=>{const el=containerRef.current?.querySelector(`[data-object-id="${CSS.escape(objectId)}"]`);setSelectedPose(parseTransform(el?.getAttribute('transform')??null))};

 useEffect(()=>{
  if(!editable)return;
  const container=containerRef.current;
  if(!container)return;
  // A React state update inside this gesture (setSelectedId/setSelectedPose) causes a re-render,
  // which reassigns dangerouslySetInnerHTML and replaces the entire injected SVG subtree — even
  // when the generated string is byte-identical, since scenePreviewSvg doesn't know about the drag
  // in progress. Caching `target`/`svgRoot` once at pointerdown left them pointing at now-detached
  // nodes the moment any state update fired, which made getScreenCTM() fall back to an identity
  // matrix (silently treating screen pixels as millimeters 1:1 instead of dividing by the real
  // scale). Fix: re-resolve both by stable selector on every move/up rather than caching a
  // reference, and defer the one state update that reflects the drag (for the side panel's number
  // inputs) until pointerup so nothing invalidates the DOM mid-gesture.
  const onPointerDown=(event:PointerEvent)=>{
   const initialTarget=(event.target as Element).closest('[data-object-id]');
   if(!initialTarget)return;
   const objectId=initialTarget.getAttribute('data-object-id')!;
   event.preventDefault();
   const start=parseTransform(initialTarget.getAttribute('transform'));
   setSelectedId(objectId);
   setSelectedPose(start);
   const startClientX=event.clientX,startClientY=event.clientY;
   let moved=false;
   const liveTarget=()=>container.querySelector(`[data-object-id="${CSS.escape(objectId)}"]`);
   const liveSvg=()=>container.querySelector('svg') as SVGSVGElement|null;
   const onMove=(moveEvent:PointerEvent)=>{
    const svgRoot=liveSvg(),target=liveTarget();
    if(!svgRoot||!target)return;
    const {dxMm,dyMm}=screenDeltaToMm(svgRoot,moveEvent.clientX-startClientX,moveEvent.clientY-startClientY);
    if(Math.hypot(dxMm,dyMm)>MOVE_THRESHOLD_MM)moved=true;
    target.setAttribute('transform',`translate(${start.x+dxMm} ${start.y+dyMm}) rotate(${start.rotation})`);
   };
   const onUp=(upEvent:PointerEvent)=>{
    window.removeEventListener('pointermove',onMove);
    window.removeEventListener('pointerup',onUp);
    if(!moved)return;
    const svgRoot=liveSvg();
    if(!svgRoot)return;
    const {dxMm,dyMm}=screenDeltaToMm(svgRoot,upEvent.clientX-startClientX,upEvent.clientY-startClientY);
    const x=start.x+dxMm,y=start.y+dyMm;
    setSelectedPose({x,y,rotation:start.rotation});
    onCommitOverride!(p=>setOverride(p,objectId,{xMm:x,yMm:y}));
   };
   window.addEventListener('pointermove',onMove);
   window.addEventListener('pointerup',onUp);
  };
  container.addEventListener('pointerdown',onPointerDown);
  return()=>container.removeEventListener('pointerdown',onPointerDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[editable,scene,view,layer]);

 if(!scene)return <div className="empty"><b>GENERATED MAP MODE</b><p>{featuresLoaded?'Vector features loaded. Click Generate scene to build the manufacturing preview.':'Load vector features, then generate the manufacturing scene.'}</p></div>;
 const selected=Math.min(layer,scene.layers.length-1),svg=scenePreviewSvg(scene,view,selected),m=scene.geometryMetrics;
 const occupancy=m?waterAreaOccupancy(m.originalWaterAreaMm2,scene.widthMm,scene.heightMm)*100:undefined;
 const landSelected=scene.layers[selected]?.id==='layer-land';
 const canEditNow=editable&&view==='individual'&&landSelected;

 const nudge=(dx:number,dy:number)=>{if(!selectedId||!selectedPose)return;const x=selectedPose.x+dx,y=selectedPose.y+dy;setSelectedPose({...selectedPose,x,y});onCommitOverride!(p=>setOverride(p,selectedId,{xMm:x,yMm:y}))};
 const setRotation=(rotation:number)=>{if(!selectedId)return;onCommitOverride!(p=>setOverride(p,selectedId,{rotationDeg:rotation}));setTimeout(()=>readPose(selectedId),0)};
 const toggleVisible=(visible:boolean)=>{if(!selectedId)return;onCommitOverride!(p=>setOverride(p,selectedId,{visible}))};
 const toggleFlip=()=>{if(!selectedId||!project)return;const current=project.overrides[selectedId]?.flipSide??false;onCommitOverride!(p=>setOverride(p,selectedId,{flipSide:!current}))};
 const reset=()=>{if(!selectedId)return;onCommitOverride!(p=>resetOverrideFields(p,selectedId));setTimeout(()=>readPose(selectedId),0)};

 const kind=selectedId?kindOf(selectedId):undefined;
 const currentOverride=selectedId&&project?project.overrides[selectedId]:undefined;
 const currentlyVisible=currentOverride?.visible??true;

 return <div className="generated"><div className="mode-badge generated-badge">GENERATED MAP MODE</div><div className="preview-controls"><button className={view==='individual'?'active':''} onClick={()=>setView('individual')}>Individual Layer</button><button className={view==='composite'?'active':''} onClick={()=>setView('composite')}>Composite</button><button className={view==='exploded'?'active':''} onClick={()=>setView('exploded')}>Exploded</button>{view==='individual'&&<select value={selected} onChange={e=>{setLayer(+e.target.value);setSelectedId(undefined)}}>{scene.layers.map((item,index)=><option value={index} key={item.id}>{item.name}</option>)}</select>}</div><div className="size-readout">{scene.widthMm.toFixed(3)} × {scene.heightMm.toFixed(3)} mm · {scene.layers.length} panels{occupancy!=null?` · Lake occupancy ${occupancy.toFixed(1)}%`:''}</div>{editable&&!canEditNow&&<p className="edit-hint">Select Individual Layer → Land/Top to edit road labels, place labels, title, subtitle, and compass directly.</p>}
  <div className={`svg-preview${canEditNow?' editable':''}`} data-preview-mode={view} ref={containerRef} dangerouslySetInnerHTML={{__html:svg}}/>
  {canEditNow&&selectedId&&kind&&<div className="object-editor"><b>{kind.replace('-',' ')}</b><small>{selectedId}</small>
   {selectedPose&&<><label>X mm <input type="number" step="0.1" value={selectedPose.x.toFixed(2)} onChange={e=>{const x=+e.target.value;setSelectedPose(p=>p&&{...p,x});onCommitOverride!(p=>setOverride(p,selectedId,{xMm:x}))}}/></label>
   <label>Y mm <input type="number" step="0.1" value={selectedPose.y.toFixed(2)} onChange={e=>{const y=+e.target.value;setSelectedPose(p=>p&&{...p,y});onCommitOverride!(p=>setOverride(p,selectedId,{yMm:y}))}}/></label></>}
   {(kind==='compass'||kind==='title'||kind==='subtitle')&&selectedPose&&<label>Rotation ° <input type="number" step="1" value={selectedPose.rotation.toFixed(0)} onChange={e=>setRotation(+e.target.value)}/></label>}
   <div className="nudge-row"><span>Nudge</span><button onClick={()=>nudge(0,-1)}>↑1</button><button onClick={()=>nudge(0,1)}>↓1</button><button onClick={()=>nudge(-1,0)}>←1</button><button onClick={()=>nudge(1,0)}>→1</button><button onClick={()=>nudge(0,-.25)}>↑.25</button><button onClick={()=>nudge(0,.25)}>↓.25</button></div>
   <label><input type="checkbox" checked={currentlyVisible} onChange={e=>toggleVisible(e.target.checked)}/> Visible</label>
   {kind==='road-label'&&<button onClick={toggleFlip}>Flip Side</button>}
   <button onClick={reset}>Reset to default</button>
  </div>}
  {m&&<details className="geometry-metrics"><summary>Geometry metrics</summary>{m.normalizedProductSize&&<span>Normalized product: {m.normalizedProductSize.width.toFixed(0)} × {m.normalizedProductSize.height.toFixed(1)}</span>}<span>Raw water features: {m.rawWaterFeatures}</span><span>Normalized polygon components: {m.normalizedPolygonComponents}</span><span>Unioned components: {m.unionedComponents}</span><span>Selected water components: {m.selectedWaterComponents}</span><span>Original water area: {m.originalWaterAreaMm2.toFixed(1)} mm² · occupancy {occupancy?.toFixed(1)}%</span>{m.openingAreasMm2.map((area,index)=><span key={index}>Opening {index+1}{m.artisticOffsetsNormalized?.[index-1]!=null?` · inset ${m.artisticOffsetsNormalized[index-1]}u`:''}: {area.toFixed(1)} mm² · {(area/m.originalWaterAreaMm2*100).toFixed(1)}% retained</span>)}<span>Invalid/rejected rings: {m.invalidRejectedRings}</span>{m.artisticOpenings?.map((opening,index)=><span key={`metric-${index}`}>W{index+1}: {opening.components} components · {opening.holes} holes · {opening.vertices} vertices · rejected {opening.rejectedComponents} components/{opening.rejectedHoles} holes</span>)}{m.rejectedArtisticComponents!=null&&<span>Rejected artistic components: {m.rejectedArtisticComponents}</span>}{m.rejectedArtisticHoles!=null&&<span>Rejected artistic holes: {m.rejectedArtisticHoles}</span>}</details>}
  {scene.labelMetrics&&<details className="geometry-metrics"><summary>Label metrics</summary><span>Place labels rendered: {scene.labelMetrics.placeLabels}</span><span>Road labels rendered: {scene.labelMetrics.roadLabels}</span><span>Road labels rejected (didn't fit): {scene.labelMetrics.rejectedRoadLabels}</span></details>}
 </div>;
}
