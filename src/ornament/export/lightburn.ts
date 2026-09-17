import type {ExportPreset} from '../types';
import type {ExportOperation,OrnamentGroupId} from './pieces';

// Colour presets.
//
// The group id is the contract; colour is a convenience on top of it. That ordering is deliberate
// and it is why this file is small and separate: an importer that reads `piece/frame/cut` gets the
// right answer under either preset, and an importer that reads only the stroke colour is relying on
// a convention that the operator can change in their machine software anyway.
//
// LightBurn assigns one layer per colour, so the preset exists to make a file that opens with its
// operations already separated instead of everything on C00. Three of the mappings are specified:
// red cuts, black engraves, blue is the shallow water pass. The other two are this implementation's
// choice, picked from LightBurn's own palette so they land on real layers rather than being snapped
// to the nearest one: green for registration marks and cyan for the non-production labels. Both are
// meant to be set to "no output" or deleted, which is what the `optional` and `non-production` in
// their group names are telling the operator.

export interface ColourPreset{
 id:ExportPreset;
 label:string;
 stroke:Record<ExportOperation,string>;
 fill:Record<ExportOperation,string>;
}

// Hairline. LightBurn ignores stroke width entirely and cuts the path; Inkscape and a browser need
// something non-zero or the cut lines are invisible, which would make a visual check useless.
export const CUT_STROKE_MM=.1;

export const LIGHTBURN_PRESET:ColourPreset={
 id:'lightburn-colors',
 label:'LightBurn colours',
 stroke:{cut:'#FF0000','engrave':'none','engrave-light':'none',annotation:'none'},
 fill:{cut:'none',engrave:'#000000','engrave-light':'#0000FF',annotation:'#00FFFF'},
};

// The semantic preset is not "no colour" — a file that renders as nothing is a file nobody can
// check. It is one neutral ink, so that the only thing distinguishing operations in the output is
// the group id, which is exactly what a semantic consumer should be reading.
export const SEMANTIC_PRESET:ColourPreset={
 id:'semantic',
 label:'Semantic groups only',
 stroke:{cut:'#000000','engrave':'none','engrave-light':'none',annotation:'none'},
 fill:{cut:'none',engrave:'#000000','engrave-light':'#777777',annotation:'#777777'},
};

export const colourPreset=(preset:ExportPreset):ColourPreset=>
 preset==='lightburn-colors'?LIGHTBURN_PRESET:SEMANTIC_PRESET;

// Registration marks engrave, but they are their own LightBurn layer so they can be switched off
// without touching the roads. Same for labels, which must never reach the machine at all.
const OVERRIDES:Partial<Record<OrnamentGroupId,{fill?:string;stroke?:string}>>={
 'registration/optional':{fill:'#00FF00'},
 'labels/non-production':{fill:'#00FFFF'},
};

export interface GroupStyle{fill:string;stroke:string;strokeWidthMm:number;fillRule:'evenodd'|'nonzero'}

export function groupStyle(preset:ColourPreset,id:OrnamentGroupId,operation:ExportOperation,fillRule:'evenodd'|'nonzero'='evenodd'):GroupStyle{
 const override=preset.id==='lightburn-colors'?OVERRIDES[id]:undefined;
 return {
  fill:override?.fill??preset.fill[operation],
  stroke:override?.stroke??preset.stroke[operation],
  strokeWidthMm:operation==='cut'?CUT_STROKE_MM:0,
  fillRule,
 };
}
