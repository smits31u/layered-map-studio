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
export interface MapProject {
 version:1;
 map:{latitude:number;longitude:number;zoom:number;bearing:number;crop?:CropGeography};
 dimensions:{widthMm:number;heightMm:number;displayUnit:DisplayUnit;lockAspect:boolean};
 shoreline:{enabledLayers:boolean[];offsetsMm:number[];artisticOffsetsNormalized?:number[];preset:'xfine'|'fine'|'narrow'|'normal'|'wide'|'custom';waterMode?:'all'|'primary';minWaterAreaMm2?:number;minArtisticComponentAreaNormalized?:number};
 bathymetry:{mode:'true-bathymetry'|'decorative-offsets';provider?:BathymetrySourceMetadata['provider'];datasetId?:string;status?:'unchecked'|'available'|'unavailable'|'error';statusMessage?:string;selection:'automatic'|'manual';thresholdsMeters:number[];dataset?:BathymetryDataset};
 roads:{mode:RoadMode;majorWidthMm:number;minorWidthMm:number};
 roadLabels:{visible:boolean;font:string;sizeMm:number;offsetMm:number};
 placeLabels:{classes:Record<GeoPlace['class'],boolean>;font:string;sizeMm:number};
 compass:{style:'classic'|'rose'|'minimal';position:'top-left'|'top-right'|'bottom-left'|'bottom-right'|'custom'|'off';xMm:number;yMm:number;sizeMm:number};
 title:{text:string;font:string;sizeMm:number;xMm:number;yMm:number;backer:'none'|'offset'|'rectangle'};
 subtitle:{text:string;font:string;sizeMm:number;xMm:number;yMm:number;gapMm:number};
 exportSettings:{layout:ExportLayout;panelGapMm:number;annotations:boolean};
}
