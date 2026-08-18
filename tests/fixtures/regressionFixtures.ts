// Explicit, reproducible crop framing for each Artistic Depth reference lake. Unlike deriving a
// crop implicitly from a generic bbox-padding ratio at test time, these corners are frozen values
// so the exact framing used for regression comparison is inspectable, diffable, and stable across
// runs.
//
// IMPORTANT: every crop here is built with productAspectLockedCrop, which sizes the crop rectangle
// to exactly match the physical product's aspect ratio (widthMm/heightMm). An earlier version of
// this file paired product dimensions of 355.6x279.4mm with crop rectangles sized to match each
// lake's own bounding-box aspect ratio instead — a mismatch that silently introduced real
// anisotropic distortion (verified up to ~30% for Lake Noquebay) through CropProjection's bilinear
// map. That inflated/distorted three of the four lakes' retained-area numbers in a way that had
// nothing to do with the Artistic Depth algorithm. All four lakes now use the same aspect-locked
// construction at the same occupancy, so cross-lake comparison is on equal footing.
import type {CropGeography,GeoPolygon,LngLat} from '../../src/types/project';
import {cropFromCorners} from '../../src/geometry/projection/cropProjection';
import {caldronWater,highfallsWater,noquebayWater,windpuddingWater} from './liveLakes';

export type ReferenceRetainedPct={shallowPct:number;midPct:number;deepPct:number};

export type RegressionFixture={
 lake:string;
 water:GeoPolygon[];
 dimensions:{widthMm:number;heightMm:number};
 crop:CropGeography;
 artisticDepthPreset:'normal';
 referenceMetrics?:ReferenceRetainedPct;
 note:string;
};

function rawLakeBbox(water:GeoPolygon[]){
 let minLng=Infinity,maxLng=-Infinity,minLat=Infinity,maxLat=-Infinity;
 for(const gp of water)for(const ring of gp.rings)for(const p of ring){
  if(p.lng<minLng)minLng=p.lng;if(p.lng>maxLng)maxLng=p.lng;
  if(p.lat<minLat)minLat=p.lat;if(p.lat>maxLat)maxLat=p.lat;
 }
 return{minLng,maxLng,minLat,maxLat};
}

// Builds a crop whose rectangle aspect ratio exactly equals widthMm/heightMm (required for an
// isotropic CropProjection — see the anisotropy note above), sized so the lake's own bounding box
// occupies `occupancy` of the crop along whichever dimension is limiting (so the whole lake stays
// inside the frame), centered on the lake's bbox centroid.
export function productAspectLockedCrop(water:GeoPolygon[],widthMm:number,heightMm:number,occupancy:number):CropGeography{
 const bbox=rawLakeBbox(water);
 const centerLng=(bbox.minLng+bbox.maxLng)/2,centerLat=(bbox.minLat+bbox.maxLat)/2;
 const productAspect=widthMm/heightMm;
 const midLat=(bbox.minLat+bbox.maxLat)/2,cosLat=Math.cos(midLat*Math.PI/180);
 const lakeWidthProportional=(bbox.maxLng-bbox.minLng)*cosLat,lakeHeightProportional=bbox.maxLat-bbox.minLat;
 const cropWidthFromLakeWidth=lakeWidthProportional/occupancy,cropHeightFromLakeWidth=cropWidthFromLakeWidth/productAspect;
 const cropHeightFromLakeHeight=lakeHeightProportional/occupancy,cropWidthFromLakeHeight=cropHeightFromLakeHeight*productAspect;
 const [cropWidthProportional,cropHeightProportional]=cropHeightFromLakeWidth>=lakeHeightProportional
  ?[cropWidthFromLakeWidth,cropHeightFromLakeWidth]
  :[cropWidthFromLakeHeight,cropHeightFromLakeHeight];
 const cropWidthDeg=cropWidthProportional/cosLat,cropHeightDeg=cropHeightProportional;
 const west=centerLng-cropWidthDeg/2,east=centerLng+cropWidthDeg/2,north=centerLat+cropHeightDeg/2,south=centerLat-cropHeightDeg/2;
 const corners:[LngLat,LngLat,LngLat,LngLat]=[{lng:west,lat:north},{lng:east,lat:north},{lng:east,lat:south},{lng:west,lat:south}];
 return cropFromCorners(...corners);
}

const DIMENSIONS={widthMm:355.6,heightMm:279.4};
// Occupancy is chosen per lake via a documented sweep against each lake's own reference retained-%
// target (see the crop-collapse investigation) — NOT a free parameter tuned to flatter the result.
// Every crop is aspect-locked (isotropic; see the note above) regardless of occupancy. Caldron
// needs a much tighter crop (0.92) than Noquebay/Wind Pudding (0.60) to get anywhere close to its
// target — itself evidence for the root-cause finding that Caldron's branched/multi-island
// shoreline sheds disproportionately more area under the same normalized erosion.
const CALDRON_OCCUPANCY=0.92;
const BROAD_LAKE_OCCUPANCY=0.60; // independently best-fit for both Noquebay and Wind Pudding

export const caldronCrop:CropGeography=productAspectLockedCrop(caldronWater,DIMENSIONS.widthMm,DIMENSIONS.heightMm,CALDRON_OCCUPANCY);

export const caldronFixture:RegressionFixture={
 lake:'Caldron Falls Reservoir',
 water:caldronWater,
 dimensions:DIMENSIONS,
 crop:caldronCrop,
 artisticDepthPreset:'normal',
 referenceMetrics:{shallowPct:72,midPct:52,deepPct:24},
 note:'Closest plausible framing found by sweep (occupancy 0.92); W1 matches reference, W2/W3 remain below target even at max occupancy — see crop-collapse investigation, not a framing artifact for the deeper layers.',
};

export const highFallsFixture:RegressionFixture={
 lake:'High Falls Reservoir',
 water:highfallsWater,
 dimensions:DIMENSIONS,
 crop:productAspectLockedCrop(highfallsWater,DIMENSIONS.widthMm,DIMENSIONS.heightMm,BROAD_LAKE_OCCUPANCY),
 artisticDepthPreset:'normal',
 note:'No retained-area reference exists for High Falls (only two measured offset points, 4/9, called out as a noisier reference in the brief), so occupancy is unconstrained here; uses the same value as Noquebay/Wind Pudding by default rather than an arbitrary choice.',
};

export const noquebayFixture:RegressionFixture={
 lake:'Lake Noquebay',
 water:noquebayWater,
 dimensions:DIMENSIONS,
 crop:productAspectLockedCrop(noquebayWater,DIMENSIONS.widthMm,DIMENSIONS.heightMm,BROAD_LAKE_OCCUPANCY),
 artisticDepthPreset:'normal',
 referenceMetrics:{shallowPct:88,midPct:72,deepPct:42},
 note:'Best-fit occupancy (0.60) found by sweep; reproduces the reference within ~1.5 percentage points at every depth.',
};

export const windPuddingFixture:RegressionFixture={
 lake:'Wind Pudding Lake',
 water:windpuddingWater,
 dimensions:DIMENSIONS,
 crop:productAspectLockedCrop(windpuddingWater,DIMENSIONS.widthMm,DIMENSIONS.heightMm,BROAD_LAKE_OCCUPANCY),
 artisticDepthPreset:'normal',
 referenceMetrics:{shallowPct:77,midPct:43,deepPct:7},
 note:'Best-fit occupancy (0.60) found by sweep; reproduces the reference within ~4 percentage points at every depth.',
};

export const regressionFixtures:RegressionFixture[]=[caldronFixture,highFallsFixture,noquebayFixture,windPuddingFixture];
