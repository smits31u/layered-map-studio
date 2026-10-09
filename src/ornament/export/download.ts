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
 // Runs `run` after `ms`. Injected so tests can drive the stagger without real timers.
 schedule?(run:()=>void,ms:number):void;
}

// Gap between successive downloads from one export.
//
// Clicking two download anchors in the same task does not give two downloads in Chromium or Safari:
// each click starts a navigation-like download, and the second cancels the first. Users got only the
// last file, which is the project .json, from a button labelled "Export SVG". Each file after the
// first therefore goes out in its own task, far enough apart that the earlier download has started.
export const DOWNLOAD_STAGGER_MS=500;

// How long a blob URL outlives its click. Revoking on the next tick (as this used to) can race the
// browser's read of the blob and produce an empty or failed download. 40s is the delay FileSaver.js
// uses, and the cost is one export's worth of memory held for that long.
export const BLOB_REVOKE_DELAY_MS=40_000;

const browserHost=():DownloadHost|undefined=>{
 if(typeof document==='undefined'||typeof URL==='undefined'||typeof URL.createObjectURL!=='function')return undefined;
 return {
  createObjectURL:blob=>URL.createObjectURL(blob),
  revokeObjectURL:url=>URL.revokeObjectURL(url),
  createAnchor:()=>document.createElement('a'),
  schedule:(run,ms)=>{setTimeout(run,ms)},
 };
};

function downloadOne(file:DownloadFile,host:DownloadHost,schedule:(run:()=>void,ms:number)=>void):void{
 const url=host.createObjectURL(new Blob([file.content],{type:file.type}));
 try{
  const anchor=host.createAnchor();
  anchor.href=url;
  anchor.download=file.name;
  anchor.rel='noopener';
  anchor.click();
 }finally{
  schedule(()=>host.revokeObjectURL(url),BLOB_REVOKE_DELAY_MS);
 }
}

// `host` is optional-with-a-default for the browser, and explicitly nullable so a caller (or a test)
// can say "there is no host" rather than falling back to one.
//
// The first file is clicked synchronously, inside the user's click, so it can never be lost to a
// popup or multiple-download policy. Callers put the file that matters first: the SVG. Later files
// follow at DOWNLOAD_STAGGER_MS intervals. A browser that asks "allow multiple downloads?" may hold
// those back, but it can no longer drop the SVG in their favour.
export function downloadFiles(files:DownloadFile[],host:DownloadHost|null|undefined=browserHost()):boolean{
 if(!host||!files.length)return false;
 const schedule=host.schedule?.bind(host)??((run:()=>void,ms:number)=>{if(typeof setTimeout==='function')setTimeout(run,ms);else run()});
 const [first,...rest]=files;
 downloadOne(first,host,schedule);
 rest.forEach((file,index)=>schedule(()=>downloadOne(file,host,schedule),DOWNLOAD_STAGGER_MS*(index+1)));
 return true;
}
