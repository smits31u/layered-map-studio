import {insertPngText,readPngInfo} from './png';

// What an exported preview image says about itself. Honesty rule: every exported image is labelled
// a rendered preview in its PNG metadata, and the watermark, when on, always carries the same words.
// It is a design render of the cut files, not a photograph of a finished piece.

export const RENDER_NOTICE='RENDERED PREVIEW - design render, not a photo of the finished piece';

export const EXPORT_WIDTHS=[3000,4000,6000] as const;
// V2 spec, A6: a proof or listing image is at least 2000 px on its long side. Every width and shape
// offered clears it; finalizePreviewPng refuses anything that does not.
export const MIN_PROOF_LONG_SIDE=2000;
// The proof background: an opaque light neutral grey, so a proof reads the same on any page and a
// listing photo has no transparency for a marketplace to fill with black.
export const PROOF_BACKGROUND='#ecebe8';
export const EXPORT_ASPECTS=[{id:'4:3',value:4/3},{id:'1:1',value:1},{id:'3:2',value:3/2},{id:'16:9',value:16/9}] as const;
export type ExportAspect=typeof EXPORT_ASPECTS[number]['id'];

export type WatermarkOptions={enabled:boolean;text:string;customer:string;lake:string;size:string};

export const exportSize=(width:number,aspect:ExportAspect)=>{const a=EXPORT_ASPECTS.find(x=>x.id===aspect)?.value??4/3;return{width:Math.round(width),height:Math.round(width/a)}};

// The watermark's text: the big diagonal word and the caption lines under it. The render notice is
// always the first caption line; it cannot be edited away.
export function watermarkText(w:WatermarkOptions):{headline:string;caption:string[]}{
 const details=[w.customer,w.lake,w.size].map(s=>s.trim()).filter(Boolean).join(' · ');
 return {headline:w.text.trim()||'PROOF',caption:[RENDER_NOTICE,...(details?[details]:[])]};
}

export type PreviewMeta={title:string;customer?:string;lake?:string;size?:string;appVersion:string;createdAt:string;watermarked:boolean};

export function previewPngText(meta:PreviewMeta):Record<string,string>{
 const details=[meta.customer,meta.lake,meta.size].map(s=>s?.trim()).filter(Boolean).join(' · ');
 return {
  Title:meta.title,
  Description:'Rendered 3D preview of a layered map design, built from the cut-file geometry. Design render, not a photograph of a finished piece.',
  Disclaimer:RENDER_NOTICE,
  Software:`Layered Map Studio ${meta.appVersion}`,
  'Creation Time':meta.createdAt,
  ...(details?{Comment:details}:{}),
  ...(meta.watermarked?{Watermark:'PROOF watermark applied'}:{}),
 };
}

// Adds the metadata to the browser-encoded PNG and checks it is the size that was asked for.
export function finalizePreviewPng(png:Uint8Array,expected:{width:number;height:number},meta:PreviewMeta):Uint8Array{
 const info=readPngInfo(png);
 if(Math.max(expected.width,expected.height)<MIN_PROOF_LONG_SIDE)throw new Error(`A preview image must be at least ${MIN_PROOF_LONG_SIDE} px on its long side; ${expected.width} x ${expected.height} px was asked for.`);
 if(info.width!==expected.width||info.height!==expected.height)throw new Error(`The renderer produced ${info.width} x ${info.height} px instead of ${expected.width} x ${expected.height}. The browser may not support images this large; try a smaller width.`);
 return insertPngText(png,previewPngText(meta));
}
