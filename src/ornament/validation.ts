import {inchesToMm,mmToInches} from '../utils/units';
import {ORNAMENT_LIMITS,type NumericLimit,type OrnamentProject,type OrnamentUnit,type TextLine} from './types';

export const clampTo=(value:number,limit:NumericLimit)=>Number.isFinite(value)?Math.min(limit.max,Math.max(limit.min,value)):limit.min;

// Snaps to the limit's step so a value typed into a number input cannot land between the increments
// the slider can express — the two controls share one stored value and must agree on what it can be.
export function snapTo(value:number,limit:NumericLimit):number{
 const snapped=limit.min+Math.round((clampTo(value,limit)-limit.min)/limit.step)*limit.step;
 return clampTo(Number(snapped.toFixed(6)),limit);
}

export const toDisplay=(mm:number,unit:OrnamentUnit)=>unit==='in'?mmToInches(mm):mm;
export const fromDisplay=(value:number,unit:OrnamentUnit)=>unit==='in'?inchesToMm(value):value;

const clampLine=(line:TextLine):TextLine=>({
 ...line,
 sizeMm:clampTo(line.sizeMm,ORNAMENT_LIMITS.textSizeMm),
 letterSpacingMm:clampTo(line.letterSpacingMm,ORNAMENT_LIMITS.letterSpacingMm),
});

// Every stored numeric is forced into range on the way into state, so nothing downstream has to
// re-check. Geometry validity (loop neck width, text band height) is not decided here — those are
// relationships between several fields and are reported by buildOrnamentGeometry as issues, since a
// user mid-edit should see a warning rather than have their value silently rewritten.
export function clampOrnamentProject(project:OrnamentProject):OrnamentProject{
 const L=ORNAMENT_LIMITS;
 return {
  ...project,
  viewport:{...project.viewport,zoom:snapTo(project.viewport.zoom,L.zoom),bearing:0,pitch:0},
  ornament:{
   diameterMm:clampTo(project.ornament.diameterMm,L.diameterMm),
   rimWidthMm:clampTo(project.ornament.rimWidthMm,L.rimWidthMm),
   hangingLoop:{
    outerDiameterMm:clampTo(project.ornament.hangingLoop.outerDiameterMm,L.loopOuterDiameterMm),
    innerDiameterMm:clampTo(project.ornament.hangingLoop.innerDiameterMm,L.loopInnerDiameterMm),
    overlapMm:clampTo(project.ornament.hangingLoop.overlapMm,L.loopOverlapMm),
    minNeckWidthMm:clampTo(project.ornament.hangingLoop.minNeckWidthMm,L.loopMinNeckWidthMm),
   },
   mapToTextBoundaryMm:clampTo(project.ornament.mapToTextBoundaryMm,L.mapToTextBoundaryMm),
  },
  roads:{...project.roads,widthScale:clampTo(project.roads.widthScale,L.roadWidthScale)},
  land:{
   ...project.land,
   minIslandAreaMm2:clampTo(project.land.minIslandAreaMm2,L.minIslandAreaMm2),
   bridgeWidthMm:clampTo(project.land.bridgeWidthMm,L.bridgeWidthMm),
   structuralRingWidthMm:clampTo(project.land.structuralRingWidthMm,L.structuralRingWidthMm),
  },
  marker:{...project.marker,sizeMm:clampTo(project.marker.sizeMm,L.markerSizeMm)},
  text:{
   subtitle:clampLine(project.text.subtitle),
   title:clampLine(project.text.title),
   date:clampLine(project.text.date),
   gap12Mm:clampTo(project.text.gap12Mm,L.lineGapMm),
   gap23Mm:clampTo(project.text.gap23Mm,L.lineGapMm),
  },
 };
}
