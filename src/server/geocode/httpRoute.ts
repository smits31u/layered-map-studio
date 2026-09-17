import type {GeocodeHandler} from './handler';

// The only Node-HTTP-shaped thing in the geocode module: turning a request into handler arguments
// and a handler outcome into a response. It is written against the narrowest possible request and
// response shapes so both mounts — the Vite dev middleware and the production server — share one
// implementation, and so it can be unit tested without a socket.

export interface HttpRequestLike{url?:string;method?:string}
export interface HttpResponseLike{statusCode:number;setHeader(name:string,value:string):void;end(body?:string):void}

export const GEOCODE_PATH='/api/geocode';

export async function serveGeocode(request:HttpRequestLike,response:HttpResponseLike,handler:GeocodeHandler):Promise<void>{
 if(request.method&&request.method!=='GET'&&request.method!=='HEAD'){
  response.statusCode=405;
  response.setHeader('Allow','GET, HEAD');
  response.setHeader('Content-Type','application/json; charset=utf-8');
  response.end(JSON.stringify({error:'The geocoding proxy only answers GET.',code:'method-not-allowed'}));
  return;
 }
 // A base is required to parse a server-side request URL, which is path-only. It is discarded.
 const url=new URL(request.url??GEOCODE_PATH,'http://localhost');
 const outcome=await handler({q:url.searchParams.get('q'),provider:url.searchParams.get('provider')});
 response.statusCode=outcome.status;
 response.setHeader('Content-Type','application/json; charset=utf-8');
 // The proxy already caches server-side, where the entry is shared and expires on a schedule the
 // operator controls. Telling the browser to cache as well would put copies of what someone
 // searched for in their disk cache, which the plan's privacy rule specifically avoids.
 response.setHeader('Cache-Control','no-store');
 response.end(request.method==='HEAD'?undefined:JSON.stringify(outcome.body));
}
