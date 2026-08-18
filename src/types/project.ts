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
 bathymetry:{mode:'true-bathymetry'|'decorative-offsets';provider?:BathymetrySourceMetadata['provider'];datasetId?:string;status?:'unchecked'|'available'|'unavailable'|'error';statusMessage?:string;selection:'automatic'|'manual';thresholdsMeters:number[];dataset?:BathymetryDataset};
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
}
