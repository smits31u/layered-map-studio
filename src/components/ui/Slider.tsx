import {useId,type CSSProperties} from 'react';

// The app's slider (styles/studio.css): a label and a value readout above a large-thumbed range
// input on a ruled track, with optional end labels. Replaces the thin native slider, which was hard
// to grab. `--p` (0–1) drives the filled part of the track, so the fill ends at the thumb's centre.
//
// By default the readout is an <output> and the label names the range input, so it is found by role
// and name like the native input it wraps. With `entry`, the readout is an editable number box
// instead (the ornament's "numeric values adjacent to sliders and editable directly"): the label
// then names the number box, and the range input is named by `ariaLabel`. Both are views of the one
// value passed in, never two states kept in sync.
export interface SliderProps{
 label:string;
 value:number;
 min:number;
 max:number;
 step:number;
 onChange:(value:number)=>void;
 format?:(value:number)=>string;
 // What the two ends mean, e.g. ['Calm','Rugged'].
 ends?:readonly [string,string];
 hint?:string;
 ariaLabel?:string;
 disabled?:boolean;
 // An editable number box in place of the readout, with an optional unit after it.
 entry?:boolean;
 suffix?:string;
}

export function Slider({label,value,min,max,step,onChange,format=String,ends,hint,ariaLabel,disabled,entry,suffix}:SliderProps){
 const id=useId();
 const rangeId=`${id}-range`,entryId=`${id}-entry`;
 const p=max>min?Math.min(1,Math.max(0,(value-min)/(max-min))):0;
 return <div className="slider">
  <div className="slider-head">
   <label htmlFor={entry?entryId:rangeId}>{label}</label>
   {entry
    ?<span className="slider-entry"><input id={entryId} type="number" min={min} max={max} step={step} value={value} disabled={disabled} onChange={e=>onChange(Number(e.target.value))}/>{suffix?<small>{suffix}</small>:null}</span>
    :<output htmlFor={rangeId} className="slider-value">{format(value)}</output>}
  </div>
  <input id={rangeId} type="range" aria-label={ariaLabel??label} min={min} max={max} step={step} value={value} disabled={disabled} onChange={e=>onChange(Number(e.target.value))} style={{'--p':p} as CSSProperties}/>
  {ends&&<div className="slider-ends" aria-hidden="true"><span>{ends[0]}</span><span>{ends[1]}</span></div>}
  {hint&&<small>{hint}</small>}
 </div>;
}
