import {mkdir,readFile,readdir,rename,rm,stat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tileKey,type TileCoord} from './tilePath';

// Tile caches for the terrain proxy.
//
// The plan asks for successful responses to be cached on disk, and ADR 0004 records what that needs
// that nothing before it did: a directory that is writable by the container's non-root user and
// survives a rebuild (a named volume — see docker-compose.yml). Terrain tiles are public, immutable
// data, so unlike the geocoder's cache there is no privacy reason to forget them; the only reason
// to bound the cache is the disk.
//
// Paths are built from a validated TileCoord's integers alone — `<dir>/<z>/<x>/<y>.png` — never from
// request text. Writes go to a temporary file that is renamed into place, so a crash or a concurrent
// reader never sees half a PNG.

export interface TileCache{
 get(tile:TileCoord):Promise<Uint8Array|undefined>;
 set(tile:TileCoord,bytes:Uint8Array):Promise<void>;
}

export function createMemoryTileCache():TileCache&{readonly size:number}{
 const entries=new Map<string,Uint8Array>();
 return {
  async get(tile){return entries.get(tileKey(tile))},
  async set(tile,bytes){entries.set(tileKey(tile),bytes)},
  get size(){return entries.size},
 };
}

export interface DiskTileCacheOptions{
 // Evict oldest-first once the cache exceeds this, down to 90% of it. Default 2 GiB.
 maxBytes?:number;
}

export const DEFAULT_TERRAIN_CACHE_MAX_BYTES=2*1024**3;

export function createDiskTileCache(directory:string,options:DiskTileCacheOptions={}):TileCache{
 const maxBytes=options.maxBytes??DEFAULT_TERRAIN_CACHE_MAX_BYTES;
 const fileOf=({z,x,y}:TileCoord)=>join(directory,String(z),String(x),`${y}.png`);
 // The size index is built lazily on first write rather than at construction, so creating the
 // cache (which happens when the dev config or the server module loads) touches no disk.
 let index:Map<string,{bytes:number;mtimeMs:number}>|undefined;
 let total=0;
 let tempCounter=0;

 const buildIndex=async()=>{
  index=new Map();total=0;
  const walk=async(dir:string):Promise<void>=>{
   let entries;
   try{entries=await readdir(dir,{withFileTypes:true})}catch{return}
   for(const entry of entries){
    const path=join(dir,entry.name);
    if(entry.isDirectory())await walk(path);
    else if(entry.name.endsWith('.png')){try{const s=await stat(path);index!.set(path,{bytes:s.size,mtimeMs:s.mtimeMs});total+=s.size}catch{/* raced with eviction */}}
   }
  };
  await walk(directory);
 };

 const evict=async()=>{
  if(total<=maxBytes||!index)return;
  const oldestFirst=[...index.entries()].sort((a,b)=>a[1].mtimeMs-b[1].mtimeMs);
  for(const [path,entry] of oldestFirst){
   if(total<=maxBytes*.9)break;
   try{await rm(path,{force:true})}catch{/* already gone */}
   index.delete(path);total-=entry.bytes;
  }
 };

 return {
  async get(tile){
   try{return new Uint8Array(await readFile(fileOf(tile)))}catch{return undefined}
  },
  async set(tile,bytes){
   const path=fileOf(tile),temp=`${path}.${process.pid}.${++tempCounter}.tmp`;
   await mkdir(join(directory,String(tile.z),String(tile.x)),{recursive:true});
   await writeFile(temp,bytes);
   await rename(temp,path);
   if(!index)await buildIndex();
   const previous=index!.get(path);
   if(previous)total-=previous.bytes;
   index!.set(path,{bytes:bytes.length,mtimeMs:Date.now()});
   total+=bytes.length;
   await evict();
  },
 };
}
