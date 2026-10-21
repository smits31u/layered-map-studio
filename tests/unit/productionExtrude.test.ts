import {describe,expect,it} from 'vitest';
import {createDefaultEstimateConfig,MM_PER_IN} from '../../src/production/estimate/config';
import {rectPathData} from '../../src/production/geometry/pathData';
import type {ProductionJob} from '../../src/production/job';
import {extrudePolygons,meshVolume,outlinePolygons,topCapArea,type MeshData} from '../../src/production/preview3d/extrude';
import {defaultLayerColors,explodedY,stackHeight,stackLayers} from '../../src/production/preview3d/stack';

// Extrusion of outlines with holes into closed, outward-wound solids, and the physical stacking
// order and heights of the preview.

const opts={widthMm:10,heightMm:10,baseY:0,thicknessMm:3.175};

// Every triangle's geometric normal must agree with the normal stored at its vertices.
function windingAgreesWithNormals(mesh:MeshData){
 const p=mesh.positions,n=mesh.normals,ix=mesh.indices;
 for(let t=0;t<ix.length;t+=3){
  const [a,b,c]=[ix[t]*3,ix[t+1]*3,ix[t+2]*3];
  const ux=p[b]-p[a],uy=p[b+1]-p[a+1],uz=p[b+2]-p[a+2],vx=p[c]-p[a],vy=p[c+1]-p[a+1],vz=p[c+2]-p[a+2];
  const gx=uy*vz-uz*vy,gy=uz*vx-ux*vz,gz=ux*vy-uy*vx;
  if(gx*n[a]+gy*n[a+1]+gz*n[a+2]<=0)return false;
 }
 return true;
}

describe('extrudePolygons',()=>{
 it('a square with a square hole: caps of the even-odd area, a closed outward solid',()=>{
  const mesh=extrudePolygons(outlinePolygons([`${rectPathData(0,0,10,10)} ${rectPathData(2,2,6,6)}`]),opts);
  expect(topCapArea(mesh)).toBeCloseTo(64,9);
  expect(meshVolume(mesh)).toBeCloseTo(64*3.175,4);
  expect(windingAgreesWithNormals(mesh)).toBe(true);
  // 8 ring vertices: 8 per cap and 4 per side quad.
  expect(mesh.positions.length/3).toBe(8+8+8*4);
 });

 it('side walls face out of the solid: away from the board centre outside, into the hole inside',()=>{
  const mesh=extrudePolygons(outlinePolygons([`${rectPathData(0,0,10,10)} ${rectPathData(2,2,6,6)}`]),opts);
  const p=mesh.positions,n=mesh.normals;
  for(let v=16;v<p.length/3;v++){
   const x=p[v*3],z=p[v*3+2],nx=n[v*3],nz=n[v*3+2];
   const onOuter=x===0||x===10||z===0||z===10;
   // Outward from the solid: outer walls point away from (5,5), hole walls point toward it.
   const away=(x-5)*nx+(z-5)*nz>0;
   expect(away).toBe(onOuter);
  }
 });

 it('ring direction does not matter: holes wound either way give the same solid',()=>{
  const cwHole='M2 2 L2 8 L8 8 L8 2 Z',ccwHole='M2 2 L8 2 L8 8 L2 8 Z',outer='M0 0 L10 0 L10 10 L0 10 Z',outerCw='M0 0 L0 10 L10 10 L10 0 Z';
  for(const d of [`${outer} ${cwHole}`,`${outer} ${ccwHole}`,`${outerCw} ${cwHole}`,`${outerCw} ${ccwHole}`]){
   const mesh=extrudePolygons(outlinePolygons([d]),opts);
   expect(meshVolume(mesh)).toBeCloseTo(64*3.175,4);
   expect(windingAgreesWithNormals(mesh)).toBe(true);
  }
 });

 it('islands inside openings, and ponds on islands, become their own solids with holes',()=>{
  // Board 100x80, lake 60x50, island 20x20 in the lake, pond 5x5 on the island.
  const d=[rectPathData(0,0,100,80),rectPathData(10,10,60,50),rectPathData(20,20,20,20),rectPathData(25,25,5,5)].join(' ');
  const polygons=outlinePolygons([d]);
  expect(polygons).toHaveLength(2);
  const mesh=extrudePolygons(polygons,{widthMm:100,heightMm:80,baseY:0,thicknessMm:2});
  expect(topCapArea(mesh)).toBeCloseTo(8000-3000+400-25,6);
  expect(meshVolume(mesh)).toBeCloseTo((8000-3000+400-25)*2,3);
  expect(windingAgreesWithNormals(mesh)).toBe(true);
 });

 it('top-cap texture coordinates map the board, with north at the top of the image',()=>{
  const mesh=extrudePolygons(outlinePolygons([rectPathData(0,0,10,10)]),opts);
  // Vertex 0 is the top cap's first point, (0, 0) in SVG: the image's top-left corner.
  expect([mesh.uvs[0],mesh.uvs[1]]).toEqual([0,1]);
  expect(mesh.positions[1]).toBeCloseTo(3.175,6);
 });
});

