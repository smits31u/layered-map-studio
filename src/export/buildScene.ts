import type {ExtractedFeatures,FontId,MapProject} from '../types/project';
import {CropProjection} from '../geometry/projection/cropProjection';
import {buildWaterModel,geometryPath,multiPolygonArea,panelFromWater,validatePanel} from '../geometry/shoreline/polygonEngine';
import {artisticDepthOpenings,normalizedProductSize,presetOffsets} from '../geometry/shoreline/artisticDepth';
import {projectRoads} from '../geometry/roads/roads';
import {projectDepthRegions,selectedThresholds} from '../bathymetry/depthGeometry';
import {resolvePlacement} from '../geometry/scene/overrides';
import {buildPlaceLabelObjects} from '../geometry/scene/placeLabels';
import {buildRoadLabelCandidates,resolveRoadLabelObject} from '../geometry/scene/roadLabels';
import {compassPathData} from '../geometry/scene/compass';
import {titleBackerPath} from '../geometry/scene/titleBacker';
import {getLoadedFont} from '../text/fontRegistry';
import {textPathData} from '../text/textVector';
import type {ManufacturingScene,PhysicalLayer,Shape} from './scene';
const linePath=(p:{x:number;y:number}[])=>p.map((q,i)=>`${i?'L':'M'}${q.x.toFixed(3)} ${q.y.toFixed(3)}`).join(' ');
const MAJOR_CLASSES=['motorway','trunk','primary','secondary'];

function requireFont(id:FontId){
 const font=getLoadedFont(id);
 if(!font)throw new Error(`Font "${id}" is still loading — wait a moment and try again.`);
 return font;
}

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
  if(i===0&&project.roads.mode!=='off')shapes.push(...roads.map((r,j)=>({id:`road-${j}`,operation:'engrave' as const,kind:'path' as const,d:linePath(r.points),group:MAJOR_CLASSES.includes(r.class)?'roads-major':'roads-minor',strokeWidthMm:MAJOR_CLASSES.includes(r.class)?project.roads.majorWidthMm:project.roads.minorWidthMm})));
  const region=depthByIndex.get(i);layers.push({id,name:i===6?'Base / Backer':i===0?'Land / Top':trueDepth?`Depth ${region!.depthMeters.toFixed(2)} m`:`Artistic Depth ${i}`,shapes,...(region?{depthMeters:region.depthMeters}:{})});
 }

 // Every object below is pushed into `objects`, which the SVG serializers already merge onto
 // layer-land only (never intermediate depth layers or Base) — see exportSvg.ts/previewSvg.ts.
 const objects:Shape[]=[];
 let renderedPlaceLabels=0,renderedRoadLabels=0,rejectedRoadLabels=0;

 const placeLabelObjects=buildPlaceLabelObjects(features.places,projection,w,h,project.placeLabels,project.overrides);
 if(placeLabelObjects.some(o=>o.visible)){
  const font=requireFont(project.placeLabels.font);
  for(const label of placeLabelObjects){
   if(!label.visible)continue;
   const {d}=textPathData(font,label.name,project.placeLabels.sizeMm,'left');
   objects.push({id:label.id,operation:'engrave',kind:'path',d,transform:`translate(${label.xMm} ${label.yMm}) rotate(0)`,group:'place-labels',objectId:label.id});
   renderedPlaceLabels++;
  }
 }

 if(project.roadLabels.visible){
  const candidates=buildRoadLabelCandidates(roads);
  const resolved=candidates.map(candidate=>resolveRoadLabelObject(candidate,project.roadLabels,project.overrides[candidate.id]));
  if(resolved.some(o=>o.visible)){
   const font=requireFont(project.roadLabels.font);
   for(const label of resolved){
    if(!label.visible)continue;
    const {d,widthMm}=textPathData(font,label.name,project.roadLabels.sizeMm,'center');
    if(widthMm>label.segmentLengthMm*.92){rejectedRoadLabels++;continue} // reject labels that don't fit
    objects.push({id:label.id,operation:'engrave',kind:'path',d,transform:`translate(${label.xMm} ${label.yMm}) rotate(${label.tangentAngleDeg})`,group:'road-labels',objectId:label.id});
    renderedRoadLabels++;
   }
  }
 }

 const titlePlacement=resolvePlacement({xMm:project.title.xMm,yMm:project.title.yMm,visible:project.title.visible},project.overrides.title);
 if(project.title.text&&titlePlacement.visible){
  const font=requireFont(project.title.font);
  const {d,bounds}=textPathData(font,project.title.text,project.title.sizeMm,'center');
  const transform=`translate(${titlePlacement.xMm} ${titlePlacement.yMm}) rotate(${titlePlacement.rotationDeg})`;
  // Backer is scoped to the title text only (not title+subtitle combined) — a deliberate scope
  // limit; see the final report.
  const backerD=titleBackerPath(project.title.backer,bounds,project.title.backerPaddingMm);
  if(backerD)objects.push({id:'title-backer-panel',operation:'cut',kind:'path',d:backerD,transform,group:'title-backer',objectId:'title'});
  objects.push({id:'title-text',operation:'engrave',kind:'path',d,transform,group:'title',objectId:'title'});
 }

 const subtitlePlacement=resolvePlacement({xMm:project.subtitle.xMm,yMm:project.subtitle.yMm,visible:project.subtitle.visible},project.overrides.subtitle);
 if(project.subtitle.text&&subtitlePlacement.visible){
  const font=requireFont(project.subtitle.font);
  const {d}=textPathData(font,project.subtitle.text,project.subtitle.sizeMm,'center');
  objects.push({id:'subtitle-text',operation:'engrave',kind:'path',d,transform:`translate(${subtitlePlacement.xMm} ${subtitlePlacement.yMm}) rotate(${subtitlePlacement.rotationDeg})`,group:'subtitle',objectId:'subtitle'});
 }

 if(project.compass.position!=='off'){
  const placement=resolvePlacement({xMm:project.compass.xMm,yMm:project.compass.yMm,rotationDeg:project.compass.rotationDeg},project.overrides.compass);
  if(placement.visible){
   const d=compassPathData(project.compass.style,project.compass.sizeMm);
   objects.push({id:'compass',operation:'engrave',kind:'path',d,transform:`translate(${placement.xMm} ${placement.yMm}) rotate(${placement.rotationDeg})`,group:'compass',objectId:'compass'});
  }
 }

 return{widthMm:w,heightMm:h,layers,objects,geometryMetrics:model.metrics,labelMetrics:{placeLabels:renderedPlaceLabels,roadLabels:renderedRoadLabels,rejectedRoadLabels},depthMode:project.bathymetry.mode,...(trueDepth?{bathymetrySource:project.bathymetry.dataset!.source}:{})};
}
