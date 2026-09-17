import {useEffect,useMemo,useRef,useState} from 'react';
import {geometryPath} from '../../geometry/shoreline/polygonEngine';
import type {FeatureGeometryResult} from '../geometry/featureGeometry';
import type {OrnamentGeometry} from '../geometry/ornamentShape';
import {mapWindowLayout,ornamentViewBox,previewTransform} from '../map/cropMask';
import {OPENFREEMAP} from '../map/provider';
import type {OrnamentTextLayout} from '../text/ornamentText';
import type {OrnamentProject} from '../types';
import {OrnamentMap} from './OrnamentMap';
import type {CaptureOutcome} from './OrnamentPage';

type Props={
 project:OrnamentProject;
 geometry:OrnamentGeometry;
 textLayout:OrnamentTextLayout;
 featureGeometry?:FeatureGeometryResult;
 dirty:boolean;
 fitBounds?:{bounds:[number,number,number,number];token:number};
 captureRequest?:{token:number};
 onCapture:(outcome:CaptureOutcome)=>void;
 onViewportChange:(view:{center:[number,number];zoom:number})=>void;
 onStatus:(message:string)=>void;
};

// Semantic roles, not decoration: cut lines are strokes with no fill, engraving is filled. Colours
// are a preset the export layer will swap (plan §SVG fabrication contract: "colour is a preset, not
// the only semantic signal"), so the preview names the role in the group id too.
const CUT='#d8503f',BAND='#2f3d4b',ENGRAVE='#12181e',WATER='#7c9fb5',TAB='#c08a2e';

// The plan's last accessibility rule is "Do not rely on colour alone for cut/engrave roles", and the
// drawing above already obeys it structurally: a cut is a stroke with no fill and an engrave is
// filled. That distinction is invisible unless it is written down, so it is -- here, as text, next
// to the drawing. Each entry names the role, the shape treatment that encodes it, and only then the
// colour, so the legend still works in greyscale, at low contrast, and read aloud.
const ROLE_LEGEND:readonly {role:string;encoding:string}[]=[
 {role:'Cut',encoding:'outline only, no fill'},
 {role:'Engrave',encoding:'solid fill'},
 {role:'Water',encoding:'tinted fill'},
 {role:'Tabs and loose pieces',encoding:'dashed outline'},
 {role:'Text band guide',encoding:'dashed guide, not cut'},
];

// The frame is drawn over the map and must not swallow drags and scrolls meant for it; the map sits
// in the hole the frame leaves, so every pointer event the frame receives was aimed past it.
const OVERLAY:React.CSSProperties={position:'absolute',inset:0,pointerEvents:'none'};

