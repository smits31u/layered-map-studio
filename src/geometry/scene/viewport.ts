// Editor viewport state (M-LIVE): purely a display concern for the generated-map preview. Never
// part of MapProject, never serialized, never touches physical coordinates, projection, or export
// geometry — see docs/v1-milestones.md's state-separation note. Deliberately kept as plain,
// framework-free math so it's testable without React and without a DOM.
export type EditorViewport={zoom:number;panXPx:number;panYPx:number};

export const MIN_ZOOM=.25;
export const MAX_ZOOM=4;
export const DEFAULT_ZOOM=1;

export const clampZoom=(zoom:number)=>Math.min(MAX_ZOOM,Math.max(MIN_ZOOM,zoom));

// "100%" means the exported SVG at its literal physical size: the browser's own mm->CSS-px
// conversion (96 CSS px per inch / 25.4mm per inch), matching how the SVG's own width="...mm"
// height="...mm" attributes already resolve — not "fit to container", which is a separate,
// explicit action (fitZoom below).
export const CSS_PX_PER_MM=96/25.4;

export function fitZoom(widthMm:number,heightMm:number,containerWidthPx:number,containerHeightPx:number,paddingPx=24):number{
 if(widthMm<=0||heightMm<=0||containerWidthPx<=0||containerHeightPx<=0)return DEFAULT_ZOOM;
 const naturalWidthPx=widthMm*CSS_PX_PER_MM,naturalHeightPx=heightMm*CSS_PX_PER_MM;
 const availableWidth=Math.max(1,containerWidthPx-paddingPx*2),availableHeight=Math.max(1,containerHeightPx-paddingPx*2);
 return clampZoom(Math.min(availableWidth/naturalWidthPx,availableHeight/naturalHeightPx));
}

export function centeredViewport(zoom:number,widthMm:number,heightMm:number,containerWidthPx:number,containerHeightPx:number):EditorViewport{
 const scaledWidthPx=widthMm*CSS_PX_PER_MM*zoom,scaledHeightPx=heightMm*CSS_PX_PER_MM*zoom;
 return{zoom,panXPx:(containerWidthPx-scaledWidthPx)/2,panYPx:(containerHeightPx-scaledHeightPx)/2};
}

// Keeps the mm point currently under (pointerXPx,pointerYPx) visually fixed while zoom changes —
// standard "zoom toward cursor" behavior. Content is rendered with
// `transform: translate(panXPx,panYPx) scale(zoom)`, so a local (unscaled) point maps to screen
// as screenX = panX + zoom*localX; solving for the pan that keeps localX fixed under the same
// screen point at the new zoom gives the update below.
export function zoomAroundPoint(current:EditorViewport,nextZoom:number,pointerXPx:number,pointerYPx:number):EditorViewport{
 const zoom=clampZoom(nextZoom);
 if(zoom===current.zoom)return current;
 const ratio=zoom/current.zoom;
 return{zoom,panXPx:pointerXPx-(pointerXPx-current.panXPx)*ratio,panYPx:pointerYPx-(pointerYPx-current.panYPx)*ratio};
}

export function panBy(current:EditorViewport,dxPx:number,dyPx:number):EditorViewport{
 return{...current,panXPx:current.panXPx+dxPx,panYPx:current.panYPx+dyPx};
}

export const cssTransform=(viewport:EditorViewport)=>`translate(${viewport.panXPx}px, ${viewport.panYPx}px) scale(${viewport.zoom})`;
