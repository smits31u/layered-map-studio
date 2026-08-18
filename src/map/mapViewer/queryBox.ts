import type {QueryBox} from '../featureExtraction/mapLibreExtractor';

export type Rect={left:number;top:number;right:number;bottom:number;width:number;height:number};

export function canvasLocalQueryBox(frame:Rect,canvas:Rect):QueryBox{
 const left=Math.max(0,Math.min(canvas.width,frame.left-canvas.left));
 const top=Math.max(0,Math.min(canvas.height,frame.top-canvas.top));
 const right=Math.max(0,Math.min(canvas.width,frame.right-canvas.left));
 const bottom=Math.max(0,Math.min(canvas.height,frame.bottom-canvas.top));
 if(!Number.isFinite(left+top+right+bottom)||right<=left||bottom<=top)throw new Error('The selected crop is outside the map canvas or has no area.');
 return[[left,top],[right,bottom]];
}
