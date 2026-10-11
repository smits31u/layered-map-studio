import {useState,useSyncExternalStore} from 'react';
import type {FontId} from '../../types/project';
import {failedFonts,fontStateVersion,retryFont,subscribeFonts} from '../../text/fontRegistry';

// Shown by every tool while a bundled font has failed to load (HTTP error, corrupt file, or the
// load timeout). Names the font and the reason and offers a Retry; without it a failed font read as
// "still loading" forever and the only remedy was a page reload nobody was told to do. Renders
// nothing while every font is loading or ready.
export function FontLoadNotice(){
 useSyncExternalStore(subscribeFonts,fontStateVersion,fontStateVersion);
 const [retrying,setRetrying]=useState<FontId>();
 const failures=failedFonts();
 if(!failures.length)return null;
 const retry=async(id:FontId)=>{setRetrying(id);try{await retryFont(id)}finally{setRetrying(undefined)}};
 return <div className="font-load-notice error" role="alert">
  {failures.map(({id,label,error})=><p key={id}>
   <span>{error.message.startsWith(`Font "${label}"`)?error.message:`Font "${label}" failed to load: ${error.message}`}. Text set in {label} can't be generated or exported until it loads.</span>{' '}
   <button type="button" onClick={()=>retry(id)} disabled={retrying===id}>{retrying===id?'Retrying…':`Retry ${label}`}</button>
  </p>)}
 </div>;
}
