import {describe,expect,it} from 'vitest';
import {CSS_PX_PER_MM,MAX_ZOOM,MIN_ZOOM,centeredViewport,clampZoom,fitZoom,panBy,zoomAroundPoint} from '../../src/geometry/scene/viewport';

describe('clampZoom',()=>{
 it('clamps to the 25%-400% range',()=>{
  expect(clampZoom(0.1)).toBe(MIN_ZOOM);
  expect(clampZoom(10)).toBe(MAX_ZOOM);
  expect(clampZoom(1.5)).toBe(1.5);
 });
});

describe('fitZoom',()=>{
 it('scales down a large physical size to fit a small container',()=>{
  // 355.6 x 279.4 mm at CSS_PX_PER_MM natural size is much larger than an 800x600 container
  const zoom=fitZoom(355.6,279.4,800,600);
  expect(zoom).toBeLessThan(1);
  expect(zoom).toBeGreaterThan(0);
  const scaledWidthPx=355.6*CSS_PX_PER_MM*zoom;
  expect(scaledWidthPx).toBeLessThanOrEqual(800);
 });

 it('never exceeds MAX_ZOOM even for a tiny physical size in a huge container',()=>{
  expect(fitZoom(10,10,5000,5000)).toBeLessThanOrEqual(MAX_ZOOM);
 });

 it('falls back to 100% for degenerate input',()=>{
  expect(fitZoom(0,100,800,600)).toBe(1);
  expect(fitZoom(100,100,0,0)).toBe(1);
 });
});

describe('centeredViewport',()=>{
 it('centers scaled content within the container',()=>{
  const v=centeredViewport(1,100,50,800,600);
  const scaledWidthPx=100*CSS_PX_PER_MM,scaledHeightPx=50*CSS_PX_PER_MM;
  expect(v.panXPx).toBeCloseTo((800-scaledWidthPx)/2,5);
  expect(v.panYPx).toBeCloseTo((600-scaledHeightPx)/2,5);
 });
});

describe('zoomAroundPoint',()=>{
 it('keeps the point under the cursor fixed on screen as zoom changes',()=>{
  const start={zoom:1,panXPx:0,panYPx:0};
  const pointerX=200,pointerY:number=150;
  const zoomed=zoomAroundPoint(start,2,pointerX,pointerY);
  // the local (unscaled) coordinate under the cursor before zooming
  const localX=(pointerX-start.panXPx)/start.zoom,localY=(pointerY-start.panYPx)/start.zoom;
  // after zoom, that same local coordinate must still land under the cursor
  const screenXAfter=zoomed.panXPx+localX*zoomed.zoom,screenYAfter=zoomed.panYPx+localY*zoomed.zoom;
  expect(screenXAfter).toBeCloseTo(pointerX,6);
  expect(screenYAfter).toBeCloseTo(pointerY,6);
 });

 it('is a no-op when the requested zoom clamps to the current zoom',()=>{
  const start={zoom:MAX_ZOOM,panXPx:5,panYPx:5};
  expect(zoomAroundPoint(start,999,100,100)).toBe(start);
 });

 it('respects zoom clamping while still preserving the cursor-fixed point at the clamped value',()=>{
  const start={zoom:1,panXPx:0,panYPx:0};
  const zoomed=zoomAroundPoint(start,999,100,100);
  expect(zoomed.zoom).toBe(MAX_ZOOM);
 });
});

describe('panBy',()=>{
 it('adds the delta to the current pan without touching zoom',()=>{
  const start={zoom:1.5,panXPx:10,panYPx:20};
  expect(panBy(start,5,-5)).toEqual({zoom:1.5,panXPx:15,panYPx:15});
 });
});
