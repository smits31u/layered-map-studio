// Bounded, expiring response cache for the geocoder proxy.
//
// Caching is a policy obligation, not an optimisation: Nominatim's usage policy requires callers to
// cache results rather than re-asking for the same string, and the plan repeats it ("rate-limit and
// cache responsibly"). It is bounded because the proxy is long-lived and every distinct query a
// user types would otherwise be retained for the life of the process — which is also why entries
// expire: a cached address is a record of something someone searched for, and the plan's privacy
// rule is "do not store address-query history unless the user enables local project persistence".
// An in-memory map that forgets is the least the proxy can hold and still meet the caching rule.

export interface Cache<T>{get(key:string):T|undefined;set(key:string,value:T):void;delete(key:string):void;clear():void;readonly size:number}

export function createLruCache<T>(maxEntries:number,ttlMs:number,now:()=>number=()=>Date.now()):Cache<T>{
 // Map preserves insertion order, so re-inserting on read is enough to make it an LRU: the oldest
 // key is always the first one the iterator yields.
 const entries=new Map<string,{value:T;expiresAt:number}>();
 const evictExpired=(key:string,entry:{expiresAt:number})=>{
  if(entry.expiresAt>now())return false;
  entries.delete(key);
  return true;
 };
 return {
  get(key){
   const entry=entries.get(key);
   if(!entry)return undefined;
   if(evictExpired(key,entry))return undefined;
   entries.delete(key);
   entries.set(key,entry);
   return entry.value;
  },
  set(key,value){
   if(maxEntries<=0||ttlMs<=0)return;
   entries.delete(key);
   entries.set(key,{value,expiresAt:now()+ttlMs});
   while(entries.size>maxEntries){
    const oldest=entries.keys().next();
    if(oldest.done)break;
    entries.delete(oldest.value);
   }
  },
  delete(key){entries.delete(key)},
  clear(){entries.clear()},
  get size(){
   for(const [key,entry] of [...entries])evictExpired(key,entry);
   return entries.size;
  },
 };
}
