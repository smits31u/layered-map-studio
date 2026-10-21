import {useEffect,useRef,useState} from 'react';
import {LINE_INTERVAL_UNITS,PLACEHOLDER_LABEL,PRODUCTS,createDefaultEstimateConfig,lineIntervalFromUnit,lineIntervalToUnit,type LineIntervalUnit,type EstimateConfig,type LayerRecipe,type MachineProfile,type MaterialSettings,type RecipeSlot,type SettingField,type StockItem} from '../config';

type Tab='machines'|'materials'|'recipes'|'rates';

// A number field that keeps whatever is being typed (an empty box, "0.") until it parses, so
// clearing a field to retype it does not snap it back to 0. `unverified` puts the placeholder label
// next to it.
function Num({label,value,onChange,min=0,step=.1,suffix,unverified,testId}:{label:string;value:number|null;onChange:(v:number|null)=>void;min?:number;step?:number;suffix?:string;unverified?:boolean;testId?:string}){
 const[text,setText]=useState(value===null?'':String(value));
 // Follows outside changes (Reset to defaults) without fighting the text being typed.
 useEffect(()=>{if(value===null?text!=='':Number(text)!==value)setText(value===null?'':String(value))},[value]);
 return <label>{label}{unverified&&<span className="estimate-placeholder">{PLACEHOLDER_LABEL}</span>}<span className="estimate-num"><input type="number" min={min} step={step} value={text} data-testid={testId} onChange={e=>{setText(e.target.value);if(e.target.value==='')onChange(null);else if(Number.isFinite(+e.target.value)&&+e.target.value>=min)onChange(+e.target.value)}}/>{suffix&&<small>{suffix}</small>}</span></label>;
}

