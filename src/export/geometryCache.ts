import type {ExtractedFeatures,MapProject} from '../types/project';
import {buildGeometryLayers,type GeometryLayers} from './buildScene';

// The subset of MapProject that actually affects buildGeometryLayers's expensive polygon-boolean
// work (water union/erosion/differencing). Everything else — roads.mode/width, road/place label
// settings, title/subtitle/backer, compass, and all manual overrides — is handled entirely by
// buildPresentationScene and must never appear here, or a purely-presentation change would
// needlessly invalidate the cache and defeat the point of M-LIVE.
export function geometryKeyOf(project:MapProject):string{
 return JSON.stringify({
  crop:project.map.crop,
  focus:{lng:project.map.longitude,lat:project.map.latitude}, // 'primary' water-selection focus point
  widthMm:project.dimensions.widthMm,
  heightMm:project.dimensions.heightMm,
  shoreline:project.shoreline,
  bathymetry:{mode:project.bathymetry.mode,selection:project.bathymetry.selection,thresholdsMeters:project.bathymetry.thresholdsMeters,dataset:project.bathymetry.dataset},
 });
}

export type GeometryCache={key:string;features:ExtractedFeatures;result:GeometryLayers}|undefined;

export type GeometryCacheResult={cache:GeometryCache;result:GeometryLayers;reused:boolean};

// Pure function: given the previous cache value, returns the (possibly-reused) geometry layers
// plus the cache value to store for next time. `features` is compared by reference — it only ever
// gets a new reference when a fresh geographic extraction actually happens (see App.tsx), so
// reference equality is both correct and free here, no deep-equality needed.
export function getCachedGeometryLayers(cache:GeometryCache,project:MapProject,features:ExtractedFeatures):GeometryCacheResult{
 const key=geometryKeyOf(project);
 if(cache&&cache.key===key&&cache.features===features)return{cache,result:cache.result,reused:true};
 const result=buildGeometryLayers(project,features);
 return{cache:{key,features,result},result,reused:false};
}
