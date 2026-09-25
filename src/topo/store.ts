import {createDefaultTopoProject} from './defaults';
import type {TopoProject,TopoRoute,TopoUnit} from './types';
import {clampTopoProject,snapZoom} from './validation';

// The topo builder's state transitions. Same structure as the ornament's store: every control is
// rendered from this state, every change goes through the reducer, and every result is clamped, so a
// control can never display a value the store does not hold.

export type TopoAction=
 |{type:'reset'}
 |{type:'replace';project:TopoProject}
 |{type:'setOutput';patch:Partial<TopoProject['output']>}
 |{type:'setDisplayUnit';value:TopoUnit}
 // What the map reports after the user pans or zooms it. Zoom is kept exactly as reported.
 |{type:'setViewport';center:[number,number];zoom:number}
 // What the zoom control asks for: snapped to the control's 0.5 step.
 |{type:'setZoom';value:number}
 |{type:'selectPlace';label:string;center:[number,number];zoom?:number}
 // Loading a GPX file. A second load replaces the first — the plan's "replace".
 |{type:'setRoute';route:TopoRoute}
 |{type:'clearRoute'}
 // Terrain layer count, coverage targets and contours. Coverage is clamped by validation so layers
 // 2–4 never ask for more than the layer below them.
 |{type:'setTerrain';patch:Partial<Omit<TopoProject['terrain'],'coveragePercent'>>&{coveragePercent?:readonly number[]}}
 // The board's vector features (Phase 3). None of these is in the terrain's regeneration key.
 |{type:'setRoads';patch:Partial<TopoProject['roads']>}
 |{type:'setLabels';patch:Partial<TopoProject['labels']>}
 |{type:'setFrame';patch:Partial<TopoProject['frame']>}
 |{type:'setTitle';patch:Partial<TopoProject['title']>}
 |{type:'setRouteWidth';widthMm:number};

export function topoReducer(state:TopoProject,action:TopoAction):TopoProject{
 switch(action.type){
  case 'reset':return createDefaultTopoProject();
  case 'replace':return clampTopoProject(action.project);
  case 'setOutput':return clampTopoProject({...state,output:{...state.output,...action.patch}});
  case 'setDisplayUnit':return clampTopoProject({...state,displayUnit:action.value});
  case 'setViewport':return clampTopoProject({...state,viewport:{...state.viewport,center:action.center,zoom:action.zoom}});
  case 'setZoom':return clampTopoProject({...state,viewport:{...state.viewport,zoom:snapZoom(action.value)}});
  case 'selectPlace':return clampTopoProject({...state,viewport:{...state.viewport,center:action.center,zoom:action.zoom??state.viewport.zoom,selectedPlaceLabel:action.label}});
  case 'setRoute':return clampTopoProject({...state,route:action.route});
  case 'clearRoute':return {...state,route:null};
  case 'setTerrain':return clampTopoProject({...state,terrain:{...state.terrain,...action.patch} as TopoProject['terrain']});
  case 'setRoads':return clampTopoProject({...state,roads:{...state.roads,...action.patch}});
  case 'setLabels':return clampTopoProject({...state,labels:{...state.labels,...action.patch}});
  case 'setFrame':return clampTopoProject({...state,frame:{...state.frame,...action.patch}});
  case 'setTitle':return clampTopoProject({...state,title:{...state.title,...action.patch}});
  case 'setRouteWidth':return state.route?clampTopoProject({...state,route:{...state.route,widthMm:action.widthMm}}):state;
 }
}
