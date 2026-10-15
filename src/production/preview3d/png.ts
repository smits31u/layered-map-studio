import {zlibSync} from 'fflate';

// Minimal PNG writing and reading: enough to encode an RGBA image, add the text metadata that marks
// a preview as a render, and read both back to check them. The browser's own encoder
// (canvas.toBlob) makes the image in the app; these functions add the metadata to it, and encode
// directly where there is no canvas (tests, and a fallback).

const SIGNATURE=[137,80,78,71,13,10,26,10];

const CRC_TABLE=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
export function crc32(bytes:Uint8Array,start=0,end=bytes.length):number{
 let c=0xffffffff;
 for(let i=start;i<end;i++)c=CRC_TABLE[(c^bytes[i])&0xff]^(c>>>8);
 return (c^0xffffffff)>>>0;
}

function chunk(type:string,data:Uint8Array):Uint8Array{
 const out=new Uint8Array(12+data.length),view=new DataView(out.buffer);
 view.setUint32(0,data.length);
 for(let i=0;i<4;i++)out[4+i]=type.charCodeAt(i);
 out.set(data,8);
 view.setUint32(8+data.length,crc32(out,4,8+data.length));
 return out;
}

// tEXt is Latin-1; anything outside it is replaced so the chunk stays valid.
const latin1=(s:string)=>Uint8Array.from([...s].map(c=>{const code=c.charCodeAt(0);return code<256?code:0x3f}));

function textChunk(keyword:string,text:string):Uint8Array{
 const k=latin1(keyword.slice(0,79)),t=latin1(text),data=new Uint8Array(k.length+1+t.length);
 data.set(k,0);data[k.length]=0;data.set(t,k.length+1);
 return chunk('tEXt',data);
}

const concat=(parts:Uint8Array[])=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let o=0;for(const p of parts){out.set(p,o);o+=p.length}return out};

// RGBA, rows top to bottom, 8 bits per channel.
export function encodePng(rgba:Uint8Array,width:number,height:number,text:Record<string,string>={}):Uint8Array{
 if(rgba.length!==width*height*4)throw new Error(`Expected ${width*height*4} RGBA bytes, got ${rgba.length}.`);
 const ihdr=new Uint8Array(13),view=new DataView(ihdr.buffer);
 view.setUint32(0,width);view.setUint32(4,height);
 ihdr[8]=8;ihdr[9]=6;ihdr[10]=0;ihdr[11]=0;ihdr[12]=0;
 // Filter type 0 (none) on every row: simple, and the deflate does the real work.
 const raw=new Uint8Array(height*(width*4+1));
 for(let y=0;y<height;y++){raw[y*(width*4+1)]=0;raw.set(rgba.subarray(y*width*4,(y+1)*width*4),y*(width*4+1)+1)}
 return concat([Uint8Array.from(SIGNATURE),chunk('IHDR',ihdr),...Object.entries(text).map(([k,v])=>textChunk(k,v)),chunk('IDAT',zlibSync(raw,{level:6})),chunk('IEND',new Uint8Array(0))]);
}

export type PngChunk={type:string;data:Uint8Array;offset:number;length:number};

export function readPngChunks(png:Uint8Array):PngChunk[]{
 for(let i=0;i<8;i++)if(png[i]!==SIGNATURE[i])throw new Error('Not a PNG file.');
 const view=new DataView(png.buffer,png.byteOffset,png.byteLength),chunks:PngChunk[]=[];
 let o=8;
 while(o+12<=png.length){
  const length=view.getUint32(o),type=String.fromCharCode(...png.subarray(o+4,o+8));
  if(o+12+length>png.length)throw new Error('Truncated PNG chunk.');
  if(crc32(png,o+4,o+8+length)!==view.getUint32(o+8+length))throw new Error(`Bad CRC in PNG ${type} chunk.`);
  chunks.push({type,data:png.subarray(o+8,o+8+length),offset:o,length:12+length});
  o+=12+length;
  if(type==='IEND')break;
 }
 return chunks;
}

export type PngInfo={width:number;height:number;colorType:number;bitDepth:number;text:Record<string,string>};

export function readPngInfo(png:Uint8Array):PngInfo{
 const chunks=readPngChunks(png),ihdr=chunks[0];
 if(!ihdr||ihdr.type!=='IHDR')throw new Error('PNG has no IHDR chunk.');
 const view=new DataView(ihdr.data.buffer,ihdr.data.byteOffset,ihdr.data.byteLength);
 const text:Record<string,string>={};
 for(const c of chunks.filter(c=>c.type==='tEXt')){const zero=c.data.indexOf(0);text[String.fromCharCode(...c.data.subarray(0,zero))]=String.fromCharCode(...c.data.subarray(zero+1))}
 return {width:view.getUint32(0),height:view.getUint32(4),bitDepth:ihdr.data[8],colorType:ihdr.data[9],text};
}

// Adds tEXt chunks right after IHDR (before the image data, where readers look first).
export function insertPngText(png:Uint8Array,text:Record<string,string>):Uint8Array{
 const chunks=readPngChunks(png),ihdr=chunks[0];
 if(!ihdr||ihdr.type!=='IHDR')throw new Error('PNG has no IHDR chunk.');
 const at=ihdr.offset+ihdr.length;
 return concat([png.subarray(0,at),...Object.entries(text).map(([k,v])=>textChunk(k,v)),png.subarray(at)]);
}
