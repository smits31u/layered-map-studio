// A promise-chain lock: each call to the returned function runs after the previous one has settled,
// whether it resolved or threw. Lifted out of the terrain tile cache (tileCache.ts), where it closes
// the index/eviction race, so the golf snapshot cache serializes its writes the same way rather than
// with a second, slightly different lock.
//
// A failing task never wedges the chain: the tail is always reassigned to a promise that resolves.
export type SerialLock=<T>(fn:()=>Promise<T>)=>Promise<T>;

export function createSerialLock():SerialLock{
 let tail:Promise<void>=Promise.resolve();
 return <T>(fn:()=>Promise<T>):Promise<T>=>{
  const result=tail.then(fn,fn);
  tail=result.then(()=>undefined,()=>undefined);
  return result;
 };
}
