import {useId,useRef,useState} from 'react';
import {GeocodeError,ProxyGeocoder,type GeocodeSearchResponse} from '../../map/geocoding/GeocoderService';
import type {GeocodeCandidate,GeocodeProviderId,GeocodeProviderInfo} from '../../server/geocode/types';

type Props={
 selectedLabel?:string;
 onSelect:(candidate:GeocodeCandidate,fitBounds:boolean)=>void;
};

// Place search.
//
// Two rules from the plan shape this component more than anything else. "Search on explicit submit
// only" — so it is a form, and there is no autocomplete, no debounce, no search-as-you-type: every
// keystroke sent upstream would be a keystroke of somebody's home address handed to a third party
// for no benefit. And "Do not fire fallbacks automatically for every ambiguous result" — so when a
// provider finds nothing, this offers the other providers as buttons and stops. Deciding that a
// miss is worth asking somebody else about is the user's call, and it is a call they can only make
// knowingly if they are told who they are about to ask.

const DEFAULT_PROVIDER:GeocodeProviderId='nominatim';

export function PlaceSearch({selectedLabel,onSelect}:Props){
 const inputId=useId();
 const [query,setQuery]=useState('');
 const [provider,setProvider]=useState<GeocodeProviderId>(DEFAULT_PROVIDER);
 const [response,setResponse]=useState<GeocodeSearchResponse|undefined>(undefined);
 const [providers,setProviders]=useState<GeocodeProviderInfo[]>([]);
 const [error,setError]=useState('');
 const [searching,setSearching]=useState(false);
 const [fitToResult,setFitToResult]=useState(true);
 // One in-flight search at a time: submitting again abandons the previous request rather than
 // racing it, so a slow first answer can never overwrite a fast second one.
 const inFlight=useRef<AbortController|undefined>(undefined);

 const run=async(withProvider:GeocodeProviderId,text:string)=>{
  const trimmed=text.trim();
  if(!trimmed){setError('Enter a place or address to search for.');return}
  inFlight.current?.abort();
  const controller=new AbortController();
  inFlight.current=controller;
  setSearching(true);setError('');
  try{
   const result=await new ProxyGeocoder(withProvider).searchDetailed(trimmed,controller.signal);
   if(controller.signal.aborted)return;
   setResponse(result);
   setProviders(result.providers);
   if(!result.results.length)setError(`No matches from ${describe(result.providers,withProvider)}.`);
  }catch(reason){
   if((reason as Error).name==='AbortError')return;
   setResponse(undefined);
   setError(reason instanceof GeocodeError?reason.message:`The search failed: ${(reason as Error).message}`);
  }finally{
   if(!controller.signal.aborted)setSearching(false);
  }
 };

 const others=providers.filter(entry=>entry.id!==response?.provider);

 return <div className="ornament-search">
  <form onSubmit={event=>{event.preventDefault();void run(provider,query)}}>
   <div className="ornament-field">
    <label htmlFor={inputId}>Place or address</label>
    <input id={inputId} type="search" value={query} placeholder="Crivitz, Wisconsin" autoComplete="off" onChange={event=>setQuery(event.target.value)}/>
   </div>
   <div className="ornament-field">
    <label htmlFor={`${inputId}-provider`}>Search with</label>
    <select id={`${inputId}-provider`} value={provider} onChange={event=>setProvider(event.target.value as GeocodeProviderId)}>
     {(providers.length?providers:[{id:DEFAULT_PROVIDER,label:'Nominatim (OpenStreetMap)',attribution:'',note:''}]).map(entry=>
      <option key={entry.id} value={entry.id}>{entry.label}</option>)}
    </select>
   </div>
   <label className="ornament-check">
    <input type="checkbox" checked={fitToResult} onChange={event=>setFitToResult(event.target.checked)}/>
    <span>Zoom to fit the result&apos;s area</span>
   </label>
   <button type="submit" disabled={searching}>{searching?'Searching…':'Search'}</button>
  </form>

  <p className="ornament-status" role="status" aria-live="polite">
   {searching?'Searching…'
    :error?error
    :response?`${response.results.length} result${response.results.length===1?'':'s'} from ${describe(response.providers,response.provider)}${response.cached?' (cached)':''}`
    :selectedLabel?`Showing ${selectedLabel}`
    :'Search for the place this ornament is of.'}
  </p>

  {response?.results.length?<ul className="ornament-results">
   {response.results.map(candidate=>
    <li key={candidate.id}>
     <button type="button" onClick={()=>onSelect(candidate,fitToResult&&Boolean(candidate.boundingBox))}>
      <span className="ornament-result-label">{candidate.label}</span>
      <span className="ornament-result-meta">
       {candidate.kind?`${candidate.kind} · `:''}
       {candidate.coordinates[1].toFixed(4)}, {candidate.coordinates[0].toFixed(4)}
       {candidate.boundingBox?'':' · no area to fit'}
      </span>
     </button>
    </li>)}
  </ul>:null}

  {response&&!response.results.length&&others.length?<div className="ornament-retry">
   {/* Offered, never fired automatically: a provider that genuinely found nothing is not broken,
       and asking a second one is a decision with a privacy cost the user should be making. */}
   <p>Try a different provider:</p>
   {others.map(entry=>
    <button key={entry.id} type="button" onClick={()=>{setProvider(entry.id);void run(entry.id,query)}} title={entry.note}>
     Search {entry.label}
    </button>)}
  </div>:null}

  {response?.attribution?<p className="ornament-attribution">{response.attribution}</p>:null}
 </div>;
}

const describe=(providers:GeocodeProviderInfo[],id:GeocodeProviderId)=>providers.find(entry=>entry.id===id)?.label??id;
