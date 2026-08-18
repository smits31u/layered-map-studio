import type {MapProject,ObjectOverride} from '../../types/project';

export type ResolvedPlacement={xMm:number;yMm:number;rotationDeg:number;scale:number;visible:boolean;flipSide:boolean};

// Merges a generated/default placement with any manual override for that object id. Absent override
// fields fall back to the default — this is what makes "Reset" simple: clearing a field (or the
// whole entry) from overrides restores the generated position without needing a separate stored
// "original" value alongside it.
export function resolvePlacement(defaults:{xMm:number;yMm:number;rotationDeg?:number;scale?:number;visible?:boolean;flipSide?:boolean},override?:ObjectOverride):ResolvedPlacement{
 return{
  xMm:override?.xMm??defaults.xMm,
  yMm:override?.yMm??defaults.yMm,
  rotationDeg:override?.rotationDeg??defaults.rotationDeg??0,
  scale:override?.scale??defaults.scale??1,
  visible:override?.visible??defaults.visible??true,
  flipSide:override?.flipSide??defaults.flipSide??false,
 };
}

export function setOverride(project:MapProject,objectId:string,patch:Partial<ObjectOverride>):MapProject{
 const merged={...project.overrides[objectId],...patch};
 return {...project,overrides:{...project.overrides,[objectId]:merged}};
}

// Resets one or more fields back to the generated default by deleting them from that object's
// override entry (removing the whole entry once it has no fields left).
export function resetOverrideFields(project:MapProject,objectId:string,fields?:(keyof ObjectOverride)[]):MapProject{
 const existing=project.overrides[objectId];
 if(!existing)return project;
 if(!fields){
  const {[objectId]:_removed,...rest}=project.overrides;
  return {...project,overrides:rest};
 }
 const next={...existing};
 for(const field of fields)delete next[field];
 const hasFields=Object.keys(next).length>0;
 const overrides={...project.overrides};
 if(hasFields)overrides[objectId]=next;else delete overrides[objectId];
 return {...project,overrides};
}

// Converts a screen-pixel pointer delta into a physical-mm delta using an SVG element's actual
// CTM (handles viewBox scale, any CSS scaling, and zoom uniformly) rather than assuming a fixed
// px-per-mm ratio. `svg` must be the root <svg> element the coordinates are measured against.
export function screenDeltaToMm(svg:SVGSVGElement,dxPx:number,dyPx:number):{dxMm:number;dyMm:number}{
 const ctm=svg.getScreenCTM();
 if(!ctm||!ctm.a)return {dxMm:0,dyMm:0};
 // a/d are the CTM's x/y scale factors (mm-per-px isn't uniform if a page zoom or non-uniform CSS
 // scale is applied, so invert each axis independently rather than assuming ctm.a === ctm.d).
 return {dxMm:dxPx/ctm.a,dyMm:dyPx/ctm.d};
}
