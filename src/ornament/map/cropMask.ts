import type {MultiPolygonMm} from '../../geometry/shoreline/polygonEngine';
import type {OrnamentGeometry} from '../geometry/ornamentShape';

// The preview's map crop.
//
// The map is clipped by `geometry.mapOpening` — the same MultiPolygon `buildOrnamentGeometry`
// subtracts from the frame in Phase 1, produced by intersecting the inner disk with the half-plane
// above the map/text chord. It is not re-derived here from a radius and a chord height, because the
// plan's requirement is that they cannot drift: "Use the same geometry mask for preview and export;
// do not maintain unrelated magic proportions." If the rim width or the map/text boundary changes,
// the frame and this crop change together, by construction.
//
// Everything below is pure arithmetic on that geometry plus a container size, so the alignment
// between the SVG frame and the clipped map is unit-testable rather than something that has to be
// eyeballed in a browser.

export interface ViewBoxMm{minX:number;minY:number;width:number;height:number}

// Maps the ornament's millimetre space onto pixels inside a container, preserving aspect ratio and
// centring — the same fit an SVG with preserveAspectRatio="xMidYMid meet" performs, computed
// explicitly so the map element can be positioned with the identical transform.
export interface PreviewTransform{
 scale:number;
 offsetXPx:number;
 offsetYPx:number;
 widthPx:number;
 heightPx:number;
 // The container the drawing was fitted into. Carried so the map element can be sized to the pane
 // rather than to the drawing — see `mapWindowLayout`.
 containerWidthPx:number;
 containerHeightPx:number;
}

export function ornamentViewBox(geometry:OrnamentGeometry,marginMm?:number):ViewBoxMm{
 const loopTop=geometry.loop.centerY-geometry.loop.outerRadiusMm;
 const margin=marginMm??Math.max(4,geometry.outerRadiusMm*.08);
 return {
  minX:-geometry.outerRadiusMm-margin,
  minY:loopTop-margin,
  width:geometry.outerRadiusMm*2+margin*2,
  height:geometry.outerRadiusMm-loopTop+margin*2,
 };
}

export function previewTransform(viewBox:ViewBoxMm,containerWidthPx:number,containerHeightPx:number):PreviewTransform{
 const usableWidth=Math.max(0,containerWidthPx),usableHeight=Math.max(0,containerHeightPx);
 if(!(viewBox.width>0)||!(viewBox.height>0)||!(usableWidth>0)||!(usableHeight>0))
  return {scale:0,offsetXPx:0,offsetYPx:0,widthPx:0,heightPx:0,containerWidthPx:usableWidth,containerHeightPx:usableHeight};
 const scale=Math.min(usableWidth/viewBox.width,usableHeight/viewBox.height);
 const widthPx=viewBox.width*scale,heightPx=viewBox.height*scale;
 return {
  scale,
  offsetXPx:(usableWidth-widthPx)/2,
  offsetYPx:(usableHeight-heightPx)/2,
  widthPx,
  heightPx,
  containerWidthPx:usableWidth,
  containerHeightPx:usableHeight,
 };
}

export const mmToContainerPx=(viewBox:ViewBoxMm,transform:PreviewTransform,x:number,y:number):[number,number]=>[
 transform.offsetXPx+(x-viewBox.minX)*transform.scale,
 transform.offsetYPx+(y-viewBox.minY)*transform.scale,
];

// Where the interactive map element sits and how it is clipped.
//
// The map occupies the square that circumscribes the inner opening — side 2·innerRadius, centred on
// the ornament centre — so the map's own centre pixel is the ornament's (0,0). That registration is
// what makes the plan's export scale rule ("Convert map screen pixels to millimetres using
// diameterMm / renderedMapDiameterPx") a single division rather than an offset to keep track of,
// and it means panning the map moves the geography under a fixed ornament, which is what a user
// framing an ornament expects.
export interface MapWindowLayout{
 // The ornament's map *window* — the square circumscribing the inner opening. This is the physical
 // thing: `sizeMm` is what the capture calls its diameter, and `sizeMm/2` is the innerRadiusMm a
 // capture records. It is no longer the size of the map element, which is larger (see below).
 leftPx:number;
 topPx:number;
 sizePx:number;
 sizeMm:number;
 // The map *element* — the interactive MapLibre canvas. It fills the preview pane rather than
 // stopping at the ornament's opening, so a user framing a piece can see the geography they are
 // panning past instead of only the part already inside the frame. The area outside the opening is
 // dimmed, not cropped.
 //
 // It stays centred on the ornament centre, which is not decoration: the whole export projection
 // depends on the ornament's (0,0) being the map's centre pixel, so growing the element around that
 // point is what makes it a presentation change rather than a change to where geometry lands. It is
 // therefore a rectangle rather than a square — the ornament centre sits below the pane's centre,
 // because the hanging loop extends the drawing upward — and it is allowed to overhang the pane,
 // which `.ornament-preview`'s `overflow:hidden` takes care of.
 elementLeftPx:number;
 elementTopPx:number;
 elementWidthPx:number;
 elementHeightPx:number;
 // Pixels per millimetre inside the map element. Its reciprocal is the mm-per-pixel figure Phase 3
 // projects captured features with.
 scalePxPerMm:number;
 // A CSS clip-path value: `path('...')`, in the map element's own pixel coordinates. No longer
 // applied to the map element itself (the preview shows the full map with the area outside this
 // mask dimmed rather than hard-clipping it away), but kept for anything that still wants a literal
 // clip — e.g. `maskPathPx` un-wrapped for the dim-overlay's own `<path>` `d`.
 clipPath:string;
 // `maskPathPx` without the `path('...')` wrapper — the same ring, in the map element's own pixel
 // coordinates, for drawing (not clipping) the ornament boundary.
 maskPathPx:string;
 // The same crop as an SVG path in millimetre coordinates, for the preview overlay.
 outlinePathMm:string;
}

