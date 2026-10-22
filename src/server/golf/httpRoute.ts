import type {GolfSnapshotHandler} from './handler';
import type {GolfOsmType} from './types';

// The golf route's HTTP edge, shared by the production server and the Vite dev plugin like the
// geocode and terrain routes. The OSM type and id are parsed with a digits-only pattern before
// anything else sees them; nothing else from the request reaches Overpass or the cache.

export interface GolfRequestLike{url?:string;originalUrl?:string;method?:string}
export interface GolfResponseLike{statusCode:number;setHeader(name:string,value:string):void;end(body?:string):void}

export const GOLF_PATH_PREFIX='/api/golf/';
const SNAPSHOT_PATH=/^\/api\/golf\/snapshot\/(way|relation)\/(\d{1,12})$/;

const json=(response:GolfResponseLike,status:number,body:unknown)=>{
 response.statusCode=status;
 response.setHeader('Content-Type','application/json; charset=utf-8');
 response.setHeader('Cache-Control','no-store');
 response.end(JSON.stringify(body));
};

export function parseSnapshotPath(pathname:string):{osmType:GolfOsmType;osmId:number}|undefined{
 const match=SNAPSHOT_PATH.exec(pathname);
 if(!match)return undefined;
 const osmId=Number(match[2]);
 return Number.isSafeInteger(osmId)&&osmId>0?{osmType:match[1] as GolfOsmType,osmId}:undefined;
}

export async function serveGolf(request:GolfRequestLike,response:GolfResponseLike,handler:GolfSnapshotHandler):Promise<void>{
 if(request.method&&request.method!=='GET'){
  response.setHeader('Allow','GET');
  json(response,405,{error:'The golf route only answers GET.',code:'method-not-allowed'});
  return;
 }
 // Connect-style dev middleware mounted at a path strips it from `url` and keeps it in `originalUrl`.
 const url=new URL(request.originalUrl??request.url??'/','http://localhost');
 const target=parseSnapshotPath(url.pathname);
 if(!target){json(response,404,{error:'Expected /api/golf/snapshot/way/<id> or /api/golf/snapshot/relation/<id>.',code:'invalid-request'});return}
 const outcome=await handler({...target,refresh:url.searchParams.get('refresh')==='1'});
 json(response,outcome.status,outcome.body);
}