export function EstimateSettings({config,setConfig,onClose}:{config:EstimateConfig;setConfig:(c:EstimateConfig)=>void;onClose:()=>void}){
 const[tab,setTab]=useState<Tab>('machines');
 const[machineId,setMachineId]=useState(config.defaultMachineId);
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{ref.current?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose()};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[onClose]);
 const machine=config.machines.find(m=>m.id===machineId)??config.machines[0];
 const patchMachine=(fields:Partial<MachineProfile>)=>setConfig({...config,machines:config.machines.map(m=>m.id===machine.id?{...m,...fields}:m)});
 // Editing a value means a real number is going in: that field stops being a placeholder.
 const patchSettings=(materialId:string,field:SettingField,value:number)=>patchMachine({settings:machine.settings.map(s=>s.materialId===materialId?{...s,[field]:value,placeholder:s.placeholder.filter(f=>f!==field)}:s)});
 const markPlaceholder=(materialId:string)=>patchMachine({settings:machine.settings.map(s=>s.materialId===materialId?{...s,placeholder:['cutSpeedMmS','cutPowerPct','cutPasses','scoreSpeedMmS','scorePowerPct','engraveSpeedMmS','engravePowerPct','lineIntervalMm']}:s)});
 const patchStock=(id:string,fields:Partial<StockItem>)=>setConfig({...config,stock:config.stock.map(s=>s.id===id?{...s,...fields}:s)});
 const patchRecipe=(id:string,fields:Partial<LayerRecipe>)=>setConfig({...config,recipes:config.recipes.map(r=>r.id===id?{...r,...fields}:r)});
 const patchSlot=(recipe:LayerRecipe,index:number,fields:Partial<RecipeSlot>)=>patchRecipe(recipe.id,{slots:recipe.slots.map((s,i)=>i===index?{...s,...fields}:s)});
 const materialName=(id:string)=>config.materials.find(m=>m.id===id)?.name??id;
 const addMachine=()=>{const id=`machine-${Date.now().toString(36)}`;setConfig({...config,machines:[...config.machines,{...structuredClone(machine),id,name:'New laser',location:'',bedPlaceholder:true,settings:machine.settings.map(s=>({...s,placeholder:['cutSpeedMmS','cutPowerPct','cutPasses','scoreSpeedMmS','scorePowerPct','engraveSpeedMmS','engravePowerPct','lineIntervalMm']}))}]});setMachineId(id)};
 const removeMachine=()=>{if(config.machines.length<2)return;const rest=config.machines.filter(m=>m.id!==machine.id);setConfig({...config,machines:rest,defaultMachineId:config.defaultMachineId===machine.id?rest[0].id:config.defaultMachineId});setMachineId(rest[0].id)};
 const addStock=()=>setConfig({...config,stock:[...config.stock,{id:`stock-${Date.now().toString(36)}`,name:'New stock',materialIds:[config.materials[0]?.id??''],widthIn:12,heightIn:24,packPrice:0,packQty:1}]});
 const addRecipe=()=>setConfig({...config,recipes:[...config.recipes,{id:`recipe-${Date.now().toString(36)}`,label:'New size',widthIn:16,heightIn:20,slots:[{kind:'layer',materialId:config.materials[0]?.id??'',count:5}],frameCost:null}]});
 const reset=()=>{if(window.confirm('Reset every estimate setting to the defaults? Calibration entries are kept.'))setConfig({...createDefaultEstimateConfig(),calibration:config.calibration})};
 const field=(s:MaterialSettings,key:SettingField,label:string,suffix:string,min:number,step:number,round=false)=><Num label={label} suffix={suffix} value={s[key]} min={min} step={step} unverified={s.placeholder.includes(key)} testId={`${machine.id}-${s.materialId}-${key}`} onChange={v=>v!==null&&patchSettings(s.materialId,key,round?Math.round(v):v)}/>;

 // Shown and typed in the chosen unit (xTool Studio's lines/cm by default), stored in mm.
 const unit=config.lineIntervalUnit;
 const lineInterval=(s:MaterialSettings)=><Num label="Line interval" suffix={LINE_INTERVAL_UNITS[unit]} value={Number(lineIntervalToUnit(s.lineIntervalMm,unit).toFixed(unit==='mm'?4:1))} min={unit==='mm'?.001:1} step={unit==='mm'?.005:10} unverified={s.placeholder.includes('lineIntervalMm')} testId={`${machine.id}-${s.materialId}-lineIntervalMm`} onChange={v=>v!==null&&v>0&&patchSettings(s.materialId,'lineIntervalMm',lineIntervalFromUnit(v,unit))}/>;

 return <div className="estimate-dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
  <div className="estimate-dialog" role="dialog" aria-modal="true" aria-label="Estimate settings" tabIndex={-1} ref={ref}>
   <header><h2>Estimate settings</h2><button className="btn-quiet" onClick={onClose} aria-label="Close settings">Close</button></header>
   <div className="nav-tabs estimate-tabs" role="tablist">{(['machines','materials','recipes','rates'] as Tab[]).map(t=><button key={t} role="tab" aria-selected={tab===t} className={tab===t?'active':''} onClick={()=>setTab(t)}>{t==='machines'?'Machines':t==='materials'?'Materials & stock':t==='recipes'?'Layer recipes':'Rates & fit'}</button>)}</div>
   <div className="estimate-dialog-body">
    {tab==='machines'&&<>
     <div className="estimate-machine-pick" role="group" aria-label="Machine">{config.machines.map(m=><button key={m.id} className={m.id===machine.id?'active':''} onClick={()=>setMachineId(m.id)}>{m.name}{m.location?` (${m.location})`:''}</button>)}<button className="btn-quiet" onClick={addMachine}>+ Machine</button></div>
     <div className="field-pair"><label>Name <input value={machine.name} onChange={e=>patchMachine({name:e.target.value})}/></label><label>Location <input value={machine.location} onChange={e=>patchMachine({location:e.target.value})}/></label></div>
     <div className="field-pair"><Num label="Bed width" suffix="mm" value={machine.bedWidthMm} min={10} step={1} unverified={machine.bedPlaceholder} onChange={v=>v!==null&&patchMachine({bedWidthMm:v,bedPlaceholder:false})}/><Num label="Bed height" suffix="mm" value={machine.bedHeightMm} min={10} step={1} unverified={machine.bedPlaceholder} onChange={v=>v!==null&&patchMachine({bedHeightMm:v,bedPlaceholder:false})}/></div>
     <div className="field-pair"><Num label="Laser rate" suffix="$/h" value={machine.hourlyRate} step={1} onChange={v=>v!==null&&patchMachine({hourlyRate:v})}/><Num label="Overhead per piece" suffix="min" value={machine.perPieceOverheadMin} step={.5} onChange={v=>v!==null&&patchMachine({perPieceOverheadMin:v})}/></div>
     <div className="field-pair"><Num label="Travel multiplier" suffix="x" value={machine.travelMultiplier} min={.1} step={.05} onChange={v=>v!==null&&patchMachine({travelMultiplier:v})}/><label>Line interval in <select aria-label="Line interval unit" value={unit} onChange={e=>setConfig({...config,lineIntervalUnit:e.target.value as LineIntervalUnit})}>{(Object.keys(LINE_INTERVAL_UNITS) as LineIntervalUnit[]).map(u=><option key={u} value={u}>{LINE_INTERVAL_UNITS[u]}</option>)}</select></label></div>
     <label className="check"><input type="checkbox" checked={config.defaultMachineId===machine.id} onChange={e=>e.target.checked&&setConfig({...config,defaultMachineId:machine.id})}/> Default machine (sizes with no recipe and no bed that fits)</label>
     <small>Time per piece = (cut length x passes / cut speed + score length / score speed + engrave area / (engrave speed x line interval)) x travel multiplier + overhead. Power does not change the time; it is kept here as your reference.</small>
     {machine.settings.map(s=><fieldset key={s.materialId} className="estimate-fieldset"><legend>{materialName(s.materialId)}{s.placeholder.length===0?<span className="estimate-entered">all entered</span>:<button className="btn-quiet" onClick={()=>markPlaceholder(s.materialId)} title="Label every value in this row as unverified again">Mark all unverified</button>}</legend>
      <div className="field-pair">{field(s,'cutSpeedMmS','Cut speed','mm/s',.1,1)}{field(s,'cutPowerPct','Cut power','%',0,1)}</div>
      <div className="field-pair">{field(s,'cutPasses','Cut passes','',1,1,true)}{field(s,'engraveSpeedMmS','Engrave speed','mm/s',.1,10)}</div>
      <div className="field-pair">{field(s,'engravePowerPct','Engrave power','%',0,1)}{lineInterval(s)}</div>
      <div className="field-pair">{field(s,'scoreSpeedMmS','Score speed','mm/s',.1,1)}{field(s,'scorePowerPct','Score power','%',0,1)}</div>
     </fieldset>)}
     <button className="btn-quiet" onClick={removeMachine} disabled={config.machines.length<2}>Remove this machine</button>
    </>}
    {tab==='materials'&&<>
     <h3>Materials</h3>
     {config.materials.map(m=><div key={m.id} className="field-pair"><label>Name <input value={m.name} onChange={e=>setConfig({...config,materials:config.materials.map(x=>x.id===m.id?{...x,name:e.target.value}:x)})}/></label><Num label="Thickness" suffix="mm" value={m.thicknessMm} min={.1} step={.005} unverified={Boolean(m.note)} onChange={v=>v!==null&&setConfig({...config,materials:config.materials.map(x=>x.id===m.id?{...x,thicknessMm:v,note:undefined}:x)})}/></div>)}
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
     <small>Pieces listed top of the stack first. Layer slots are filled from the generated scene's layers in order; a border slot is an extra piece the scene does not draw. "By hand" pieces are bought but take no laser time.</small>
     {config.recipes.map(r=><fieldset key={r.id} className="estimate-fieldset"><legend>{r.label}</legend>
      <div className="field-pair"><Num label="Width" suffix="in" value={r.widthIn} min={.5} onChange={v=>v!==null&&patchRecipe(r.id,{widthIn:v,label:`${v}x${r.heightIn}`})}/><Num label="Height" suffix="in" value={r.heightIn} min={.5} onChange={v=>v!==null&&patchRecipe(r.id,{heightIn:v,label:`${r.widthIn}x${v}`})}/></div>
      <label>Cut on <select aria-label={`Machine for ${r.label}`} value={r.machineId??''} onChange={e=>patchRecipe(r.id,{machineId:e.target.value||undefined})}><option value="">Smallest bed that fits</option>{config.machines.map(m=><option key={m.id} value={m.id}>{m.name}{m.location?` (${m.location})`:''}</option>)}</select></label>
      <label>For <select aria-label={`Products for ${r.label}`} value={r.products?.[0]??''} onChange={e=>patchRecipe(r.id,{products:e.target.value?[e.target.value]:[]})}><option value="">Every product</option>{Object.entries(PRODUCTS).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
      {r.slots.map((s,i)=><div key={i} className="estimate-slot">
       <select aria-label="Slot kind" value={s.kind} onChange={e=>patchSlot(r,i,{kind:e.target.value as RecipeSlot['kind']})}><option value="layer">Layer</option><option value="border">Border</option></select>
       <select aria-label="Slot material" value={s.materialId} onChange={e=>patchSlot(r,i,{materialId:e.target.value})}>{config.materials.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select>
       <input aria-label="Slot count" type="number" min="0" step="1" value={s.count} onChange={e=>patchSlot(r,i,{count:Math.max(0,Math.round(+e.target.value||0))})}/>
       <label className="check"><input type="checkbox" checked={Boolean(s.upTo)} onChange={e=>patchSlot(r,i,{upTo:e.target.checked})}/>up to</label>
       <label className="check"><input type="checkbox" checked={Boolean(s.manual)} onChange={e=>patchSlot(r,i,{manual:e.target.checked})}/>by hand</label>
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
     <div className="field-pair"><Num label="Design" suffix="$/h" value={config.rates.designPerHour} step={1} onChange={v=>v!==null&&setConfig({...config,rates:{...config.rates,designPerHour:v}})}/><Num label="Default design time" suffix="h" value={config.rates.designHours} step={.25} onChange={v=>v!==null&&setConfig({...config,rates:{...config.rates,designHours:v}})}/></div>
     <small>The design timer in the estimate panel replaces the default design time once it has counted a minute.</small>
     <Num label="Supplies" suffix="% of material" value={config.rates.suppliesPct} step={1} onChange={v=>v!==null&&setConfig({...config,rates:{...config.rates,suppliesPct:v}})}/>
     <label>Roads (stroked lines) <select value={config.strokedLines} onChange={e=>setConfig({...config,strokedLines:e.target.value as EstimateConfig['strokedLines']})}><option value="engrave">Engraved (area = length x width)</option><option value="score">Scored (one pass along the line)</option></select></label>
     <div className="field-pair"><Num label="Sheet margin" suffix="mm" value={config.sheetMarginMm} step={.5} onChange={v=>v!==null&&setConfig({...config,sheetMarginMm:v})}/><Num label="Piece spacing" suffix="mm" value={config.pieceSpacingMm} step={.5} onChange={v=>v!==null&&setConfig({...config,pieceSpacingMm:v})}/></div>
     <label className="check"><input type="checkbox" checked={config.chargeWholeSheets} onChange={e=>setConfig({...config,chargeWholeSheets:e.target.checked})}/> Charge whole sheets (off: only the fraction used)</label>
     <Num label="Laser-cut border width" suffix="mm (only when not by hand)" value={config.borderWidthMm} min={1} step={.5} onChange={v=>v!==null&&setConfig({...config,borderWidthMm:v})}/>
    </>}
   </div>
   <footer><small>Saved in this browser automatically.</small><button className="btn-quiet" onClick={reset}>Reset to defaults</button></footer>
  </div>
 </div>;
}
