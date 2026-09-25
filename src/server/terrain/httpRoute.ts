import type {TerrainTileHandler} from './handler';
import {parseTilePath} from './tilePath';

// The terrain route's HTTP edge, shared by the production server and the Vite dev plugin like the
// geocode route is. It is a separate route type because it answers with bytes: the geocode route's
// response shape writes strings only, and it is left exactly as it was (ADR 0004).

export interface TerrainRequestLike{url?:string;originalUrl?:string;method?:string}
export interface BinaryResponseLike{statusCode:number;setHeader(name:string,value:string):void;end(body?:Uint8Array|string):void}

const json=(response:BinaryResponseLike,status:number,body:{error:string;code:string},head=false)=>{
 response.statusCode=status;
 response.setHeader('Content-Type','application/json; charset=utf-8');
 response.setHeader('Cache-Control','no-store');
 response.end(head?undefined:JSON.stringify(body));
};

export async function serveTerrainTile(request:TerrainRequestLike,response:BinaryResponseLike,handler:TerrainTileHandler):Promise<void>{
 const head=request.method==='HEAD';
 if(request.method&&request.method!=='GET'&&!head){
  response.setHeader('Allow','GET, HEAD');
  json(response,405,{error:'The terrain proxy only answers GET.',code:'method-not-allowed'});
  return;
 }
 // Connect-style dev middleware mounted at a path strips it from `url` and keeps the full path in
 // `originalUrl`; the production server passes the full path as `url`.
 const pathname=new URL(request.originalUrl??request.url??'/','http://localhost').pathname;
 const tile=parseTilePath(pathname);
 if(!tile){json(response,400,{error:'Expected /api/terrain/<z>/<x>/<y>.png with integer z 0–15 and x, y inside that zoom level.',code:'invalid-tile'},head);return}
 const outcome=await handler(tile);
 if(outcome.status!==200){json(response,outcome.status,{error:outcome.error,code:outcome.code},head);return}
 response.statusCode=200;
 response.setHeader('Content-Type','image/png');
 // Unlike geocoding results, tiles are public and immutable, so the browser may keep them too.
 response.setHeader('Cache-Control','public, max-age=604800, immutable');
 response.setHeader('X-Terrain-Cache',outcome.cache);
 response.end(head?undefined:outcome.body);
}
