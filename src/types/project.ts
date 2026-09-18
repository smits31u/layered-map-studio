export type LngLat = { lng:number; lat:number };
export type CropGeography = { nw:LngLat; ne:LngLat; se:LngLat; sw:LngLat; bbox:[number,number,number,number] };
export type DisplayUnit = 'in'|'mm';
export type RoadClass = 'motorway'|'trunk'|'primary'|'secondary'|'tertiary'|'minor'|'service';
export type RoadMode = 'all'|'main'|'off';
export type ExportLayout = 'production'|'registered'|'individual';
export type GeoLine = { id:string; coordinates:LngLat[]; class:RoadClass; name?:string };
export type GeoPolygon = { id:string; rings:LngLat[][] };
export type BathymetrySourceMetadata={provider:'wisconsin-dnr'|'noaa-ncei'|'usgs'|'user';datasetId:string;title:string;sourceDate?:string;retrievedAt?:string;sourceUrl?:string;quality?:string;notForNavigation:true};
export type BathymetryContour={depthMeters:number;geometry:GeoPolygon[]};
export type BathymetryDataset={source:BathymetrySourceMetadata;depthUnit:'meters';minDepthMeters:number;maxDepthMeters:number;contours:BathymetryContour[]};
export type GeoPlace = { id:string; coordinate:LngLat; name:string; class:'city'|'town'|'village'|'hamlet' };
export type ExtractedFeatures = { water:GeoPolygon[]; roads:GeoLine[]; places:GeoPlace[] };

export type FontId='inter'|'cinzel'|'great-vibes';

export type MarkerType='pin'|'star'|'heart'|'house'|'cabin'|'campfire'|'fish'|'boat'|'anchor'|'crosshair'|'circle'|'diamond'|'flag';

// lat/lng are the true, permanent geographic identity of a marker (undefined until geocoded, or
// for a marker added directly by dragging with no address yet). The projected physical position
// is deliberately NOT stored here — it is recomputed on every scene build from lat/lng through the
// same CropProjection every other geographic feature uses (see geometry/scene/markers.ts), so a
// marker survives a crop/dimension regeneration without going stale, and reprojecting never
// requires special-case "recalculate markers" code. Manual drag position lives in
// MapProject.overrides[marker.id] (the same ObjectOverride/resolvePlacement mechanism title/
// compass/labels already use) rather than an offsetXMm/offsetYMm pair on the marker itself — the
// override's absence *is* "at the exact geocoded position", and deleting it (Reset) is exactly the
// existing resetOverrideFields, so dragging a marker changes nothing about lat/lng, matching the
// "true location vs artistic offset" requirement with no new mechanism.
export type MapMarker={
 id:string; // stable across reorders/deletes — never a derived array index
 address?:string;
 lat?:number;
 lng?:number;
 markerType:MarkerType;
 sizeMm:number;
 rotationDeg:number;
 label?:string;
 showLabel:boolean;
 labelSizeMm:number;
 visible:boolean;
 operation:'engrave'|'cut';
 keepOutEnabled:boolean;
 keepOutPaddingMm:number;
};

// A per-object manual edit layered on top of that object's generated/default placement. Absent
// fields fall back to the default; deleting an object's entry (or clearing a field) is "Reset" for
// that field. Object ids: 'title', 'subtitle', 'compass', `place-${GeoPlace.id}`,
// `road-label-${group id}`. This is the only place manual drag/nudge/flip/hide state lives — it is
// plain serializable project state, never ephemeral UI state like selection.
export type ObjectOverride={xMm?:number;yMm?:number;rotationDeg?:number;scale?:number;visible?:boolean;flipSide?:boolean};

export interface MapProject {
 version:1;
 map:{latitude:number;longitude:number;zoom:number;bearing:number;crop?:CropGeography};
 dimensions:{widthMm:number;heightMm:number;displayUnit:DisplayUnit;lockAspect:boolean};
 shoreline:{enabledLayers:boolean[];offsetsMm:number[];artisticOffsetsNormalized?:number[];preset:'xfine'|'fine'|'narrow'|'normal'|'wide'|'custom';waterMode?:'all'|'primary';minWaterAreaMm2?:number;minArtisticComponentAreaNormalized?:number};
 bathymetry:{mode:'true-bathymetry'|'decorative-offsets';provider?:BathymetrySourceMetadata['provider'];datasetId?:string;status?:'unchecked'|'available'|'unavailable'|'unsupported'|'error';statusMessage?:string;selection:'automatic'|'manual';thresholdsMeters:number[];dataset?:BathymetryDataset};
 roads:{mode:RoadMode;majorWidthMm:number;minorWidthMm:number};
 roadLabels:{visible:boolean;font:FontId;sizeMm:number;offsetMm:number;flipAllSides:boolean};
 placeLabels:{classes:Record<GeoPlace['class'],boolean>;font:FontId;sizeMm:number};
 // keepOutPaddingMm: how far beyond the compass's own rendered edge (see compassFootprintRadiusMm)
 // roads/labels must clear — always active whenever the compass is on (see docs/v1-milestones.md,
 // M-COMPASS), not a separate opt-in toggle, since the brief requires this to be a guarantee, not
 // an option someone could forget to enable.
 compass:{style:'classic'|'rose'|'minimal'|'classic-rose';position:'top-left'|'top-right'|'bottom-left'|'bottom-right'|'custom'|'off';xMm:number;yMm:number;sizeMm:number;rotationDeg:number;keepOutPaddingMm:number};
 title:{text:string;font:FontId;sizeMm:number;xMm:number;yMm:number;visible:boolean;backer:'none'|'offset'|'rectangle';backerPaddingMm:number};
 subtitle:{text:string;font:FontId;sizeMm:number;xMm:number;yMm:number;visible:boolean;gapMm:number};
 exportSettings:{layout:ExportLayout;panelGapMm:number;annotations:boolean};
 overrides:Record<string,ObjectOverride>;
 markers:MapMarker[];
}
