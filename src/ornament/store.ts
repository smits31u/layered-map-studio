import {createDefaultOrnamentProject} from './defaults';
import type {BuildMode,ExportPreset,OrnamentProject,OrnamentUnit,TextLine} from './types';
import {clampOrnamentProject} from './validation';

export type OrnamentTextKey='subtitle'|'title'|'date';

export type OrnamentAction=
 |{type:'reset'}
 |{type:'replace';project:OrnamentProject}
 |{type:'setOrnament';patch:Partial<Omit<OrnamentProject['ornament'],'hangingLoop'>>}
 |{type:'setHangingLoop';patch:Partial<OrnamentProject['ornament']['hangingLoop']>}
 |{type:'setViewport';patch:Partial<Omit<OrnamentProject['viewport'],'bearing'|'pitch'>>}
 |{type:'setRoads';patch:Partial<OrnamentProject['roads']>}
 |{type:'setMarker';patch:Partial<OrnamentProject['marker']>}
 |{type:'setTextLine';key:OrnamentTextKey;patch:Partial<TextLine>}
 |{type:'setTextGap';key:'gap12Mm'|'gap23Mm';value:number}
 |{type:'scaleText';factor:number}
 |{type:'setBuildMode';value:BuildMode}
 |{type:'setExportPreset';value:ExportPreset}
 |{type:'setDisplayUnit';value:OrnamentUnit}
 // Choosing a search result is one action, not three, because the three have to happen together:
 // the map moves to the place, the place is remembered, and the marker is put on the place. The
 // plan is explicit that the marker belongs at "the selected place coordinate, not automatically at
 // the current map center after panning" — so this is the only action that moves the marker on the
 // user's behalf, and panning afterwards leaves it where the place is.
 |{type:'selectPlace';label:string;center:[number,number];zoom?:number}
 // The separate, explicit "center marker" action the plan asks for: "If the user wants the marker
 // to move with the map center, expose a separate 'center marker' action."
 |{type:'centerMarkerOnView'}
 // The preview pane's "return to selected place". A no-op when nothing has been selected, rather
 // than silently falling back to the viewport centre.
 |{type:'markerToSelectedPlace'};

// Reset is `createDefaultOrnamentProject()` and nothing else — no per-control default, no partial
// merge over current state. That is the structural answer to the reference tool's reset bug (zoom UI
// left showing 7 while state intended 14): a control cannot display a value the store does not hold,
// because every control is rendered from this state and has nowhere else to read from.
export function ornamentReducer(state:OrnamentProject,action:OrnamentAction):OrnamentProject{
 switch(action.type){
  case 'reset':return createDefaultOrnamentProject();
  case 'replace':return clampOrnamentProject(action.project);
  case 'setOrnament':return clampOrnamentProject({...state,ornament:{...state.ornament,...action.patch}});
  case 'setHangingLoop':return clampOrnamentProject({...state,ornament:{...state.ornament,hangingLoop:{...state.ornament.hangingLoop,...action.patch}}});
  case 'setViewport':return clampOrnamentProject({...state,viewport:{...state.viewport,...action.patch}});
  case 'setRoads':return clampOrnamentProject({...state,roads:{...state.roads,...action.patch}});
  case 'setMarker':return clampOrnamentProject({...state,marker:{...state.marker,...action.patch}});
  case 'setTextLine':return clampOrnamentProject({...state,text:{...state.text,[action.key]:{...state.text[action.key],...action.patch}}});
  case 'setTextGap':return clampOrnamentProject({...state,text:{...state.text,[action.key]:action.value}});
  case 'scaleText':return clampOrnamentProject({...state,text:{
   ...state.text,
   subtitle:{...state.text.subtitle,sizeMm:round(state.text.subtitle.sizeMm*action.factor)},
   title:{...state.text.title,sizeMm:round(state.text.title.sizeMm*action.factor)},
   date:{...state.text.date,sizeMm:round(state.text.date.sizeMm*action.factor)},
   gap12Mm:round(state.text.gap12Mm*action.factor),
   gap23Mm:round(state.text.gap23Mm*action.factor),
  }});
  case 'setBuildMode':return {...state,buildMode:action.value};
  case 'setExportPreset':return {...state,exportPreset:action.value};
  case 'setDisplayUnit':return {...state,displayUnit:action.value};
  case 'selectPlace':return clampOrnamentProject({
   ...state,
   viewport:{...state.viewport,center:action.center,zoom:action.zoom??state.viewport.zoom,selectedPlaceLabel:action.label,selectedPlaceCenter:action.center},
   marker:{...state.marker,position:action.center},
  });
  case 'centerMarkerOnView':return {...state,marker:{...state.marker,position:[state.viewport.center[0],state.viewport.center[1]]}};
  case 'markerToSelectedPlace':return state.viewport.selectedPlaceCenter
   ?{...state,marker:{...state.marker,position:[state.viewport.selectedPlaceCenter[0],state.viewport.selectedPlaceCenter[1]]}}
   :state;
 }
}

const round=(n:number)=>Number(n.toFixed(3));
