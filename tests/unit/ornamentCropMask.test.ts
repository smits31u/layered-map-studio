import {describe,expect,it} from 'vitest';
import {createDefaultOrnamentProject} from '../../src/ornament/defaults';
import {buildOrnamentGeometry} from '../../src/ornament/geometry/ornamentShape';
import {mapWindowOf} from '../../src/ornament/geometry/clipLine';
import {geometryToPath,mapPxToOrnamentMm,mapWindowLayout,mmToContainerPx,ornamentMmToMapPx,ornamentViewBox,previewTransform} from '../../src/ornament/map/cropMask';

const defaults=createDefaultOrnamentProject();
const geometry=buildOrnamentGeometry(defaults.ornament);
const viewBox=ornamentViewBox(geometry);

const numbersIn=(path:string)=>(path.match(/-?\d+(?:\.\d+)?/g)??[]).map(Number);

describe('preview transform',()=>{
 it('fits the ornament inside the container without distorting it',()=>{
  const transform=previewTransform(viewBox,800,400);
  expect(transform.scale).toBeCloseTo(400/viewBox.height,12);   // height-limited
  expect(transform.widthPx/transform.heightPx).toBeCloseTo(viewBox.width/viewBox.height,12);
 });

 it('centres the fitted ornament in the leftover space',()=>{
  const transform=previewTransform(viewBox,800,400);
  expect(transform.offsetXPx).toBeCloseTo((800-transform.widthPx)/2,9);
  expect(transform.offsetYPx).toBeCloseTo(0,9);
 });

 it('is width-limited when the container is narrow',()=>{
  const transform=previewTransform(viewBox,200,4000);
  expect(transform.scale).toBeCloseTo(200/viewBox.width,12);
 });

 it('collapses to zero rather than producing Infinity for a zero-sized container',()=>{
  for(const [w,h] of [[0,400],[800,0],[0,0],[-10,-10]]){
   const transform=previewTransform(viewBox,w,h);
   expect(transform.scale).toBe(0);
   expect(Number.isFinite(transform.widthPx)).toBe(true);
  }
 });

 it('maps the ornament centre to the middle of the fitted area',()=>{
  const transform=previewTransform(viewBox,800,400);
  const [x,y]=mmToContainerPx(viewBox,transform,0,0);
  expect(x).toBeCloseTo(transform.offsetXPx+(0-viewBox.minX)*transform.scale,9);
  // The ornament centre is not the viewBox centre: the hanging loop extends the box upward.
  expect(y).toBeGreaterThan(transform.offsetYPx+transform.heightPx/2);
 });
});

describe('map window layout',()=>{
 const transform=previewTransform(viewBox,900,700);
 const layout=mapWindowLayout(geometry,viewBox,transform);

 it('sizes the map element to the inner opening, not the outer ornament',()=>{
  expect(layout.sizeMm).toBeCloseTo(geometry.innerRadiusMm*2,12);
  expect(layout.sizePx).toBeCloseTo(layout.sizeMm*transform.scale,9);
 });

 it('puts the ornament centre at the centre of the map element',()=>{
  const [centreX,centreY]=mmToContainerPx(viewBox,transform,0,0);
  expect(layout.leftPx+layout.sizePx/2).toBeCloseTo(centreX,9);
  expect(layout.topPx+layout.sizePx/2).toBeCloseTo(centreY,9);
 });

 it('reports a scale whose reciprocal is the mm-per-pixel figure the export projection needs',()=>{
  expect(layout.sizeMm/layout.sizePx).toBeCloseTo(1/layout.scalePxPerMm,12);
 });

 it('round-trips a position between map pixels and ornament millimetres',()=>{
  for(const point of [[0,0],[10,-20],[-33.3,7.25]] as [number,number][]){
   const [px,py]=ornamentMmToMapPx(layout,point[0],point[1]);
   const back=mapPxToOrnamentMm(layout,px,py);
   expect(back[0]).toBeCloseTo(point[0],9);
   expect(back[1]).toBeCloseTo(point[1],9);
  }
 });

 it('returns NaN rather than a wrong answer when there is no scale',()=>{
  const zero=mapWindowLayout(geometry,viewBox,previewTransform(viewBox,0,0));
  expect(mapPxToOrnamentMm(zero,10,10).every(Number.isNaN)).toBe(true);
  expect(zero.clipPath).toBe('none');
 });
});

