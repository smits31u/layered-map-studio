import {memo,useId,useMemo} from 'react';
import type {MultiPolygonMm} from '../../geometry/shoreline/polygonEngine';
import type {BoardOverlay} from '../features/overlay';
import type {TerrainResult} from '../terrain/pipeline';

// Edit mode's board preview, in board millimetres (the viewBox is the board): water behind, the
// terrain layers lowest first, contour centerlines, then the overlay — roads, route, labels, title and
// frame. It is a preview; Phase 4 builds the laser SVG from the same geometry with its own grouping
// and metadata.
//
// Drawn as SVG rather than on a canvas: the geometry is already vector, SVG scales to the pane with
// no resampling, and every layer is a DOM node the tests can inspect.
//
// The terrain half is a memoised component keyed on the terrain result alone. A roads, labels, frame,
// title or route change re-renders only the overlay half, so the terrain's path data — the largest
// strings on the page — is neither rebuilt nor re-diffed when an overlay control moves.
//
// Roads and the route are drawn as their centrelines stroked at their physical widths (round caps
// and joins, the same shape the buffer produces) and clipped to the land through an SVG clip path, so
// a thickness change is a stroke width, not a rebuild. The buffered polygons are built alongside, in
// the feature worker, for export.

const LAYER_FILLS=['#ece6d3','#d6c9a4','#b9a47a','#927b55'];
const WATER_FILL='#a9c9d8';
const LAYER_OUTLINE='#6d5b40',ROAD_STROKE='#3b3a36',BRIDGE_OUTLINE_MM=.3;

const ringsPath=(geometry:MultiPolygonMm)=>geometry.map(polygon=>polygon.map(ring=>ring.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(3)} ${y.toFixed(3)}`).join('')+'Z').join('')).join('');
const linePath=(lines:[number,number][][])=>lines.map(line=>line.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(3)} ${y.toFixed(3)}`).join('')).join('');

const TerrainLayers=memo(function TerrainLayers({result,landClipId}:{result:TerrainResult;landClipId:string}){
 const {widthMm:w,heightMm:h}=result;
 const paths=useMemo(()=>({
  layers:result.layers.map(layer=>({index:layer.index,d:ringsPath(layer.geometry)})),
  contours:result.contours.map(level=>({elevation:level.elevation,d:linePath(level.lines)})),
 }),[result]);
 const contourWidth=Math.max(w,h)/700;
 return <>
  <defs><clipPath id={landClipId}><path d={paths.layers[0]?.d??''} clipRule="evenodd"/></clipPath></defs>
  <rect x={0} y={0} width={w} height={h} fill={WATER_FILL}/>
  {paths.layers.map(({index,d})=><path key={index} data-testid={`terrain-layer-${index}`} d={d} fill={LAYER_FILLS[index-1]} fillRule="evenodd" stroke="#6d5b40" strokeWidth={contourWidth*.6}/>)}
  {paths.contours.map(({elevation,d})=>d&&<path key={elevation} data-testid="terrain-contour" data-elevation={elevation.toFixed(2)} d={d} fill="none" stroke="#4a3b28" strokeWidth={contourWidth} strokeLinejoin="round" strokeLinecap="round"/>)}
 </>;
});

function OverlayLayers({overlay,landClipId}:{overlay:BoardOverlay;landClipId:string}){
 const clip=`url(#${landClipId})`;
 return <>
  {overlay.roads.visible&&overlay.roads.classes.length>0&&<g data-testid="board-roads" clipPath={clip} fill="none" stroke={ROAD_STROKE} strokeLinecap="round" strokeLinejoin="round">
   {overlay.roads.classes.map(group=><path key={group.roadClass} data-testid="board-road-class" data-road-class={group.roadClass} data-width-mm={group.widthMm.toFixed(3)} d={group.d} strokeWidth={group.widthMm}/>)}
  </g>}
  {/* Bridges: the tab of material kept across the water (outlined like a terrain layer's edge) with
      the road engraved on it, drawn over the water rather than clipped to the land. */}
  {overlay.roads.visible&&overlay.roads.bridges.length>0&&<g data-testid="board-bridges" fill="none" strokeLinecap="round" strokeLinejoin="round">
   {overlay.roads.bridges.map(group=><g key={group.roadClass}>
    <path d={group.d} stroke={LAYER_OUTLINE} strokeWidth={group.widthMm+BRIDGE_OUTLINE_MM}/>
    <path data-testid="board-bridge" data-road-class={group.roadClass} data-width-mm={group.widthMm.toFixed(3)} d={group.d} stroke={ROAD_STROKE} strokeWidth={group.widthMm}/>
   </g>)}
  </g>}
  {overlay.route&&overlay.route.d&&<path data-testid="board-route" clipPath={clip} d={overlay.route.d} fill="none" stroke="#b8322a" strokeWidth={overlay.route.widthMm} strokeLinecap="round" strokeLinejoin="round"/>}
  {overlay.route&&overlay.route.bridgesD&&<g data-testid="board-route-bridges" fill="none" strokeLinecap="round" strokeLinejoin="round">
   <path d={overlay.route.bridgesD} stroke={LAYER_OUTLINE} strokeWidth={overlay.route.widthMm+BRIDGE_OUTLINE_MM}/>
   <path d={overlay.route.bridgesD} stroke="#b8322a" strokeWidth={overlay.route.widthMm}/>
  </g>}
  {overlay.labels.visible&&overlay.labels.layer&&<g data-testid="board-labels" fill="#1f1d1a">
   {overlay.labels.layer.placed.map(label=><path key={label.name} data-testid="board-label" data-name={label.name} d={label.d}/>)}
  </g>}
  {overlay.title&&<path data-testid="board-title" d={overlay.title.d} fill="#1f1d1a"/>}
  {overlay.frame&&<path data-testid="board-frame" d={ringsPath(overlay.frame.geometry)} fill="#6b4f33" fillRule="evenodd"/>}
 </>;
}

export function TerrainPreview({result,overlay}:{result:TerrainResult;overlay?:BoardOverlay}){
 const {widthMm:w,heightMm:h}=result;
 const landClipId=`topo-land-${useId().replace(/:/g,'')}`;
 return <svg className="topo-terrain-preview" data-testid="terrain-preview" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Terrain preview: ${result.layers.length} layer${result.layers.length===1?'':'s'}${result.contours.length?`, ${result.contours.length} contour elevations`:''}`}>
  <TerrainLayers result={result} landClipId={landClipId}/>
  {overlay&&<OverlayLayers overlay={overlay} landClipId={landClipId}/>}
 </svg>;
}