export function OrnamentPreview({project,geometry,textLayout,featureGeometry,dirty,fitBounds,captureRequest,onCapture,onViewportChange,onStatus}:Props){
 const host=useRef<HTMLDivElement>(null);
 const [size,setSize]=useState({width:0,height:0});

 // The map is a pixel-sized DOM element, so the mm-to-pixel transform has to be computed from the
 // real container rather than delegated to the SVG's preserveAspectRatio. Measuring it here is what
 // lets the frame and the map share one transform instead of two that agree by luck.
 useEffect(()=>{
  const element=host.current;
  if(!element)return;
  const measure=()=>setSize({width:element.clientWidth,height:element.clientHeight});
  measure();
  if(typeof ResizeObserver==='undefined')return;
  const observer=new ResizeObserver(measure);
  observer.observe(element);
  return ()=>observer.disconnect();
 },[]);

 const blocked=geometry.issues.some(issue=>issue.severity==='error');

 // Memoised because `layout` is a dependency of the map's own effects. Recomputing it is cheap;
 // handing the map a new object on every render is not — that alone is enough to make the map
 // re-render this component and start again.
 const viewBox=useMemo(()=>ornamentViewBox(geometry),[geometry]);
 const transform=useMemo(()=>previewTransform(viewBox,size.width,size.height),[viewBox,size.width,size.height]);
 const layout=useMemo(()=>mapWindowLayout(geometry,viewBox,transform),[geometry,viewBox,transform]);
 const showMap=transform.scale>0&&!blocked;

 // With no map mounted there is nothing to answer a capture request, and the page would sit in its
 // "capturing" state for ever. Reporting the failure from here is what closes that loop — it is the
 // only place that knows the map was never rendered.
 useEffect(()=>{
  if(!captureRequest||showMap)return;
  onCapture({ok:false,message:'The map is not on screen yet, so there is no geometry to capture. Give the preview a moment to lay out and try again.'});
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[captureRequest?.token,showMap]);

 if(blocked)return <div className="empty">
  <p>Ornament geometry cannot be built yet.</p>
  <ul className="ornament-issues">{geometry.issues.filter(i=>i.severity==='error').map((issue,index)=><li key={`${issue.code}-${index}`} className="error">{issue.message}</li>)}</ul>
 </div>;

 const cutout=project.buildMode==='water-cutout-3-piece';
 const hairline=Math.max(.1,geometry.outerRadiusMm/400);

 return <div className="ornament-preview" ref={host}>
  {showMap?<OrnamentMap
   layout={layout}
   center={project.viewport.center}
   zoom={project.viewport.zoom}
   detail={project.roads.detail}
   chordYMm={geometry.chordYMm}
   fitBounds={fitBounds}
   captureRequest={captureRequest}
   onCapture={onCapture}
   onViewportChange={onViewportChange}
   onStatus={onStatus}
  />:null}

  <svg
   style={{...OVERLAY,left:transform.offsetXPx,top:transform.offsetYPx,width:transform.widthPx,height:transform.heightPx,inset:'auto'}}
   viewBox={`${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`}
   width={transform.widthPx||undefined}
   height={transform.heightPx||undefined}
   role="img"
   aria-label={`Ornament preview, ${project.ornament.diameterMm}mm diameter`}
  >
   {/* Captured geometry is drawn first, under the frame, in the same millimetre coordinate system
       the frame uses. That is the point of showing it at all: if the projection, the scale or the
       clip were wrong, the roads would sit somewhere other than on top of the roads the map is
       drawing underneath, and it would be obvious rather than discovered at the laser. */}
   {featureGeometry?<g id="ornament/captured" aria-hidden="true">
    {featureGeometry.waterEngrave.length?<g id="piece/base/water-light-engrave">
     <path d={geometryPath(featureGeometry.waterEngrave)} fill={WATER} fillOpacity={.55} fillRule="evenodd"/>
    </g>:null}
    {cutout&&featureGeometry.waterCut.length?<g id="piece/base/water-cut">
     <path d={geometryPath(featureGeometry.waterCut)} fill="none" stroke={CUT} strokeWidth={hairline} fillRule="evenodd"/>
    </g>:null}
    {featureGeometry.roadsEngrave.length?<g id="piece/land/roads-engrave">
     <path d={geometryPath(featureGeometry.roadsEngrave)} fill={ENGRAVE} fillRule="evenodd"/>
    </g>:null}
    {/* Loose land pieces and the tabs bridging them are called out rather than blended in: they are
        the parts of the ornament most likely to go wrong on the machine. */}
    {featureGeometry.islands.bridges.map((bridge,index)=>
     <line key={`bridge-${index}`} x1={bridge.from[0]} y1={bridge.from[1]} x2={bridge.to[0]} y2={bridge.to[1]} stroke={TAB} strokeWidth={bridge.widthMm} strokeLinecap="butt" opacity={.9}/>)}
    {featureGeometry.islands.remaining.map((island,index)=>
     <circle key={`island-${index}`} cx={island.centroidMm[0]} cy={island.centroidMm[1]} r={Math.max(1,island.extentMm/2)} fill="none" stroke={TAB} strokeWidth={hairline} strokeDasharray="1 1"/>)}
   </g>:null}

   <g id="piece/frame/cut">
    <title>Ornament outline, cut</title>
    <path d={geometryPath(geometry.frame)} fill="#e8ece9" stroke={CUT} strokeWidth={Math.max(.15,geometry.outerRadiusMm/250)} fillRule="evenodd"/>
   </g>
   <g id="preview/map-window" aria-hidden="true">
    {/* The crop the map is clipped by, drawn from the same MultiPolygon the clip-path is built
        from, so a mismatch between the two would be visible rather than silent. */}
    <path d={layout.outlinePathMm} fill="none" stroke={CUT} strokeWidth={hairline} opacity={.6}/>
   </g>
   <g id="preview/text-band" aria-hidden="true">
    <path d={geometryPath(geometry.textBand)} fill="none" stroke={BAND} strokeWidth={hairline} strokeDasharray="1.5 1.5"/>
   </g>
   <g id="piece/frame/text-engrave" fill={ENGRAVE} fillRule="nonzero">
    <title>Personalisation text, engraved</title>
    {textLayout.lines.map(line=>line.d?<path key={line.key} d={line.d} data-line={line.key}/>:null)}
   </g>
  </svg>

  <ul className="ornament-legend">
   {ROLE_LEGEND.map(entry=><li key={entry.role}>
    <span className={`ornament-legend-swatch role-${entry.role.split(' ')[0].toLowerCase()}`} aria-hidden="true"/>
    <span><strong>{entry.role}</strong> — {entry.encoding}</span>
   </li>)}
  </ul>

  <div className="ornament-metrics">
   <span>Finished diameter {project.ornament.diameterMm.toFixed(1)}mm</span>
   <span>Map window {geometry.mapOpeningHeightMm.toFixed(1)}mm · {layout.sizeMm.toFixed(1)}mm across</span>
   <span>Text band {geometry.textBandHeightMm.toFixed(1)}mm · block {textLayout.blockHeightMm.toFixed(1)}mm</span>
   <span>Loop join {geometry.loop.junctionWidthMm.toFixed(2)}mm</span>
   {featureGeometry?<span>Roads {featureGeometry.metrics.roads.areaMm2.toFixed(1)}mm² · water {featureGeometry.metrics.water.areaMm2.toFixed(1)}mm²</span>:null}
  </div>

  {/* Attribution lives out here rather than inside the map, because the map is clipped to a circle
      and MapLibre's own control would be cropped away. */}
  <p className="ornament-attribution ornament-map-credit">{OPENFREEMAP.attribution}</p>

  {dirty?<p className="ornament-dirty" role="status">Map moved since the geometry was captured — capture again before exporting.</p>:null}
 </div>;
}
