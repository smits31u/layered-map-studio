import type * as opentype from 'opentype.js';

export type TextAnchorH='left'|'center'|'right';

// opentype.js's getPath(text, x, y, fontSize) already emits path data in the same Y-down
// convention as SVG (baseline at y, ascenders as negative y) — no vertical flip is needed for
// direct embedding. fontSize is literally "1 em == this many output units", so passing sizeMm
// gives millimeter-scale glyph outlines directly, matching the rest of the manufacturing pipeline.
export function measureTextWidthMm(font:opentype.Font,text:string,sizeMm:number):number{
 return font.getAdvanceWidth(text,sizeMm);
}

// Builds path data for `text` at physical size sizeMm with its baseline anchored at (0,0) in local
// (unrotated, unpositioned) space, horizontally aligned per `anchorH`. The caller positions/rotates
// the result with an SVG group transform (translate/rotate) rather than baking world coordinates
// into the path itself, so the same path data stays reusable if the object is moved. Also returns
// the glyph bounding box in that same local space (used for backer geometry).
export function textPathData(font:opentype.Font,text:string,sizeMm:number,anchorH:TextAnchorH='left'):{d:string;widthMm:number;bounds:{minX:number;minY:number;maxX:number;maxY:number}}{
 const widthMm=measureTextWidthMm(font,text,sizeMm);
 const dx=anchorH==='center'?-widthMm/2:anchorH==='right'?-widthMm:0;
 const path=font.getPath(text,dx,0,sizeMm);
 const box=path.getBoundingBox();
 return {d:path.toPathData(3),widthMm,bounds:{minX:box.x1,minY:box.y1,maxX:box.x2,maxY:box.y2}};
}
