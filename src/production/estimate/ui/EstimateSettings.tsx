import {useEffect,useRef,useState} from 'react';
import {PLACEHOLDER_LABEL,createDefaultEstimateConfig,type EstimateConfig,type LayerRecipe,type MaterialSettings,type RecipeSlot,type StockItem} from '../config';

type Tab='machine'|'materials'|'recipes'|'rates';

// A number field that keeps whatever is being typed (an empty box, "0.") until it parses, so
// clearing a field to retype it does not snap it back to 0.
function Num({label,value,onChange,min=0,step=.1,suffix,testId}:{label:string;value:number|null;onChange:(v:number|null)=>void;min?:number;step?:number;suffix?:string;testId?:string}){
 const[text,setText]=useState(value===null?'':String(value));
 // Follows outside changes (Reset to defaults) without fighting the text being typed.
 useEffect(()=>{if(value===null?text!=='':Number(text)!==value)setText(value===null?'':String(value))},[value]);
 return <label>{label}<span className="estimate-num"><input type="number" min={min} step={step} value={text} data-testid={testId} onChange={e=>{setText(e.target.value);if(e.target.value==='')onChange(null);else if(Number.isFinite(+e.target.value)&&+e.target.value>=min)onChange(+e.target.value)}}/>{suffix&&<small>{suffix}</small>}</span></label>;
}

