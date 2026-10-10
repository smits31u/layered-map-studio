import type {ExtractedFeatures,MapProject} from '../types/project';
import {CropProjection} from '../geometry/projection/cropProjection';
import {buildWaterModel} from '../geometry/shoreline/polygonEngine';
import type {GeoMultiPolygon} from './model';

// The water body the depth panels will be cut from — the same buildWaterModel selection the scene
// uses (Primary or All water, crop-clipped) — handed back in lng/lat so depth providers can match
// surveys to it by location rather than by the search box's text.
export function selectedWaterGeo(project:MapProject,features:ExtractedFeatures):GeoMultiPolygon{
 if(!project.map.crop)throw new Error('Select a geographic crop first.');
 if(!features.water.length)throw new Error('No water features captured in the selected crop.');
 const {widthMm:w,heightMm:h}=project.dimensions,projection=new CropProjection(project.map.crop,w,h);
 const {water}=buildWaterModel(features.water,projection,w,h,{mode:project.shoreline.waterMode,minAreaMm2:project.shoreline.minWaterAreaMm2,focus:{lng:project.map.longitude,lat:project.map.latitude}});
 return water.map(polygon=>polygon.map(ring=>ring.map(([x,y])=>{const p=projection.unproject({x,y});return[p.lng,p.lat] as [number,number]})));
}
