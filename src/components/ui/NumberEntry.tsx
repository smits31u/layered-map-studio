import {useState,type InputHTMLAttributes} from 'react';

// A number box that can be typed into. The sidebar's boxes show the stored project value, so a box
// bound straight to it snaps back on every keystroke the project rejects: clearing the field, or the
// "1" on the way to "18" (25.4 mm, under the 50 mm floor), leaving only the spinner arrows. This
// keeps the typed text while the box is being edited, passes each value `isValid` allows up as it is
// typed, and shows the stored value again on blur (or Enter), so a half-typed or out-of-range entry
// is dropped rather than kept.
export interface NumberEntryProps extends Omit<InputHTMLAttributes<HTMLInputElement>,'value'|'onChange'|'type'>{
 value:number;
 onChange:(value:number)=>void;
 isValid?:(value:number)=>boolean;
}

export function NumberEntry({value,onChange,isValid=()=>true,onBlur,onKeyDown,...rest}:NumberEntryProps){
 const [draft,setDraft]=useState<string>();
 const valid=(text:string)=>text.trim()!==''&&Number.isFinite(+text)&&isValid(+text);
 return <input {...rest} type="number" value={draft??String(value)} aria-invalid={draft!==undefined&&!valid(draft)?true:undefined}
  onChange={e=>{const text=e.target.value;setDraft(text);if(valid(text))onChange(+text)}}
  onBlur={e=>{setDraft(undefined);onBlur?.(e)}}
  onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();onKeyDown?.(e)}}/>;
}