export function EstimateSettings({config,setConfig,onClose}:{config:EstimateConfig;setConfig:(c:EstimateConfig)=>void;onClose:()=>void}){
 const[tab,setTab]=useState<Tab>('machine');
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{ref.current?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose()};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[onClose]);
 const machine=config.machine;
 const patchMachine=(fields:Partial<EstimateConfig['machine']>)=>setConfig({...config,machine:{...machine,...fields}});
 // Editing any value in a material's row means real numbers are going in: the row stops being a
 // placeholder. "Mark placeholder" puts the label back if that was a mistake.
 const patchSettings=(materialId:string,fields:Partial<MaterialSettings>)=>patchMachine({settings:machine.settings.map(s=>s.materialId===materialId?{...s,...fields,placeholder:'placeholder' in fields?Boolean(fields.placeholder):false}:s)});
 const patchStock=(id:string,fields:Partial<StockItem>)=>setConfig({...config,stock:config.stock.map(s=>s.id===id?{...s,...fields}:s)});
 const patchRecipe=(id:string,fields:Partial<LayerRecipe>)=>setConfig({...config,recipes:config.recipes.map(r=>r.id===id?{...r,...fields}:r)});
 const patchSlot=(recipe:LayerRecipe,index:number,fields:Partial<RecipeSlot>)=>patchRecipe(recipe.id,{slots:recipe.slots.map((s,i)=>i===index?{...s,...fields}:s)});
 const materialName=(id:string)=>config.materials.find(m=>m.id===id)?.name??id;
 const addStock=()=>setConfig({...config,stock:[...config.stock,{id:`stock-${Date.now().toString(36)}`,name:'New stock',materialIds:[config.materials[0]?.id??''],widthIn:12,heightIn:24,packPrice:0,packQty:1}]});
 const addRecipe=()=>setConfig({...config,recipes:[...config.recipes,{id:`recipe-${Date.now().toString(36)}`,label:'New size',widthIn:16,heightIn:20,slots:[{kind:'layer',materialId:config.materials[0]?.id??'',count:5}],frameCost:null}]});
 const reset=()=>{if(window.confirm('Reset every estimate setting to the defaults from Ben\'s notes? Calibration entries are kept.'))setConfig({...createDefaultEstimateConfig(),calibration:config.calibration})};

 return <div className="estimate-dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
  <div className="estimate-dialog" role="dialog" aria-modal="true" aria-label="Estimate settings" tabIndex={-1} ref={ref}>
   <header><h2>Estimate settings</h2><button className="btn-quiet" onClick={onClose} aria-label="Close settings">Close</button></header>
   <div className="nav-tabs estimate-tabs" role="tablist">{(['machine','materials','recipes','rates'] as Tab[]).map(t=><button key={t} role="tab" aria-selected={tab===t} className={tab===t?'active':''} onClick={()=>setTab(t)}>{t==='machine'?'Machine':t==='materials'?'Materials & stock':t==='recipes'?'Layer recipes':'Rates & fit'}</button>)}</div>
   <div className="estimate-dialog-body">
    {tab==='machine'&&<>
     <label>Machine <input value={machine.name} onChange={e=>patchMachine({name:e.target.value})}/></label>
     <div className="field-pair"><Num label="Bed width" suffix="mm" value={machine.bedWidthMm} min={10} step={1} onChange={v=>v!==null&&patchMachine({bedWidthMm:v,bedPlaceholder:false})}/><Num label="Bed height" suffix="mm" value={machine.bedHeightMm} min={10} step={1} onChange={v=>v!==null&&patchMachine({bedHeightMm:v,bedPlaceholder:false})}/></div>
     {machine.bedPlaceholder&&<small className="estimate-placeholder">Bed size: xTool's published P2S work area, not measured. {PLACEHOLDER_LABEL}</small>}
     <div className="field-pair"><Num label="Overhead per piece" suffix="min" value={machine.perPieceOverheadMin} step={.5} onChange={v=>v!==null&&patchMachine({perPieceOverheadMin:v})}/><Num label="Travel multiplier" suffix="x" value={machine.travelMultiplier} min={.1} step={.05} onChange={v=>v!==null&&patchMachine({travelMultiplier:v})}/></div>
     <small>Time per piece = (cut length x passes / cut speed + score length / score speed + engrave area / (engrave speed x line interval)) x travel multiplier + overhead.</small>
     {machine.settings.map(s=><fieldset key={s.materialId} className="estimate-fieldset"><legend>{materialName(s.materialId)} {s.placeholder?<span className="estimate-placeholder" data-testid={`placeholder-${s.materialId}`}>{PLACEHOLDER_LABEL}</span>:<button className="btn-quiet" onClick={()=>patchSettings(s.materialId,{placeholder:true})}>Mark placeholder</button>}</legend>
      <div className="field-pair"><Num label="Cut speed" suffix="mm/s" value={s.cutSpeedMmS} min={.1} onChange={v=>v!==null&&patchSettings(s.materialId,{cutSpeedMmS:v})}/><Num label="Cut power" suffix="%" value={s.cutPowerPct} step={1} onChange={v=>v!==null&&patchSettings(s.materialId,{cutPowerPct:v})}/></div>
      <div className="field-pair"><Num label="Cut passes" value={s.cutPasses} min={1} step={1} onChange={v=>v!==null&&patchSettings(s.materialId,{cutPasses:Math.round(v)})}/><Num label="Score speed" suffix="mm/s" value={s.scoreSpeedMmS} min={.1} onChange={v=>v!==null&&patchSettings(s.materialId,{scoreSpeedMmS:v})}/></div>
      <div className="field-pair"><Num label="Score power" suffix="%" value={s.scorePowerPct} step={1} onChange={v=>v!==null&&patchSettings(s.materialId,{scorePowerPct:v})}/><Num label="Engrave speed" suffix="mm/s" value={s.engraveSpeedMmS} min={.1} step={1} onChange={v=>v!==null&&patchSettings(s.materialId,{engraveSpeedMmS:v})}/></div>
      <div className="field-pair"><Num label="Engrave power" suffix="%" value={s.engravePowerPct} step={1} onChange={v=>v!==null&&patchSettings(s.materialId,{engravePowerPct:v})}/><Num label="Line interval" suffix="mm" value={s.lineIntervalMm} min={.005} step={.01} onChange={v=>v!==null&&patchSettings(s.materialId,{lineIntervalMm:v})}/></div>
     </fieldset>)}
    </>}
    {tab==='materials'&&<>
     <h3>Materials</h3>
     {config.materials.map(m=><div key={m.id} className="field-pair"><label>Name <input value={m.name} onChange={e=>setConfig({...config,materials:config.materials.map(x=>x.id===m.id?{...x,name:e.target.value}:x)})}/></label><Num label="Thickness" suffix="mm" value={m.thicknessMm} min={.1} step={.005} onChange={v=>v!==null&&setConfig({...config,materials:config.materials.map(x=>x.id===m.id?{...x,thicknessMm:v,note:undefined}:x)})}/></div>)}
     <h3>Stock used per material</h3>
     {config.materials.map(m=><label key={m.id}>{m.name}<select value={config.stockSelection[m.id]??'auto'} onChange={e=>setConfig({...config,stockSelection:{...config.stockSelection,[m.id]:e.target.value}})}><option value="auto">Cheapest that fits</option>{config.stock.filter(s=>s.materialIds.includes(m.id)).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>)}
     <h3>Stock and prices</h3>
     {config.stock.map(s=><fieldset key={s.id} className="estimate-fieldset"><legend>{s.name}{s.note&&<small> · {s.note}</small>}</legend>
      <label>Name <input value={s.name} onChange={e=>patchStock(s.id,{name:e.target.value})}/></label>
      <div className="toggle-grid" role="group" aria-label={`Materials for ${s.name}`}>{config.materials.map(m=><label key={m.id} className="toggle-chip"><input type="checkbox" checked={s.materialIds.includes(m.id)} onChange={e=>patchStock(s.id,{materialIds:e.target.checked?[...s.materialIds,m.id]:s.materialIds.filter(x=>x!==m.id)})}/>{m.name}</label>)}</div>
      <div className="field-pair"><Num label="Width" suffix="in" value={s.widthIn} min={.5} onChange={v=>patchStock(s.id,{widthIn:v,...(v===null?{heightIn:null}:{})})}/><Num label="Height" suffix="in" value={s.heightIn} min={.5} onChange={v=>patchStock(s.id,{heightIn:v,...(v===null?{widthIn:null}:{})})}/></div>
      {s.widthIn===null&&<small>No size: bought per piece at the size needed.</small>}
      <div className="field-pair"><Num label="Pack price" suffix="$" value={s.packPrice} step={.01} onChange={v=>v!==null&&patchStock(s.id,{packPrice:v})}/><Num label="Pieces per pack" value={s.packQty} min={1} step={1} onChange={v=>v!==null&&patchStock(s.id,{packQty:Math.max(1,Math.round(v))})}/></div>
      <button className="btn-quiet" onClick={()=>setConfig({...config,stock:config.stock.filter(x=>x.id!==s.id)})}>Remove stock</button>
     </fieldset>)}
     <button onClick={addStock}>+ Add stock</button>
    </>}
    {tab==='recipes'&&<>
     <small>Pieces listed top of the stack first. Layer slots are filled from the generated scene's layers in order; a border slot is an extra piece the scene does not draw.</small>
     {config.recipes.map(r=><fieldset key={r.id} className="estimate-fieldset"><legend>{r.label}</legend>
      <div className="field-pair"><Num label="Width" suffix="in" value={r.widthIn} min={.5} onChange={v=>v!==null&&patchRecipe(r.id,{widthIn:v,label:`${v}x${r.heightIn}`})}/><Num label="Height" suffix="in" value={r.heightIn} min={.5} onChange={v=>v!==null&&patchRecipe(r.id,{heightIn:v,label:`${r.widthIn}x${v}`})}/></div>
      {r.slots.map((s,i)=><div key={i} className="estimate-slot">
       <select aria-label="Slot kind" value={s.kind} onChange={e=>patchSlot(r,i,{kind:e.target.value as RecipeSlot['kind']})}><option value="layer">Layer</option><option value="border">Border</option></select>
       <select aria-label="Slot material" value={s.materialId} onChange={e=>patchSlot(r,i,{materialId:e.target.value})}>{config.materials.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select>
       <input aria-label="Slot count" type="number" min="0" step="1" value={s.count} onChange={e=>patchSlot(r,i,{count:Math.max(0,Math.round(+e.target.value||0))})}/>
       <label className="check"><input type="checkbox" checked={Boolean(s.upTo)} onChange={e=>patchSlot(r,i,{upTo:e.target.checked})}/>up to</label>
       <button className="btn-quiet" aria-label="Remove slot" onClick={()=>patchRecipe(r.id,{slots:r.slots.filter((_,j)=>j!==i)})}>x</button>
       {s.note&&<small>{s.note}</small>}
      </div>)}
      <button className="btn-quiet" onClick={()=>patchRecipe(r.id,{slots:[...r.slots,{kind:'layer',materialId:config.materials[0]?.id??'',count:1}]})}>+ Slot</button>
      <Num label="Frame cost" suffix="$ (blank = none)" value={r.frameCost} step={.01} onChange={v=>patchRecipe(r.id,{frameCost:v})}/>
      <button className="btn-quiet" onClick={()=>setConfig({...config,recipes:config.recipes.filter(x=>x.id!==r.id)})}>Remove size</button>
     </fieldset>)}
     <button onClick={addRecipe}>+ Add size</button>
    </>}
    {tab==='rates'&&<>
     <div className="field-pair"><Num label="Laser" suffix="$/h" value={config.rates.laserPerHour} step={1} onChange={v=>v!==null&&setConfig({...config,rates:{...config.rates,laserPerHour:v}})}/><Num label="Design" suffix="$/h" value={config.rates.designPerHour} step={1} onChange={v=>v!==null&&setConfig({...config,rates:{...config.rates,designPerHour:v}})}/></div>
     <div className="field-pair"><Num label="Design time" suffix="h" value={config.rates.designHours} step={.25} onChange={v=>v!==null&&setConfig({...config,rates:{...config.rates,designHours:v}})}/><Num label="Supplies" suffix="% of material" value={config.rates.suppliesPct} step={1} onChange={v=>v!==null&&setConfig({...config,rates:{...config.rates,suppliesPct:v}})}/></div>
     <div className="field-pair"><Num label="Sheet margin" suffix="mm" value={config.sheetMarginMm} step={.5} onChange={v=>v!==null&&setConfig({...config,sheetMarginMm:v})}/><Num label="Piece spacing" suffix="mm" value={config.pieceSpacingMm} step={.5} onChange={v=>v!==null&&setConfig({...config,pieceSpacingMm:v})}/></div>
     <label className="check"><input type="checkbox" checked={config.chargeWholeSheets} onChange={e=>setConfig({...config,chargeWholeSheets:e.target.checked})}/> Charge whole sheets (off: only the fraction used)</label>
     <Num label="Border frame width" suffix="mm (assumed)" value={config.borderWidthMm} min={1} step={.5} onChange={v=>v!==null&&setConfig({...config,borderWidthMm:v})}/>
    </>}
   </div>
   <footer><small>Saved in this browser automatically.</small><button className="btn-quiet" onClick={reset}>Reset to defaults</button></footer>
  </div>
 </div>;
}
