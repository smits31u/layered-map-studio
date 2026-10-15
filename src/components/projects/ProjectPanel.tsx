import {useState} from 'react';
import type {ProjectSession} from '../../state/projects/useProjectSession';
import {replaceWarning} from '../../state/projects/sessionLogic';
import {ProjectsDialog} from './ProjectsDialog';
import './projects.css';

const time=(iso?:string)=>{if(!iso)return '';const d=new Date(iso);return Number.isNaN(d.getTime())?'':d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})};

// The Project section at the top of the lake tool's sidebar: what is open, whether it is saved, and
// Save / Save as / Open / New. Everything is also autosaved, so this is about naming and keeping
// projects, not about not losing work. New, Open and Import ask first when there is unsaved work,
// and the session they replace can be brought back once with Recover last session.
export function ProjectPanel({session,suggestedName,onDownload}:{session:ProjectSession;suggestedName:string;onDownload:(name:string,json:string)=>void}){
 const[naming,setNaming]=useState(false),[name,setName]=useState('');
 const[dialog,setDialog]=useState(false);
 const {current,recovery}=session;
 const startNaming=()=>{setName(current.name?`${current.name} copy`:suggestedName);setNaming(true)};
 const save=()=>{if(current.id)void session.save();else startNaming()};
 const confirmName=()=>{if(!name.trim())return;void session.save(name).then(()=>setNaming(false))};
 const newProject=()=>{const warning=replaceWarning(current,'new');if(warning&&!window.confirm(warning))return;void session.newProject()};
 const status=!session.ready?'Loading…':current.id?(current.dirty?'Unsaved changes':`Saved ${time(current.savedAt)}`.trim()):current.dirty?'Not saved yet (autosaved in this browser)':'Nothing to save yet';
 return <div className="project-panel" data-testid="project-panel">
  <div className="project-current"><b data-testid="project-name">{current.name??'Unsaved project'}</b><small data-testid="project-status" data-dirty={current.dirty}>{status}</small></div>
  {naming?<form className="project-naming" onSubmit={e=>{e.preventDefault();confirmName()}}>
   <label>Name <input autoFocus aria-label="Project name" value={name} onChange={e=>setName(e.target.value)}/></label>
   <div className="action-row"><button type="submit" className="btn-strong" disabled={!name.trim()}>Save</button><button type="button" className="btn-quiet" onClick={()=>setNaming(false)}>Cancel</button></div>
  </form>:<div className="project-actions">
   <button onClick={save} disabled={!session.ready}>Save</button>
   <button onClick={startNaming} disabled={!session.ready}>Save as…</button>
   <button onClick={()=>setDialog(true)} disabled={!session.ready}>Open…</button>
   <button className="btn-quiet" onClick={newProject} disabled={!session.ready}>New</button>
  </div>}
  {recovery&&<div className="project-recover"><button className="btn-quiet" onClick={()=>void session.recover()} disabled={!session.ready}>Recover last session</button><small data-testid="project-recovery">{recovery.name??'Unsaved map'} · {time(recovery.updatedAt)}</small></div>}
  {session.error?<small className="notice" data-severity="error" role="alert">{session.error}</small>:session.message&&<small data-testid="project-message">{session.message}</small>}
  {dialog&&<ProjectsDialog session={session} onClose={()=>setDialog(false)} onDownload={onDownload}/>}
 </div>;
}
