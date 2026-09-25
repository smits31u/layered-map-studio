import type * as opentype from 'opentype.js';

export type TextAnchorH='left'|'center'|'right';

// opentype.js's getPath(text, x, y, fontSize) already emits path data in the same Y-down
// convention as SVG (baseline at y, ascenders as negative y) — no vertical flip is needed for
// direct embedding. fontSize is literally "1 em == this many output units", so passing sizeMm
// gives millimeter-scale glyph outlines directly, matching the rest of the manufacturing pipeline.
//
// letterSpacingMm is uniform tracking added *between* glyphs (n-1 gaps, never after the last), so a
// centred line stays visually centred. Kerning is unaffected: it is applied by opentype.js when it
// positions each glyph, and tracking is added on top of that.
export function measureTextWidthMm(font:opentype.Font,text:string,sizeMm:number,letterSpacingMm=0):number{
 const advance=font.getAdvanceWidth(text,sizeMm);
 if(!letterSpacingMm||!text)return advance;
 return advance+letterSpacingMm*Math.max(0,font.stringToGlyphs(text).length-1);
}

// opentype.js 2.x ends every glyph contour on a point coincident with its start but never emits a Z
// closepath command. That renders identically when filled, but a cut path is not a fill: CAM/laser
// importers that treat a Z-less subpath as an open polyline will skip kerf compensation on it or cut
// a lead-out artifact. The geometry is already closed, so this only states what is already true.
const withExplicitCloses=(d:string)=>d?d.split('M').filter(Boolean).map(s=>{const sub=`M${s}`.trimEnd();return sub.endsWith('Z')?sub:`${sub}Z`}).join(''):d;

const EMPTY_BOUNDS={minX:0,minY:0,maxX:0,maxY:0};

// opentype.js 2.0.0's toPathData writes NaN for any coordinate within ~1e-6 of a whole number. Its
// roundDecimal splits off the fractional part and rounds `frac + "e+" + places` as a string; a
// fraction that small stringifies in exponent form ("2.8e-14"), the concatenation becomes
// "2.8e-14e+3", and that parses to NaN — which is then written into the path. Which coordinates hit
// it depends on the font's units and the position, so it is rare with Inter and common with Cinzel
// at whole-millimetre sizes (found by the topo export's non-finite preflight on a real title).
//
// Snapping such a coordinate to its whole number first is exactly what correct 3-decimal rounding
// would print, so every coordinate that did not already come out NaN formats byte-identically.
const NEAR_INTEGER=1e-6;
function snapNearIntegers(commands:opentype.PathCommand[]):void{
 for(const command of commands){
  const c=command as unknown as Record<string,unknown>;
  for(const key of ['x','y','x1','y1','x2','y2']){
   const v=c[key];
   if(typeof v==='number'&&Number.isFinite(v)&&v-Math.floor(v)<NEAR_INTEGER)c[key]=Math.floor(v);
  }
 }
}

// Shifts every x-coordinate of a command list in place. Commands carry x/y and, for curves, x1/y1
// and x2/y2; only the x family moves for horizontal tracking.
function shiftCommandsX(commands:opentype.PathCommand[],dx:number):void{
 if(!dx)return;
 for(const command of commands){
  const c=command as {x?:number;x1?:number;x2?:number};
  if(typeof c.x==='number')c.x+=dx;
  if(typeof c.x1==='number')c.x1+=dx;
  if(typeof c.x2==='number')c.x2+=dx;
 }
}

// Builds path data for `text` at physical size sizeMm with its baseline anchored at (0,0) in local
// (unrotated, unpositioned) space, horizontally aligned per `anchorH`. The caller positions/rotates
// the result with an SVG group transform (translate/rotate) rather than baking world coordinates
// into the path itself, so the same path data stays reusable if the object is moved. Also returns
// the glyph bounding box in that same local space (used for backer geometry).
// originX/originY (default 0,0) let a caller bake an additional local offset directly into the
// emitted path data itself, rather than relying on a second SVG transform — needed by the
// classic-rose compass, whose N/E/S/W letters each sit at a different local position within a
// single combined path/shared transform (see buildScene.ts's compass block for why: the object
// model's drag/select code keys off exactly one element per objectId, so a multi-piece compass
// must stay one Shape, one transform).
export function textPathData(font:opentype.Font,text:string,sizeMm:number,anchorH:TextAnchorH='left',originX=0,originY=0,letterSpacingMm=0):{d:string;widthMm:number;bounds:{minX:number;minY:number;maxX:number;maxY:number}}{
 const widthMm=measureTextWidthMm(font,text,sizeMm,letterSpacingMm);
 const dx=originX+(anchorH==='center'?-widthMm/2:anchorH==='right'?-widthMm:0);
 // Fast path: no tracking, so opentype.js's own single-path layout is already exactly right.
 if(!letterSpacingMm){
  const path=font.getPath(text,dx,originY,sizeMm);
  const box=path.getBoundingBox();
  snapNearIntegers(path.commands);
  return {d:withExplicitCloses(path.toPathData(3)),widthMm,bounds:{minX:box.x1,minY:box.y1,maxX:box.x2,maxY:box.y2}};
 }
 // Tracking: lay out per glyph and slide glyph i right by i gaps. Commands are merged back into the
 // first path so its own toPathData/getBoundingBox can be reused — opentype is imported as a type
 // only here, so there is no Path constructor available to build a fresh one.
 const paths=font.getPaths(text,dx,originY,sizeMm);
 if(!paths.length)return {d:'',widthMm,bounds:{...EMPTY_BOUNDS}};
 const [combined,...rest]=paths;
 rest.forEach((path,index)=>{shiftCommandsX(path.commands,(index+1)*letterSpacingMm);combined.commands.push(...path.commands)});
 const box=combined.getBoundingBox();
 snapNearIntegers(combined.commands);
 return {d:withExplicitCloses(combined.toPathData(3)),widthMm,bounds:{minX:box.x1,minY:box.y1,maxX:box.x2,maxY:box.y2}};
}
