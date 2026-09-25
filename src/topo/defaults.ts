import {inchesToMm} from '../utils/units';
import type {TopoProject} from './types';

// The plan's observed initial settings (§What was verified on the reference tool): a 9 × 9 in
// board, zoom 14, high road detail with roads and labels on, one terrain layer with optional layers
// 2–4 at 50/25/12% coverage, contours on at "Normal" (the middle of the five densities, 8 contours),
// and a 0.6 mm route line. Frame, compass and title are described only as optional, so they start
// off/empty.
//
// The plan names no starting place. The lake tool's default location is used so both tools open on
// the same map.
export const DEFAULT_TOPO_CENTER:[number,number]=[-88.207,45.3685];
export const DEFAULT_ROUTE_WIDTH_MM=.6;

export function createDefaultTopoProject():TopoProject{
 const nineInches=inchesToMm(9);
 return {
  schemaVersion:1,
  viewport:{center:[...DEFAULT_TOPO_CENTER],zoom:14,bearing:0,pitch:0},
  output:{widthMm:nineInches,heightMm:nineInches},
  displayUnit:'in',
  terrain:{layerCount:1,coveragePercent:[100,50,25,12],contoursEnabled:true,contourCount:8},
  roads:{enabled:true,detail:'high',thicknessScale:1},
  labels:{enabled:true,sizeMm:3},
  route:null,
  frame:{enabled:false,thicknessMm:6},
  compass:{position:'off',sizeMm:25,mergeWithTerrain:false},
  title:{text:'',fontId:'inter',sizeMm:10,dxMm:0,dyMm:0},
 };
}
