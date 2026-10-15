import {unzlibSync} from 'fflate';
import {describe,expect,it} from 'vitest';
import {buildScene} from '../../src/export/buildScene';
import {lakeSceneToJob} from '../../src/production/adapters/lakeScene';
import {createDefaultEstimateConfig} from '../../src/production/estimate/config';
import type {MeshData} from '../../src/production/preview3d/extrude';
import {encodePng,insertPngText,readPngChunks,readPngInfo} from '../../src/production/preview3d/png';
import {exportSize,finalizePreviewPng,previewPngText,RENDER_NOTICE,watermarkText} from '../../src/production/preview3d/previewImage';
import {defaultLayerColors,explodedY,stackLayers} from '../../src/production/preview3d/stack';
import {buildLayerMesh} from '../../src/production/preview3d/worker/buildLayerMesh';
import {caldronFallsFeatures,caldronFallsProject} from '../fixtures/caldronFalls';

// The PNG side of the preview export. jsdom has no WebGL, so the image here is drawn by a tiny
// software rasterizer (an orthographic top view of the same layer solids, painted bottom-up); the
// real WebGL render is checked against production in a browser. What this pins is everything after
// the pixels exist: the requested size, a non-empty image, valid chunks, and the render labelling.

const meta={title:'Caldron Falls - 3D preview',customer:'Jane Doe',lake:'Caldron Falls',size:'14 x 11 in',appVersion:'0.1.0',createdAt:'2026-10-14T12:00:00.000Z',watermarked:true};

function rasterizeTopView(meshes:{mesh:MeshData;y:number;color:string}[],widthMm:number,heightMm:number,width:number,height:number):Uint8Array{
 const rgba=new Uint8Array(width*height*4);
 const scale=Math.min(width/widthMm,height/heightMm)*.9,ox=(width-widthMm*scale)/2,oy=(height-heightMm*scale)/2;
 for(const {mesh,color} of [...meshes].sort((a,b)=>a.y-b.y)){
  const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
  const p=mesh.positions,ix=mesh.indices;
  for(let t=0;t<mesh.topIndexCount;t+=3){
   const pts=[ix[t],ix[t+1],ix[t+2]].map(i=>[ox+p[i*3]*scale,oy+p[i*3+2]*scale]);
   // Scanline fill: each pixel row through the triangle, between the two edge crossings.
   const minY=Math.max(0,Math.floor(Math.min(...pts.map(q=>q[1])))),maxY=Math.min(height-1,Math.ceil(Math.max(...pts.map(q=>q[1]))));
   for(let y=minY;y<=maxY;y++){
    const cy=y+.5,xs:number[]=[];
    for(let e=0;e<3;e++){const a=pts[e],b=pts[(e+1)%3];if((a[1]<=cy&&cy<b[1])||(b[1]<=cy&&cy<a[1]))xs.push(a[0]+(cy-a[1])*(b[0]-a[0])/(b[1]-a[1]))}
    if(xs.length<2)continue;
    const from=Math.max(0,Math.ceil(Math.min(...xs)-.5)),to=Math.min(width-1,Math.floor(Math.max(...xs)-.5));
    for(let x=from;x<=to;x++){const o=(y*width+x)*4;rgba[o]=rgb[0];rgba[o+1]=rgb[1];rgba[o+2]=rgb[2];rgba[o+3]=255}
   }
  }
 }
 return rgba;
}

// Decodes an 8-bit RGBA PNG written with filter 0 (what encodePng writes).
function decodeRgba(png:Uint8Array){
 const info=readPngInfo(png),idat=readPngChunks(png).filter(c=>c.type==='IDAT');
 const raw=unzlibSync(Uint8Array.from(idat.flatMap(c=>[...c.data])));
 const rgba=new Uint8Array(info.width*info.height*4);
 for(let y=0;y<info.height;y++){expect(raw[y*(info.width*4+1)]).toBe(0);rgba.set(raw.subarray(y*(info.width*4+1)+1,(y+1)*(info.width*4+1)),y*info.width*4)}
 return {info,rgba};
}

describe('preview PNG export',()=>{
 it('a 3000 px wide preview of a real scene: requested size, non-empty, labelled a rendered preview',()=>{
  const scene=buildScene({...caldronFallsProject,title:{...caldronFallsProject.title,text:'Caldron Falls'}},caldronFallsFeatures);
  const job=lakeSceneToJob(scene),layers=stackLayers(job,createDefaultEstimateConfig()),colors=defaultLayerColors(layers);
  const meshes=layers.map((l,i)=>({mesh:buildLayerMesh({id:l.id,outlinePaths:l.outlinePaths,widthMm:job.widthMm,heightMm:job.heightMm,thicknessMm:l.thicknessMm}),y:explodedY(l,0),color:colors[i]}));
  const size=exportSize(3000,'4:3');
  expect(size).toEqual({width:3000,height:2250});
  const rgba=rasterizeTopView(meshes,job.widthMm,job.heightMm,size.width,size.height);
  const png=finalizePreviewPng(encodePng(rgba,size.width,size.height),size,meta);
  const {info,rgba:decoded}=decodeRgba(png);
  expect([info.width,info.height]).toEqual([3000,2250]);
  let opaque=0,wood=0;
  for(let i=3;i<decoded.length;i+=4)if(decoded[i]===255){opaque++;if(decoded[i-3]===0xc9&&decoded[i-2]===0xa4)wood++}
  // The board fills 90% of the shorter side: most of the frame is drawn, and the top is wood.
  expect(opaque/(3000*2250)).toBeGreaterThan(.5);
  expect(wood).toBeGreaterThan(0);
  expect(info.text.Disclaimer).toBe(RENDER_NOTICE);
  expect(info.text.Description).toMatch(/Rendered 3D preview .* not a photograph of a finished piece/);
  expect(info.text.Comment).toBe('Jane Doe · Caldron Falls · 14 x 11 in');
 },60000);

 it('refuses an image that is not the size asked for',()=>{
  const png=encodePng(new Uint8Array(4*4*4),4,4);
  expect(()=>finalizePreviewPng(png,{width:3000,height:2250},meta)).toThrow(/produced 4 x 4 px instead of 3000 x 2250/);
 });

 it('metadata goes in valid tEXt chunks right after IHDR, before the pixels',()=>{
  const png=insertPngText(encodePng(new Uint8Array(2*2*4).fill(200),2,2),previewPngText({...meta,watermarked:false}));
  const chunks=readPngChunks(png);// verifies every CRC
  expect(chunks[0].type).toBe('IHDR');
  expect(chunks.slice(1,chunks.findIndex(c=>c.type==='IDAT')).every(c=>c.type==='tEXt')).toBe(true);
  expect(readPngInfo(png).text.Watermark).toBeUndefined();
  expect(readPngInfo(png).text.Software).toBe('Layered Map Studio 0.1.0');
 });

 it('export sizes are at least 3000 px wide in every shape',()=>{
  for(const aspect of ['4:3','1:1','3:2','16:9'] as const)expect(exportSize(3000,aspect).width).toBe(3000);
  expect(exportSize(4000,'16:9')).toEqual({width:4000,height:2250});
 });

 it('the watermark always says it is a rendered preview, whatever text is typed',()=>{
  expect(watermarkText({enabled:true,text:'',customer:'',lake:'',size:''})).toEqual({headline:'PROOF',caption:[RENDER_NOTICE]});
  expect(watermarkText({enabled:true,text:'SAMPLE',customer:'Jane',lake:'Mary Lake',size:'11 x 14 in'}).caption).toEqual([RENDER_NOTICE,'Jane · Mary Lake · 11 x 14 in']);
 });
});
