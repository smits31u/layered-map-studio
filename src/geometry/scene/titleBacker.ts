export type TextBoundsMm={minX:number;minY:number;maxX:number;maxY:number};

export function unionBounds(a:TextBoundsMm,b?:TextBoundsMm):TextBoundsMm{
 if(!b)return a;
 return {minX:Math.min(a.minX,b.minX),minY:Math.min(a.minY,b.minY),maxX:Math.max(a.maxX,b.maxX),maxY:Math.max(a.maxY,b.maxY)};
}

// Backer geometry is manufacturing geometry (a real path in the scene), not a CSS background.
// Default operation is 'cut': a backer border is conventionally meant to be cut cleanly through the
// material so the title area reads as a distinct physical plate/frame, per the product's existing
// convention that only Land carries cut *and* engrave content — see buildScene.ts and the final
// report for why 'cut' was chosen as the sensible default rather than 'engrave'.
//
// 'rectangle': a sharp-cornered rectangle padded by paddingMm around the text bounds.
// 'offset': a rounded-corner rectangle (corner radius == paddingMm) approximating a halo that
// follows the text more closely than a sharp rectangle — a deliberate simplification of a true
// glyph-outline offset (which would need buffering the actual letter shapes); documented as such.
export function titleBackerPath(mode:'none'|'offset'|'rectangle',bounds:TextBoundsMm,paddingMm:number):string|undefined{
 if(mode==='none')return undefined;
 const x=bounds.minX-paddingMm,y=bounds.minY-paddingMm,width=bounds.maxX-bounds.minX+paddingMm*2,height=bounds.maxY-bounds.minY+paddingMm*2;
 if(width<=0||height<=0)return undefined;
 if(mode==='rectangle')return `M${x} ${y} L${x+width} ${y} L${x+width} ${y+height} L${x} ${y+height} Z`;
 const r=Math.min(paddingMm,width/2,height/2);
 return `M${x+r} ${y} L${x+width-r} ${y} A${r} ${r} 0 0 1 ${x+width} ${y+r} L${x+width} ${y+height-r} A${r} ${r} 0 0 1 ${x+width-r} ${y+height} L${x+r} ${y+height} A${r} ${r} 0 0 1 ${x} ${y+height-r} L${x} ${y+r} A${r} ${r} 0 0 1 ${x+r} ${y} Z`;
}
