// Parameter model for the procedural depth-terrain generator. See docs/depth-terrain.md for how
// each value enters the pipeline.
//
// Two layers: TerrainParams is the full engine input (every knob the pipeline reads), and
// SimpleTerrainControls is the small user-facing set that expandSimpleControls() turns into a full
// TerrainParams. Every constant in the expansion below is an original artistic choice for this
// product, not a measurement of anything.
//
// Normalization is deliberately forgiving: a value outside its range is clamped and a non-finite
// value falls back to the default, so a slider glitch or a hand-edited project file can never put a
// NaN into the grid. Nothing is thrown for bad parameters — only for bad geometry.

export type TerrainProfileName='smooth-basin'|'broad-shelf'|'stepped-benches'|'even-slope';
export const TERRAIN_PROFILE_NAMES:readonly TerrainProfileName[]=['smooth-basin','broad-shelf','stepped-benches','even-slope'];

// Grid resolution. cellMm is the preferred physical cell size; the cell-count bounds on the
// shoreline's longer bounding-box side override it for very large or very small shorelines.
export interface TerrainResolution{cellMm:number;minCellsLongSide:number;maxCellsLongSide:number}

export interface TerrainParams{
 // Any integer; coerced to uint32. Only the noise depends on it.
 seed:number;
 profile:TerrainProfileName;
 // Depth of the deepest cell of the largest water body, as a fraction of full depth (0,1].
 maxDepth:number;
 // 0 = gentle beach, 0.5 = neutral (linear), 1 = abrupt drop-off at the waterline.
 bankSteepness:number;
 // Fraction of each body's shore-to-centre distance given to a shallow near-shore shelf [0,0.6].
 shelfWidth:number;
 // Blend toward terraceLevels discrete benches [0,1], and how many benches [2,12].
 terraceStrength:number;
 terraceLevels:number;
 // How far the noise may push the shore distance, as a fraction of each body's depth range [0,1].
 noiseAmplitude:number;
 // Base noise feature size as a fraction of the shoreline's longer bounding-box side [0.02,2].
 // Relative rather than millimetres so the same lake reads the same at any product size.
 featureScale:number;
 // fBm octave count [1,8] ("detail") and per-octave amplitude falloff [0,1] ("roughness").
 octaves:number;
 roughness:number;
 // Blend from smooth value noise toward ridged noise [0,1].
 ridged:number;
 // Domain-warp displacement, in base-feature units [0,2].
 warpStrength:number;
 // Direction features elongate along, degrees from +x toward +y (the y-down mm space), axial so
 // normalized to [0,180); and how strongly they elongate [0,1].
 grainAngleDeg:number;
 grainStrength:number;
 // Smaller disconnected bodies are shallowed by (cells/largestCells)^exponent [0,2].
 bodyScaleExponent:number;
 // Bodies with fewer grid cells than this are dropped: left at depth 0 (shoreline level) rather
 // than given a basin of their own [1,1000000]. 1 keeps every body. See MIN_BODY_CELLS_DEFAULT.
 minBodyCells:number;
 resolution:TerrainResolution;
}

export type TerrainParamsInput=Partial<Omit<TerrainParams,'resolution'>>&{resolution?:Partial<TerrainResolution>};

export interface SimpleTerrainControls{
 seed:number;
 profile:TerrainProfileName;
 maxDepth:number;
 // 0 = calm, broad, soft bottom; 1 = rugged, busy, ridged bottom.
 character:number;
 // Passed straight through, and also narrows the shelf as banks steepen.
 bankSteepness:number;
 // Directional structure: 0 = isotropic, 1 = strongly elongated along weaveAngleDeg.
 weave:number;
 weaveAngleDeg:number;
 // 0 = continuous slopes, 1 = hard benches.
 terracing:number;
}

export const DEFAULT_TERRAIN_RESOLUTION:TerrainResolution={cellMm:.5,minCellsLongSide:64,maxCellsLongSide:512};

// 16 cells, about a 4x4 patch. What this is aimed at is raster debris: the tip of a narrow spike or
// arm that the cell-centre sampling cuts off from the main water, typically 1-5 cells. A body that
// small is nearly all shore-edge cells, and under the area scaling it would get a tiny near-flat
// basin anyway, as noise rather than terrain. The threshold is in cells rather than mm² because
// that debris is sized by the grid, not by the product. At the default 0.5mm cell it is 4mm², far
// below anything a stack of cut layers could render as a separate basin. At the 512-cell cap on a
// very large shoreline a cell grows, and a genuinely separate small pond can then fall under it —
// that is the case to revisit if it comes up.
export const MIN_BODY_CELLS_DEFAULT=16;

export const DEFAULT_SIMPLE_TERRAIN_CONTROLS:SimpleTerrainControls={seed:1,profile:'smooth-basin',maxDepth:1,character:.4,bankSteepness:.5,weave:0,weaveAngleDeg:0,terracing:0};

type NumericKey=Exclude<keyof TerrainParams,'seed'|'profile'|'resolution'|'grainAngleDeg'>;
const RANGES:Record<NumericKey,[number,number]>={
 maxDepth:[.01,1],bankSteepness:[0,1],shelfWidth:[0,.6],terraceStrength:[0,1],terraceLevels:[2,12],noiseAmplitude:[0,1],
 featureScale:[.02,2],octaves:[1,8],roughness:[0,1],ridged:[0,1],warpStrength:[0,2],grainStrength:[0,1],bodyScaleExponent:[0,2],
 minBodyCells:[1,1000000],
};
const INTEGER_KEYS=new Set<NumericKey>(['terraceLevels','octaves','minBodyCells']);
const RESOLUTION_RANGES:Record<keyof TerrainResolution,[number,number]>={cellMm:[.05,20],minCellsLongSide:[8,1024],maxCellsLongSide:[8,2048]};

