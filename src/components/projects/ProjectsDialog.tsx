import {useCallback,useEffect,useRef,useState} from 'react';
import type {SavedLakeProject} from '../../state/projects/projectStore';
import type {ProjectSession} from '../../state/projects/useProjectSession';
import {replaceWarning} from '../../state/projects/sessionLogic';

const inches=(mm:number)=>+(mm/25.4).toFixed(2);
const DEPTH:Record<string,string>={'true-bathymetry':'True bathymetry','decorative-offsets':'Artistic depth','procedural-terrain':'Procedural terrain'};
const when=(iso:string)=>{const d=new Date(iso);return Number.isNaN(d.getTime())?'':d.toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})};

// The saved projects in this browser: open, rename, duplicate, export as a file, delete, and import a
// project file (a backup, or a project saved on another computer).
export function ProjectsDialog({session,onClose,onDownload}:{session:ProjectSession;onClose:()=>void;onDownload:(name:string,json:string)=>void}){
 const[projects,setProjects]=useState<SavedLakeProject[]>();
 const[filter,setFilter]=useState(''),[renaming,setRenaming]=useState<{id:string;name:string}>();
 const[loadError,setLoadError]=useState('');
 const ref=useRef<HTMLDivElement>(null);
 const refresh=useCallback(()=>{session.list().then(setProjects,e=>setLoadError((e as Error).message))},[session]);
 useEffect(()=>{refresh()},[]);
 useEffect(()=>{ref.current?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose()};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[onClose]);
 const shown=(projects??[]).filter(p=>!filter.trim()||`${p.name} ${p.project.title.text}`.toLowerCase().includes(filter.trim().toLowerCase()));
 // Both ask first when the session on screen has unsaved work, saved before or not (reopening the
 // open project replaces its unsaved changes with the saved copy too).
 const open=async(p:SavedLakeProject)=>{
  const warning=replaceWarning(session.current,'open',p.name);
  if(warning&&!window.confirm(warning))return;
  await session.open(p.id);onClose();
 };
 const remove=async(p:SavedLakeProject)=>{if(!window.confirm(`Delete ${p.name} from this browser? This cannot be undone; export it first if you might want it back.`))return;await session.remove(p.id);refresh()};
 const exportOne=async(p:SavedLakeProject)=>{const file=await session.exportFile(p.id);onDownload(file.name,file.json)};
 // A cancelled or failed import clears the picker, so choosing the same file again still fires.
 const importOne=async(input:HTMLInputElement)=>{
  const file=input.files?.[0];if(!file)return;
  const warning=replaceWarning(session.current,'import',file.name);
  if(warning&&!window.confirm(warning)){input.value='';return}
  if(await session.importFile(await file.text()))onClose();else input.value='';
 };
 return <div className="project-dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
  <div className="project-dialog" role="dialog" aria-modal="true" aria-label="Saved projects" tabIndex={-1} ref={ref}>
   <header><h2>Saved projects</h2><button className="btn-quiet" onClick={onClose} aria-label="Close projects">Close</button></header>
   <div className="project-dialog-tools">
    <input type="search" aria-label="Find a project" placeholder="Find by name or title" value={filter} onChange={e=>setFilter(e.target.value)}/>
    <label className="project-import">Import file… <input type="file" accept=".json,application/json" aria-label="Import project file" onChange={e=>void importOne(e.currentTarget)}/></label>
   </div>
   <div className="project-dialog-body">
    {loadError&&<p className="error" role="alert">{loadError}</p>}
    {!projects&&!loadError&&<small>Loading…</small>}
    {projects&&!projects.length&&<small>No saved projects in this browser yet. Use Save in the Project section, or import a project file.</small>}
    <ul className="project-list" aria-label="Projects">{shown.map(p=><li key={p.id} className={p.id===session.current.id?'project-open':undefined}>
     <div className="project-row-main">
      {renaming?.id===p.id
       ?<form onSubmit={e=>{e.preventDefault();void session.rename(p.id,renaming.name).then(()=>{setRenaming(undefined);refresh()})}}><input autoFocus aria-label={`New name for ${p.name}`} value={renaming.name} onChange={e=>setRenaming({id:p.id,name:e.target.value})}/><button type="submit">Rename</button><button type="button" className="btn-quiet" onClick={()=>setRenaming(undefined)}>Cancel</button></form>
       :<b>{p.name}{p.id===session.current.id&&<span className="project-open-tag"> open</span>}</b>}
      <small>{inches(p.project.dimensions.widthMm)} x {inches(p.project.dimensions.heightMm)} in · {DEPTH[p.project.bathymetry.mode]??p.project.bathymetry.mode}{p.project.title.text?` · "${p.project.title.text}"`:''}{p.features?'':' · no geography saved'} · {when(p.updatedAt)}</small>
     </div>
     <div className="project-row-actions">
      <button className="btn-strong" onClick={()=>void open(p)} aria-label={`Open ${p.name}`}>Open</button>
      <button className="btn-quiet" onClick={()=>setRenaming({id:p.id,name:p.name})} aria-label={`Rename ${p.name}`}>Rename</button>
      <button className="btn-quiet" onClick={()=>void session.duplicate(p.id).then(refresh)} aria-label={`Duplicate ${p.name}`}>Duplicate</button>
      <button className="btn-quiet" onClick={()=>void exportOne(p)} aria-label={`Export ${p.name}`}>Export</button>
      <button className="btn-quiet" onClick={()=>void remove(p)} aria-label={`Delete ${p.name}`}>Delete</button>
     </div>
    </li>)}</ul>
    {session.error&&<p className="error" role="alert">{session.error}</p>}
   </div>
   <footer><small>Projects are saved in this browser. Export one to keep a backup or move it to another computer.</small></footer>
  </div>
 </div>;
}
