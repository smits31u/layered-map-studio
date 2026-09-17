// Serializes upstream calls to one provider and holds them at least `minIntervalMs` apart.
//
// The plan is explicit for public Nominatim: "cap at one request per second". A token bucket or a
// per-request timestamp check is not enough, because two searches submitted in the same tick would
// both see an expired timestamp and both fire. This queues instead: every task waits for the
// previous one to have *started* plus the interval, so the nth call cannot happen before
// n*minIntervalMs regardless of how many arrive at once.
//
// The clock is injected so tests can assert the spacing without actually sleeping.

export interface Clock{now():number;sleep(ms:number):Promise<void>}

export const systemClock:Clock={now:()=>Date.now(),sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms))};

export interface RateLimiter{run<T>(task:()=>Promise<T>):Promise<T>}

export function createRateLimiter(minIntervalMs:number,clock:Clock=systemClock):RateLimiter{
 // `tail` is the queue. It is deliberately reassigned to a promise that never rejects, so one
 // failing upstream call cannot poison the chain and wedge every later search.
 let tail:Promise<unknown>=Promise.resolve();
 let lastStart=Number.NEGATIVE_INFINITY;
 return {
  run<T>(task:()=>Promise<T>):Promise<T>{
   const result=tail.then(async()=>{
    if(minIntervalMs>0){
     const wait=lastStart+minIntervalMs-clock.now();
     if(wait>0)await clock.sleep(wait);
    }
    lastStart=clock.now();
    return task();
   });
   tail=result.catch(()=>undefined);
   return result;
  },
 };
}
