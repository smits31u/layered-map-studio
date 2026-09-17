// Handing two files to the browser.
//
// Separated from `exportOrnament.ts` so that everything which decides *what* is in the files is pure
// and testable, and the only part that touches the DOM is this. The split matters because the
// interesting failure modes — a blocked preflight, a mis-measured neck, a piece laid out on top of
// another — all live on the pure side, where a test can reach them without a browser.

export interface DownloadFile{name:string;content:string;type:string}

export const SVG_MIME='image/svg+xml';
// Not application/json: some browsers offer to open a .json rather than save it, and this is a file
// the user is meant to keep next to the SVG.
export const PROJECT_MIME='application/octet-stream';

type Anchor={href:string;download:string;rel:string;click():void};

export interface DownloadHost{
 createObjectURL(blob:Blob):string;
 revokeObjectURL(url:string):void;
 createAnchor():Anchor;
}

const browserHost=():DownloadHost|undefined=>{
 if(typeof document==='undefined'||typeof URL==='undefined'||typeof URL.createObjectURL!=='function')return undefined;
 return {
  createObjectURL:blob=>URL.createObjectURL(blob),
  revokeObjectURL:url=>URL.revokeObjectURL(url),
  createAnchor:()=>document.createElement('a'),
 };
};

// `host` is optional-with-a-default for the browser, and explicitly nullable so a caller (or a test)
// can say "there is no host" rather than falling back to one.
export function downloadFiles(files:DownloadFile[],host:DownloadHost|null|undefined=browserHost()):boolean{
 if(!host||!files.length)return false;
 for(const file of files){
  const url=host.createObjectURL(new Blob([file.content],{type:file.type}));
  try{
   const anchor=host.createAnchor();
   anchor.href=url;
   anchor.download=file.name;
   anchor.rel='noopener';
   anchor.click();
  }finally{
   // Revoked on the next turn of the event loop rather than immediately: a synchronous revoke can
   // race the browser's own read of the blob and produce a zero-byte download.
   const revoke=()=>host.revokeObjectURL(url);
   if(typeof setTimeout==='function')setTimeout(revoke,0);else revoke();
  }
 }
 return true;
}
