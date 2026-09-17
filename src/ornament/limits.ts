import type {CapturedFeatures} from './capture/featureTypes';

// Capacity limits for a capture, and the simplification that keeps a dense one usable.
//
// Phase 5 asks for "feature-count, vertex-count, memory, and simplification limits ... to prevent a
// dense urban capture from producing an unreasonably large/slow export". These numbers are sized for
// the ornament this tool is actually for — up to 4in / 101.6mm — and deliberately not for a
// hypothetical wall panel. At 101.6mm across a 640px map element the scale is about 0.159mm per
// pixel, and the whole map window is roughly 8,100mm². Geometry finer than the laser kerf cannot
// survive the machine, so carrying it through the pipeline costs time and memory and buys nothing.
//
// Three tiers, because the three failures are different:
//
//   simplify  — the capture is dense but fine. Thin it and say so. No decision required.
//   refuse    — the capture is so large that building it would hang the tab. Refusing with an
//               instruction is kinder than a spinner that never stops.
//   warn      — the built geometry is large enough that the export will be slow and the file big.
//               It still exports; the user is told what they are about to get.

export const ORNAMENT_CAPACITY={
 // The size these limits were chosen for. Recorded so a future larger ornament is a deliberate
 // revisit of these numbers rather than a silent inheritance of numbers picked for a 4in disc.
 sizedForDiameterMm:101.6,

 // Above this many captured features, refuse. A dense downtown at high detail over a 4in window is
 // a few thousand; twelve thousand means the view is far wider than the ornament can resolve.
 maxCapturedFeatures:12_000,

 // Above this many captured vertices, refuse outright.
 maxCapturedVertices:400_000,

 // Above this, simplify before building. Chosen well under the refusal cap so the common dense
 // capture is thinned rather than rejected.
 simplifyAboveVertices:25_000,

 // The physical tolerance simplification works to. A 0.04mm deviation is a quarter of a typical
 // 0.15mm laser kerf and below what the material itself will hold, so it is not visible on the
 // finished piece at any size this tool supports.
 simplifyToleranceMm:.04,

 // Built geometry above this is exported with a warning: it is legal, it is just going to be a
 // large file and a slow job.
 warnOutputVertices:200_000,

 // Two float64 coordinates plus array overhead, rounded up. Used only to put a number in a message
 // — an estimate the user can act on beats a precise figure nobody can obtain in a browser.
 bytesPerVertex:32,
} as const;

export const countCapturedVertices=(features:CapturedFeatures):number=>{
 let total=0;
 for(const road of features.roads)total+=road.line.length;
 for(const polygon of features.water)for(const ring of polygon.rings)total+=ring.length;
 return total;
};

export const estimateCaptureBytes=(vertices:number):number=>vertices*ORNAMENT_CAPACITY.bytesPerVertex;

const mb=(bytes:number)=>(bytes/1_048_576).toFixed(1);

export interface CaptureCapacity{
 featureCount:number;
 vertexCount:number;
 estimatedBytes:number;
 // Set when the capture must be refused. The message says what to change, because "too large" on
 // its own is not something a user can act on.
 refusal?:string;
 // Set when the capture will be thinned before building.
 simplifyToleranceMm?:number;
}

// The one place a capture is measured against the limits. Pure, so the same assessment can be made
// in the capture path, in a test, and in a message without three versions of the arithmetic.
export function assessCaptureCapacity(features:CapturedFeatures):CaptureCapacity{
 const featureCount=features.roads.length+features.water.length;
 const vertexCount=countCapturedVertices(features);
 const estimatedBytes=estimateCaptureBytes(vertexCount);

 if(featureCount>ORNAMENT_CAPACITY.maxCapturedFeatures)
  return {featureCount,vertexCount,estimatedBytes,refusal:
   `This view contains ${featureCount.toLocaleString()} map features, more than the ${ORNAMENT_CAPACITY.maxCapturedFeatures.toLocaleString()} an ornament can use. Zoom in, or set road detail to Medium or Low, and capture again.`};

 if(vertexCount>ORNAMENT_CAPACITY.maxCapturedVertices)
  return {featureCount,vertexCount,estimatedBytes,refusal:
   `This view contains ${vertexCount.toLocaleString()} map points (about ${mb(estimatedBytes)}MB), more than the ${ORNAMENT_CAPACITY.maxCapturedVertices.toLocaleString()} an ornament can build from. Zoom in, or set road detail to Medium or Low, and capture again.`};

 return vertexCount>ORNAMENT_CAPACITY.simplifyAboveVertices
  ?{featureCount,vertexCount,estimatedBytes,simplifyToleranceMm:ORNAMENT_CAPACITY.simplifyToleranceMm}
  :{featureCount,vertexCount,estimatedBytes};
}
