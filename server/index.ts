import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {extname,join,normalize,resolve,sep} from 'node:path';
import {createGeocodeHandler} from '../src/server/geocode/handler';
import {GEOCODE_PATH,serveGeocode} from '../src/server/geocode/httpRoute';

// Production entry point.
//
// Before Phase 2 the built app was static files behind nginx, which cannot answer `/api/geocode`.
// The plan requires the geocoder to be proxied ("Use /api/geocode?q=... on localhost"), so the
// deployed container now runs this instead: one Node process serving the same built `dist/` plus
// the proxy route. That is the smallest arrangement that works — an nginx-plus-Node-sidecar split
// would mean two images and a proxy_pass for one endpoint on a tool that runs on a workbench.
//
// The served surface is deliberately tiny: static files, the geocode route, and the `/health`
// endpoint the container healthcheck already used.

const PORT=Number(process.env.PORT??8080);
const HOST=process.env.HOST??'0.0.0.0';
const ROOT=resolve(process.env.STATIC_ROOT??'dist');

const TYPES:Record<string,string>={
 '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
 '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml',
 '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.ico':'image/x-icon',
 '.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.otf':'font/otf','.map':'application/json; charset=utf-8',
};

// Resolves a request path inside ROOT, or returns undefined if it escapes — `normalize` collapses
// `..` before the prefix check, so an encoded traversal cannot reach outside the build output.
function safePath(pathname:string):string|undefined{
 const decoded=decodeURIComponent(pathname);
 const candidate=resolve(join(ROOT,normalize(decoded)));
 return candidate===ROOT||candidate.startsWith(ROOT+sep)?candidate:undefined;
}

const geocode=createGeocodeHandler();

const server=createServer(async(request,response)=>{
 try{
  const url=new URL(request.url??'/','http://localhost');
  if(url.pathname===GEOCODE_PATH){await serveGeocode(request,response,geocode);return}
  if(url.pathname==='/health'){response.statusCode=200;response.setHeader('Content-Type','text/plain; charset=utf-8');response.end('ok');return}
  if(request.method!=='GET'&&request.method!=='HEAD'){response.statusCode=405;response.setHeader('Allow','GET, HEAD');response.end();return}

  const direct=safePath(url.pathname==='/'?'/index.html':url.pathname);
  // Anything that is not a real file falls back to index.html so client-side routing keeps working,
  // which is what the nginx `try_files ... /index.html` rule did.
  const file=direct&&await isFile(direct)?direct:join(ROOT,'index.html');
  const type=TYPES[extname(file).toLowerCase()]??'application/octet-stream';
  response.statusCode=200;
  response.setHeader('Content-Type',type);
  if(request.method==='HEAD'){response.end();return}
  createReadStream(file).on('error',()=>{response.statusCode=404;response.end('Not found')}).pipe(response);
 }catch(error){
  response.statusCode=500;
  response.setHeader('Content-Type','text/plain; charset=utf-8');
  response.end(`Server error: ${(error as Error).message}`);
 }
});

async function isFile(path:string):Promise<boolean>{
 try{return (await stat(path)).isFile()}catch{return false}
}

server.listen(PORT,HOST,()=>{
 if(!process.env.GEOCODER_CONTACT)console.warn('GEOCODER_CONTACT is not set. Nominatim requires a contactable identifier in the User-Agent; set it before using the public instance.');
 console.log(`Layered Map Studio listening on http://${HOST}:${PORT} (static root ${ROOT})`);
});
