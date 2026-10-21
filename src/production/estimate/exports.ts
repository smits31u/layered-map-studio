import {MM_PER_IN,type CalibrationEntry,type EstimateConfig} from './config';
import {CALIBRATION_GATE_PCT,formatPercentError} from './calibration';
import type {ProductionJob} from '../job';
import {confidenceBadge,confidenceLabel,estimateJob,formatMachineTime,type DesignTime,type Estimate} from './estimate';

// The estimate's file outputs: a JSON record for a future Business Suite import, a one-page
// printable quote sheet for Ben's own reference, and a short summary packed into a tool's export
// (estimateSummaryFiles). None is customer-facing, and none is sent anywhere: each is built here and
// handed to the browser as a download.

// generatedAt is left out of the summary packed into an export ZIP: the ZIP pins its timestamps so
// re-exporting an unchanged design gives the same bytes, and a clock reading would break that.
export type EstimateMeta={product:string;title:string;generatedAt?:string;appVersion:string};

export const ESTIMATE_JSON_SCHEMA='layered-map-studio.estimate/1';

const round=(v:number,places=2)=>Number(v.toFixed(places));

export function estimateJson(estimate:Estimate,config:EstimateConfig,meta:EstimateMeta){
 const machine=config.machines.find(m=>m.id===estimate.machine.id);
 return {
  schema:ESTIMATE_JSON_SCHEMA,
  ...meta,
  notice:'Internal estimate. Machine times are '+(estimate.timeConfidence==='calibrated'?'calibrated against recorded jobs':'not calibrated')+'; prices are from Ben\'s notes and need verifying.',
  size:{widthMm:round(estimate.widthMm,3),heightMm:round(estimate.heightMm,3),widthIn:round(estimate.widthMm/MM_PER_IN,3),heightIn:round(estimate.heightMm/MM_PER_IN,3)},
  recipe:estimate.recipe,
  machine:{...estimate.machine,travelMultiplier:machine?.travelMultiplier??null,perPieceOverheadMin:machine?.perPieceOverheadMin??null},
  strokedLines:estimate.strokedLines,
  timeConfidence:estimate.timeConfidence,
  placeholderInputs:estimate.placeholderInputs,
  design:{hours:round(estimate.design.hours,3),source:estimate.design.source},
  pieces:estimate.pieces.map(p=>({id:p.id,name:p.name,role:p.role,manual:p.manual,material:p.materialId,thicknessMm:p.thicknessMm,stock:p.stockId,sheetFraction:round(p.sheetFraction,4),cutLengthMm:round(p.cutLengthMm,1),scoreLengthMm:round(p.scoreLengthMm,1),engraveAreaMm2:round(p.engraveAreaMm2,1),fitsStock:p.fitsStock,fitsBed:p.fitsBed,minutes:Object.fromEntries(Object.entries(p.minutes).map(([k,v])=>[k,round(v,2)]))})),
  materials:estimate.materials.map(m=>({material:m.materialId,stock:m.stockId,pieces:m.pieces,piecesPerSheet:m.piecesPerSheet,sheets:round(m.sheets,3),sheetPrice:round(m.sheetPrice),cost:round(m.cost),unplaced:m.unplaced})),
  totals:Object.fromEntries(Object.entries(estimate.totals).map(([k,v])=>[k,v===null?null:round(v,k.endsWith('Min')||k.endsWith('Hours')?3:2)])),
  rates:{...config.rates,laserPerHour:estimate.machine.hourlyRate},
  calibration:{machineId:estimate.calibration.machineId,entries:estimate.calibration.entries,meanRatio:estimate.calibration.meanRatio===null?null:round(estimate.calibration.meanRatio,3),suggestedMultiplier:estimate.calibration.suggestedMultiplier===null?null:round(estimate.calibration.suggestedMultiplier,3),gatePct:CALIBRATION_GATE_PCT,latestErrorPct:(()=>{const e=estimate.calibration.rows.at(-1)?.errorPct;return e===undefined||e===null?null:round(e,1)})()},
  operations:Object.fromEntries(Object.entries(operationTotals(estimate)).map(([k,v])=>[k,round(v,k.endsWith('Min')?2:1)])),
  warnings:estimate.warnings,
 };
}

