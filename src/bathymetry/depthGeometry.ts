import * as polygonClipping from 'polygon-clipping';
import type {BathymetryDataset,GeoPolygon} from '../types/project';
import type {CropProjection} from '../geometry/projection/cropProjection';
import {automaticThresholds} from './model';
import {buildWaterModel,multiPolygonArea,panelFromWater,validatePanel,type MultiPolygonMm} from '../geometry/shoreline/polygonEngine';
export type PhysicalDepthRegion={depthMeters:number;geometry:MultiPolygonMm;areaMm2:number};
export function projectDepthRegions(dataset:BathymetryDataset,shoreline:MultiPolygonMm,projection:CropProjection,width:number,height:number,thresholds:number[]):PhysicalDepthRegion[]{let previous=shoreline;return thresholds.map(depthMeters=>{const contour=dataset.contours.find(item=>item.depthMeters===depthMeters);if(!contour)throw new Error(`Dataset does not provide a ${depthMeters} m depth region.`);const projected=buildWaterModel(contour.geometry,projection,width,height,{mode:'all',minAreaMm2:0}).water,clipped=polygonClipping.intersection(projected,shoreline,previous);if(!clipped.length)throw new Error(`Depth region ${depthMeters} m does not overlap the selected waterbody.`);validatePanel(panelFromWater(clipped,width,height),width,height,`Depth ${depthMeters} m`);previous=clipped;return{depthMeters,geometry:clipped,areaMm2:multiPolygonArea(clipped)}})}
export function selectedThresholds(dataset:BathymetryDataset,count:number,selection:'automatic'|'manual',manual:number[]){return selection==='manual'?manual.slice(0,count):automaticThresholds(dataset.contours,count)}
