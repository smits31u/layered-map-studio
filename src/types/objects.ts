// Core interfaces for the V1.0 milestones not yet implemented (markers, compass keep-out,
// lake info, frame/inset) plus named aliases for concepts that already exist inline inside
// MapProject. Nothing in this file is wired into runtime code yet — see docs/v1-milestones.md.
// Deliberately NOT re-exported from types/project.ts yet: MapProject stays exactly as it is
// (tested, working) until each concept's own milestone actually adds it as a real field.
import type {GeoPlace,MapProject,RoadClass} from './project';

// ---- Named aliases for shapes that already exist inline in MapProject ----
// These give the spec's requested type names without touching the (working, tested) inline
// definitions they describe — TypeScript structurally verifies they stay in sync.
export type PhysicalDimensions={widthMm:number;heightMm:number};
export type ShorelineSettings=MapProject['shoreline'];
export type RoadSettings=MapProject['roads'];

// The spec's plain axis-aligned bounds. The app's real geographic selection is the
// bearing-aware CropGeography (four corners + derived bbox) in geometry/projection/
// cropProjection.ts — MapBounds is the simpler shape referenced elsewhere in this spec
// (e.g. a future "manual lat/lon bounds entry" UI) and can be derived from CropGeography's
// bbox tuple when needed, not a replacement for it.
export type MapBounds={north:number;south:number;east:number;west:number};

// ---- Resolved/effective label shapes ----
// These describe a label's final state (default position + override already applied) for
// documentation/API-surface purposes. The actual computation already exists and is tested:
// PlaceLabelSceneObject (geometry/scene/placeLabels.ts) and RoadLabelSceneObject (geometry/
// scene/roadLabels.ts). Kept as separate lightweight aliases rather than importing those
// directly, since those two carry extra fields (defaultXMm/segmentLengthMm/etc.) specific to
// how each is computed, while RoadLabel/PlaceLabel here are the flatter "current state" shape
// a save/load or external API layer would actually want.
export type PlaceLabel={
 id:string;
 placeId:string;
 name:string;
 placeClass:GeoPlace['class'];
 xMm:number;
 yMm:number;
 visible:boolean;
};

export type RoadLabel={
 id:string;
 name:string;
 roadClass:RoadClass;
 xMm:number;
 yMm:number;
 rotationDeg:number;
 flipSide:boolean;
 visible:boolean;
};

// ---- Compass (M-COMPASS: landed) ----
// MapProject['compass'] itself now carries keepOutPaddingMm — keep-out is always active whenever
// the compass is visible (not a separate opt-in toggle; see docs/v1-milestones.md), so there is no
// keepOutEnabled field to add here. This alias exists so other planning types (EditableMapObject
// etc.) and any future object type can still refer to "a compass" by a stable name.
export type CompassObject=MapProject['compass'];

// ---- Brand new types for not-yet-implemented milestones ----

// ---- Markers (M-MARKERS: landed) ----
// MapProject['markers'][number] is the real, wired-in shape — this is a stable alias, the same
// pattern CompassObject above uses. Two differences from this file's original sketch, both because
// the real implementation reuses architecture that already existed rather than inventing a
// marker-specific one: (1) no projectedXMm/projectedYMm/xMm/yMm fields — the projected position is
// recomputed every scene build from lat/lng via the shared CropProjection (geometry/scene/
// markers.ts), and manual drag position lives in MapProject.overrides[marker.id], the same
// ObjectOverride/resolvePlacement mechanism every other draggable object uses; (2) no 'custom'
// MarkerType/customSvgPath yet — the marker registry (geometry/scene/markerRegistry.ts) is
// factory-based specifically so a future CUSTOM_SVG type can be added without touching UI/export
// switch statements, but no UI for uploading one exists yet (out of scope; see
// docs/v1-milestones.md).
export type MarkerType=MapProject['markers'][number]['markerType'];
export type MapMarker=MapProject['markers'][number];

export type LakeInfoField='name'|'county'|'state'|'acreage'|'maxDepthFt'|'shorelineLengthMi'|'elevationFt'|'lakeType';

export type LakeInfoSource={
 provider:string;
 status:'unchecked'|'available'|'unavailable'|'error'|'user-entered';
 statusMessage?:string;
 retrievedAt?:string;
};

export type LakeInfoBlock={
 visible:boolean;
 xMm:number;
 yMm:number;
 widthMm:number;
 heightMm:number;
 font:string;
 sizeMm:number;
 // Present only for fields the user has enabled/populated — omission means "leave blank",
 // never a fabricated placeholder. Values are always either provider-sourced (with `source`
 // recording where from) or user-entered (source.status === 'user-entered').
 fields:Partial<Record<LakeInfoField,string>>;
 source:LakeInfoSource;
 rotationDeg:number;
 keepOutEnabled:boolean;
 keepOutPaddingMm:number;
};

export type FrameStyle='none'|'line'|'double-line';

export type FrameSettings={
 insetMm:number;
 thicknessMm:number;
 style:FrameStyle;
 showSafeAreaGuide:boolean; // editor-only guide; never becomes production cut/engrave geometry
 clipArtworkToInset:boolean;
};

// The common shape every draggable/selectable presentation object conforms to (section 30/31).
// Already realized in practice for the object types that exist today (title/subtitle/compass/
// place labels/road labels) via ObjectOverride (geometry/scene/overrides.ts) layered on each
// type's own generated default — EditableMapObject is the target shape new object types
// (markers, lake info) should resolve to, for a consistent selection/side-panel experience.
export type EditableMapObjectType='title'|'subtitle'|'compass'|'place-label'|'road-label'|'marker'|'lake-info';

export type EditableMapObject={
 id:string;
 type:EditableMapObjectType;
 xMm:number;
 yMm:number;
 rotationDeg:number;
 scale:number;
 visible:boolean;
 keepOutEnabled?:boolean;
 keepOutPaddingMm?:number;
};
