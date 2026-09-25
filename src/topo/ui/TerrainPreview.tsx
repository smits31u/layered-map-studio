import {useMemo} from 'react';
import type {MultiPolygonMm} from '../../geometry/shoreline/polygonEngine';
import type {TerrainResult} from '../terrain/pipeline';

// Edit mode's terrain preview: the generated layers stacked lowest first, with contour centerlines
// on top, drawn in board millimetres (the viewBox is the board). It is a preview — Phase 4 builds the
// laser SVG from the same geometry with its own grouping and metadata.
//
// Drawn as SVG rather than on a canvas: the geometry is already vector, SVG scales to the pane with
// no resampling, and every layer is a DOM node the tests can inspect.

const LAYER_FILLS=['#ece6d3','#d6c9a4','#b9a47a','#927b55'];
const WATER_FILL='#a9c9d8';

const ringsPath=(geometry:MultiPolygonMm)=>geometry.map(polygon=>polygon.map(ring=>ring.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(3)} ${y.toFixed(3)}`).join('')+'Z').join('')).join('');
const linePath=(lines:[number,number][][])=>lines.map(line=>line.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(3)} ${y.toFixed(3)}`).join('')).join('');

export function TerrainPreview({result}:{result:TerrainResult}){
 const {widthMm:w,heightMm:h}=result;
 const paths=useMemo(()=>({
  layers:result.layers.map(layer=>({index:layer.index,d:ringsPath(layer.geometry)})),
  contours:result.contours.map(level=>({elevation:level.elevation,d:linePath(level.lines)})),
 }),[result]);
 const contourWidth=Math.max(w,h)/700;
 return <svg className="topo-terrain-preview" data-testid="terrain-preview" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Terrain preview: ${result.layers.length} layer${result.layers.length===1?'':'s'}${result.contours.length?`, ${result.contours.length} contour elevations`:''}`}>
  <rect x={0} y={0} width={w} height={h} fill={WATER_FILL}/>
  {paths.layers.map(({index,d})=><path key={index} data-testid={`terrain-layer-${index}`} d={d} fill={LAYER_FILLS[index-1]} fillRule="evenodd" stroke="#6d5b40" strokeWidth={contourWidth*.6}/>)}
  {paths.contours.map(({elevation,d})=>d&&<path key={elevation} data-testid="terrain-contour" data-elevation={elevation.toFixed(2)} d={d} fill="none" stroke="#4a3b28" strokeWidth={contourWidth} strokeLinejoin="round" strokeLinecap="round"/>)}
 </svg>;
}
