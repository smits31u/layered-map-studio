import {useMemo,useState} from 'react';
import type {ProductionJob} from '../../job';
import {downloadFile,fileSlug} from '../../download';
import {MM_PER_IN,type EstimateConfig} from '../config';
import {formatTimer} from '../designTimer';
import {CALIBRATION_GATE_PCT,describeError,formatPercentError,percentError,withinGate} from '../calibration';
import {confidenceBadge,confidenceLabel,designTimeFrom,estimateJob,formatMachineTime} from '../estimate';
import {calibrationEntryFrom,estimateJson,quoteSheetHtml,type EstimateMeta} from '../exports';
import {EstimateSettings} from './EstimateSettings';
import {useDesignTimer} from './useDesignTimer';
import '../../production.css';

const money=(v:number)=>`$${v.toFixed(2)}`;
const length=(mm:number)=>mm>=1000?`${(mm/1000).toFixed(2)} m`:`${Math.round(mm)} mm`;

// The live estimate for whatever the tool has generated. It reads the job and the config and
// nothing else, so editing a price, a speed or a recipe recomputes this panel without the tool
// rebuilding its scene; layer, size and setting changes reach it through the tool's own rebuild.
export function EstimatePanel({job,title,product,config,setConfig,appVersion}:{job?:ProductionJob;title:string;product:string;config:EstimateConfig;setConfig:(c:EstimateConfig)=>void;appVersion:string}){
 const timer=useDesignTimer();
 const design=designTimeFrom(timer.elapsedMs,config.rates.designHours);
 const estimate=useMemo(()=>{
  if(!job)return {value:undefined,error:''};
  try{return {value:estimateJob(job,config,design),error:''}}catch(e){return {value:undefined,error:(e as Error).message}}
 },[job,config,design.hours,design.source]);
 const[settingsOpen,setSettingsOpen]=useState(false);
 const[actual,setActual]=useState(''),[jobLabel,setJobLabel]=useState('');
 const e=estimate.value;
 const meta=():EstimateMeta=>({product,title:title||'Untitled map',generatedAt:new Date().toISOString(),appVersion});
 const baseName=()=>e?`${fileSlug(title,'map')}-${+(e.widthMm/MM_PER_IN).toFixed(2)}x${+(e.heightMm/MM_PER_IN).toFixed(2)}in`:'estimate';
 const openQuote=()=>{if(!e)return;const url=URL.createObjectURL(new Blob([quoteSheetHtml(e,config,meta())],{type:'text/html'}));window.open(url,'_blank','noopener');setTimeout(()=>URL.revokeObjectURL(url),60000)};
 const saveQuote=()=>e&&downloadFile(`quote-${baseName()}.html`,quoteSheetHtml(e,config,meta()),'text/html');
 const saveJson=()=>e&&downloadFile(`estimate-${baseName()}.json`,JSON.stringify(estimateJson(e,config,meta()),null,1),'application/json');
 const actualMin=Number(actual);
 const record=()=>{if(!e||!(actualMin>0))return;setConfig({...config,calibration:[...config.calibration,calibrationEntryFrom(e,config,actualMin,jobLabel||title)]});setActual('');setJobLabel('')};
 const removeEntry=(id:string)=>setConfig({...config,calibration:config.calibration.filter(c=>c.id!==id)});
 const applyMultiplier=(machineId:string,m:number)=>setConfig({...config,machines:config.machines.map(x=>x.id===machineId?{...x,travelMultiplier:Number(m.toFixed(3))}:x)});
 // Roads engraved (the default) are part of the engrave area, so the score column only shows when scoring.
 const scored=e?.strokedLines==='score';
 const currentMultiplier=e?config.machines.find(m=>m.id===e.machine.id)?.travelMultiplier:undefined;

 return <div className="estimate-panel" data-testid="estimate-panel">
  {!job&&<small>Generate the scene to see materials, machine time and cost.</small>}
  {estimate.error&&<p className="error" role="alert">Estimate failed: {estimate.error}</p>}
  {e&&<>
   <div className="estimate-headline">
    <div><span className="estimate-key">Suggested total</span><b data-testid="estimate-total">{money(e.totals.suggestedTotal)}</b></div>
    <div><span className="estimate-key">Machine time</span><b data-testid="estimate-time">{formatMachineTime(e.totals.machineMin,e.timeConfidence)}</b><span className="estimate-badge" data-confidence={e.timeConfidence} data-testid="estimate-badge">{confidenceBadge(e.timeConfidence)}</span></div>
   </div>
   <small className="notice" data-severity={e.timeConfidence==='calibrated'?'success':'warning'} data-testid="estimate-confidence">{confidenceLabel(e.timeConfidence)}.{e.placeholderInputs.length>0&&` Not entered yet: ${e.placeholderInputs.join(', ')}.`} Recipe: {e.recipe?.label??'none for this size'}. Machine: <span data-testid="estimate-machine">{e.machine.name}{e.machine.location?` (${e.machine.location})`:''}</span>.</small>
   {/* Sized for the 330px sidebar: material and sheet share the piece cell, engrave is in mm². */}
   <table className="estimate-table" aria-label="Estimate per layer">
    <thead><tr><th>Piece</th><th className="n">Cut</th>{scored&&<th className="n">Score</th>}<th className="n">Engr. mm²</th><th className="n">Time</th></tr></thead>
    <tbody>{e.pieces.map(p=><tr key={p.id} className={p.fitsStock&&p.fitsBed?undefined:'estimate-flag'}><td title={`${(p.widthMm/MM_PER_IN).toFixed(2)} x ${(p.heightMm/MM_PER_IN).toFixed(2)} in`}>{p.name}<small>{p.materialName} · {p.fitsStock?`${p.sheetFraction.toFixed(2)} sheet`:'no sheet fits'}</small></td>{p.manual?<td className="n" colSpan={scored?3:2}>by hand</td>:<><td className="n">{length(p.cutLengthMm)}</td>{scored&&<td className="n">{length(p.scoreLengthMm)}</td>}<td className="n">{Math.round(p.engraveAreaMm2).toLocaleString('en-US')}</td></>}<td className="n">{formatMachineTime(p.minutes.total,e.timeConfidence)}</td></tr>)}</tbody>
   </table>
   <table className="estimate-table" aria-label="Sheets by material">
    <thead><tr><th>Material and stock</th><th className="n">Sheets</th><th className="n">Cost</th></tr></thead>
    <tbody>{e.materials.map(m=><tr key={m.materialId} className={m.unplaced?'estimate-flag':undefined}><td>{m.materialName}<small>{m.stockName??'no stock fits'}{m.piecesPerSheet>1?` (${m.piecesPerSheet}/sheet)`:''}</small></td><td className="n">{+m.sheets.toFixed(2)}</td><td className="n">{money(m.cost)}</td></tr>)}</tbody>
   </table>
   <dl className="estimate-totals">
    <dt>Material</dt><dd>{money(e.totals.materialCost)}</dd>
    <dt>Supplies ({config.rates.suppliesPct}%)</dt><dd>{money(e.totals.suppliesCost)}</dd>
    <dt>Laser ({money(e.machine.hourlyRate)}/h)</dt><dd>{money(e.totals.laserCost)}</dd>
    <dt>Design ({+e.design.hours.toFixed(2)} h{e.design.source==='timer'?', timed':''})</dt><dd data-testid="estimate-design">{money(e.totals.designCost)}</dd>
    <dt>Frame</dt><dd>{e.totals.frameCost===null?'not set':money(e.totals.frameCost)}</dd>
   </dl>
   {e.warnings.length>0&&<ul className="estimate-warnings" aria-label="Estimate warnings">{e.warnings.map(w=><li key={w}>{w}</li>)}</ul>}
  </>}
  <div className="estimate-timer" aria-label="Design timer">
   <span className="estimate-key">Design timer</span>
   <b data-testid="design-timer" className={timer.running?'estimate-timer-running':undefined}>{formatTimer(timer.elapsedMs)}</b>
   {timer.running?<button onClick={timer.pause}>Pause</button>:<button onClick={timer.start}>{timer.elapsedMs>0?'Resume':'Start'}</button>}
   <button className="btn-quiet" onClick={timer.reset} disabled={timer.elapsedMs===0&&!timer.running}>Reset</button>
   <small>{timer.idle?'Idle over 10 min: not counting until you work in the page again.':timer.elapsedMs>0?'Timed minutes are billed as design time.':`Until started, design is billed at the default ${config.rates.designHours} h.`}</small>
  </div>
  {e&&<>
   <div className="estimate-actions">
    <button onClick={openQuote}>Print quote sheet</button>
    <button onClick={saveQuote}>Quote .html</button>
    <button onClick={saveJson}>Estimate JSON</button>
   </div>
   <details className="estimate-calibration"><summary>Calibrate machine time<span className="summary-meta">{e.calibration.entries?`${e.calibration.entries} recorded`:'none recorded'}</span></summary>
    <small>Enter the job time the laser software reported for this job (or a past one generated at the same settings) on the {e.machine.name}. The ratio tunes that machine's travel multiplier.</small>
    <div className="field-pair">
     <label>Actual min <input type="number" min="0" step="0.5" value={actual} onChange={ev=>setActual(ev.target.value)} aria-label="Actual job minutes"/></label>
     <label>Job <input value={jobLabel} placeholder={title||'Job name'} onChange={ev=>setJobLabel(ev.target.value)} aria-label="Calibration job name"/></label>
    </div>
    {(()=>{const err=actualMin>0?percentError(e.totals.machineMin,actualMin):null;return <small className="notice" data-severity={err===null?undefined:withinGate(err)?'success':'warning'} data-testid="calibration-error">This estimate: {e.totals.machineMin.toFixed(1)} min. {describeError(err)}</small>})()}
    <button onClick={record} disabled={!(actualMin>0)}>Record actual time</button>
    {e.calibration.rows.length>0&&<table className="estimate-table" aria-label="Estimate versus actual"><thead><tr><th>Job</th><th className="n">Est.</th><th className="n">Actual</th><th className="n" title={`Estimate against the actual time; the gate is ${CALIBRATION_GATE_PCT}%`}>Error</th><th/></tr></thead><tbody>{e.calibration.rows.map(r=><tr key={r.id} className={r.errorPct!==null&&!withinGate(r.errorPct)?'estimate-flag':undefined}><td>{r.label}</td><td className="n">{r.estimatedMin.toFixed(1)}</td><td className="n">{r.actualMin.toFixed(1)}</td><td className="n" data-testid="calibration-row-error">{formatPercentError(r.errorPct)}</td><td><button className="btn-quiet" onClick={()=>removeEntry(r.id)} aria-label={`Remove ${r.label}`}>x</button></td></tr>)}</tbody></table>}
    {e.calibration.suggestedMultiplier!==null&&<button onClick={()=>applyMultiplier(e.machine.id,e.calibration.suggestedMultiplier!)}>Use multiplier x{e.calibration.suggestedMultiplier.toFixed(2)} (now x{currentMultiplier})</button>}
   </details>
  </>}
  <button className="btn-block" onClick={()=>setSettingsOpen(true)}>Estimate settings…</button>
  {settingsOpen&&<EstimateSettings config={config} setConfig={setConfig} onClose={()=>setSettingsOpen(false)}/>}
 </div>;
}
