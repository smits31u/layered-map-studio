import {unzlibSync} from 'fflate';

// A small, pure PNG decoder for Terrarium elevation tiles.
//
// Why not the browser's image decoder: in a Terrarium tile the RGB values *are* the elevation, and a
// canvas decode is allowed to colour-manage them (gAMA/iCCP/sRGB chunks, display colour space) and
// may premultiply alpha. Either would silently shift every elevation. Decoding the bytes ourselves
// is exact, identical in every browser, runs inside a worker without OffscreenCanvas, and is the same
// code the tests exercise. zlib inflate comes from fflate, which the app already depends on.
//
// Supports what elevation tiles use: 8-bit, non-interlaced, greyscale/RGB/palette/grey+alpha/RGBA.
// Anything else is refused with a reason rather than decoded wrongly.

export class PngError extends Error{
 constructor(message:string){super(message);this.name='PngError'}
}

export interface DecodedImage{width:number;height:number;rgba:Uint8Array}

const SIGNATURE=[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a];
const CHANNELS:Record<number,number>={0:1,2:3,3:1,4:2,6:4};

const u32=(b:Uint8Array,o:number)=>((b[o]<<24)>>>0)+(b[o+1]<<16)+(b[o+2]<<8)+b[o+3];

export function decodePng(bytes:Uint8Array):DecodedImage{
 if(bytes.length<SIGNATURE.length||!SIGNATURE.every((v,i)=>bytes[i]===v))throw new PngError('Not a PNG (bad signature).');
 let offset=8,width=0,height=0,bitDepth=0,colorType=-1,interlace=0,palette:Uint8Array|undefined;
 const idat:Uint8Array[]=[];
 let sawEnd=false;
 while(offset+12<=bytes.length){
  const length=u32(bytes,offset),type=String.fromCharCode(bytes[offset+4],bytes[offset+5],bytes[offset+6],bytes[offset+7]);
  const start=offset+8,end=start+length;
  if(end+4>bytes.length)throw new PngError(`Truncated PNG (${type} chunk runs past the end).`);
  const data=bytes.subarray(start,end);
  if(type==='IHDR'){
   width=u32(data,0);height=u32(data,4);bitDepth=data[8];colorType=data[9];interlace=data[12];
  }else if(type==='PLTE')palette=data;
  else if(type==='IDAT')idat.push(data);
  else if(type==='IEND'){sawEnd=true;break}
  offset=end+4;
 }
 if(!width||!height)throw new PngError('PNG has no IHDR header.');
 if(!sawEnd)throw new PngError('Truncated PNG (no IEND).');
 if(bitDepth!==8)throw new PngError(`Unsupported PNG bit depth ${bitDepth} (elevation tiles are 8-bit).`);
 if(interlace!==0)throw new PngError('Interlaced PNGs are not supported.');
 const channels=CHANNELS[colorType];
 if(!channels)throw new PngError(`Unsupported PNG colour type ${colorType}.`);
 if(colorType===3&&!palette)throw new PngError('Palette PNG without a palette.');

 const compressed=new Uint8Array(idat.reduce((sum,chunk)=>sum+chunk.length,0));
 let at=0;for(const chunk of idat){compressed.set(chunk,at);at+=chunk.length}
 let raw:Uint8Array;
 try{raw=unzlibSync(compressed)}catch(error){throw new PngError(`PNG image data does not inflate: ${(error as Error).message}`)}
 const stride=width*channels;
 if(raw.length<(stride+1)*height)throw new PngError('PNG image data is shorter than its dimensions.');

 // Undo the per-scanline filters (PNG spec §9), in place into `pixels`.
 const pixels=new Uint8Array(stride*height);
 for(let y=0;y<height;y++){
  const filter=raw[y*(stride+1)],src=y*(stride+1)+1,dst=y*stride,up=dst-stride;
  for(let i=0;i<stride;i++){
   const x=raw[src+i];
   const a=i>=channels?pixels[dst+i-channels]:0,b=y>0?pixels[up+i]:0,c=y>0&&i>=channels?pixels[up+i-channels]:0;
   let value:number;
   switch(filter){
    case 0:value=x;break;
    case 1:value=x+a;break;
    case 2:value=x+b;break;
    case 3:value=x+((a+b)>>1);break;
    case 4:{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);value=x+(pa<=pb&&pa<=pc?a:pb<=pc?b:c);break}
    default:throw new PngError(`Unknown PNG filter type ${filter} on row ${y}.`);
   }
   pixels[dst+i]=value&255;
  }
 }

 const rgba=new Uint8Array(width*height*4);
 for(let p=0;p<width*height;p++){
  const s=p*channels,d=p*4;
  switch(colorType){
   case 0:rgba[d]=rgba[d+1]=rgba[d+2]=pixels[s];rgba[d+3]=255;break;
   case 2:rgba[d]=pixels[s];rgba[d+1]=pixels[s+1];rgba[d+2]=pixels[s+2];rgba[d+3]=255;break;
   case 3:{const k=pixels[s]*3;if(k+2>=palette!.length)throw new PngError('Palette index out of range.');rgba[d]=palette![k];rgba[d+1]=palette![k+1];rgba[d+2]=palette![k+2];rgba[d+3]=255;break}
   case 4:rgba[d]=rgba[d+1]=rgba[d+2]=pixels[s];rgba[d+3]=pixels[s+1];break;
   case 6:rgba[d]=pixels[s];rgba[d+1]=pixels[s+1];rgba[d+2]=pixels[s+2];rgba[d+3]=pixels[s+3];break;
  }
 }
 return {width,height,rgba};
}
