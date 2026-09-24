import type {MapProject} from '../../types/project';
import {terrainControlsOf} from '../../geometry/shoreline/proceduralDepth';
import {TERRAIN_PROFILE_NAMES,type SimpleTerrainControls,type TerrainProfileName} from '../../geometry/terrain/terrainParams';

// The Procedural Terrain mode's controls in the Depth Data section: the simple, user-facing set
// only (expandSimpleControls turns it into the full engine parameters), never the advanced ones.
// Every change writes the complete control set back to project.bathymetry.terrain, so the project
// always records exactly what produced the terrain on screen.

const PROFILE_LABELS:Record<TerrainProfileName,string>={'smooth-basin':'Smooth basin','broad-shelf':'Broad shelf','stepped-benches':'Stepped benches','even-slope':'Even slope'};
type SliderKey='character'|'bankSteepness'|'weave'|'terracing'|'maxDepth';
const SLIDERS:{key:SliderKey;label:string;hint:string;min:number}[]=[
 {key:'character',label:'Character',hint:'calm → rugged',min:0},
 {key:'bankSteepness',label:'Bank steepness',hint:'beach → drop-off',min:0},
 {key:'weave',label:'Weave',hint:'directional grain',min:0},
 {key:'terracing',label:'Terracing',hint:'slopes → benches',min:0},
 {key:'maxDepth',label:'Max depth',hint:'how far down the layers the lake reaches',min:.1},
];

export function TerrainControls({project,patch}:{project:MapProject;patch:(x:Partial<MapProject>)=>void}){
 const controls=terrainControlsOf(project.bathymetry.terrain);
 const set=(fields:Partial<SimpleTerrainControls>)=>patch({bathymetry:{...project.bathymetry,terrain:{...controls,...fields}}});
 const shuffle=()=>{const value=new Uint32Array(1);crypto.getRandomValues(value);set({seed:value[0]%1000000})};
 return <div className="terrain-controls">
  <label>Bottom profile <select aria-label="Bottom profile" value={controls.profile} onChange={e=>set({profile:e.target.value as TerrainProfileName})}>{TERRAIN_PROFILE_NAMES.map(name=><option key={name} value={name}>{PROFILE_LABELS[name]}</option>)}</select></label>
  {SLIDERS.map(({key,label,hint,min})=><label key={key} title={hint}>{label} <span className="terrain-slider"><input type="range" aria-label={label} min={min} max={1} step={.01} value={controls[key]} onChange={e=>set({[key]:+e.target.value} as Partial<SimpleTerrainControls>)}/><output>{Math.round(controls[key]*100)}%</output></span></label>)}
  {controls.weave>0&&<label>Weave angle ° <input type="number" aria-label="Weave angle" min={0} max={179} step={1} value={controls.weaveAngleDeg} onChange={e=>{const v=+e.target.value;if(Number.isFinite(v))set({weaveAngleDeg:v})}}/></label>}
  <label>Seed <span className="terrain-seed"><input type="number" aria-label="Seed" min={0} step={1} value={controls.seed} onChange={e=>{const v=+e.target.value;if(Number.isFinite(v))set({seed:Math.trunc(v)})}}/><button type="button" onClick={shuffle}>Shuffle</button></span></label>
  <small>Procedural Terrain is generated artwork shaped by the shoreline, not surveyed depth. Depth panels are cut at evenly spaced depths through the terrain; below 100% Max depth the deepest panels come out empty.</small>
 </div>;
}