const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]!));
const money=(v:number)=>`$${v.toFixed(2)}`;
const mm=(v:number)=>v>=1000?`${(v/1000).toFixed(2)} m`:`${v.toFixed(0)} mm`;
const hours=(h:number)=>`${+h.toFixed(2)} h`;

// A self-contained HTML page sized to print on one US Letter sheet. Opened in a tab it is a quote
// sheet; printed (or "Save as PDF" from the print dialog) it is the PDF.
export function quoteSheetHtml(estimate:Estimate,config:EstimateConfig,meta:EstimateMeta):string{
 const t=estimate.totals,size=`${+(estimate.widthMm/MM_PER_IN).toFixed(2)} x ${+(estimate.heightMm/MM_PER_IN).toFixed(2)} in`;
 const machine=config.machines.find(m=>m.id===estimate.machine.id);
 const machineLabel=`${estimate.machine.name}${estimate.machine.location?` (${estimate.machine.location})`:''}`;
 const rows=estimate.pieces.map(p=>p.manual
  ?`<tr><td>${esc(p.name)}</td><td>${esc(p.materialName)}</td><td class="n" colspan="3">made by hand</td><td class="n">${p.sheetFraction?p.sheetFraction.toFixed(2):'no fit'}</td><td class="n">-</td></tr>`
  :`<tr><td>${esc(p.name)}</td><td>${esc(p.materialName)}</td><td class="n">${mm(p.cutLengthMm)}</td><td class="n">${mm(p.scoreLengthMm)}</td><td class="n">${Math.round(p.engraveAreaMm2).toLocaleString('en-US')} mm²</td><td class="n">${p.sheetFraction?p.sheetFraction.toFixed(2):'no fit'}</td><td class="n">${formatMachineTime(p.minutes.total,estimate.timeConfidence)}</td></tr>`).join('');
 const sheets=estimate.materials.map(m=>`<tr><td>${esc(m.materialName)}</td><td>${esc(m.stockName??'no stock fits')}</td><td class="n">${m.pieces}</td><td class="n">${m.piecesPerSheet||'-'}</td><td class="n">${+m.sheets.toFixed(2)}</td><td class="n">${money(m.cost)}</td></tr>`).join('');
 const line=(label:string,value:string)=>`<tr><td>${label}</td><td class="n">${value}</td></tr>`;
 const unverified=estimate.placeholderInputs.length?` Unverified: ${esc(estimate.placeholderInputs.join(', '))}.`:'';
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Quote sheet - ${esc(meta.title)}</title><style>
@page{size:letter;margin:12mm}
*{box-sizing:border-box}
body{font:10.5px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1d1a16;margin:0;padding:12mm;background:#fff}
@media print{body{padding:0}}
h1{font-size:17px;margin:0 0 2px}
.sub{color:#5b544b;margin:0 0 10px}
.flag{border:1px solid #b45309;background:#fff7ed;color:#7c2d12;padding:6px 8px;margin:8px 0;border-radius:4px}
table{border-collapse:collapse;width:100%;margin:6px 0 12px}
th,td{border-bottom:1px solid #ddd6cc;padding:3px 5px;text-align:left;vertical-align:top}
th{font-size:9.5px;text-transform:uppercase;letter-spacing:.04em;color:#5b544b}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
h2{font-size:12px;margin:10px 0 2px}
.totals{width:50%;margin-left:auto}
.totals tr:last-child td{font-weight:700;border-top:2px solid #1d1a16}
ul{margin:4px 0 0 16px;padding:0}
.foot{color:#5b544b;font-size:9px;margin-top:10px}
</style></head><body>
<h1>${esc(meta.title)} - ${esc(size)}</h1>
<p class="sub">Internal quote sheet (not customer-facing) · ${esc(meta.product)} · ${esc(meta.generatedAt??'')} · recipe ${esc(estimate.recipe?.label??'none')} · ${esc(machineLabel)}</p>
<div class="flag"><b>Machine time: ${esc(confidenceLabel(estimate.timeConfidence))}.</b>${unverified} Prices are from Ben's notes and are unverified. Travel multiplier ${machine?.travelMultiplier??'-'}, ${machine?.perPieceOverheadMin??'-'} min overhead per piece. Roads ${estimate.strokedLines==='engrave'?'engraved':'scored'}.</div>
<h2>Layers</h2>
<table><thead><tr><th>Piece</th><th>Material</th><th class="n">Cut</th><th class="n">Score</th><th class="n">Engrave</th><th class="n">Sheets</th><th class="n">Time</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Sheets by material</h2>
<table><thead><tr><th>Material</th><th>Stock</th><th class="n">Pieces</th><th class="n">Per sheet</th><th class="n">Sheets</th><th class="n">Cost</th></tr></thead><tbody>${sheets}</tbody></table>
<h2>Totals</h2>
<table class="totals"><tbody>
${line('Machine time',esc(formatMachineTime(t.machineMin,estimate.timeConfidence)))}
${line('Material',money(t.materialCost))}
${line(`Supplies (${config.rates.suppliesPct}% of material)`,money(t.suppliesCost))}
${line(`Laser (${money(estimate.machine.hourlyRate)}/h)`,money(t.laserCost))}
${line(`Design (${hours(estimate.design.hours)}${estimate.design.source==='timer'?', timed':''} at ${money(config.rates.designPerHour)}/h)`,money(t.designCost))}
${line('Frame',t.frameCost===null?'not set':money(t.frameCost))}
${line('Suggested total',money(t.suggestedTotal))}
</tbody></table>
${estimate.warnings.length?`<h2>Check before quoting</h2><ul>${estimate.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>`:''}
<p class="foot">Layered Map Studio ${esc(meta.appVersion)}. Sheet use is a bounding-box grid fit, not nesting. Estimate only.</p>
</body></html>`;
}

// What a calibration entry records: this estimate's motion and overhead time on its machine (so the
// multiplier can be re-derived later even after it has been changed) and the time the laser
// software reported.
export function calibrationEntryFrom(estimate:Estimate,config:EstimateConfig,actualMin:number,label:string,now=new Date()):CalibrationEntry{
 const machine=config.machines.find(m=>m.id===estimate.machine.id);
 return {
  id:`cal-${now.getTime().toString(36)}-${Math.round(estimate.totals.motionMin*1000).toString(36)}`,
  recordedAt:now.toISOString(),
  label:label.trim()||'Past job',
  machineId:estimate.machine.id,
  estimatedMotionMin:estimate.totals.motionMin,
  estimatedOverheadMin:estimate.totals.overheadMin,
  multiplierAtTime:machine?.travelMultiplier??1,
  actualMin,
 };
}

// Cut, score and engrave totals over the pieces the laser runs (by-hand pieces take no laser time).
export function operationTotals(estimate:Estimate){
 const lasered=estimate.pieces.filter(p=>!p.manual);
 return {
  cutLengthMm:lasered.reduce((s,p)=>s+p.cutLengthMm,0),
  scoreLengthMm:lasered.reduce((s,p)=>s+p.scoreLengthMm,0),
  engraveAreaMm2:lasered.reduce((s,p)=>s+p.engraveAreaMm2,0),
  cutMin:lasered.reduce((s,p)=>s+p.minutes.cut,0),
  scoreMin:lasered.reduce((s,p)=>s+p.minutes.score,0),
  engraveMin:lasered.reduce((s,p)=>s+p.minutes.engrave,0),
 };
}

// The plain-text half of the export summary: what a person opening the ZIP reads first. Labor is
// the laser time at the machine's rate; design time is listed on its own line.
export function estimateSummaryText(estimate:Estimate,config:EstimateConfig,meta:EstimateMeta):string{
 const t=estimate.totals,ops=operationTotals(estimate);
 const inSize=`${+(estimate.widthMm/MM_PER_IN).toFixed(2)} x ${+(estimate.heightMm/MM_PER_IN).toFixed(2)} in`;
 const machine=`${estimate.machine.name}${estimate.machine.location?` (${estimate.machine.location})`:''}`;
 const last=estimate.calibration.rows.at(-1);
 const lines=[
  `Layered Map Studio estimate - ${meta.title} (${meta.product})`,
  `Size ${inSize} · recipe ${estimate.recipe?.label??'none'} · ${machine}`,
  `Machine time: ${formatMachineTime(t.machineMin,estimate.timeConfidence)} (${t.machineMin.toFixed(1)} min computed) - ${confidenceBadge(estimate.timeConfidence).toUpperCase()}`,
  `  ${confidenceLabel(estimate.timeConfidence)}.${estimate.placeholderInputs.length?` Not entered yet: ${estimate.placeholderInputs.join(', ')}.`:''}`,
  `  Calibration on this machine: ${estimate.calibration.entries?`${estimate.calibration.entries} timed job(s); latest ${formatPercentError(last?.errorPct??null)} against its actual time (gate ${CALIBRATION_GATE_PCT}%)`:'no timed jobs recorded'}.`,
  '',
  'Operations',
  `  Cut     ${(ops.cutLengthMm/1000).toFixed(2)} m   ${ops.cutMin.toFixed(1)} min`,
  `  Score   ${(ops.scoreLengthMm/1000).toFixed(2)} m   ${ops.scoreMin.toFixed(1)} min`,
  `  Engrave ${Math.round(ops.engraveAreaMm2)} mm²   ${ops.engraveMin.toFixed(1)} min`,
  `  Travel multiplier x${config.machines.find(m=>m.id===estimate.machine.id)?.travelMultiplier??'-'}, overhead ${t.overheadMin.toFixed(1)} min`,
  '',
  'Sheets',
  ...estimate.materials.map(m=>`  ${m.materialName}: ${m.pieces} piece(s) on ${+m.sheets.toFixed(2)} x ${m.stockName??'no stock that fits'} = ${money(m.cost)}`),
  '',
  `Material  ${money(t.materialCost)}`,
  `Supplies  ${money(t.suppliesCost)} (${config.rates.suppliesPct}% of material)`,
  `Labor     ${money(t.laserCost)} (laser ${hours(t.machineHours)} at ${money(estimate.machine.hourlyRate)}/h)`,
  `Design    ${money(t.designCost)} (${hours(estimate.design.hours)}${estimate.design.source==='timer'?', timed':''})`,
  `Frame     ${t.frameCost===null?'not set':money(t.frameCost)}`,
  `Total     ${money(t.suggestedTotal)}`,
  ...(estimate.warnings.length?['','Check before quoting',...estimate.warnings.map(w=>`  - ${w}`)]:[]),
  '',
  `Layered Map Studio ${meta.appVersion}. Internal estimate, not a quote. Prices are from Ben's notes.`,
 ];
 return lines.join('\n')+'\n';
}

// The two files a tool's export carries: the JSON record and the text summary.
export function estimateSummaryFiles(estimate:Estimate,config:EstimateConfig,meta:EstimateMeta):{'estimate.json':string;'estimate.txt':string}{
 return {'estimate.json':JSON.stringify(estimateJson(estimate,config,meta),null,1)+'\n','estimate.txt':estimateSummaryText(estimate,config,meta)};
}

// The summary files for a job, for a tool's export. An estimate that cannot be built must not stop
// the cut files from being written, so the failure goes into the summary instead.
export function estimateFilesFor(job:ProductionJob,config:EstimateConfig,design:DesignTime,meta:EstimateMeta):Record<string,string>{
 try{return estimateSummaryFiles(estimateJob(job,config,design),config,meta)}
 catch(error){return {'estimate.txt':`The estimate could not be built for this export: ${(error as Error).message}\n`}}
}
