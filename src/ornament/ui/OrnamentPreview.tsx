import {useEffect,useRef,useState} from 'react';
import {geometryPath} from '../../geometry/shoreline/polygonEngine';
import type {PointMm} from '../geometry/clipLine';
import type {OrnamentGeometry} from '../geometry/ornamentShape';
import {mapWindowLayout,ornamentViewBox,previewTransform} from '../map/cropMask';
import {OPENFREEMAP} from '../map/provider';
import type {OrnamentMarkerSymbol} from '../markers/ornamentMarker';
import type {OrnamentTextLayout} from '../text/ornamentText';
import type {OrnamentProject} from '../types';
import {OrnamentMap} from './OrnamentMap';

type Props={
 project:OrnamentProject;
 geometry:OrnamentGeometry;
 textLayout:OrnamentTextLayout;
 marker:OrnamentMarkerSymbol;
 dirty:boolean;
 fitBounds?:{bounds:[number,number,number,number];token:number};
 onViewportChange:(view:{center:[number,number];zoom:number})=>void;
 onMarkerOffsetMm:(offset:PointMm|undefined)=>void;
 onStatus:(message:string)=>void;
};

// Semantic roles, not decoration: cut lines are strokes with no fill, engraving is filled. Colours
// are a preset the export layer will swap (plan §SVG fabrication contract: "colour is a preset, not
// the only semantic signal"), so the preview names the role in the group id too.
const CUT='#d8503f',BAND='#2f3d4b',ENGRAVE='#12181e';

// The frame is drawn over the map and must not swallow drags and scrolls meant for it; the map sits
// in the hole the frame leaves, so every pointer event the frame receives was aimed past it.
const OVERLAY:React.CSSProperties={position:'absolute',inset:0,pointerEvents:'none'};

export function OrnamentPreview({project,geometry,textLayout,marker,dirty,fitBounds,onViewportChange,onMarkerOffsetMm,onStatus}:Props){
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
 if(blocked)return <div className="empty">
  <p>Ornament geometry cannot be built yet.</p>
  <ul className="ornament-issues">{geometry.issues.filter(i=>i.severity==='error').map((issue,index)=><li key={`${issue.code}-${index}`} className="error">{issue.message}</li>)}</ul>
 </div>;

 const viewBox=ornamentViewBox(geometry);
 const transform=previewTransform(viewBox,size.width,size.height);
 const layout=mapWindowLayout(geometry,viewBox,transform);
 const showMap=transform.scale>0;

 return <div className="ornament-preview" ref={host}>
  {showMap?<OrnamentMap
   layout={layout}
   center={project.viewport.center}
   zoom={project.viewport.zoom}
   detail={project.roads.detail}
   marker={marker}
   markerPosition={project.marker.position}
   fitBounds={fitBounds}
   onViewportChange={onViewportChange}
   onMarkerOffsetMm={onMarkerOffsetMm}
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
   <g id="piece/frame/cut">
    <path d={geometryPath(geometry.frame)} fill="#e8ece9" stroke={CUT} strokeWidth={Math.max(.15,geometry.outerRadiusMm/250)} fillRule="evenodd"/>
   </g>
   <g id="preview/map-window" aria-hidden="true">
    {/* The crop the map is clipped by, drawn from the same MultiPolygon the clip-path is built
        from, so a mismatch between the two would be visible rather than silent. */}
    <path d={layout.outlinePathMm} fill="none" stroke={CUT} strokeWidth={Math.max(.1,geometry.outerRadiusMm/400)} opacity={.6}/>
   </g>
   <g id="preview/text-band" aria-hidden="true">
    <path d={geometryPath(geometry.textBand)} fill="none" stroke={BAND} strokeWidth={Math.max(.1,geometry.outerRadiusMm/400)} strokeDasharray="1.5 1.5"/>
   </g>
   <g id="piece/frame/text-engrave" fill={ENGRAVE} fillRule="nonzero">
    {textLayout.lines.map(line=>line.d?<path key={line.key} d={line.d} data-line={line.key}/>:null)}
   </g>
  </svg>

  <div className="ornament-metrics">
   <span>Finished diameter {project.ornament.diameterMm.toFixed(1)}mm</span>
   <span>Map window {geometry.mapOpeningHeightMm.toFixed(1)}mm · {layout.sizeMm.toFixed(1)}mm across</span>
   <span>Text band {geometry.textBandHeightMm.toFixed(1)}mm · block {textLayout.blockHeightMm.toFixed(1)}mm</span>
   <span>Loop join {geometry.loop.junctionWidthMm.toFixed(2)}mm</span>
  </div>

  {/* Attribution lives out here rather than inside the map, because the map is clipped to a circle
      and MapLibre's own control would be cropped away. */}
  <p className="ornament-attribution ornament-map-credit">{OPENFREEMAP.attribution}</p>

  {dirty?<p className="ornament-dirty" role="status">Map moved since the geometry was captured — capture again before exporting.</p>:null}
 </div>;
}
