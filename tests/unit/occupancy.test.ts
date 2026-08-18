import {describe,expect,it} from 'vitest';
import {waterAreaOccupancy,waterBoundingBoxOccupancy,type MultiPolygonMm} from '../../src/geometry/shoreline/polygonEngine';

describe('framing occupancy metrics',()=>{
 it('computes area-based occupancy as water area over crop area',()=>{
  expect(waterAreaOccupancy(5000,100,100)).toBeCloseTo(0.5);
  expect(waterAreaOccupancy(2500,100,100)).toBeCloseTo(0.25);
  expect(waterAreaOccupancy(0,100,100)).toBe(0);
 });

 it('computes bounding-box occupancy for a known synthetic polygon',()=>{
  const water:MultiPolygonMm=[[[[20,20],[60,20],[60,70],[20,70],[20,20]]]];
  // bbox is 40x50 inside a 100x100 crop => 2000/10000 = 0.2
  expect(waterBoundingBoxOccupancy(water,100,100)).toBeCloseTo(0.2);
 });

 it('bounding-box occupancy spans multiple components',()=>{
  const water:MultiPolygonMm=[[[[0,0],[10,0],[10,10],[0,10],[0,0]]],[[[90,90],[100,90],[100,100],[90,100],[90,90]]]];
  // combined bbox is the full 100x100 crop => occupancy 1.0
  expect(waterBoundingBoxOccupancy(water,100,100)).toBeCloseTo(1);
 });

 it('returns zero occupancy for empty water',()=>{
  expect(waterBoundingBoxOccupancy([],200,150)).toBe(0);
 });
});
