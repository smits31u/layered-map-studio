import type {ExtractedFeatures,MapProject} from '../../types/project';
import type {LakeAutosave} from './projectStore';

// The project session's rules, apart from React: what counts as unsaved work, what a replaced
// session's record looks like, and what to ask before replacing one.

export type SessionCurrent={id?:string;name?:string;dirty:boolean;savedAt?:string;timerId:string};
// absorbedFrom: the project the baseline last absorbed a map report from (see absorbMapReport).
export type SessionBaseline={project:MapProject;features:ExtractedFeatures;absorbedFrom?:MapProject};

export const hasGeography=(f:ExtractedFeatures|undefined):f is ExtractedFeatures=>Boolean(f)&&f!.water.length+f!.roads.length+f!.places.length>0;

// Anything on screen other than the baseline is a change. Reference comparison is enough: the app
// makes a new project or features object for every change and never mutates one in place. No
// baseline means the session already has unsaved work.
export function changedSince(baseline:SessionBaseline|undefined,project:MapProject,features:ExtractedFeatures):boolean{
 return !baseline||baseline.project!==project||baseline.features!==features&&(hasGeography(features)||hasGeography(baseline.features));
}

// The map reports its view and crop when it loads, before anyone touches it. When nothing has
// changed since the baseline, that report is the map settling into the project's own view, so it
// becomes part of the baseline instead of an unsaved change. Repeating the call for the same
// previous project (React may run a state updater twice) moves the baseline to the latest result.
export function absorbMapReport(baseline:SessionBaseline|undefined,previous:MapProject,next:MapProject):SessionBaseline|undefined{
 if(!baseline)return baseline;
 if(baseline.project===previous||baseline.absorbedFrom===previous)return {...baseline,project:next,absorbedFrom:previous};
 return baseline;
}

// A restored session has unsaved work when its autosave said so, or when it was never saved and
// carries geography (autosaves written before unsaved sessions were tracked always said dirty:false).
export const restoredDirty=(saved:LakeAutosave)=>saved.dirty||(!saved.savedId&&hasGeography(saved.features));

// The session as the autosave (and the recovery slot) store it.
export function sessionRecord(project:MapProject,features:ExtractedFeatures,current:SessionCurrent,now=new Date()):LakeAutosave{
 return {project,...(hasGeography(features)?{features}:{}),...(current.id?{savedId:current.id,...(current.name?{savedName:current.name}:{})}:{}),dirty:current.dirty,timerId:current.timerId,updatedAt:now.toISOString()};
}

// What New, Open and Import ask before replacing a session with unsaved work, saved or not. Nothing
// to ask when there is no unsaved work. The replaced session goes to the recovery slot either way.
export function replaceWarning(current:Pick<SessionCurrent,'id'|'name'|'dirty'>,action:'new'|'open'|'import',target?:string):string|undefined{
 if(!current.dirty)return undefined;
 const verb=action==='new'?'Start a new project':action==='open'?`Open ${target??'that project'}`:`Import ${target??'that project file'}`;
 const what=current.id?`Your unsaved changes to ${current.name??'this project'} will be replaced. You can get them`:'This map has not been saved and will be replaced. You can get it';
 return `${verb}? ${what} back once with Recover last session.`;
}
