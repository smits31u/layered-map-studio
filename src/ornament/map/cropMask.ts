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
export interface PreviewTransform{scale:number;offsetXPx:number;offsetYPx:number;widthPx:number;heightPx:number}

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
 if(!(viewBox.width>0)||!(viewBox.height>0)||!(usableWidth>0)||!(usableHeight>0))return {scale:0,offsetXPx:0,offsetYPx:0,widthPx:0,heightPx:0};
 const scale=Math.min(usableWidth/viewBox.width,usableHeight/viewBox.height);
 const widthPx=viewBox.width*scale,heightPx=viewBox.height*scale;
 return {scale,offsetXPx:(usableWidth-widthPx)/2,offsetYPx:(usableHeight-heightPx)/2,widthPx,heightPx};
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
 leftPx:number;
 topPx:number;
 sizePx:number;
 sizeMm:number;
 // Pixels per millimetre inside the map element. Its reciprocal is the mm-per-pixel figure Phase 3
 // projects captured features with.
 scalePxPerMm:number;
 // A CSS clip-path value: `path('...')`, in the map element's own pixel coordinates.
 clipPath:string;
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
 // Translating by +radius moves the ornament's centre to the map element's top-left origin, which
 // is the coordinate system a CSS clip-path is resolved in.
 const clipPath=geometry.mapOpening.length&&transform.scale>0
  ?`path('${geometryToPath(geometry.mapOpening,radius,radius,transform.scale)}')`
  :'none';
 return {leftPx,topPx,sizePx,sizeMm,scalePxPerMm:transform.scale,clipPath,outlinePathMm:geometryToPath(geometry.mapOpening)};
}

// Converts a position inside the map element back to ornament millimetres. Used to ask whether a
// marker placed at a geographic coordinate actually lands inside the ornament's map window.
export const mapPxToOrnamentMm=(layout:MapWindowLayout,xPx:number,yPx:number):[number,number]=>
 layout.scalePxPerMm>0
  ?[(xPx-layout.sizePx/2)/layout.scalePxPerMm,(yPx-layout.sizePx/2)/layout.scalePxPerMm]
  :[Number.NaN,Number.NaN];

export const ornamentMmToMapPx=(layout:MapWindowLayout,xMm:number,yMm:number):[number,number]=>[
 layout.sizePx/2+xMm*layout.scalePxPerMm,
 layout.sizePx/2+yMm*layout.scalePxPerMm,
];
