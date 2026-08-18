import type {ExtractedFeatures,MapProject} from '../types/project';
import {CropProjection} from '../geometry/projection/cropProjection';
import {buildWaterModel,geometryPath,multiPolygonArea,panelFromWater,validatePanel} from '../geometry/shoreline/polygonEngine';
import {artisticDepthOpenings,normalizedProductSize,presetOffsets} from '../geometry/shoreline/artisticDepth';
import {projectRoads} from '../geometry/roads/roads';
import {projectDepthRegions,selectedThresholds} from '../bathymetry/depthGeometry';
import type {ManufacturingScene,PhysicalLayer,Shape} from './scene';
const linePath=(p:{x:number;y:number}[])=>p.map((q,i)=>`${i?'L':'M'}${q.x.toFixed(3)} ${q.y.toFixed(3)}`).join(' ');
export function buildScene(project:MapProject,features:ExtractedFeatures):ManufacturingScene{
 if(!project.map.crop)throw new Error('Select a geographic crop before generation');
 if(!features.water.length)throw new Error('No water features found in the selected crop');
 const {widthMm:w,heightMm:h}=project.dimensions,projection=new CropProjection(project.map.crop,w,h),layers:PhysicalLayer[]=[];
 const model=buildWaterModel(features.water,projection,w,h,{mode:project.shoreline.waterMode,minAreaMm2:project.shoreline.minWaterAreaMm2,focus:{lng:project.map.longitude,lat:project.map.latitude}});
 const trueDepth=project.bathymetry.mode==='true-bathymetry';
 if(trueDepth&&!project.bathymetry.dataset)throw new Error('TRUE BATHYMETRY selected, but no verified depth-valued dataset is loaded. Import bathymetry or choose Decorative Offsets.');
 const depthIndexes=[1,2,3,4,5].filter(index=>project.shoreline.enabledLayers[index]),thresholds=trueDepth?selectedThresholds(project.bathymetry.dataset!,depthIndexes.length,project.bathymetry.selection,project.bathymetry.thresholdsMeters):[],regions=trueDepth?projectDepthRegions(project.bathymetry.dataset!,model.water,projection,w,h,thresholds):[],depthByIndex=new Map(depthIndexes.map((index,position)=>[index,regions[position]]));
 const normalizedOffsets=presetOffsets(project.shoreline.preset,project.shoreline.artisticOffsetsNormalized??[]),artisticOpenings=trueDepth?[]:artisticDepthOpenings(model.water,normalizedOffsets,w,h,project.shoreline.minArtisticComponentAreaNormalized),artisticByIndex=new Map(artisticOpenings.map((opening,index)=>[index+1,opening]));
 if(!trueDepth){model.metrics.normalizedProductSize=normalizedProductSize(w,h);model.metrics.artisticOffsetsNormalized=normalizedOffsets;model.metrics.artisticOpenings=artisticOpenings.map(opening=>({offsetNormalized:opening.normalizedOffset,areaMm2:opening.areaMm2,components:opening.componentCount,holes:opening.holeCount,vertices:opening.vertexCount,smallestComponentAreaMm2:opening.smallestComponentAreaMm2,largestComponentAreaMm2:opening.largestComponentAreaMm2,rejectedComponents:opening.rejectedComponents,rejectedHoles:opening.rejectedHoles}));model.metrics.rejectedArtisticComponents=artisticOpenings.reduce((sum,opening)=>sum+opening.rejectedComponents,0);model.metrics.rejectedArtisticHoles=artisticOpenings.reduce((sum,opening)=>sum+opening.rejectedHoles,0)}
 const roads=projectRoads(features.roads,projection,project.roads.mode);
 for(let i=0;i<7;i++){if(!project.shoreline.enabledLayers[i])continue;const id=i===0?'layer-land':i===6?'layer-base':`layer-depth-${i+1}`,shapes:Shape[]=[];
  if(i===6)shapes.push({id:`${id}-panel`,operation:'cut',kind:'rect',x:0,y:0,width:w,height:h});
  else{const region=depthByIndex.get(i),artistic=artisticByIndex.get(i),opening=i===0?model.water:trueDepth?region!.geometry:artistic!.geometry,panel=panelFromWater(opening,w,h),label=i===0?'Land':trueDepth?`Depth ${region!.depthMeters} m`:`Artistic Depth ${i}`;validatePanel(panel,w,h,label);model.metrics.openingAreasMm2.push(multiPolygonArea(opening));shapes.push({id:`${id}-panel`,operation:'cut',kind:'path',d:geometryPath(panel)})}
  if(i===0&&project.roads.mode!=='off')shapes.push(...roads.map((r,j)=>({id:`road-${j}`,operation:'engrave' as const,kind:'path' as const,d:linePath(r.points),strokeWidthMm:['motorway','trunk','primary','secondary'].includes(r.class)?project.roads.majorWidthMm:project.roads.minorWidthMm})));
  const region=depthByIndex.get(i);layers.push({id,name:i===6?'Base / Backer':i===0?'Land / Top':trueDepth?`Depth ${region!.depthMeters.toFixed(2)} m`:`Artistic Depth ${i}`,shapes,...(region?{depthMeters:region.depthMeters}:{})});
 }
 const objects:Shape[]=[];if(project.compass.position!=='off'){const{xMm:x,yMm:y,sizeMm:s}=project.compass;objects.push({id:'compass',operation:'engrave',kind:'path',d:`M${x} ${y+s} L${x+s/2} ${y} L${x+s} ${y+s} L${x+s/2} ${y+s*.72} Z M${x+s/2} ${y} L${x+s/2} ${y+s}`})}
 return{widthMm:w,heightMm:h,layers,objects,geometryMetrics:model.metrics,depthMode:project.bathymetry.mode,...(trueDepth?{bathymetrySource:project.bathymetry.dataset!.source}:{})};
}
