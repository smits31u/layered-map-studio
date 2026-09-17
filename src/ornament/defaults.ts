import type {OrnamentProject} from './types';

// The single source of truth for "unmodified project". Reset is defined as "replace state with
// createDefaultOrnamentProject()" and nothing else, which is what makes the reference tool's reset
// bug (zoom UI left at 7 while state intended 14) structurally impossible here: there is no second
// place a default is written down, and no control holds its own copy of one.
//
// A factory rather than a shared const: every call returns freshly constructed objects, so a reset
// can never hand back an object that some earlier edit already mutated in place.
//
// Proportions are original. They are chosen for a 101.6mm (4in) ornament and deliberately do not
// reproduce the reference tool's ratios.
export function createDefaultOrnamentProject():OrnamentProject{
 return {
  schemaVersion:1,
  viewport:{center:[-88.207,45.3685],zoom:14,bearing:0,pitch:0},
  ornament:{
   diameterMm:101.6,
   rimWidthMm:6,
   hangingLoop:{outerDiameterMm:16,innerDiameterMm:8,overlapMm:3,minNeckWidthMm:3},
   mapToTextBoundaryMm:14,
  },
  roads:{detail:'medium',widthScale:1},
  // 'bridge' is the default because these ornaments are made at four inches and under, one or two at
  // a time, and a water cutout that returns five loose slivers to glue back by hand is a worse
  // product than one that is a single connected piece. Bridging joins what it can with visible tabs
  // and drops only fragments already below the size the user called meaningful; anything larger that
  // cannot be reached still comes back, still reported, and still blocks export. 'keep-separate' is
  // one click away for anyone who wants the islands as real separate pieces.
  //
  // What has not changed is that every policy reports everything it found. The default decides what
  // happens to a loose fragment, never whether the user is told about it.
  //
  // minIslandAreaMm2 is 2mm-squared, set by Ben as an *area* after being asked explicitly whether
  // "islands under 2mm" meant area or a linear dimension. It is worth recording that this is looser
  // than the 4mm-squared it replaced, not tighter: a 3mm-squared island that used to be dropped is
  // now kept. That was the stated intent, not an oversight.
  land:{islandPolicy:'bridge',minIslandAreaMm2:2,bridgeWidthMm:1.5,structuralRingWidthMm:2},
  text:{
   subtitle:{value:'',fontId:'inter',sizeMm:4,letterSpacingMm:.4},
   title:{value:'',fontId:'great-vibes',sizeMm:11,letterSpacingMm:0},
   date:{value:'',fontId:'inter',sizeMm:3.6,letterSpacingMm:.3},
   gap12Mm:2,
   gap23Mm:2,
  },
  buildMode:'classic-2-piece',
  exportPreset:'semantic',
  displayUnit:'in',
 };
}

// Zoom 14 is called out separately because it is the specific value the reference tool's reset was
// observed to get wrong (plan §Reference behavior not to reproduce). Tests assert against this.
export const DEFAULT_ZOOM=14;