const round=(n:number)=>Number(n.toFixed(3));

// Serializes a MultiPolygon, optionally translated and scaled. Rings are emitted closed; the
// ornament's opening is a single ring today, but water-cutout modes will not be, so holes are
// carried through rather than assumed away.
export function geometryToPath(geometry:MultiPolygonMm,offsetX=0,offsetY=0,scale=1):string{
 return geometry
  .flat()
  .map(ring=>ring.map(([x,y],index)=>`${index?'L':'M'}${round((x+offsetX)*scale)} ${round((y+offsetY)*scale)}`).join(' ')+' Z')
  .join(' ');
}

export function mapWindowLayout(geometry:OrnamentGeometry,viewBox:ViewBoxMm,transform:PreviewTransform):MapWindowLayout{
 const radius=geometry.innerRadiusMm;
 const sizeMm=radius*2;
 const [leftPx,topPx]=mmToContainerPx(viewBox,transform,-radius,-radius);
 const sizePx=sizeMm*transform.scale;

 // The element is the smallest rectangle centred on the ornament centre that still covers the whole
 // container. Taking the larger half-extent on each axis is what guarantees coverage: the centre is
 // off-centre in the pane, so mirroring the longer side is the only way to reach both edges without
 // moving the centre.
 const [centreXPx,centreYPx]=mmToContainerPx(viewBox,transform,0,0);
 const halfWidthPx=transform.scale>0?Math.max(centreXPx,transform.containerWidthPx-centreXPx):sizePx/2;
 const halfHeightPx=transform.scale>0?Math.max(centreYPx,transform.containerHeightPx-centreYPx):sizePx/2;
 const elementWidthPx=halfWidthPx*2,elementHeightPx=halfHeightPx*2;

 // The mask is drawn in the element's own pixel coordinates, whose origin is its top-left corner.
 // Dividing the pixel offset by the scale expresses it as the millimetre translation
 // `geometryToPath` applies before scaling, which keeps one serializer rather than two.
 const maskPathPx=geometry.mapOpening.length&&transform.scale>0
  ?geometryToPath(geometry.mapOpening,halfWidthPx/transform.scale,halfHeightPx/transform.scale,transform.scale)
  :'';
 const clipPath=maskPathPx?`path('${maskPathPx}')`:'none';
 return {
  leftPx,topPx,sizePx,sizeMm,
  elementLeftPx:centreXPx-halfWidthPx,
  elementTopPx:centreYPx-halfHeightPx,
  elementWidthPx,
  elementHeightPx,
  scalePxPerMm:transform.scale,
  clipPath,
  maskPathPx,
  outlinePathMm:geometryToPath(geometry.mapOpening),
 };
}

// Converts a position inside the map element back to ornament millimetres. Used to ask whether a
// point projected from a geographic coordinate actually lands inside the ornament's map window.
export const mapPxToOrnamentMm=(layout:MapWindowLayout,xPx:number,yPx:number):[number,number]=>
 layout.scalePxPerMm>0
  ?[(xPx-layout.elementWidthPx/2)/layout.scalePxPerMm,(yPx-layout.elementHeightPx/2)/layout.scalePxPerMm]
  :[Number.NaN,Number.NaN];

export const ornamentMmToMapPx=(layout:MapWindowLayout,xMm:number,yMm:number):[number,number]=>[
 layout.elementWidthPx/2+xMm*layout.scalePxPerMm,
 layout.elementHeightPx/2+yMm*layout.scalePxPerMm,
];
