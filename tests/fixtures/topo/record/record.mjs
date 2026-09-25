// Records a topo fixture: node tests/fixtures/topo/record/record.mjs <sf-coast|sf-city> [devServerUrl]
//
// Needs the Vite dev server running (npm run dev, default http://127.0.0.1:5173) and a headless
// Chromium: CHROME=/path/to/chrome, or Playwright's cached headless shell. Talks to it over the
// DevTools protocol with Node's built-in WebSocket (Node 22+), so it adds no dependency.
// Network: the basemap (tiles.openfreemap.org), MapLibre (unpkg.com) and, through the dev server's
// /api/terrain proxy, AWS Terrain Tiles. Never run by the test suite.
import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';

const FIXTURES={
 // The Golden Gate at map zoom 12: the centre of terrain tile 12/654/1582, so a 400 px frame needs
 // exactly the 3×3 tile plan.
 'sf-coast':{description:'San Francisco coast: Golden Gate strait and bridge, Marin Headlands, Presidio',center:[654.5/4096*360-180,Math.atan(Math.sinh(Math.PI*(1-2*1582.5/4096)))*180/Math.PI],zoom:12,withTiles:true},
 // Downtown at the plan's default zoom 14, on the corner of vector tiles 14/2620–2621/6331–6332, so
 // the capture spans four tiles.
 'sf-city':{description:'San Francisco downtown: Union Square, Nob Hill, Chinatown, SoMa',center:[2621/16384*360-180,Math.atan(Math.sinh(Math.PI*(1-2*6332/16384)))*180/Math.PI],zoom:14,withTiles:false},
};
const name=process.argv[2],server=(process.argv[3]??'http://127.0.0.1:5173').replace(/\/$/,'');
const fixture=FIXTURES[name];
if(!fixture){console.error(`usage: record.mjs <${Object.keys(FIXTURES).join('|')}> [devServerUrl]`);process.exit(2)}
const out=resolve(dirname(fileURLToPath(import.meta.url)),'..',name);

function chromePath(){
 if(process.env.CHROME)return process.env.CHROME;
 const cache=resolve(homedir(),'.cache/ms-playwright');
 for(const dir of existsSync(cache)?readdirSync(cache).filter(d=>d.startsWith('chromium_headless_shell')).sort().reverse():[]){
  for(const sub of readdirSync(resolve(cache,dir))){const bin=resolve(cache,dir,sub,'headless_shell');if(existsSync(bin))return bin}
 }
 throw new Error('No Chromium found: set CHROME, or install Playwright\'s headless shell.');
}

const port=9300+Math.floor(Math.random()*500);
const chrome=spawn(chromePath(),[`--remote-debugging-port=${port}`,'--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
 let target;
 for(let i=0;i<100&&!target;i++){try{target=(await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page')}catch{}if(!target)await sleep(200)}
 if(!target)throw new Error('Chromium did not start.');
 const ws=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
 let nextId=1;const pending=new Map(),waiters=[];
 ws.onmessage=event=>{
  const m=JSON.parse(event.data);
  if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);return}
  if(m.method==='Runtime.exceptionThrown')console.error('page exception:',m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);
  for(const w of [...waiters])if(w.method===m.method){waiters.splice(waiters.indexOf(w),1);w.resolve(m.params)}
 };
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=nextId++;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
 await send('Page.enable');await send('Runtime.enable');
 const loaded=new Promise(resolve=>waiters.push({method:'Page.loadEventFired',resolve}));
 await send('Page.navigate',{url:`${server}/tests/fixtures/topo/record/record.html`});
 await loaded;
 const request={center:fixture.center,zoom:fixture.zoom,frameWidthPx:400,widthMm:228.6,heightMm:228.6,withTiles:fixture.withTiles};
 const evaluated=await send('Runtime.evaluate',{expression:`window.recordFixture(${JSON.stringify(request)})`,awaitPromise:true,returnByValue:true});
 if(evaluated.exceptionDetails)throw new Error(evaluated.exceptionDetails.exception?.description??evaluated.exceptionDetails.text);
 const j=JSON.parse(evaluated.result.value);
 ws.close();

 rmSync(out,{recursive:true,force:true});
 mkdirSync(out,{recursive:true});
 for(const [key,b64] of Object.entries(j.tiles))writeFileSync(resolve(out,`${key.replaceAll('/','-')}.png`),Buffer.from(b64,'base64'));
 const capture=j.result.capture;
 const record={
  description:fixture.description,recordedAt:new Date().toISOString().slice(0,10),maplibre:j.maplibre,styleUrl:j.styleUrl,
  request:{center:capture.view.center,zoom:capture.view.zoom,frameWidthPx:capture.view.frameWidthPx,widthMm:capture.view.widthMm,heightMm:capture.view.heightMm},
  canvas:j.canvas,style:j.style,rendered:j.rendered,
  expected:{counts:capture.features.counts,water:capture.features.water.length,roads:capture.features.roads.length,labels:capture.labels.length,duplicateLabels:capture.duplicateLabels,layers:capture.layers,view:capture.view,warnings:j.result.warnings},
  tiles:Object.keys(j.tiles),
 };
 const gz=gzipSync(JSON.stringify(record),{level:9});
 writeFileSync(resolve(out,'rendered.json.gz'),gz);
 console.log(`${name}: ${capture.features.water.length} water, ${capture.features.roads.length} roads (${capture.features.counts.duplicateRoads} duplicates), ${capture.labels.length} labels, ${Object.keys(j.tiles).length} tiles; rendered.json.gz ${gz.length} bytes`);
}finally{chrome.kill()}
