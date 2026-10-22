import {createDefaultGolfProject} from './defaults';
import type {GolfCourseRef,GolfProject,GolfUnit,TitleField} from './types';
import {clampGolfProject} from './validation';

// The golf starter's state transitions: the topo builder's shape (src/topo/store.ts). Every change
// goes through the reducer and every result is clamped.

export type GolfAction=
 |{type:'reset'}
 |{type:'replace';project:GolfProject}
 // Picking a course clears the previous course's confirmation and nine choice: both belonged to it.
 |{type:'selectCourse';course:GolfCourseRef}
 |{type:'setBoard';patch:Partial<GolfProject['board']>}
 |{type:'setDisplayUnit';value:GolfUnit}
 |{type:'confirmCoverage';key:string|null}
 |{type:'setNines';nines:string[]|null}
 |{type:'setMarks';patch:Partial<GolfProject['marks']>}
 |{type:'setTitle';patch:Partial<Omit<GolfProject['title'],'show'|'text'>>}
 |{type:'setTitleField';field:TitleField;show?:boolean;text?:string};

export function golfReducer(state:GolfProject,action:GolfAction):GolfProject{
 switch(action.type){
  case 'reset':return createDefaultGolfProject();
  case 'replace':return clampGolfProject(action.project);
  case 'selectCourse':{
   const same=state.course?.osmType===action.course.osmType&&state.course.osmId===action.course.osmId;
   return clampGolfProject({...state,course:action.course,...(same?{}:{coverageConfirmedFor:null,nines:null,title:{...state.title,text:{...state.title.text,name:'',location:'',par:''}}})});
  }
  case 'setBoard':return clampGolfProject({...state,board:{...state.board,...action.patch}});
  case 'setDisplayUnit':return clampGolfProject({...state,displayUnit:action.value});
  case 'confirmCoverage':return clampGolfProject({...state,coverageConfirmedFor:action.key});
  case 'setNines':return clampGolfProject({...state,nines:action.nines});
  case 'setMarks':return clampGolfProject({...state,marks:{...state.marks,...action.patch}});
  case 'setTitle':return clampGolfProject({...state,title:{...state.title,...action.patch}});
  case 'setTitleField':return clampGolfProject({...state,title:{...state.title,
   show:action.show===undefined?state.title.show:{...state.title.show,[action.field]:action.show},
   text:action.text===undefined?state.title.text:{...state.title.text,[action.field]:action.text}}});
 }
}
