import type {OrnamentProject,RoadDetail} from './types';

// Dirty-state tracking for the map viewport.
//
// The plan requires it twice: Phase 2 asks for "dirty-state tracking and export-disabled
// conditions", and the acceptance suite names the case — "Moving the viewport after a geometry
// snapshot marks export dirty". The failure it prevents is the one that matters most on a
// fabrication tool: exporting an SVG built from geography the user has since panned away from, and
// only finding out after the material is cut.
//
// A snapshot is transient, exactly like the captured features it will describe once Phase 3 fills
// it in — the plan puts both outside the serializable project ("The MapLibre instance and captured
// features are transient objects. Keep them outside the serializable project store."). Persisting
// it would let a reload claim geometry that was never captured in this session.

export interface ViewportFingerprint{
 center:[number,number];
 zoom:number;
 detail:RoadDetail;
 innerRadiusMm:number;
}

export interface GeometrySnapshot{
 fingerprint:ViewportFingerprint;
 takenAt:number;
 // Filled in by Phase 3. Present here so a snapshot is a real record rather than a boolean with a
 // timestamp, and so the readiness check below already knows to ask.
 featureCount?:number;
}

// Everything that changes which geography ends up on the ornament. Road *width scale* is absent on
// purpose: it changes how thick a captured centreline is drawn, not which centrelines were
// captured, so changing it does not invalidate a snapshot. The inner radius is present because it
// sets the physical area the map window covers — widening the rim crops the map.
export function viewportFingerprint(project:OrnamentProject,innerRadiusMm:number):ViewportFingerprint{
 return {center:[project.viewport.center[0],project.viewport.center[1]],zoom:project.viewport.zoom,detail:project.roads.detail,innerRadiusMm};
}

// Compared with a tolerance rather than by equality: a map's centre is a float that a pan can
// return to only approximately, and re-rendering the same view must not read as a change. About a
// millionth of a degree is under 12cm on the ground — far below a tile pixel at the maximum zoom.
const CENTER_EPSILON=1e-6;
const ZOOM_EPSILON=1e-6;
const RADIUS_EPSILON=1e-6;

export function fingerprintsMatch(a:ViewportFingerprint,b:ViewportFingerprint):boolean{
 return Math.abs(a.center[0]-b.center[0])<=CENTER_EPSILON
  &&Math.abs(a.center[1]-b.center[1])<=CENTER_EPSILON
  &&Math.abs(a.zoom-b.zoom)<=ZOOM_EPSILON
  &&Math.abs(a.innerRadiusMm-b.innerRadiusMm)<=RADIUS_EPSILON
  &&a.detail===b.detail;
}

export const isSnapshotStale=(snapshot:GeometrySnapshot|undefined,current:ViewportFingerprint):boolean=>
 snapshot?!fingerprintsMatch(snapshot.fingerprint,current):false;

export type ExportBlockReason=
 |{code:'no-snapshot';message:string}
 |{code:'snapshot-stale';message:string}
 |{code:'geometry-invalid';message:string}
 |{code:'text-invalid';message:string}
 |{code:'no-place';message:string};

export interface ExportReadiness{ready:boolean;dirty:boolean;reasons:ExportBlockReason[]}

export interface ExportReadinessInput{
 snapshot:GeometrySnapshot|undefined;
 current:ViewportFingerprint;
 hasSelectedPlace:boolean;
 blockingIssueCount:number;
 blockingTextIssueCount:number;
}

// Export is allowed only when every one of these holds. They are returned as a list rather than a
// boolean so the disabled control can say which one is unmet — the plan's accessibility rule is
// that "errors explain how to recover", and "Export is disabled" on its own explains nothing.
export function exportReadiness(input:ExportReadinessInput):ExportReadiness{
 const dirty=isSnapshotStale(input.snapshot,input.current);
 const reasons:ExportBlockReason[]=[];
 if(input.blockingIssueCount>0)reasons.push({code:'geometry-invalid',message:'The ornament geometry has problems that must be resolved first.'});
 if(input.blockingTextIssueCount>0)reasons.push({code:'text-invalid',message:'The personalisation text does not fit the text band.'});
 if(!input.hasSelectedPlace)reasons.push({code:'no-place',message:'Search for a place and choose a result first.'});
 if(!input.snapshot)reasons.push({code:'no-snapshot',message:'Capture the map geometry before exporting.'});
 else if(dirty)reasons.push({code:'snapshot-stale',message:'The map has moved since the geometry was captured. Capture it again to export.'});
 return {ready:reasons.length===0,dirty,reasons};
}
