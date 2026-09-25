import type {MultiPolygonMm} from '../../geometry/shoreline/polygonEngine';
import type {TopoFeatureWarning} from './warnings';

// The frame (plan §5: "build as the Boolean difference between outer and inner board rectangles").
// Two axis-aligned rectangles need no boolean engine: the difference is exactly the outer ring with
// the inner one as its hole, wound opposite, which is what the engine would return.
//
// The ornament's frame is a ring around a disk and is built with circle booleans; the rectangle is
// the same construction with nothing curved in it, so it is written directly rather than routed
// through a circle helper.

export interface TopoFrame{geometry:MultiPolygonMm;insetMm:number}

// The frame must leave some board inside it: at least a quarter of the shorter side.
export const MIN_FRAME_OPENING_SHARE=.25;

export function buildFrame(widthMm:number,heightMm:number,thicknessMm:number):{frame?:TopoFrame;warnings:TopoFeatureWarning[]}{
 const t=thicknessMm,open=Math.min(widthMm,heightMm)-2*t;
 if(!(t>0))return {warnings:[]};
 if(open<Math.min(widthMm,heightMm)*MIN_FRAME_OPENING_SHARE)
  return {warnings:[{code:'frame-too-thick',message:`A ${t} mm frame leaves too little of a ${widthMm.toFixed(1)} × ${heightMm.toFixed(1)} mm board inside it, so it was not drawn. Make it thinner.`}]};
 const outer:[number,number][]=[[0,0],[widthMm,0],[widthMm,heightMm],[0,heightMm],[0,0]];
 const inner:[number,number][]=[[t,t],[t,heightMm-t],[widthMm-t,heightMm-t],[widthMm-t,t],[t,t]];
 return {frame:{geometry:[[outer,inner]],insetMm:t},warnings:[]};
}
