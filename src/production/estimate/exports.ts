import {MM_PER_IN,type CalibrationEntry,type EstimateConfig} from './config';
import {confidenceLabel,formatMachineTime,type Estimate} from './estimate';

// The estimate's two file outputs: a JSON record for a future Business Suite import, and a one-page
// printable quote sheet for Ben's own reference. Neither is customer-facing, and neither is sent
// anywhere: both are built here and handed to the browser as a download.

export type EstimateMeta={product:string;title:string;generatedAt:string;appVersion:string};

export const ESTIMATE_JSON_SCHEMA='layered-map-studio.estimate/1';

const round=(v:number,places=2)=>Number(v.toFixed(places));

export function estimateJson(estimate:Estimate,config:EstimateConfig,meta:EstimateMeta){
 return {
  schema:ESTIMATE_JSON_SCHEMA,
  ...meta,
  notice:'Internal estimate. Machine times are '+(estimate.timeConfidence==='calibrated'?'calibrated against recorded jobs':'not calibrated')+'; prices are from Ben\'s notes and need verifying.',
  size:{widthMm:round(estimate.widthMm,3),heightMm:round(estimate.heightMm,3),widthIn:round(estimate.widthMm/MM_PER_IN,3),heightIn:round(estimate.heightMm/MM_PER_IN,3)},
  recipe:estimate.recipe,
  machine:{id:config.machine.id,name:config.machine.name,travelMultiplier:config.machine.travelMultiplier,perPieceOverheadMin:config.machine.perPieceOverheadMin},
  timeConfidence:estimate.timeConfidence,
  pieces:estimate.pieces.map(p=>({id:p.id,name:p.name,role:p.role,material:p.materialId,thicknessMm:p.thicknessMm,stock:p.stockId,sheetFraction:round(p.sheetFraction,4),cutLengthMm:round(p.cutLengthMm,1),scoreLengthMm:round(p.scoreLengthMm,1),engraveAreaMm2:round(p.engraveAreaMm2,1),fitsStock:p.fitsStock,fitsBed:p.fitsBed,minutes:Object.fromEntries(Object.entries(p.minutes).map(([k,v])=>[k,round(v,2)]))})),
  materials:estimate.materials.map(m=>({material:m.materialId,stock:m.stockId,pieces:m.pieces,piecesPerSheet:m.piecesPerSheet,sheets:round(m.sheets,3),sheetPrice:round(m.sheetPrice),cost:round(m.cost),unplaced:m.unplaced})),
  totals:Object.fromEntries(Object.entries(estimate.totals).map(([k,v])=>[k,v===null?null:round(v,k.endsWith('Min')||k.endsWith('Hours')?3:2)])),
  rates:config.rates,
  calibration:{entries:estimate.calibration.entries,meanRatio:estimate.calibration.meanRatio===null?null:round(estimate.calibration.meanRatio,3),suggestedMultiplier:estimate.calibration.suggestedMultiplier===null?null:round(estimate.calibration.suggestedMultiplier,3)},
  warnings:estimate.warnings,
 };
}

const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]!));
const money=(v:number)=>`$${v.toFixed(2)}`;
const mm=(v:number)=>v>=1000?`${(v/1000).toFixed(2)} m`:`${v.toFixed(0)} mm`;

// A self-contained HTML page sized to print on one US Letter sheet. Opened in a tab it is a quote
// sheet; printed (or "Save as PDF" from the print dialog) it is the PDF.
export function quoteSheetHtml(estimate:Estimate,config:EstimateConfig,meta:EstimateMeta):string{
 const t=estimate.totals,size=`${+(estimate.widthMm/MM_PER_IN).toFixed(2)} x ${+(estimate.heightMm/MM_PER_IN).toFixed(2)} in`;
 const rows=estimate.pieces.map(p=>`<tr><td>${esc(p.name)}</td><td>${esc(p.materialName)}</td><td class="n">${mm(p.cutLengthMm)}</td><td class="n">${mm(p.scoreLengthMm)}</td><td class="n">${Math.round(p.engraveAreaMm2).toLocaleString('en-US')} mm²</td><td class="n">${p.sheetFraction?p.sheetFraction.toFixed(2):'no fit'}</td><td class="n">${formatMachineTime(p.minutes.total,estimate.timeConfidence)}</td></tr>`).join('');
 const sheets=estimate.materials.map(m=>`<tr><td>${esc(m.materialName)}</td><td>${esc(m.stockName??'no stock fits')}</td><td class="n">${m.pieces}</td><td class="n">${m.piecesPerSheet||'-'}</td><td class="n">${+m.sheets.toFixed(2)}</td><td class="n">${money(m.cost)}</td></tr>`).join('');
 const line=(label:string,value:string)=>`<tr><td>${label}</td><td class="n">${value}</td></tr>`;
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
<p class="sub">Internal quote sheet (not customer-facing) · ${esc(meta.product)} · ${esc(meta.generatedAt)} · recipe ${esc(estimate.recipe?.label??'none')} · ${esc(config.machine.name)}</p>
<div class="flag"><b>Machine time: ${esc(confidenceLabel(estimate.timeConfidence))}.</b> Prices are from Ben's notes and are unverified. Travel multiplier ${config.machine.travelMultiplier}, ${config.machine.perPieceOverheadMin} min overhead per piece.</div>
<h2>Layers</h2>
<table><thead><tr><th>Piece</th><th>Material</th><th class="n">Cut</th><th class="n">Score</th><th class="n">Engrave</th><th class="n">Sheets</th><th class="n">Time</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Sheets by material</h2>
<table><thead><tr><th>Material</th><th>Stock</th><th class="n">Pieces</th><th class="n">Per sheet</th><th class="n">Sheets</th><th class="n">Cost</th></tr></thead><tbody>${sheets}</tbody></table>
<h2>Totals</h2>
<table class="totals"><tbody>
${line('Machine time',esc(formatMachineTime(t.machineMin,estimate.timeConfidence)))}
${line('Material',money(t.materialCost))}
${line(`Supplies (${config.rates.suppliesPct}% of material)`,money(t.suppliesCost))}
${line(`Laser (${money(config.rates.laserPerHour)}/h)`,money(t.laserCost))}
${line(`Design (${config.rates.designHours} h at ${money(config.rates.designPerHour)}/h)`,money(t.designCost))}
${line('Frame',t.frameCost===null?'not set':money(t.frameCost))}
${line('Suggested total',money(t.suggestedTotal))}
</tbody></table>
${estimate.warnings.length?`<h2>Check before quoting</h2><ul>${estimate.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>`:''}
<p class="foot">Layered Map Studio ${esc(meta.appVersion)}. Sheet use is a bounding-box grid fit, not nesting. Estimate only.</p>
</body></html>`;
}

// What a calibration entry records: this estimate's motion and overhead time (so the multiplier
// can be re-derived later even after it has been changed) and the time xTool Studio reported.
export function calibrationEntryFrom(estimate:Estimate,config:EstimateConfig,actualMin:number,label:string,now=new Date()):CalibrationEntry{
 return {
  id:`cal-${now.getTime().toString(36)}-${Math.round(estimate.totals.motionMin*1000).toString(36)}`,
  recordedAt:now.toISOString(),
  label:label.trim()||'Past job',
  estimatedMotionMin:estimate.totals.motionMin,
  estimatedOverheadMin:estimate.totals.overheadMin,
  multiplierAtTime:config.machine.travelMultiplier,
  actualMin,
 };
}
