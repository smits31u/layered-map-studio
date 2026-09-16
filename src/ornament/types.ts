import type {FontId} from '../types/project';

export type OrnamentUnit='mm'|'in';
export type RoadDetail='low'|'medium'|'high';
export type MarkerKind='heart'|'pin'|'house';
export type MarkerOutput='separate-cut-piece'|'engraved';
export type BuildMode='classic-2-piece'|'water-cutout-3-piece';
export type ExportPreset='semantic'|'lightburn-colors';

export interface TextLine{value:string;fontId:FontId;sizeMm:number;letterSpacingMm:number}

// All physical measurements are millimetres. `displayUnit` is presentation only — it never changes
// what is stored, so switching in/mm can never drift the geometry (plan §Domain model: "Store all
// physical measurements internally in millimetres").
//
// bearing/pitch are the literal type 0, not number: the plan requires the first release to enforce
// bearing 0 and pitch 0, and a literal type makes that a compile error rather than a runtime check
// somebody can forget to call.
//
// Two deliberate departures from the plan's TypeScript block, both to satisfy its own prose:
//   - hangingLoop.minNeckWidthMm — the plan's interface omits it, but §Original ornament template
//     requires the loop be "sized from minimum material width, not a magic fraction" and §Geometry
//     requires it "connected by at least the configured minimum neck width". Configured means
//     stored.
//   - displayUnit — the plan declares `type Unit = 'mm' | 'in'` and then never uses it, while
//     Phase 1 calls for unit conversion and the UI plan calls for a unit display.
// TextLine.fontId is the existing FontId union rather than the plan's `string`, per ADR 0002.
export interface OrnamentProject{
 schemaVersion:1;
 viewport:{center:[number,number];zoom:number;bearing:0;pitch:0;selectedPlaceLabel?:string};
 ornament:{
  diameterMm:number;
  rimWidthMm:number;
  hangingLoop:{outerDiameterMm:number;innerDiameterMm:number;overlapMm:number;minNeckWidthMm:number};
  // y of the horizontal chord splitting the map opening (above) from the text band (below), in
  // geometry space with the ornament centred at (0,0) and +y downward. Negative puts the chord
  // above centre and yields a taller text band.
  mapToTextBoundaryMm:number;
 };
 roads:{detail:RoadDetail;widthScale:number};
 marker:{kind:MarkerKind;position:[number,number];sizeMm:number;output:MarkerOutput};
 text:{subtitle:TextLine;title:TextLine;date:TextLine;gap12Mm:number;gap23Mm:number};
 buildMode:BuildMode;
 exportPreset:ExportPreset;
 displayUnit:OrnamentUnit;
}

export type NumericLimit={min:number;max:number;step:number};

// One source of truth for every numeric range. The UI renders inputs from these and validation
// clamps against these, so a control can never offer a value validation would reject.
//
// diameterMm is 25–300. The reference tool's UI accepted 1–30 (unit-ambiguous) while its logic
// clamped to 1–12in / 25–300mm; the plan calls for "one consistent validated range", and since mm
// is the stored unit, the mm range is the one that survives.
export const ORNAMENT_LIMITS={
 diameterMm:{min:25,max:300,step:1},
 rimWidthMm:{min:2,max:40,step:.5},
 loopOuterDiameterMm:{min:4,max:60,step:.5},
 loopInnerDiameterMm:{min:1.5,max:50,step:.5},
 loopOverlapMm:{min:.5,max:30,step:.5},
 loopMinNeckWidthMm:{min:1,max:20,step:.25},
 mapToTextBoundaryMm:{min:-150,max:150,step:.5},
 roadWidthScale:{min:.25,max:4,step:.05},
 markerSizeMm:{min:2,max:60,step:.5},
 textSizeMm:{min:1,max:60,step:.1},
 letterSpacingMm:{min:-2,max:8,step:.05},
 lineGapMm:{min:-8,max:18,step:.25},
 zoom:{min:7,max:19,step:.5},
} as const satisfies Record<string,NumericLimit>;

export type OrnamentLimitKey=keyof typeof ORNAMENT_LIMITS;
