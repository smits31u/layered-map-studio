import {ROAD_CLASS_TIERS,ROAD_DETAIL_ORDER} from '../map/provider';
import type {RoadDetail} from '../types';

// Physical road widths, in millimetres.
//
// The plan's instruction is one sentence and one prohibition: "Define a physical width table in mm
// at a reference ornament diameter, scaled modestly with diameter and bounded by a minimum
// engravable width", and "Avoid using map style pixel widths as fabrication widths."
//
// The prohibition is the important half. A style's `line-width` is an interpolation over zoom chosen
// so a map is readable on a screen; it has no physical meaning, and feeding it to an offsetter would
// make the engraved width of a residential street depend on how far the user happened to zoom in.
// The table below is indexed by road class alone, so the same street engraves to the same width at
// every zoom, and re-framing the ornament changes what is on it rather than how thick it is.
//
// The numbers are a hierarchy, not a measurement: a motorway is not 0.9mm wide in the world. They
// are chosen so that at the reference diameter the five tiers are visually separable at arm's length
// and the thinnest is still above what a diode laser can resolve on wood.

export const REFERENCE_DIAMETER_MM=101.6;

// Below this an engraved line stops being a line: the beam overlaps itself, the kerf dominates, and
// what comes out is a scorch mark of whatever width the machine happens to have. Every computed
// width is raised to it, which means a heavily scaled-down ornament loses road *hierarchy* before it
// loses roads.
export const MIN_ENGRAVABLE_WIDTH_MM=.25;

// Widths at REFERENCE_DIAMETER_MM, before the diameter and user scale factors.
export const ROAD_WIDTH_TABLE_MM:Record<string,number>={
 motorway:.90,
 trunk:.80,
 primary:.70,
 secondary:.60,
 tertiary:.50,
 minor:.42,
 residential:.42,
 unclassified:.42,
 living_street:.42,
 service:.32,
 track:.30,
 pedestrian:.30,
 path:.26,
 footway:.26,
 cycleway:.26,
 steps:.26,
 bridleway:.26,
};

// Anything the provider classifies but the table does not name. Falling back to the thinnest tier
// rather than dropping the road keeps an unfamiliar class visible and unobtrusive; dropping it would
// make a provider schema change look like a quiet map.
export const UNKNOWN_ROAD_WIDTH_MM=.30;

// "Scaled modestly with diameter": the square root, not the ratio. A 300mm ornament is ~3× the
// reference across but only ~1.7× in road width, so a large ornament gains detail rather than
// turning into a set of fat ribbons, and a small one keeps its roads above the engravable floor.
// The clamp stops either extreme of the supported 25–300mm range from running away.
export const DIAMETER_WIDTH_EXPONENT=.5;
const MIN_DIAMETER_FACTOR=.6,MAX_DIAMETER_FACTOR=2;

export function diameterWidthFactor(diameterMm:number):number{
 if(!Number.isFinite(diameterMm)||diameterMm<=0)return MIN_DIAMETER_FACTOR;
 const raw=Math.pow(diameterMm/REFERENCE_DIAMETER_MM,DIAMETER_WIDTH_EXPONENT);
 return Math.min(MAX_DIAMETER_FACTOR,Math.max(MIN_DIAMETER_FACTOR,raw));
}

export interface RoadWidthSettings{diameterMm:number;widthScale:number}

// The one function the geometry pipeline calls. It returns a width, never a radius — the halving
// happens at the offsetter, where it is obvious that a stroke of width w is an offset of w/2.
export function roadWidthMm(roadClass:string,settings:RoadWidthSettings):number{
 const base=ROAD_WIDTH_TABLE_MM[roadClass]??UNKNOWN_ROAD_WIDTH_MM;
 const scale=Number.isFinite(settings.widthScale)&&settings.widthScale>0?settings.widthScale:1;
 return Math.max(MIN_ENGRAVABLE_WIDTH_MM,base*diameterWidthFactor(settings.diameterMm)*scale);
}

// Widths are quantised before grouping so that classes which land on the same physical width share
// one offset pass. On a dense capture that is the difference between seventeen Clipper invocations
// and four. A nanometre bucket is far below anything the table can distinguish.
const WIDTH_QUANTUM_MM=1e-4;
export const quantiseWidthMm=(widthMm:number)=>Math.round(widthMm/WIDTH_QUANTUM_MM)*WIDTH_QUANTUM_MM;

// The classes a detail level admits, as a set. The capture already queries only the visible layers,
// so this is a second gate rather than the only one — it matters when geometry is rebuilt from a
// stored capture at a *lower* detail than it was taken at, which is exactly what a golden fixture
// does when it asserts "changing detail changes captured road classes".
export function roadClassesForDetailSet(detail:RoadDetail):Set<string>{
 const tiers=ROAD_DETAIL_ORDER.slice(0,ROAD_DETAIL_ORDER.indexOf(detail)+1);
 return new Set(tiers.flatMap(tier=>[...ROAD_CLASS_TIERS[tier]]));
}
