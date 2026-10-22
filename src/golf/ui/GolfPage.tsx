import {Suspense,lazy,useEffect,useMemo,useReducer,useRef,useState} from 'react';
import {FontLoadNotice} from '../../components/ui/FontLoadNotice';
import {Slider} from '../../components/ui/Slider';
import {ThemeToggle} from '../../components/ui/ThemeToggle';
import {APP_VERSION} from '../../ornament/export/metadata';
import {PlaceSearch} from '../../ornament/ui/PlaceSearch';
import {golfBoardToJob,golfSheetStock} from '../../production/adapters/golfBoard';
import {savedTimerElapsedMs} from '../../production/estimate/designTimer';
import {designTimeFrom} from '../../production/estimate/estimate';
import {estimateFilesFor} from '../../production/estimate/exports';
import {EstimatePanel} from '../../production/estimate/ui/EstimatePanel';
import {useEstimateConfig} from '../../production/estimate/ui/useEstimateConfig';
import type {ProductionJob} from '../../production/job';
import type {GolfSnapshot} from '../../server/golf/types';
import {FONT_REGISTRY,getLoadedFont,loadFont} from '../../text/fontRegistry';
import type {FontId} from '../../types/project';
import {inchesToMm,mmToInches} from '../../utils/units';
import {coverageCleared,coverageReport} from '../coverage';
import {createDefaultGolfProject} from '../defaults';
import {exportGolf} from '../export/exportGolf';
import {golfPreflightSummary,type GolfPreflightReport} from '../export/preflight';
import {buildGolfBoard,titleValues,type GolfBoard} from '../geometry/board';
import {GolfFontError,fontsForTitle} from '../geometry/titleBlock';
import {resolveNines} from '../holes';
import {loadGolfProject,saveGolfProject} from '../persistence';
import {GolfSnapshotFetchError,fetchGolfSnapshot,parseOsmRef} from '../snapshotClient';
import {golfReducer} from '../store';
import {GOLF_LIMITS,TITLE_FIELDS,type GolfProject,type GolfUnit,type MarkOperation,type TitleField} from '../types';
import {BoardPreview} from './BoardPreview';
import './golf.css';

// The golf course map starter (docs/GOLF_MODULE_PLAN.md, status in docs/golf-implementation-status.md).
//
// The flow is the plan's §4: find a course, review what OpenStreetMap has for it (the coverage gate,
// §3), set the board, then the holes, marks and title, and export one SVG per sheet in a ZIP. The
// course geometry comes from the server's snapshot route (/api/golf/snapshot), never from the
// browser talking to Overpass; the board is rebuilt from that snapshot whenever a setting changes,
// and the export builds it again from the current settings rather than trusting the preview.
//
// Reached from the lake tool's nav ("Golf Course Map →"), like the ornament and topo tools.

const Preview3D=lazy(()=>import('../../production/preview3d/ui/Preview3D'));
const BUILD_DEBOUNCE_MS=250;
const fmt=(n:number,digits:number)=>String(Number(n.toFixed(digits)));
const OPS:{value:MarkOperation;label:string}[]=[{value:'engrave',label:'Engrave'},{value:'score',label:'Score'},{value:'none',label:'Off'}];
const FIELD_LABELS:Record<TitleField,string>={above:'Line above the name',name:'Course name',location:'Town and state',par:'Par',length:'Length',rating:'Course rating',slope:'Slope',year:'Year established',architect:'Architect',personal:'Personal line'};
const FIELD_HINTS:Partial<Record<TitleField,string>>={length:'6,412 yards',rating:'71.2',slope:'128',year:'1964',architect:'Designed by …',personal:'Our first round together',above:'Home of the Tuesday league'};

type SnapshotState={status:'idle'|'loading'|'ready'|'error';snapshot?:GolfSnapshot;cached?:boolean;error?:string;code?:string};

