import type {GolfOsmType} from '../server/golf/types';
import type {FontId} from '../types/project';

// The golf starter's project (docs/GOLF_MODULE_PLAN.md §4–§6): what the user chose, never the course
// geometry itself. The snapshot is the server's (src/server/golf/), fetched by `course` and cached
// there, so a reload refetches nothing that is already cached and the browser stores only settings.
//
// Like the topo builder (src/topo/types.ts), every physical dimension is millimetres, the display
// unit is presentation only, and every numeric range lives in GOLF_LIMITS so the UI and validation
// can never disagree.

export type GolfUnit='mm'|'in';
// A mark on the visible surface (§5.1): engraved (filled), scored (one line pass), or left off.
export type MarkOperation='engrave'|'score'|'none';
export type TitleLayout='header'|'corner'|'none';
export type TitleField='above'|'name'|'location'|'par'|'length'|'rating'|'slope'|'year'|'architect'|'personal';
export const TITLE_FIELDS:readonly TitleField[]=['above','name','location','par','length','rating','slope','year','architect','personal'];

export interface GolfCourseRef{osmType:GolfOsmType;osmId:number;label:string}

export interface GolfProject{
 schemaVersion:1;
 course:GolfCourseRef|null;
 displayUnit:GolfUnit;
 board:{widthMm:number;heightMm:number;marginMm:number;northUp:boolean};
 // The coverage gate's confirmation, for one snapshot: `${osmType}-${osmId}@${fetchedAt}`. A refresh
 // from OSM gives a new fetchedAt, so a confirmation never carries over to data nobody looked at.
 coverageConfirmedFor:string|null;
 // Which nines get routing and numbers on a multi-layout course, in play order. null: the default
 // (the course's first 18-hole layout, else its first two nines). Ignored on a single-layout course.
 nines:string[]|null;
 marks:{
  bunkers:MarkOperation;
  tees:MarkOperation;
  cartpaths:MarkOperation;
  streams:MarkOperation;
  routing:MarkOperation;
  floorWater:'engrave'|'none';
  greenInset:boolean;
  greenCollar:boolean;
  holeNumbers:boolean;
 };
 title:{
  layout:TitleLayout;
  fontId:FontId;
  sizeMm:number;
  show:Record<TitleField,boolean>;
  // '' means "from the course" for name, location and par; the rest are typed (§2.5).
  text:Record<TitleField,string>;
 };
}

export type NumericLimit={min:number;max:number;step:number};

export const GOLF_LIMITS={
 // 2 in to the Thunder's 60 in bed. The default board is 18 x 12 in.
 boardMm:{min:50,max:1524,step:1},
 marginMm:{min:0,max:60,step:.5},
 titleSizeMm:{min:4,max:40,step:.5},
} as const satisfies Record<string,NumericLimit>;

// Physical defaults for marks, all original choices (docs/golf-implementation-status.md, decision 12).
export const GOLF_MARKS={
 greenInsetMm:1,
 greenCollarMm:1.5,
 badgeDiameterMm:6,
 badgeNumberSizeMm:3.2,
 // An engraved line is this wide; a scored line is one pass of the beam.
 engravedLineWidthMm:.8,
 // The gap left in a routing line on each side of a green.
 routingGreenGapMm:.75,
} as const;

// A surface piece much smaller than this is fiddly to glue; preflight warns. Below the ornament's
// 0.25 mm² floor it is an error, because it falls through the bed.
export const SMALL_PIECE_AREA_MM2=4;
// Glue-up labour is the plan's §10 risk: above the warning count preflight says so, above the cap it
// blocks (§7 "piece counts are under the caps").
export const SURFACE_PIECE_WARN=80;
export const SURFACE_PIECE_CAP=150;
