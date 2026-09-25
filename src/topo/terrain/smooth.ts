// Separable Gaussian smoothing of an elevation grid (plan §Terrain acquisition: "Smooth with a
// separable Gaussian/box filter whose radius is configurable and covered by tests").
//
// Why smooth at all: Terrarium data is quantised to 1/256 m and resampled up from ~256-pixel tiles,
// so the raw field has stair-steps and pixel-scale noise. Contours traced through that come out as
// jagged, fragment-heavy lines that are miserable to cut. A small blur removes structure far below
// what a laser can reproduce while leaving every feature a person would recognise.
//
// Radius is in grid samples. The kernel is a Gaussian truncated at ±radius with σ = radius/2, so the
// truncated tails hold under 5% of the weight, normalised to sum to 1 so flat ground stays exactly
// flat. Edges clamp (the nearest sample is repeated), which does not pull a valley or a peak at the
// board edge towards zero the way zero padding would. Radius 0 returns an unchanged copy.

export const MAX_SMOOTHING_RADIUS=16;

export function gaussianKernel(radius:number):Float64Array{
 const r=Math.round(radius);
 if(!(r>=0))throw new Error(`Smoothing radius must be a non-negative number (got ${radius}).`);
 if(r===0)return Float64Array.of(1);
 const sigma=r/2,kernel=new Float64Array(2*r+1);
 let sum=0;
 for(let i=-r;i<=r;i++){const w=Math.exp(-(i*i)/(2*sigma*sigma));kernel[i+r]=w;sum+=w}
 for(let i=0;i<kernel.length;i++)kernel[i]/=sum;
 return kernel;
}

export function smoothGrid(values:Float32Array,columns:number,rows:number,radius:number):Float32Array{
 if(values.length!==columns*rows)throw new Error('Smoothing: grid size does not match its dimensions.');
 const r=Math.min(MAX_SMOOTHING_RADIUS,Math.round(radius));
 if(!(r>0))return values.slice();
 const kernel=gaussianKernel(r);
 // Horizontal pass into a float64 buffer, vertical pass back to float32: accumulating in float64
 // keeps a symmetric input symmetric to the last bit, which the tests rely on.
 const horizontal=new Float64Array(values.length),out=new Float32Array(values.length);
 for(let y=0;y<rows;y++){
  const base=y*columns;
  for(let x=0;x<columns;x++){
   let sum=0;
   for(let k=-r;k<=r;k++){const xx=x+k<0?0:x+k>=columns?columns-1:x+k;sum+=kernel[k+r]*values[base+xx]}
   horizontal[base+x]=sum;
  }
 }
 for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
  let sum=0;
  for(let k=-r;k<=r;k++){const yy=y+k<0?0:y+k>=rows?rows-1:y+k;sum+=kernel[k+r]*horizontal[yy*columns+x]}
  out[y*columns+x]=sum;
 }
 return out;
}