// The point of this group: the crop is the Phase 1 geometry, not a lookalike. If somebody ever
// replaces mapOpening with a freshly-drawn circle, these fail.
describe('the crop is the ornament geometry',()=>{
 const transform=previewTransform(viewBox,900,700);
 const layout=mapWindowLayout(geometry,viewBox,transform);

 it('serializes exactly the mapOpening polygon the frame was cut from',()=>{
  expect(layout.outlinePathMm).toBe(geometryToPath(geometry.mapOpening));
  expect(layout.outlinePathMm.length).toBeGreaterThan(0);
 });

 it('emits a clip path with the same vertex count as the geometry',()=>{
  const vertices=geometry.mapOpening.flat().flat().length;
  expect(numbersIn(layout.clipPath)).toHaveLength(vertices*2);
 });

 it('places every clip vertex inside the map element box',()=>{
  const numbers=numbersIn(layout.clipPath);
  for(let i=0;i<numbers.length;i+=2){
   expect(numbers[i]).toBeGreaterThanOrEqual(-0.01);
   expect(numbers[i]).toBeLessThanOrEqual(layout.sizePx+0.01);
   expect(numbers[i+1]).toBeGreaterThanOrEqual(-0.01);
   expect(numbers[i+1]).toBeLessThanOrEqual(layout.sizePx+0.01);
  }
 });

 it('agrees with the line clipper about where the window is',()=>{
  const window=mapWindowOf(geometry);
  const numbers=numbersIn(layout.clipPath);
  for(let i=0;i<numbers.length;i+=2){
   const back=mapPxToOrnamentMm(layout,numbers[i],numbers[i+1]);
   // Clip vertices sit on the boundary, so allow the rounding the path serializer applies.
   // isInsideMapWindow is exercised directly in ornamentClipLine.test.ts; here the point is that
   // the crop path and the clipper describe the same region.
   expect(Math.hypot(back[0],back[1])).toBeLessThanOrEqual(window.innerRadiusMm+0.01);
   expect(back[1]).toBeLessThanOrEqual(window.chordYMm+0.01);
  }
 });

 it('follows the rim and the text boundary when they change, rather than a fixed proportion',()=>{
  const wider=buildOrnamentGeometry({...defaults.ornament,rimWidthMm:14});
  const lower=buildOrnamentGeometry({...defaults.ornament,mapToTextBoundaryMm:-5});
  const box=ornamentViewBox(wider);
  expect(mapWindowLayout(wider,box,previewTransform(box,900,700)).sizeMm).toBeCloseTo(wider.innerRadiusMm*2,12);
  expect(mapWindowLayout(wider,box,previewTransform(box,900,700)).sizeMm).toBeLessThan(mapWindowLayout(geometry,viewBox,transform).sizeMm);
  // A higher chord means a shorter map window, and the crop path has to shrink with it.
  const lowerBox=ornamentViewBox(lower);
  const lowerLayout=mapWindowLayout(lower,lowerBox,previewTransform(lowerBox,900,700));
  expect(lowerLayout.outlinePathMm).not.toBe(layout.outlinePathMm);
  expect(lower.mapOpeningHeightMm).toBeLessThan(geometry.mapOpeningHeightMm);
 });
});

describe('geometryToPath',()=>{
 it('closes every ring and rounds to three decimals',()=>{
  const path=geometryToPath([[[[0,0],[10,0],[10,10],[0,10],[0,0]]]]);
  expect(path.startsWith('M0 0')).toBe(true);
  expect(path.trim().endsWith('Z')).toBe(true);
  expect(path).not.toMatch(/\d\.\d{4}/);
 });

 it('keeps holes as separate subpaths',()=>{
  const withHole=geometryToPath([[[[0,0],[10,0],[10,10],[0,10],[0,0]],[[2,2],[4,2],[4,4],[2,4],[2,2]]]]);
  expect(withHole.match(/Z/g)).toHaveLength(2);
 });

 it('applies the offset and scale uniformly',()=>{
  expect(geometryToPath([[[[1,2],[3,4],[1,2]]]],10,20,2)).toBe('M22 44 L26 48 L22 44 Z');
 });

 it('returns an empty string for empty geometry',()=>{
  expect(geometryToPath([])).toBe('');
 });
});
