import {describe,expect,it} from 'vitest';
import {circle} from '../../src/ornament/geometry/circle';
import {geometryAreaMm2,normalizeTopology,subtract,unionAll} from '../../src/ornament/geometry/polygonRepair';
import {dilateGeometry,erodeGeometry,thinFeatures} from '../../src/ornament/export/morphology';

// Erosion and dilation are the measuring instrument every width check in Phase 4 depends on, so they
// are pinned against shapes whose eroded area can be worked out on paper. If these drift, the neck
// measurement drifts with them and reports a number that is confidently wrong.

const rect=(x0:number,y0:number,x1:number,y1:number)=>[[[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]] as [number,number][]]];

describe('morphological erosion and dilation',()=>{
 it('erodes a disk to a disk of the smaller radius',()=>{
  const disk=circle(0,0,10,.02);
  const eroded=erodeGeometry(disk,2);
  // The polygon under-measures a true circle slightly, so the comparison is against the same
  // approximation rather than against pi*r^2 exactly.
  expect(geometryAreaMm2(eroded)).toBeGreaterThan(Math.PI*64*.99);
  expect(geometryAreaMm2(eroded)).toBeLessThan(Math.PI*64*1.01);
  expect(eroded).toHaveLength(1);
 });

 it('erodes a disk out of existence once the radius exceeds its own',()=>{
  expect(erodeGeometry(circle(0,0,3,.02),3.5)).toHaveLength(0);
 });

 it('keeps an annulus an annulus, and erodes it from both sides',()=>{
  const annulus=normalizeTopology(subtract(circle(0,0,10,.02),circle(0,0,6,.02),'annulus'),'annulus');
  expect(annulus[0]).toHaveLength(2);
  const eroded=erodeGeometry(annulus,1);
  // 4mm of material, 1mm off each face, leaves 2mm: the ring from 7 to 9.
  expect(eroded).toHaveLength(1);
  expect(eroded[0]).toHaveLength(2);
  expect(geometryAreaMm2(eroded)).toBeGreaterThan(Math.PI*(81-49)*.98);
  expect(geometryAreaMm2(eroded)).toBeLessThan(Math.PI*(81-49)*1.02);
 });

 it('splits a dumbbell at its waist, which is the property the neck check relies on',()=>{
  // Two 10mm squares joined by a 2mm-wide bar.
  const dumbbell=normalizeTopology(unionAll([rect(-15,-5,-5,5),rect(-5,-1,5,1),rect(5,-5,15,5)],'dumbbell'),'dumbbell');
  expect(dumbbell).toHaveLength(1);

  // Eroding by less than half the waist leaves it joined...
  expect(erodeGeometry(dumbbell,.4)).toHaveLength(1);
  // ...and by more than half cuts it into the two ends.
  expect(erodeGeometry(dumbbell,1.2).length).toBeGreaterThanOrEqual(2);
 });

 it('restores an eroded shape to about its original size when dilated back',()=>{
  const disk=circle(0,0,12,.02);
  const opened=dilateGeometry(erodeGeometry(disk,3),3);
  expect(geometryAreaMm2(opened)).toBeGreaterThan(geometryAreaMm2(disk)*.97);
  expect(geometryAreaMm2(opened)).toBeLessThan(geometryAreaMm2(disk)*1.01);
 });

 it('finds no thin features in a shape that is uniformly thicker than the threshold',()=>{
  expect(thinFeatures(circle(0,0,20,.02),3).regions).toBe(0);
 });

 it('finds the thin part of a shape that has one',()=>{
  const spit=normalizeTopology(unionAll([circle(0,0,10,.02),rect(9,-.4,25,.4)],'spit'),'spit');
  const report=thinFeatures(spit,3);
  expect(report.regions).toBeGreaterThan(0);
  // The 0.8mm-wide, ~16mm-long spit is roughly 13mm2 of sub-minimum material.
  expect(report.areaMm2).toBeGreaterThan(5);
  expect(report.minWidthMm).toBe(3);
 });

 it('treats an empty geometry and a non-positive radius as no-ops rather than errors',()=>{
  expect(erodeGeometry([],2)).toHaveLength(0);
  expect(dilateGeometry([],2)).toHaveLength(0);
  expect(erodeGeometry(circle(0,0,5,.02),0)).toHaveLength(1);
  expect(thinFeatures(circle(0,0,5,.02),0).regions).toBe(0);
 });
});
