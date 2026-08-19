export type GeocoderResult={id:string;displayName:string;latitude:number;longitude:number;boundingBox?:[number,number,number,number];resultType?:string;provider:string};
export interface GeocoderService{search(query:string,signal?:AbortSignal):Promise<GeocoderResult[]>}
export class PhotonGeocoder implements GeocoderService{
 constructor(private endpoint=import.meta.env.VITE_PHOTON_URL||'https://photon.komoot.io'){}
 async search(query:string,signal?:AbortSignal){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),8000);signal?.addEventListener('abort',()=>controller.abort());try{const r=await fetch(`${this.endpoint}/api/?q=${encodeURIComponent(query)}&limit=8`,{signal:controller.signal});if(!r.ok)throw new Error(`Geocoder returned HTTP ${r.status}`);const j=await r.json();return j.features.map((f:any)=>{const p=f.properties;return{id:String(p.osm_id??f.id),displayName:[p.name,p.city,p.state,p.country].filter(Boolean).filter((x:string,i:number,a:string[])=>a.indexOf(x)===i).join(', '),longitude:f.geometry.coordinates[0],latitude:f.geometry.coordinates[1],boundingBox:f.bbox,resultType:p.osm_value??p.type,provider:'Photon'}})}catch(e){if((e as Error).name==='AbortError')throw new Error('Geocoder timed out');throw e}finally{clearTimeout(timer)}}
}

// Fallback provider for address/marker geocoding (M-MARKERS): OpenStreetMap's Nominatim, used only
// when the primary Photon lookup fails or turns up nothing — never Google Maps, per the brief.
export class NominatimGeocoder implements GeocoderService{
 constructor(private endpoint=import.meta.env.VITE_NOMINATIM_URL||'https://nominatim.openstreetmap.org'){}
 async search(query:string,signal?:AbortSignal){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),8000);signal?.addEventListener('abort',()=>controller.abort());try{const r=await fetch(`${this.endpoint}/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=8`,{signal:controller.signal,headers:{Accept:'application/json'}});if(!r.ok)throw new Error(`Geocoder returned HTTP ${r.status}`);const j=await r.json();if(!Array.isArray(j))throw new Error('Geocoder returned an unexpected response');return j.map((f:any)=>({id:String(f.place_id),displayName:f.display_name,longitude:Number(f.lon),latitude:Number(f.lat),boundingBox:f.boundingbox?[Number(f.boundingbox[2]),Number(f.boundingbox[0]),Number(f.boundingbox[3]),Number(f.boundingbox[1])] as [number,number,number,number]:undefined,resultType:f.type,provider:'Nominatim'}))}catch(e){if((e as Error).name==='AbortError')throw new Error('Geocoder timed out');throw e}finally{clearTimeout(timer)}}
}

// Tries each provider in order, only moving to the next on an outright failure (network error,
// timeout, malformed response) or an empty result set — a provider that successfully returns zero
// matches for a real typo isn't "broken", so this still lets a genuinely-not-found address surface
// as not-found rather than masking it behind provider fan-out.
export class FallbackGeocoder implements GeocoderService{
 constructor(private providers:GeocoderService[]=[new PhotonGeocoder(),new NominatimGeocoder()]){}
 async search(query:string,signal?:AbortSignal){
  let lastError:Error|undefined;
  for(const provider of this.providers){
   try{
    const results=await provider.search(query,signal);
    if(results.length)return results;
   }catch(e){lastError=e as Error}
  }
  if(lastError)throw lastError;
  return[];
 }
}
