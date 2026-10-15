// Hands a file to the browser as a download. Same mechanism as the lake tool's SVG export.
export function downloadFile(name:string,data:string|Uint8Array|Blob,type:string){
 const blob=data instanceof Blob?data:new Blob([data as BlobPart],{type});
 const a=document.createElement('a');
 a.href=URL.createObjectURL(blob);
 a.download=name;
 a.click();
 setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

// A filesystem-safe slug for file names built from user text (lake names, customer names).
export const fileSlug=(text:string,fallback:string)=>text.normalize('NFKD').replace(/[^\w\s-]/g,'').trim().replace(/[\s_]+/g,'-').toLowerCase().slice(0,60)||fallback;