const clamp=(value:number,min:number,max:number)=>value<min?min:value>max?max:value;
const clamp01=(value:number)=>clamp(value,0,1);
const finiteOr=(value:unknown,fallback:number)=>typeof value==='number'&&Number.isFinite(value)?value:fallback;
const smoothstep=(x:number)=>{const t=clamp01(x);return t*t*(3-2*t)};

export const isTerrainProfileName=(value:unknown):value is TerrainProfileName=>typeof value==='string'&&(TERRAIN_PROFILE_NAMES as readonly string[]).includes(value);

// Grain is axial: 10° and 190° are the same direction of elongation.
export const normalizeGrainAngle=(degrees:number)=>{const wrapped=degrees%180;return wrapped<0?wrapped+180:wrapped===0?0:wrapped};

export const normalizeSeed=(seed:number)=>Math.trunc(seed)>>>0;

export function normalizeTerrainParams(input:TerrainParamsInput={},defaults:TerrainParams=DEFAULT_TERRAIN_PARAMS):TerrainParams{
 const out={...defaults,resolution:{...defaults.resolution}};
 out.seed=normalizeSeed(finiteOr(input.seed,defaults.seed));
 out.profile=isTerrainProfileName(input.profile)?input.profile:defaults.profile;
 out.grainAngleDeg=normalizeGrainAngle(finiteOr(input.grainAngleDeg,defaults.grainAngleDeg));
 for(const key of Object.keys(RANGES) as NumericKey[]){
  const [min,max]=RANGES[key],raw=clamp(finiteOr(input[key],defaults[key]),min,max);
  out[key]=INTEGER_KEYS.has(key)?Math.round(raw):raw;
 }
 const resolution=input.resolution??{};
 for(const key of Object.keys(RESOLUTION_RANGES) as (keyof TerrainResolution)[]){
  const [min,max]=RESOLUTION_RANGES[key],raw=clamp(finiteOr(resolution[key],defaults.resolution[key]),min,max);
  out.resolution[key]=key==='cellMm'?raw:Math.round(raw);
 }
 if(out.resolution.maxCellsLongSide<out.resolution.minCellsLongSide)out.resolution.maxCellsLongSide=out.resolution.minCellsLongSide;
 return out;
}

// The simple-control expansion. The shape of each mapping, in words:
// - character raises noise amplitude, octave count and roughness together and shrinks the base
//   feature size, so "more character" reads as busier rather than merely louder. Even at 0 a little
//   noise remains, so the calmest setting is still organic rather than concentric rings.
// - ridges only enter in the upper part of the character range (smoothstep from 0.4), so the calm
//   half stays soft.
// - weave drives grain strength, capped below 1 so the terrain never degenerates into parallel
//   stripes. It also damps the domain warp and shrinks the feature size a little: elongated
//   features at the calm feature size run longer than most lakes and the direction never reads.
// - bank steepness narrows the shelf: steep banks and a wide shallow shelf contradict each other.
export function expandSimpleControls(input:Partial<SimpleTerrainControls>={},resolution?:Partial<TerrainResolution>):TerrainParams{
 const d=DEFAULT_SIMPLE_TERRAIN_CONTROLS;
 const character=clamp01(finiteOr(input.character,d.character));
 const bank=clamp01(finiteOr(input.bankSteepness,d.bankSteepness));
 const weave=clamp01(finiteOr(input.weave,d.weave));
 const terracing=clamp01(finiteOr(input.terracing,d.terracing));
 return normalizeTerrainParams({
  seed:finiteOr(input.seed,d.seed),
  profile:isTerrainProfileName(input.profile)?input.profile:d.profile,
  maxDepth:finiteOr(input.maxDepth,d.maxDepth),
  bankSteepness:bank,
  shelfWidth:.22*(1-bank),
  terraceStrength:terracing,
  terraceLevels:6,
  noiseAmplitude:.2+.6*character,
  featureScale:(.22-.1*character)*(1-.4*weave),
  octaves:3+Math.round(3*character),
  roughness:.4+.2*character,
  ridged:.7*smoothstep((character-.4)/.6),
  warpStrength:(.2+.8*character)*(1-.4*weave),
  grainAngleDeg:finiteOr(input.weaveAngleDeg,d.weaveAngleDeg),
  grainStrength:.85*weave,
  bodyScaleExponent:.5,
  resolution,
 },BASE_PARAMS);
}

// Fallback values used only while building the defaults themselves; every field is overwritten by
// expandSimpleControls, so these numbers never reach a grid.
const BASE_PARAMS:TerrainParams={seed:1,profile:'smooth-basin',maxDepth:1,bankSteepness:.5,shelfWidth:0,terraceStrength:0,terraceLevels:6,noiseAmplitude:0,featureScale:.25,octaves:4,roughness:.5,ridged:0,warpStrength:0,grainAngleDeg:0,grainStrength:0,bodyScaleExponent:.5,minBodyCells:MIN_BODY_CELLS_DEFAULT,resolution:{...DEFAULT_TERRAIN_RESOLUTION}};

export const DEFAULT_TERRAIN_PARAMS:TerrainParams=expandSimpleControls(DEFAULT_SIMPLE_TERRAIN_CONTROLS);
