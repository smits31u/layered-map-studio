import type {BuildMode} from '../types';

const LAYERS:Record<BuildMode,{label:string;detail:string}[]>=({
 'classic-2-piece':[
  {label:'Frame + text',detail:'Ring, hanging loop, personalisation engraved'},
  {label:'Map base',detail:'Roads engraved dark, water engraved light'},
 ],
 'water-cutout-3-piece':[
  {label:'Frame + text',detail:'Ring, hanging loop, personalisation engraved'},
  {label:'Land',detail:'Water removed, roads engraved'},
  {label:'Backing / water',detail:'Solid piece showing through the cutout'},
 ],
});

// Shows the physical stack rather than describing it, because the difference between the two modes
// is what physically gets glued together — not a setting whose effect is visible in the preview.
export function StackDiagram({mode}:{mode:BuildMode}){
 const layers=LAYERS[mode];
 return <div className="stack-diagram">
  <svg viewBox={`0 0 200 ${26+layers.length*26}`} role="img" aria-label={`${layers.length}-piece stack: ${layers.map(l=>l.label).join(', ')}`}>
   {layers.map((layer,index)=>{
    const y=10+index*26;
    return <g key={layer.label}>
     <rect x={12+index*8} y={y} width={150} height={20} rx={3} fill="#22303d" stroke="#67b4da"/>
     <text x={20+index*8} y={y+14} fill="#d9e0e8" fontSize={10}>{layer.label}</text>
    </g>;
   })}
  </svg>
  <ul>{layers.map(layer=><li key={layer.label}><b>{layer.label}</b> — {layer.detail}</li>)}</ul>
 </div>;
}
