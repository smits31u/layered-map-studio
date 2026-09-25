import {describe,expect,it} from 'vitest';
import {MERCATOR_MAX_LATITUDE} from '../../src/topo/types';
import {MAX_TERRAIN_TILES,frameBounds,latOfMercatorY,lngOfMercatorX,mercatorX,mercatorY,planTerrainTiles,terrainZoomFor,tileKey} from '../../src/topo/terrain/tiles';
import {freezeTerrainView} from '../../src/topo/terrain/pipeline';
import {WORKING_GRID,workingGridSpec} from '../../src/topo/terrain/elevationGrid';

// XYZ coverage (plan §Terrain acquisition; acceptance: "Longitude/latitude <-> tile math handles
// antimeridian and Web Mercator latitude limits").

describe('terrain zoom',()=>{
 it('is clamp(floor(mapZoom), 5, 14)',()=>{
  expect([0,4.9,5,6,13.5,14,14.99,15,18].map(terrainZoomFor)).toEqual([5,5,5,6,13,14,14,14,14]);
 });
});

describe('Web Mercator',()=>{
 it('round-trips longitude and latitude',()=>{
  for(const lng of [-180,-89.68,0,45.5,179.9])expect(lngOfMercatorX(mercatorX(lng))).toBeCloseTo(lng,10);
  for(const lat of [-85,-45.1,0,44.92,85])expect(latOfMercatorY(mercatorY(lat))).toBeCloseTo(lat,10);
 });
 it('clamps at the projection limit instead of returning Infinity',()=>{
  expect(mercatorY(90)).toBeCloseTo(0,6);expect(mercatorY(-90)).toBeCloseTo(1,6);
  expect(mercatorY(90)).toBe(mercatorY(MERCATOR_MAX_LATITUDE));
  expect(Number.isFinite(mercatorY(89.9999))).toBe(true);
 });
});

describe('frame bounds',()=>{
 it('are centred on the map centre and have the frame proportions',()=>{
  const b=frameBounds([-89.68,44.92],13,600,300);
  expect((mercatorX(b.west)+mercatorX(b.east))/2).toBeCloseTo(mercatorX(-89.68),12);
  expect((mercatorY(b.north)+mercatorY(b.south))/2).toBeCloseTo(mercatorY(44.92),12);
  // 600 CSS px at map zoom 13 is 600/512 of a zoom-13 MapLibre tile.
  expect((mercatorX(b.east)-mercatorX(b.west))*512*2**13).toBeCloseTo(600,9);
  expect((mercatorY(b.south)-mercatorY(b.north))*512*2**13).toBeCloseTo(300,9);
 });
 it('keep east > west across the antimeridian',()=>{
  const b=frameBounds([179.99,0],10,800,800);
  expect(b.east).toBeGreaterThan(180);
  expect(b.east).toBeGreaterThan(b.west);
 });
 it('freeze the frame height from the board proportions',()=>{
  const view=freezeTerrainView([-89.68,44.92],14,640,300,150);
  expect(view.frameHeightPx).toBe(320);
  expect(()=>freezeTerrainView([0,0],14,0,300,150)).toThrow(/no size/);
 });
});

describe('tile plan',()=>{
 it('covers the bounds plus a one-tile padding ring',()=>{
  const view=freezeTerrainView([-89.68,44.92],13.6,600,228.6,228.6);
  const plan=planTerrainTiles(view.bounds,view.zoom);
  expect(plan.z).toBe(13);
  const n=2**13,inner={x0:Math.floor(mercatorX(view.bounds.west)*n),x1:Math.floor(mercatorX(view.bounds.east)*n),y0:Math.floor(mercatorY(view.bounds.north)*n),y1:Math.floor(mercatorY(view.bounds.south)*n)};
  expect(plan.x0).toBe(inner.x0-1);
  expect(plan.y0).toBe(inner.y0-1);
  expect(plan.columns).toBe(inner.x1-inner.x0+3);
  expect(plan.rows).toBe(inner.y1-inner.y0+3);
  expect(plan.tiles).toHaveLength(plan.columns*plan.rows);
  expect(new Set(plan.tiles.map(tileKey)).size).toBe(plan.tiles.length);
  // Row-major, placed by column/row.
  expect(plan.tiles[0]).toMatchObject({x:plan.x0,y:plan.y0,column:0,row:0});
 });

 it('wraps columns across the antimeridian',()=>{
  const plan=planTerrainTiles(frameBounds([179.999,10],8,400,400),8);
  const xs=[...new Set(plan.tiles.map(t=>t.x))];
  expect(xs).toContain(0);expect(xs).toContain(255);
  expect(plan.tiles.every(t=>t.x>=0&&t.x<256)).toBe(true);
  expect(plan.x0+plan.columns-1).toBeGreaterThan(255);
 });

 it('does not pad past the poles',()=>{
  const plan=planTerrainTiles(frameBounds([0,85],6,400,400),6);
  expect(plan.y0).toBe(0);
  expect(plan.tiles.every(t=>t.y>=0&&t.y<64)).toBe(true);
 });

 it('refuses a view that needs more tiles than the budget',()=>{
  expect(()=>planTerrainTiles(frameBounds([0,0],9.9,6000,6000),9.9)).toThrow(new RegExp(`more than the ${MAX_TERRAIN_TILES}`));
 });

 it('refuses invalid bounds',()=>{
  expect(()=>planTerrainTiles({west:1,east:0,north:1,south:0},10)).toThrow(/invalid bounds/);
  expect(()=>planTerrainTiles({west:0,east:1,north:NaN,south:0},10)).toThrow(/invalid bounds/);
 });
});

describe('working grid',()=>{
 it('is about 900 samples across the default 9-inch square, one extra cell past every edge',()=>{
  const g=workingGridSpec(228.6,228.6);
  expect(g.columns).toBe(902);expect(g.rows).toBe(902);
  expect(g.cellMm).toBeCloseTo(228.6/900,12);
  expect(g.originXMm+.5*g.cellMm).toBeLessThan(0);
  expect(g.originXMm+(g.columns-.5)*g.cellMm).toBeGreaterThan(228.6);
 });
 it('scales modestly with the perimeter and respects the sample budget',()=>{
  const small=workingGridSpec(100,100),big=workingGridSpec(600,600),wide=workingGridSpec(600,50);
  expect(Math.max(small.columns,small.rows)).toBeLessThan(902);
  expect(big.columns*big.rows).toBeLessThanOrEqual(WORKING_GRID.maxSamples);
  expect(big.columns).toBeGreaterThan(1300);
  for(const g of [small,big,wide]){
   expect(g.originXMm+.5*g.cellMm).toBeLessThan(0);
   expect(g.originYMm+.5*g.cellMm).toBeLessThan(0);
  }
  expect(wide.columns).toBeGreaterThan(wide.rows*8);
 });
});
