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
  marker:{kind:'heart',position:[-88.207,45.3685],sizeMm:8,output:'separate-cut-piece'},
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