describe('stack order and heights',()=>{
 const IN=MM_PER_IN,w=14*IN,h=11*IN;
 const job:ProductionJob={product:'lake-map',widthMm:w,heightMm:h,pieces:['layer-land','layer-depth-2','layer-depth-3','layer-depth-4','layer-base'].map(id=>({id,name:id,role:'layer' as const,widthMm:w,heightMm:h,shapes:[{id:`${id}-panel`,d:rectPathData(0,0,w,h),operation:'cut' as const,outline:true}]}))};
 const config=createDefaultEstimateConfig();

 it('builds from the bench up: base at the bottom, Land / Top last, each on the one below',()=>{
  const layers=stackLayers(job,config);
  expect(layers.map(l=>l.id)).toEqual(['layer-base','layer-depth-4','layer-depth-3','layer-depth-2','layer-land']);
  expect(layers.map(l=>l.level)).toEqual([0,1,2,3,4]);
  expect(layers[0].baseY).toBe(0);
  for(let i=1;i<layers.length;i++)expect(layers[i].baseY).toBeCloseTo(layers[i-1].baseY+layers[i-1].thicknessMm,9);
  expect(stackHeight(layers)).toBeCloseTo(5*3.175,9);
 });

 it('uses each layer\'s material thickness from the recipe and material library',()=>{
  const thick={...config,materials:config.materials.map(m=>m.id==='truflat'?{...m,thicknessMm:6.35}:m)};
  const layers=stackLayers(job,thick);
  expect(layers.at(-1)!.materialId).toBe('truflat');
  expect(layers.at(-1)!.thicknessMm).toBe(6.35);
  expect(stackHeight(layers)).toBeCloseTo(4*3.175+6.35,9);
 });

 it('never stacks the recipe\'s border piece: it has no cut geometry in the scene',()=>{
  expect(stackLayers(job,config).some(l=>l.id.startsWith('border'))).toBe(false);
 });

 it('the exploded view lifts each level by the same gap and leaves the bench piece where it is',()=>{
  const layers=stackLayers(job,config);
  expect(explodedY(layers[0],10)).toBe(0);
  expect(explodedY(layers[4],10)-explodedY(layers[3],10)).toBeCloseTo(3.175+10,9);
 });

 it('default colours: wood top, water from light to deep blue going down',()=>{
  const colors=defaultLayerColors(stackLayers(job,config));
  expect(colors.at(-1)).toBe('#c9a46c');
  const blue=(hex:string)=>parseInt(hex.slice(5,7),16),lum=(hex:string)=>[1,3,5].reduce((s,i)=>s+parseInt(hex.slice(i,i+2),16),0);
  const water=colors.slice(0,-1);
  for(const c of water)expect(blue(c)).toBeGreaterThan(parseInt(c.slice(1,3),16));
  for(let i=1;i<water.length;i++)expect(lum(water[i])).toBeGreaterThan(lum(water[i-1]));
 });
});
