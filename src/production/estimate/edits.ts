import type {EstimateConfig,MachineGuessField,MachineProfile} from './config';

// Estimate settings edits that carry a rule beyond "set this field", kept out of the settings dialog
// so the rules are tested on their own.

const patchMachine=(config:EstimateConfig,machineId:string,patch:(m:MachineProfile)=>MachineProfile):EstimateConfig=>({...config,machines:config.machines.map(m=>m.id===machineId?patch(m):m)});

// Typing a machine value (or keeping the one shown) makes it Ben's: it stops being listed as a guess.
// Setting the travel multiplier also starts a new calibration check: only jobs recorded after it count.
export function setMachineValue(config:EstimateConfig,machineId:string,field:MachineGuessField,value:number,now=new Date()):EstimateConfig{
 return patchMachine(config,machineId,m=>({...m,[field]:value,guessed:m.guessed.filter(f=>f!==field),...(field==='travelMultiplier'?{multiplierSetAt:now.toISOString()}:{})}));
}

export const keepMachineValue=(config:EstimateConfig,machineId:string,field:MachineGuessField,now=new Date())=>{const m=config.machines.find(x=>x.id===machineId);return m?setMachineValue(config,machineId,field,m[field],now):config};

// The multiplier suggested by calibration, rounded to what the settings field shows.
export const applySuggestedMultiplier=(config:EstimateConfig,machineId:string,multiplier:number,now=new Date())=>setMachineValue(config,machineId,'travelMultiplier',Number(multiplier.toFixed(3)),now);

// A material whose chosen stock is removed, or no longer lists the material, goes back to 'auto'.
// Left pointing at it, the material matched no stock and cost $0.
const unselect=(selection:Record<string,string>,stockId:string,materialIds:(materialId:string)=>boolean)=>Object.fromEntries(Object.entries(selection).map(([materialId,id])=>[materialId,id===stockId&&materialIds(materialId)?'auto':id]));

export function removeStock(config:EstimateConfig,stockId:string):EstimateConfig{
 return {...config,stock:config.stock.filter(s=>s.id!==stockId),stockSelection:unselect(config.stockSelection,stockId,()=>true)};
}

export function setStockMaterials(config:EstimateConfig,stockId:string,materialIds:string[]):EstimateConfig{
 return {...config,stock:config.stock.map(s=>s.id===stockId?{...s,materialIds}:s),stockSelection:unselect(config.stockSelection,stockId,m=>!materialIds.includes(m))};
}
