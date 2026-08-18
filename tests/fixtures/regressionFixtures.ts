// Explicit, reproducible crop framing for each Artistic Depth reference lake. Unlike deriving a
// crop implicitly from a generic bbox-padding ratio at test time, these corners are frozen values
// so the exact framing used for regression comparison is inspectable, diffable, and stable across
// runs regardless of how the underlying padding heuristic in liveLakes.ts might change later.
import type {CropGeography,GeoPolygon} from '../../src/types/project';
import {cropFromCorners} from '../../src/geometry/projection/cropProjection';
import {
 caldronWater,highfallsWater,noquebayWater,windpuddingWater,
 highfallsBbox,noquebayBbox,windpuddingBbox,
} from './liveLakes';

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

const bboxCrop=(b:{minLng:number;minLat:number;maxLng:number;maxLat:number}):CropGeography=>
 cropFromCorners({lng:b.minLng,lat:b.maxLat},{lng:b.maxLng,lat:b.maxLat},{lng:b.maxLng,lat:b.minLat},{lng:b.minLng,lat:b.minLat});

// Chosen via a documented occupancy sweep (see the crop-sensitivity investigation) as the closest
// plausible real-world framing to the external reference target: lake bbox occupies ~92% of the
// product-aspect-locked crop (a small, realistic margin — not the lake bbox itself). At this
// framing W1 matches the reference almost exactly (~72%); W2/W3 remain below target even at the
// physical occupancy limit (crop == lake bbox), so that gap is not a framing artifact.
export const caldronCrop:CropGeography=cropFromCorners(
 {lng:-88.30981353913045,lat:45.382012064411626},
 {lng:-88.22718256086957,lat:45.382012064411626},
 {lng:-88.22718256086957,lat:45.33639233558837},
 {lng:-88.30981353913045,lat:45.33639233558837},
);

export const caldronFixture:RegressionFixture={
 lake:'Caldron Falls Reservoir',
 water:caldronWater,
 dimensions:{widthMm:355.6,heightMm:279.4},
 crop:caldronCrop,
 artisticDepthPreset:'normal',
 referenceMetrics:{shallowPct:72,midPct:52,deepPct:24},
 note:'Closest plausible framing found by sweep; W1 matches reference, W2/W3 remain below target even at max occupancy — see crop-sensitivity report, not a framing artifact for the deeper layers.',
};

export const highFallsFixture:RegressionFixture={
 lake:'High Falls Reservoir',
 water:highfallsWater,
 dimensions:{widthMm:355.6,heightMm:279.4},
 crop:bboxCrop(highfallsBbox),
 artisticDepthPreset:'normal',
 note:'No retained-area reference exists for High Falls (only two measured offset points, 4/9, called out as a noisier reference in the brief). Uses the same ~30%-margin framing as Noquebay/Wind Pudding.',
};

export const noquebayFixture:RegressionFixture={
 lake:'Lake Noquebay',
 water:noquebayWater,
 dimensions:{widthMm:355.6,heightMm:279.4},
 crop:bboxCrop(noquebayBbox),
 artisticDepthPreset:'normal',
 referenceMetrics:{shallowPct:88,midPct:72,deepPct:42},
 note:'This ~30%-margin framing already reproduces the reference within ~2 percentage points at every depth.',
};

export const windPuddingFixture:RegressionFixture={
 lake:'Wind Pudding Lake',
 water:windpuddingWater,
 dimensions:{widthMm:355.6,heightMm:279.4},
 crop:bboxCrop(windpuddingBbox),
 artisticDepthPreset:'normal',
 referenceMetrics:{shallowPct:77,midPct:43,deepPct:7},
 note:'This ~30%-margin framing already reproduces the reference within ~3 percentage points at every depth.',
};

export const regressionFixtures:RegressionFixture[]=[caldronFixture,highFallsFixture,noquebayFixture,windPuddingFixture];
