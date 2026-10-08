import type {BuildMode} from '../types';

// `loop` marks the layer the hanging loop is cut as part of. It moves between modes: classic hangs
// from the frame, water-cutout hangs from the backing (see `buildThreePieceShapes`), and the diagram
// is where the user sees which piece they will be threading a ribbon through.
const LAYERS:Record<BuildMode,{label:string;detail:string;loop?:boolean}[]>=({
 'classic-2-piece':[
  {label:'Frame + text',detail:'Ring, hanging loop, personalisation engraved',loop:true},
  {label:'Map base',detail:'Roads engraved dark, water engraved light'},
 ],
 'water-cutout-3-piece':[
  {label:'Frame + text',detail:'Ring and personalisation engraved — no loop'},
  {label:'Land',detail:'Water removed, roads engraved'},
  {label:'Backing / water',detail:'Solid piece showing through the cutout, with the hanging loop',loop:true},
 ],
});

// Shows the physical stack rather than describing it, because the difference between the two modes
// is what physically gets glued together — not a setting whose effect is visible in the preview.
//
// The loop is drawn as a ring off the right-hand end of the layer that carries it. Its colours are
// attributes rather than stylesheet rules so the marker reads the same under either theme.
export function StackDiagram({mode}:{mode:BuildMode}){
 const layers=LAYERS[mode];
 const loopLayer=layers.find(layer=>layer.loop);
 return <div className="stack-diagram">
  <svg viewBox={`0 0 200 ${26+layers.length*26}`} role="img" aria-label={`${layers.length}-piece stack: ${layers.map(l=>l.label).join(', ')}${loopLayer?` · hanging loop on ${loopLayer.label}`:''}`}>
   {layers.map((layer,index)=>{
    const y=10+index*26,x=12+index*8;
    return <g key={layer.label} data-layer={layer.label} data-loop={layer.loop?'true':undefined}>
     <rect x={x} y={y} width={150} height={20} rx={3} fill="#22303d" stroke="#67b4da"/>
     <text x={x+8} y={y+14} fill="#d9e0e8" fontSize={10}>{layer.label}</text>
     {layer.loop?<circle className="stack-diagram-loop" cx={x+157} cy={y+10} r={6} fill="none" stroke="#67b4da" strokeWidth={2.5}><title>Hanging loop</title></circle>:null}
    </g>;
   })}
  </svg>
  <ul>{layers.map(layer=><li key={layer.label}><b>{layer.label}</b> — {layer.detail}</li>)}</ul>
 </div>;
}
