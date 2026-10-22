import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createSerialLock} from '../serialLock';
import {GOLF_QUERY_VERSION,GOLF_SNAPSHOT_SCHEMA,type GolfOsmType,type GolfSnapshot} from './types';

// The course snapshot cache (docs/GOLF_MODULE_PLAN.md §2.3): one JSON file per course on disk,
// keyed `{osmType}-{osmId}-v{queryVersion}`.
//
// The terrain tile cache's pattern (tileCache.ts): a file is written to a temporary name and renamed
// into place, so a reader never sees half a snapshot, and writes go through the same serial lock.
// There is no eviction and no expiry, on purpose: course geometry rarely changes, a snapshot is a
// few hundred KB, and "Refresh from OSM" is the way to replace one. Failures are never written; the
// handler only calls `set` with a snapshot it has just normalized.
//
// The file name is built from a validated type and integer id alone, never from request text.

export interface SnapshotCache{
 get(key:string):Promise<GolfSnapshot|undefined>;
 set(key:string,snapshot:GolfSnapshot):Promise<void>;
}

const KEY=/^(way|relation)-\d{1,12}-v\d{1,4}$/;
export const snapshotKey=(type:GolfOsmType,id:number,version=GOLF_QUERY_VERSION)=>`${type}-${id}-v${version}`;
const checkKey=(key:string)=>{if(!KEY.test(key))throw new Error(`Not a snapshot cache key: ${key}`)};

// A cached file is trusted only as far as its header: a hand-edited or older file that does not say
// it is this schema and this query version is a miss, and the course is fetched again.
const usable=(value:unknown):value is GolfSnapshot=>{
 const s=value as Partial<GolfSnapshot>|undefined;
 return Boolean(s&&s.schema===GOLF_SNAPSHOT_SCHEMA&&s.queryVersion===GOLF_QUERY_VERSION&&Array.isArray(s.boundary)&&Array.isArray(s.areas)&&Array.isArray(s.holes));
};

export function createMemorySnapshotCache():SnapshotCache&{readonly size:number;writes:number}{
 const entries=new Map<string,string>();
 const cache={
  writes:0,
  async get(key:string){checkKey(key);const raw=entries.get(key);return raw?JSON.parse(raw) as GolfSnapshot:undefined},
  async set(key:string,snapshot:GolfSnapshot){checkKey(key);entries.set(key,JSON.stringify(snapshot));cache.writes++},
  get size(){return entries.size},
 };
 return cache;
}

export function createDiskSnapshotCache(directory:string):SnapshotCache{
 const lock=createSerialLock();
 let tempCounter=0;
 return {
  async get(key){
   checkKey(key);
   try{const parsed=JSON.parse(await readFile(join(directory,`${key}.json`),'utf8'));return usable(parsed)?parsed:undefined}
   catch{return undefined}
  },
  async set(key,snapshot){
   checkKey(key);
   const path=join(directory,`${key}.json`),temp=`${path}.${process.pid}.${++tempCounter}.tmp`;
   await lock(async()=>{
    await mkdir(directory,{recursive:true});
    await writeFile(temp,JSON.stringify(snapshot));
    await rename(temp,path);
   });
  },
 };
}
