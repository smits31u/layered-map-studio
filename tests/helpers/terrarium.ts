import {createHash} from 'node:crypto';
import {zlibSync} from 'fflate';
import type {MultiPolygonMm} from '../../src/geometry/shoreline/polygonEngine';
import type {FrozenTerrainView} from '../../src/topo/terrain/pipeline';
import {TERRARIUM_TILE_SIZE,mercatorX,mercatorY,planTerrainTiles,tileKey} from '../../src/topo/terrain/tiles';

// Test-side PNG and Terrarium tile construction, so decode and pipeline tests run on exactly known
// elevations with no network. The encoder is written independently of src/topo/terrain/png.ts —
// forward filters here, inverse filters there — and the real-tile test checks the decoder against
// PIL, so a shared misreading of the spec would not pass both.

const CRC_TABLE=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
const crc32=(bytes:Uint8Array)=>{let c=0xffffffff;for(const b of bytes)c=CRC_TABLE[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0};

function chunk(type:string,data:Uint8Array):Uint8Array{
 const out=new Uint8Array(12+data.length),view=new DataView(out.buffer);
 view.setUint32(0,data.length);
 for(let i=0;i<4;i++)out[4+i]=type.charCodeAt(i);
 out.set(data,8);
 view.setUint32(8+data.length,crc32(out.subarray(4,8+data.length)));
 return out;
}

const paeth=(a:number,b:number,c:number)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c};

// `pixels` holds `channels` bytes per pixel for the colour type. `filter` is one filter type for
// every row, or a function choosing one per row.
export function encodePng(width:number,height:number,pixels:Uint8Array,options:{colorType?:0|2|3|4|6;filter?:number|((row:number)=>number);palette?:Uint8Array;bitDepth?:number;interlace?:number}={}):Uint8Array{
 const colorType=options.colorType??2,channels={0:1,2:3,3:1,4:2,6:4}[colorType],stride=width*channels;
 const raw=new Uint8Array((stride+1)*height);
 for(let y=0;y<height;y++){
  const filter=typeof options.filter==='function'?options.filter(y):options.filter??0;
  raw[y*(stride+1)]=filter;
  for(let i=0;i<stride;i++){
   const x=pixels[y*stride+i],a=i>=channels?pixels[y*stride+i-channels]:0,b=y>0?pixels[(y-1)*stride+i]:0,c=y>0&&i>=channels?pixels[(y-1)*stride+i-channels]:0;
   const predicted=[0,a,b,(a+b)>>1,paeth(a,b,c)][filter];
   raw[y*(stride+1)+1+i]=(x-predicted)&255;
  }
 }
 const ihdr=new Uint8Array(13),v=new DataView(ihdr.buffer);
 v.setUint32(0,width);v.setUint32(4,height);ihdr[8]=options.bitDepth??8;ihdr[9]=colorType;ihdr[12]=options.interlace??0;
 const parts=[Uint8Array.of(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a),chunk('IHDR',ihdr)];
 if(options.palette)parts.push(chunk('PLTE',options.palette));
 parts.push(chunk('IDAT',zlibSync(raw)),chunk('IEND',new Uint8Array()));
 const out=new Uint8Array(parts.reduce((s,p)=>s+p.length,0));
 let at=0;for(const p of parts){out.set(p,at);at+=p.length}
 return out;
}

// Terrarium encoding of an elevation: the inverse of R·256 + G + B/256 − 32768, exact for any value
// on the 1/256 m grid.
export function terrariumRgb(elevationM:number):[number,number,number]{
 const v=elevationM+32768,whole=Math.floor(v);
 return [Math.floor(whole/256),whole%256,Math.floor((v-whole)*256)];
}

export function terrariumTile(elevationAt:(px:number,py:number)=>number,filter:number|((row:number)=>number)=0):Uint8Array{
 const size=TERRARIUM_TILE_SIZE,rgb=new Uint8Array(size*size*3);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++)rgb.set(terrariumRgb(elevationAt(x,y)),(y*size+x)*3);
 return encodePng(size,size,rgb,{filter});
}

// Every tile a view needs, with elevations from a function of board-relative position: u and v are
// 0 at the board's west/north edge and 1 at its east/south edge (outside [0,1] in the padding ring).
// Elevations are rounded to the 1/256 m Terrarium grid so the encoding is exact.
export function tilesForView(view:FrozenTerrainView,elevation:(u:number,v:number)=>number):Record<string,Uint8Array>{
 const plan=planTerrainTiles(view.bounds,view.zoom),scale=TERRARIUM_TILE_SIZE*2**plan.z;
 const mx0=mercatorX(view.bounds.west),mx1=mercatorX(view.bounds.east),my0=mercatorY(view.bounds.north),my1=mercatorY(view.bounds.south);
 const tiles:Record<string,Uint8Array>={};
 for(const tile of plan.tiles){
  tiles[tileKey(tile)]=terrariumTile((px,py)=>{
   const mx=((plan.x0+tile.column)*TERRARIUM_TILE_SIZE+px+.5)/scale,my=((plan.y0+tile.row)*TERRARIUM_TILE_SIZE+py+.5)/scale;
   return Math.round(elevation((mx-mx0)/(mx1-mx0),(my-my0)/(my1-my0))*256)/256;
  },tile.row%5);
 }
 return tiles;
}


// A digest of every coordinate and threshold in a result, as the lake tool's fingerprint tests do.
export function geometryFingerprint(parts:{numbers:number[]}):string{
 return createHash('sha256').update(new Uint8Array(new Float64Array(parts.numbers).buffer)).digest('hex');
}
export const flattenGeometry=(geometry:MultiPolygonMm,into:number[])=>{for(const polygon of geometry)for(const ring of polygon)for(const [x,y] of ring)into.push(x,y);into.push(1e300);return into};