function DimensionField({label,valueMm,unit,onCommit}:{label:string;valueMm:number;unit:GolfUnit;onCommit:(mm:number)=>void}){
 const [draft,setDraft]=useState<string|null>(null);
 const shown=unit==='in'?fmt(mmToInches(valueMm),3):fmt(valueMm,1);
 const commit=()=>{
  if(draft===null)return;
  const value=Number(draft);
  if(draft.trim()!==''&&Number.isFinite(value))onCommit(unit==='in'?inchesToMm(value):value);
  setDraft(null);
 };
 return <label>{label}<span className="golf-dimension"><input type="number" aria-label={`${label} (${unit})`} inputMode="decimal" step={unit==='in'?.125:1} value={draft??shown} onChange={e=>setDraft(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')commit()}}/>{unit}</span></label>;
}

function OpSelect({label,value,onChange,allowScore=true}:{label:string;value:MarkOperation;onChange:(v:MarkOperation)=>void;allowScore?:boolean}){
 return <label>{label}<select aria-label={label} value={value} onChange={e=>onChange(e.target.value as MarkOperation)}>{OPS.filter(o=>allowScore||o.value!=='score').map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;
}

export function GolfPage({onExit}:{onExit?:()=>void}={}){
 const [project,dispatch]=useReducer(golfReducer,undefined,()=>loadGolfProject()??createDefaultGolfProject());
 useEffect(()=>{saveGolfProject(project)},[project]);
 const [snap,setSnap]=useState<SnapshotState>({status:'idle'});
 const [pickError,setPickError]=useState('');
 const [osmText,setOsmText]=useState('');
 const [refreshToken,setRefreshToken]=useState(0);
 const refreshRef=useRef(false);

 // The course's snapshot: fetched when the course changes, and again on "Refresh from OSM".
 const courseKey=project.course?`${project.course.osmType}/${project.course.osmId}`:'';
 useEffect(()=>{
  if(!project.course){setSnap({status:'idle'});return}
  const controller=new AbortController();
  const refresh=refreshRef.current;refreshRef.current=false;
  setSnap(previous=>({...previous,status:'loading',error:undefined}));
  fetchGolfSnapshot(project.course.osmType,project.course.osmId,{refresh,signal:controller.signal}).then(
   ({snapshot,cached})=>setSnap({status:'ready',snapshot,cached}),
   (error:Error)=>{if(error.name==='AbortError')return;setSnap(previous=>({...previous,status:'error',error:error.message,code:error instanceof GolfSnapshotFetchError?error.code:'failed'}))},
  );
  return ()=>controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[courseKey,refreshToken]);
 const snapshot=snap.snapshot;
 const usable=snapshot&&project.course&&snapshot.course.osmType===project.course.osmType&&snapshot.course.osmId===project.course.osmId?snapshot:undefined;
 const coverage=useMemo(()=>usable?coverageReport(usable):undefined,[usable]);
 const cleared=Boolean(coverage&&coverageCleared(coverage,project.coverageConfirmedFor));

 // Fonts arrive asynchronously; the board reads them synchronously, so it rebuilds as each lands.
 const [fontTick,setFontTick]=useState(0);
 const wantedFonts=useMemo(()=>[...new Set<FontId>(['inter',...(usable?fontsForTitle(project.title,titleValues(usable,project)):[])])],[usable,project]);
 useEffect(()=>{
  let live=true;
  const bump=()=>{if(live)setFontTick(t=>t+1)};
  for(const id of wantedFonts)if(!getLoadedFont(id))loadFont(id).then(bump,bump);
  return ()=>{live=false};
 },[wantedFonts]);

 // The board, rebuilt after edits settle. Display unit changes nothing on it.
 const [built,setBuilt]=useState<{board?:GolfBoard;error?:string;busy:boolean}>({busy:false});
 const buildKey=JSON.stringify({...project,displayUnit:undefined});
 useEffect(()=>{
  if(!usable||!cleared){setBuilt({busy:false});return}
  setBuilt(previous=>({...previous,busy:true}));
  const timer=setTimeout(()=>{
   try{setBuilt({board:buildGolfBoard({project,snapshot:usable,font:getLoadedFont}),busy:false})}
   catch(error){setBuilt({error:error instanceof GolfFontError?'Waiting for fonts…':(error as Error)?.message??String(error),busy:false})}
  },BUILD_DEBOUNCE_MS);
  return ()=>clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[buildKey,usable,cleared,fontTick]);
 const board=built.board;

 const [estimateConfig,setEstimateConfig]=useEstimateConfig();
 const [estimateOpen,setEstimateOpen]=useState(false);
 const [view3d,setView3d]=useState(false);
 const job:ProductionJob|undefined=useMemo(()=>board?golfBoardToJob(board):undefined,[board]);
 const stock=useMemo(()=>job?golfSheetStock(job,estimateConfig):undefined,[job,estimateConfig]);
 const values=usable?titleValues(usable,project,board?.par):undefined;
 const mapTitle=values?.name||project.course?.label||'Golf course map';
 const sizeLabel=`${fmt(mmToInches(project.board.widthMm),2)} x ${fmt(mmToInches(project.board.heightMm),2)} in`;

 const [exportState,setExportState]=useState<{busy:boolean;report?:GolfPreflightReport;message?:string;ok?:boolean}>({busy:false});
 useEffect(()=>{setExportState(previous=>previous.busy?previous:{busy:false})},[buildKey,usable]);
 const canExport=Boolean(usable&&cleared&&board&&stock&&job)&&!exportState.busy&&!built.busy;
 const onExport=()=>{
  if(!canExport||!usable||!stock||!job)return;
  setExportState({busy:true});
  setTimeout(()=>{
   try{
    const estimate=estimateFilesFor(job,estimateConfig,designTimeFrom(savedTimerElapsedMs(),estimateConfig.rates.designHours),{product:'Golf course map',title:mapTitle,appVersion:APP_VERSION});
    const result=exportGolf({project,snapshot:usable,font:getLoadedFont,stockMm:stock,extraFiles:estimate});
    if(!result.ok||!result.zip){setExportState({busy:false,ok:false,report:result.preflight,message:golfPreflightSummary(result.preflight)});return}
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([result.zip as BlobPart],{type:'application/zip'}));
    a.download=result.zipName;a.rel='noopener';a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),40_000);
    setExportState({busy:false,ok:true,report:result.preflight,message:`Exported ${result.zipName}: ${result.fileNames.length} sheets, manifest.json and the estimate summary. ${golfPreflightSummary(result.preflight)}`});
   }catch(error){setExportState({busy:false,ok:false,message:`The export could not be built: ${(error as Error)?.message??String(error)}`})}
  },0);
 };

 const pickOsm=()=>{
  const ref=parseOsmRef(osmText);
  if(!ref){setPickError('Paste an OpenStreetMap link to the course, like openstreetmap.org/way/29060461.');return}
  setPickError('');
  dispatch({type:'selectCourse',course:{...ref,label:`OpenStreetMap ${ref.osmType} ${ref.osmId}`}});
 };
 const nines=usable?.nines??[];
 const ninesValue=usable?resolveNines(usable,project.nines).join('+'):'';
 const nineOptions=usable?[
  ...usable.layouts.filter(l=>l.nines.length>=2).map(l=>({value:l.nines.join('+'),label:`${l.name} (${l.nines.join(' then ')})`})),
  ...nines.map(n=>({value:n,label:`${n} nine only`})),
  {value:nines.join('+'),label:`All ${nines.length} nines`},
 ].filter((o,i,all)=>all.findIndex(x=>x.value===o.value)===i):[];
 const unit=project.displayUnit;
 const scaleText=board?`1:${Math.round(board.fit.scaleDenominator).toLocaleString('en-US')} · the board covers ${fmt(board.fit.coverageM.width,0)} × ${fmt(board.fit.coverageM.height,0)} m${board.fit.rotationDeg?` · turned ${fmt(board.fit.rotationDeg,1)}°`:''}`:'';

 return <main className="studio golf-page">
  <FontLoadNotice/>
  <aside>
   <header className="studio-brand">
    <div className="studio-wordmark">Layered Map Studio</div>
    <h1 className="studio-tool">Golf Course Map</h1>
    {onExit&&<button className="btn-quiet studio-back" onClick={onExit}>← Back</button>}
   </header>
   <div className="sidebar-scroll">
   <details open><summary>1. Course</summary><div className="section-body">
    <PlaceSearch filter="golf-course" defaultProvider="photon" label="Golf course" placeholder="Mid Vallee Golf Course, De Pere" hint="Search for the course by name and town." selectedLabel={project.course?.label} onSelect={candidate=>{
     if(!candidate.osm||candidate.osm.type==='node'){setPickError(candidate.osm?'That result is a single point on the map, not a course outline. Try the other provider, or paste the course\'s OpenStreetMap link below.':'That result does not say which OpenStreetMap element it is. Try the other provider, or paste the course\'s OpenStreetMap link below.');return}
     setPickError('');
     dispatch({type:'selectCourse',course:{osmType:candidate.osm.type,osmId:candidate.osm.id,label:candidate.label}});
    }}/>
    <label>Or an OpenStreetMap link<span className="golf-inline"><input type="text" aria-label="OpenStreetMap link" placeholder="openstreetmap.org/way/…" value={osmText} onChange={e=>setOsmText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')pickOsm()}}/><button type="button" onClick={pickOsm}>Use</button></span></label>
    {pickError&&<p className="error" role="alert">{pickError}</p>}
    {project.course&&<div className="golf-course-status" role="status">
     <strong>{usable?.course.name??project.course.label}</strong>
     <small>OSM {project.course.osmType} {project.course.osmId}{usable?` · fetched ${new Date(usable.fetchedAt).toLocaleString()}${snap.cached?' (cached)':''}`:''}</small>
     {snap.status==='loading'&&<small>Reading the course from OpenStreetMap…</small>}
     {snap.status==='error'&&<p className="error" role="alert">{snap.error}</p>}
     <button type="button" disabled={snap.status==='loading'} onClick={()=>{refreshRef.current=true;setRefreshToken(t=>t+1)}}>Refresh from OSM</button>
    </div>}
   </div></details>

   <details open><summary>2. Coverage</summary><div className="section-body">
    {!coverage?<small>Pick a course to see what OpenStreetMap has mapped for it.</small>:<>
     <ul className="golf-coverage" aria-label="Coverage">
      {coverage.items.map(item=><li key={item.role} className={item.ok?'ok':'missing'}><span aria-hidden="true">{item.ok?'✓':'✗'}</span> {item.label} <b>{item.count}</b></li>)}
     </ul>
     {coverage.findings.map(f=><p key={f.code} className={`golf-finding ${f.level}`} role={f.level==='blocking'?'alert':'status'}>{f.message}</p>)}
     {coverage.blocking&&<label className="check"><input type="checkbox" checked={project.coverageConfirmedFor===coverage.key} onChange={e=>dispatch({type:'confirmCoverage',key:e.target.checked?coverage.key:null})}/>I have checked this; build the board anyway</label>}
     <small>Course data © OpenStreetMap contributors. Missing features can be added at openstreetmap.org, then use Refresh from OSM.</small>
    </>}
   </div></details>

   <details open><summary>3. Board</summary><div className="section-body">
    <div className="golf-segmented" role="group" aria-label="Units">
     {(['in','mm'] as const).map(value=><button key={value} type="button" aria-pressed={unit===value} className={unit===value?'active':''} onClick={()=>dispatch({type:'setDisplayUnit',value})}>{value==='in'?'Inches':'Millimetres'}</button>)}
    </div>
    <DimensionField label="Width" valueMm={project.board.widthMm} unit={unit} onCommit={widthMm=>dispatch({type:'setBoard',patch:{widthMm}})}/>
    <DimensionField label="Height" valueMm={project.board.heightMm} unit={unit} onCommit={heightMm=>dispatch({type:'setBoard',patch:{heightMm}})}/>
    <Slider label="Margin" min={GOLF_LIMITS.marginMm.min} max={GOLF_LIMITS.marginMm.max} step={GOLF_LIMITS.marginMm.step} value={project.board.marginMm} onChange={marginMm=>dispatch({type:'setBoard',patch:{marginMm}})} format={v=>`${fmt(v,1)} mm`}/>
    <label className="check"><input type="checkbox" checked={project.board.northUp} onChange={e=>dispatch({type:'setBoard',patch:{northUp:e.target.checked}})}/>Keep north up</label>
    <small>{scaleText||'Off: the course turns to fill the board.'}</small>
   </div></details>

   <details open><summary>4. Holes</summary><div className="section-body">
    {nines.length>0&&<label>Nines<select aria-label="Nines" value={ninesValue} onChange={e=>dispatch({type:'setNines',nines:e.target.value.split('+')})}>{nineOptions.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>}
    <label className="check"><input type="checkbox" checked={project.marks.holeNumbers} onChange={e=>dispatch({type:'setMarks',patch:{holeNumbers:e.target.checked}})}/>Hole numbers</label>
    <OpSelect label="Routing (tee to green)" value={project.marks.routing} onChange={routing=>dispatch({type:'setMarks',patch:{routing}})}/>
    <small>{nines.length?'This course has more than one nine. The chosen nines are numbered straight through (1–9, then 10–18); every fairway and green is drawn either way.':'Hole numbers sit near each tee, clear of the greens.'}</small>
   </div></details>

   <details open><summary>5. Marks</summary><div className="section-body">
    <OpSelect label="Bunkers" value={project.marks.bunkers} onChange={bunkers=>dispatch({type:'setMarks',patch:{bunkers}})}/>
    <OpSelect label="Tees" value={project.marks.tees} onChange={tees=>dispatch({type:'setMarks',patch:{tees}})}/>
    <OpSelect label="Cart paths" value={project.marks.cartpaths} onChange={cartpaths=>dispatch({type:'setMarks',patch:{cartpaths}})}/>
    <OpSelect label="Streams" value={project.marks.streams} onChange={streams=>dispatch({type:'setMarks',patch:{streams}})}/>
    <label>Water on the floor<select aria-label="Water on the floor" value={project.marks.floorWater} onChange={e=>dispatch({type:'setMarks',patch:{floorWater:e.target.value as 'engrave'|'none'}})}><option value="engrave">Engrave</option><option value="none">Leave for stain</option></select></label>
    <label className="check"><input type="checkbox" checked={project.marks.greenInset} onChange={e=>dispatch({type:'setMarks',patch:{greenInset:e.target.checked}})}/>Green inset (engraved paint pocket)</label>
    <label className="check"><input type="checkbox" checked={project.marks.greenCollar} onChange={e=>dispatch({type:'setMarks',patch:{greenCollar:e.target.checked}})}/>Green collar (scored ring)</label>
    <small>Each mark goes on whichever sheet shows at that spot, so nothing is engraved under another piece or across a step.</small>
   </div></details>

   <details open><summary>6. Title</summary><div className="section-body">
    <div className="golf-segmented" role="group" aria-label="Title layout">
     {([['header','Header strip'],['corner','Corner block'],['none','None']] as const).map(([value,label])=><button key={value} type="button" aria-pressed={project.title.layout===value} className={project.title.layout===value?'active':''} onClick={()=>dispatch({type:'setTitle',patch:{layout:value}})}>{label}</button>)}
    </div>
    {project.title.layout!=='none'&&<>
     <label>Name font<select aria-label="Name font" value={project.title.fontId} onChange={e=>dispatch({type:'setTitle',patch:{fontId:e.target.value as FontId}})}>{FONT_REGISTRY.map(f=><option key={f.id} value={f.id}>{f.label}</option>)}</select></label>
     <Slider label="Name size" min={GOLF_LIMITS.titleSizeMm.min} max={GOLF_LIMITS.titleSizeMm.max} step={GOLF_LIMITS.titleSizeMm.step} value={project.title.sizeMm} onChange={sizeMm=>dispatch({type:'setTitle',patch:{sizeMm}})} format={v=>`${fmt(v,1)} mm`}/>
     <div className="golf-fields">
      {TITLE_FIELDS.map(field=><div key={field} className="golf-field">
       <label className="check"><input type="checkbox" checked={project.title.show[field]} onChange={e=>dispatch({type:'setTitleField',field,show:e.target.checked})}/>{FIELD_LABELS[field]}</label>
       {project.title.show[field]&&<input type="text" aria-label={FIELD_LABELS[field]} maxLength={120} value={project.title.text[field]} placeholder={field==='name'||field==='location'||field==='par'?(values?.[field]||'from the course'):FIELD_HINTS[field]} onChange={e=>dispatch({type:'setTitleField',field,text:e.target.value})}/>}
      </div>)}
     </div>
     <small>Name, town and par come from OpenStreetMap until you type over them. Rating, slope, year, architect and length are yours to enter.</small>
    </>}
   </div></details>

   <details open={estimateOpen} onToggle={e=>setEstimateOpen((e.currentTarget as HTMLDetailsElement).open)}><summary>7. Estimate</summary><div className="section-body">
    {job?<EstimatePanel job={job} title={mapTitle} product="Golf course map" config={estimateConfig} setConfig={setEstimateConfig} appVersion={APP_VERSION}/>:<small>Build the board to see sheets, machine time and cost.</small>}
   </div></details>
   <button type="button" className="golf-reset btn-quiet" onClick={()=>dispatch({type:'reset'})}>Reset to defaults</button>
   </div>

   <details open className="action-panel golf-export"><summary onClick={e=>e.preventDefault()}>Export</summary>
    <button type="button" className="btn-primary" disabled={!canExport} onClick={onExport}>{exportState.busy?'Exporting…':'Export ZIP'}</button>
    {!canExport&&!exportState.busy&&<small>{!project.course?'Pick a course first.':!usable?'Waiting for the course.':!cleared?'Confirm the coverage gaps first.':'Waiting for the board.'}</small>}
    {exportState.message&&<p className={exportState.ok?'golf-note':'error'} role={exportState.ok?'status':'alert'} data-testid="golf-export-status">{exportState.message}</p>}
    {exportState.report&&exportState.report.findings.length>0&&<ul className="golf-preflight" aria-label="Preflight findings">
     {[...exportState.report.findings].sort((a,b)=>a.severity===b.severity?0:a.severity==='error'?-1:1).map((f,i)=><li key={i} className={f.severity} data-code={f.code}><strong>{f.severity==='error'?'Blocks export':'Warning'}:</strong> {f.message}</li>)}
    </ul>}
   </details>
  </aside>

  <section className="workspace">
   <nav>
    <div className="nav-tabs" role="group" aria-label="View"><button type="button" className={view3d?'':'active'} aria-pressed={!view3d} onClick={()=>setView3d(false)}>Board</button><button type="button" className={view3d?'active':''} aria-pressed={view3d} onClick={()=>setView3d(true)}>3D Preview</button></div>
    {built.busy&&<span className="golf-progress" role="status">Building the board…</span>}
    <span className="golf-attribution">Course data © OpenStreetMap contributors</span>
    <ThemeToggle/>
   </nav>
   <div className="golf-edit">
    {built.error&&<p className="golf-banner error" role="alert">{built.error}</p>}
    {board?.warnings.map(w=><p key={w.code+w.message} className="golf-banner warning" role="status">{w.message}</p>)}
    {!project.course?<p className="golf-empty">Search for a golf course to start.</p>
     :!usable?<p className="golf-empty">{snap.status==='error'?snap.error:'Reading the course…'}</p>
     :!cleared?<p className="golf-empty">OpenStreetMap's map of this course has gaps. Look at Coverage, then confirm to build the board.</p>
     :view3d?(job?<div className="golf-preview-3d"><Suspense fallback={<p className="golf-note">Loading 3D preview…</p>}><Preview3D job={job} config={estimateConfig} title={mapTitle} sizeLabel={sizeLabel} appVersion={APP_VERSION}/></Suspense></div>:<p className="golf-note">Building the board…</p>)
     :board?<div className={`golf-preview-frame${built.busy?' busy':''}`}><BoardPreview board={board}/></div>:<p className="golf-note">Building the board…</p>}
    {board&&<dl className="golf-stats" aria-label="Board details">
     <div><dt>Sheets</dt><dd>{board.sheets.map(s=>`L${s.index} ${s.name}${s.index?` (${s.pieces.length})`:''}`).join(' · ')}</dd></div>
     <div><dt>Holes</dt><dd>{board.holes.length} routed · {board.badges.length} numbered{board.par!==undefined?` · par ${board.par}`:''}</dd></div>
     <div><dt>Scale</dt><dd>{scaleText}</dd></div>
    </dl>}
   </div>
  </section>
 </main>;
}

export default GolfPage;
