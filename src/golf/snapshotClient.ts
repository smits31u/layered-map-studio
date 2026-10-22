import type {GolfOsmType,GolfSnapshot} from '../server/golf/types';

// The browser's side of /api/golf/snapshot. The server does all the talking to Overpass; this asks
// for one course and says why it could not get it in words the page can show as they are.

export const GOLF_SNAPSHOT_ENDPOINT='/api/golf/snapshot';

export class GolfSnapshotFetchError extends Error{
 constructor(message:string,readonly code:string,readonly status:number){super(message);this.name='GolfSnapshotFetchError'}
}

export async function fetchGolfSnapshot(osmType:GolfOsmType,osmId:number,{refresh=false,signal,fetchImpl=(...args:Parameters<typeof fetch>)=>fetch(...args)}:{refresh?:boolean;signal?:AbortSignal;fetchImpl?:typeof fetch}={}):Promise<{snapshot:GolfSnapshot;cached:boolean}>{
 let response:Response;
 try{response=await fetchImpl(`${GOLF_SNAPSHOT_ENDPOINT}/${osmType}/${osmId}${refresh?'?refresh=1':''}`,{signal,headers:{Accept:'application/json'}})}
 catch(error){
  if((error as Error).name==='AbortError')throw error;
  throw new GolfSnapshotFetchError('The course service on this machine could not be reached. Is the app running through its own server?','unreachable',0);
 }
 const body=await response.json().catch(()=>undefined) as {snapshot?:GolfSnapshot;cached?:boolean;error?:string;code?:string}|undefined;
 if(!response.ok||!body?.snapshot)throw new GolfSnapshotFetchError(body?.error??`The course service returned HTTP ${response.status}.`,body?.code??'failed',response.status);
 return {snapshot:body.snapshot,cached:Boolean(body.cached)};
}

// "https://www.openstreetmap.org/way/29060461", "way/29060461", "w29060461", "relation 123" → a ref.
export function parseOsmRef(text:string):{osmType:GolfOsmType;osmId:number}|undefined{
 const t=text.trim();
 const long=/\b(way|relation)[/\s:#]+(\d{1,12})\b/i.exec(t);
 const short=/^([wr])(\d{1,12})$/i.exec(t);
 const type=long?long[1].toLowerCase():short?(short[1].toLowerCase()==='w'?'way':'relation'):undefined;
 const id=Number(long?long[2]:short?.[2]);
 return type&&Number.isSafeInteger(id)&&id>0?{osmType:type as GolfOsmType,osmId:id}:undefined;
}
