import type * as opentype from 'opentype.js';

export type TextAnchorH='left'|'center'|'right';

// opentype.js's getPath(text, x, y, fontSize) already emits path data in the same Y-down
// convention as SVG (baseline at y, ascenders as negative y) — no vertical flip is needed for
// direct embedding. fontSize is literally "1 em == this many output units", so passing sizeMm
// gives millimeter-scale glyph outlines directly, matching the rest of the manufacturing pipeline.
export function measureTextWidthMm(font:opentype.Font,text:string,sizeMm:number):number{
 return font.getAdvanceWidth(text,sizeMm);
}

// opentype.js 2.x ends every glyph contour on a point coincident with its start but never emits a Z
// closepath command. That renders identically when filled, but a cut path is not a fill: CAM/laser
// importers that treat a Z-less subpath as an open polyline will skip kerf compensation on it or cut
// a lead-out artifact. The geometry is already closed, so this only states what is already true.
const withExplicitCloses=(d:string)=>d?d.split('M').filter(Boolean).map(s=>{const sub=`M${s}`.trimEnd();return sub.endsWith('Z')?sub:`${sub}Z`}).join(''):d;

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
export function textPathData(font:opentype.Font,text:string,sizeMm:number,anchorH:TextAnchorH='left',originX=0,originY=0):{d:string;widthMm:number;bounds:{minX:number;minY:number;maxX:number;maxY:number}}{
 const widthMm=measureTextWidthMm(font,text,sizeMm);
 const dx=originX+(anchorH==='center'?-widthMm/2:anchorH==='right'?-widthMm:0);
 const path=font.getPath(text,dx,originY,sizeMm);
 const box=path.getBoundingBox();
 return {d:withExplicitCloses(path.toPathData(3)),widthMm,bounds:{minX:box.x1,minY:box.y1,maxX:box.x2,maxY:box.y2}};
}
