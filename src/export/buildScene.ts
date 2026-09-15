import type {BathymetrySourceMetadata,ExtractedFeatures,FontId,MapProject} from '../types/project';
import {CropProjection} from '../geometry/projection/cropProjection';
import {buildWaterModel,geometryPath,multiPolygonArea,panelFromWater,validatePanel,type WaterModel} from '../geometry/shoreline/polygonEngine';
import {artisticDepthOpenings,COLLAPSED_ARTISTIC_OPENING_AREA_MM2,normalizedProductSize,presetOffsets} from '../geometry/shoreline/artisticDepth';
import {projectRoads} from '../geometry/roads/roads';
import {projectDepthRegions,selectedThresholds} from '../bathymetry/depthGeometry';
import {resolvePlacement} from '../geometry/scene/overrides';
import {buildPlaceLabelObjects} from '../geometry/scene/placeLabels';
import {buildRoadLabelCandidates,resolveRoadLabelObject} from '../geometry/scene/roadLabels';
import {classicRoseGeometry,compassFootprintRadiusMm,compassPathData} from '../geometry/scene/compass';
import {clipPolylineAgainstCircles,keepOutFootprint,pointInsideAnyCircle,type KeepOutRegion} from '../geometry/scene/keepOut';
import {buildMarkerSceneObjects} from '../geometry/scene/markers';
import {markerDefinition,markerFootprintRadiusMm,markerPathData} from '../geometry/scene/markerRegistry';
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

// GEOMETRY CHANGE tier (M-LIVE): the expensive part — polygon union/erosion/differencing for
// every physical panel. Depends only on the crop, physical dimensions, shoreline/bathymetry
// settings, and the cached extracted features; independent of roads.mode/width, labels, title,
// and compass, so callers can cache this by that narrower key and skip straight to
// buildPresentationScene (below) for everything else. Road *strokes* are deliberately NOT added
// to layer-land here — road projection/filtering is cheap (no polygon booleans) and lives in the
// presentation tier so that changing roads.mode or width never re-triggers this expensive stage.
export type GeometryLayers={
 widthMm:number;
 heightMm:number;
 layers:PhysicalLayer[]; // cut-only panels; layer-land's shapes has no road/label/title/compass content yet
 model:WaterModel;
 projection:CropProjection;
 trueDepth:boolean;
 manufacturingWarnings:string[];
 bathymetrySource?:BathymetrySourceMetadata;
};

export function buildGeometryLayers(project:MapProject,features:ExtractedFeatures):GeometryLayers{
 if(!project.map.crop)throw new Error('Select a geographic crop before generation');
 if(!features.water.length)throw new Error('No water features found in the selected crop');
 const {widthMm:w,heightMm:h}=project.dimensions,projection=new CropProjection(project.map.crop,w,h),layers:PhysicalLayer[]=[],manufacturingWarnings:string[]=[];
 const model=buildWaterModel(features.water,projection,w,h,{mode:project.shoreline.waterMode,minAreaMm2:project.shoreline.minWaterAreaMm2,focus:{lng:project.map.longitude,lat:project.map.latitude}});
 const trueDepth=project.bathymetry.mode==='true-bathymetry';
 if(trueDepth&&!project.bathymetry.dataset)throw new Error('TRUE BATHYMETRY selected, but no verified depth-valued dataset is loaded. Import bathymetry or choose Decorative Offsets.');
 const depthIndexes=[1,2,3,4,5].filter(index=>project.shoreline.enabledLayers[index]),thresholds=trueDepth?selectedThresholds(project.bathymetry.dataset!,depthIndexes.length,project.bathymetry.selection,project.bathymetry.thresholdsMeters):[],regions=trueDepth?projectDepthRegions(project.bathymetry.dataset!,model.water,projection,w,h,thresholds):[],depthByIndex=new Map(depthIndexes.map((index,position)=>[index,regions[position]]));
 const normalizedOffsets=presetOffsets(project.shoreline.preset,project.shoreline.artisticOffsetsNormalized??[]),artisticOpenings=trueDepth?[]:artisticDepthOpenings(model.water,normalizedOffsets,w,h,project.shoreline.minArtisticComponentAreaNormalized),artisticByIndex=new Map(artisticOpenings.map((opening,index)=>[index+1,opening]));
 if(!trueDepth){model.metrics.normalizedProductSize=normalizedProductSize(w,h);model.metrics.artisticOffsetsNormalized=normalizedOffsets;model.metrics.artisticOpenings=artisticOpenings.map(opening=>({offsetNormalized:opening.normalizedOffset,areaMm2:opening.areaMm2,components:opening.componentCount,holes:opening.holeCount,vertices:opening.vertexCount,smallestComponentAreaMm2:opening.smallestComponentAreaMm2,largestComponentAreaMm2:opening.largestComponentAreaMm2,rejectedComponents:opening.rejectedComponents,rejectedHoles:opening.rejectedHoles}));model.metrics.rejectedArtisticComponents=artisticOpenings.reduce((sum,opening)=>sum+opening.rejectedComponents,0);model.metrics.rejectedArtisticHoles=artisticOpenings.reduce((sum,opening)=>sum+opening.rejectedHoles,0)}
 for(let i=0;i<7;i++){if(!project.shoreline.enabledLayers[i])continue;const id=i===0?'layer-land':i===6?'layer-base':`layer-depth-${i+1}`,shapes:Shape[]=[];
  if(i===6)shapes.push({id:`${id}-panel`,operation:'cut',kind:'rect',x:0,y:0,width:w,height:h});
  else{const region=depthByIndex.get(i),artistic=artisticByIndex.get(i),opening=i===0?model.water:trueDepth?region!.geometry:artistic!.geometry,panel=panelFromWater(opening,w,h),label=i===0?'Land':trueDepth?`Depth ${region!.depthMeters} m`:`Artistic Depth ${i}`,openingArea=multiPolygonArea(opening);validatePanel(panel,w,h,label);model.metrics.openingAreasMm2.push(openingArea);if(!trueDepth&&i>0&&openingArea<=COLLAPSED_ARTISTIC_OPENING_AREA_MM2)manufacturingWarnings.push(`Layer ${i+1} collapsed at the selected Artistic Depth offset and duplicates the Base geometry.`);shapes.push({id:`${id}-panel`,operation:'cut',kind:'path',d:geometryPath(panel)})}
  const region=depthByIndex.get(i);layers.push({id,name:i===6?'Base / Backer':i===0?'Land / Top':trueDepth?`Depth ${region!.depthMeters.toFixed(2)} m`:`Artistic Depth ${i}`,shapes,...(region?{depthMeters:region.depthMeters}:{})});
 }
 return{widthMm:w,heightMm:h,layers,model,projection,trueDepth,manufacturingWarnings,...(trueDepth?{bathymetrySource:project.bathymetry.dataset!.source}:{})};
}

// PRESENTATION CHANGE tier (M-LIVE): roads, road labels, place labels, title/subtitle/backer,
// and compass — no polygon boolean operations, safe to re-run on every keystroke/drag. Takes the
// (possibly cached) GeometryLayers from buildGeometryLayers and layers presentation content on
// top without mutating it, so the same cached geometry can be reused across many calls.
export function buildPresentationScene(project:MapProject,features:ExtractedFeatures,geometry:GeometryLayers):ManufacturingScene{
 const {widthMm:w,heightMm:h,model,projection,trueDepth,bathymetrySource,manufacturingWarnings}=geometry;
 const roads=projectRoads(features.roads,projection,project.roads.mode);

 // Keep-out (M-COMPASS, extended in M-MARKERS): resolved before roads/labels become shapes, so
 // engraving geometry can clear around the compass and any keep-out-enabled marker live. This
 // never mutates `roads`/`features.places` (the source geometry) — only which *shapes* get pushed
 // into `objects`/`layer-land` differs, exactly like every other presentation-tier edit in this
 // function. Moving/resizing/disabling a region simply changes `keepOutRegions` on the next call,
 // which is why previously-suppressed geometry always comes back — there is no separate "restore"
 // step, because nothing was ever deleted from the source in the first place.
 //
 // KeepOutRegion.affects is what actually distinguishes the two kinds of region: the compass
 // clears roads AND labels (its long-standing M-COMPASS behavior, unchanged here), while a marker's
 // optional keep-out only clears road engraving — per the M-MARKERS brief's explicit scope
 // reduction ("apply keep-out only to road engraving for now" if label collisions add too much
 // scope). This is the generalized KeepOutRegion system's first second consumer.
 const markerObjects=buildMarkerSceneObjects(project.markers,projection,w,h,project.overrides);
 const compassPlacement=project.compass.position!=='off'?resolvePlacement({xMm:project.compass.xMm,yMm:project.compass.yMm,rotationDeg:project.compass.rotationDeg},project.overrides.compass):undefined;
 const keepOutRegions:KeepOutRegion[]=[];
 if(compassPlacement?.visible)keepOutRegions.push(keepOutFootprint('compass-keepout','compass',compassPlacement.xMm,compassPlacement.yMm,compassFootprintRadiusMm(project.compass.style,project.compass.sizeMm),project.compass.keepOutPaddingMm,['roads-major','roads-minor','road-labels','place-labels']));
 for(const m of markerObjects){
  if(m.visible&&m.marker.keepOutEnabled)keepOutRegions.push(keepOutFootprint(`marker-keepout-${m.id}`,m.id,m.xMm,m.yMm,markerFootprintRadiusMm(Math.max(m.marker.sizeMm,markerDefinition(m.marker.markerType).minimumSizeMm)),m.marker.keepOutPaddingMm,['roads-major','roads-minor']));
 }
 const roadCircles=keepOutRegions.filter(r=>r.affects.includes('roads-major')||r.affects.includes('roads-minor')).flatMap(r=>r.circles);
 const roadLabelCircles=keepOutRegions.filter(r=>r.affects.includes('road-labels')).flatMap(r=>r.circles);
 const placeLabelCircles=keepOutRegions.filter(r=>r.affects.includes('place-labels')).flatMap(r=>r.circles);
 const labelExtraRadiusMm=(widthMm:number,sizeMm:number)=>widthMm+sizeMm/2; // conservative: covers the full text run plus half a letter-height, so a label is suppressed whenever any part of it could plausibly overlap, never half-clipped (per the brief's explicit preference)

 const roadShapes:Shape[]=project.roads.mode==='off'?[]:roads.flatMap((r,j)=>{
  const group=MAJOR_CLASSES.includes(r.class)?'roads-major':'roads-minor',strokeWidthMm=MAJOR_CLASSES.includes(r.class)?project.roads.majorWidthMm:project.roads.minorWidthMm;
  const segments=roadCircles.length?clipPolylineAgainstCircles(r.points,roadCircles):(r.points.length>1?[r.points]:[]);
  return segments.map((points,k):Shape=>({id:`road-${j}-${k}`,operation:'engrave',kind:'path',d:linePath(points),group,strokeWidthMm}));
 });
 const layers=geometry.layers.map(layer=>layer.id==='layer-land'?{...layer,shapes:[...layer.shapes,...roadShapes]}:layer);

 // Every object below is pushed into `objects`, which the SVG serializers already merge onto
 // layer-land only (never intermediate depth layers or Base) — see exportSvg.ts/previewSvg.ts.
 const objects:Shape[]=[];
 let renderedPlaceLabels=0,renderedRoadLabels=0,rejectedRoadLabels=0;

 const placeLabelObjects=buildPlaceLabelObjects(features.places,projection,w,h,project.placeLabels,project.overrides);
 if(placeLabelObjects.some(o=>o.visible)){
  const font=requireFont(project.placeLabels.font);
  for(const label of placeLabelObjects){
   if(!label.visible)continue;
   const {d,widthMm}=textPathData(font,label.name,project.placeLabels.sizeMm,'left');
   if(pointInsideAnyCircle({x:label.xMm,y:label.yMm},placeLabelCircles,labelExtraRadiusMm(widthMm,project.placeLabels.sizeMm)))continue; // suppressed whole, never half-clipped
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
    if(pointInsideAnyCircle({x:label.xMm,y:label.yMm},roadLabelCircles,labelExtraRadiusMm(widthMm,project.roadLabels.sizeMm)))continue; // suppressed whole, never half-clipped
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

 if(compassPlacement?.visible){
  const transform=`translate(${compassPlacement.xMm} ${compassPlacement.yMm}) rotate(${compassPlacement.rotationDeg})`;
  // Classic Rose is several sub-shapes (ring/star/center boss/four letters) combined into ONE
  // path's `d` (multiple M..Z subpaths) rather than several Shape entries. This is deliberate, not
  // a shortcut: the drag/select code in GeneratedPreview.tsx resolves exactly one DOM element per
  // data-object-id and reads/writes its single `transform` attribute live during a drag gesture
  // (see the comment there) — splitting the compass into multiple Shapes with the same objectId
  // would only move the first-matched piece during a drag, leaving the rest visibly frozen until
  // release. One Shape, one transform keeps the existing (already load-bearing) drag architecture
  // correct without any changes to it.
  if(project.compass.style==='classic-rose'){
   const geo=classicRoseGeometry(project.compass.sizeMm);
   const font=requireFont('inter');
   const letterD=(['N','E','S','W'] as const).map(point=>{
    const {x,y}=geo.letterPositions[point];
    const measured=textPathData(font,point,geo.letterSizeMm,'center');
    const midY=(measured.bounds.minY+measured.bounds.maxY)/2; // vertical-center the glyph on its target point, since a baseline-anchored glyph otherwise sits visually low
    return textPathData(font,point,geo.letterSizeMm,'center',x,y-midY).d;
   });
   const d=[geo.ringD,geo.starD,geo.centerD,...letterD].join(' ');
   objects.push({id:'compass',operation:'engrave',kind:'path',d,transform,group:'compass',objectId:'compass'});
  }else{
   const d=compassPathData(project.compass.style,project.compass.sizeMm);
   objects.push({id:'compass',operation:'engrave',kind:'path',d,transform,group:'compass',objectId:'compass'});
  }
 }

 // Markers (M-MARKERS): each visible, geocoded marker pushes its glyph (operation-appropriate
 // group: 'markers-cut' or 'markers-engrave') and, if it has a label, a *separate* Shape sharing
 // the same objectId — the same "two Shapes, one objectId" pattern title/title-backer already use.
 // Deliberately not combined into one path like the compass's classic-rose: the label must stay
 // upright (rotate 0) even when the marker glyph itself is rotated for orientation (a boat/flag
 // pointing a direction), and baking that counter-rotation into a shared transform would need
 // per-point path rotation math for no real benefit here — the accepted cost is the same one
 // title+backer already has (the second shape doesn't visibly follow a live drag/rotate until
 // release, when the override-driven re-render catches it up). hitRadiusMm gives the glyph an
 // invisible, editor-only click target (previewSvg.ts only; exportSvg.ts never reads it) since a
 // hollow/thin marker outline would otherwise be hard to grab by its bounding-box interior — same
 // reasoning as the M-COMPASS classic-rose ring.
 for(const m of markerObjects){
  if(!m.visible)continue;
  const sizeMm=Math.max(m.marker.sizeMm,markerDefinition(m.marker.markerType).minimumSizeMm);
  const radiusMm=markerFootprintRadiusMm(sizeMm);
  const d=markerPathData(m.marker.markerType,sizeMm);
  const group=m.marker.operation==='cut'?'markers-cut':'markers-engrave';
  objects.push({id:m.id,operation:m.marker.operation,kind:'path',d,transform:`translate(${m.xMm} ${m.yMm}) rotate(${m.rotationDeg})`,group,objectId:m.id,hitRadiusMm:radiusMm*1.15});
  if(m.marker.showLabel&&m.marker.label){
   const font=requireFont('inter');
   const {d:labelD}=textPathData(font,m.marker.label,m.marker.labelSizeMm,'center');
   const labelYMm=m.yMm+radiusMm+m.marker.labelSizeMm*.9+1.5;
   objects.push({id:`${m.id}-label`,operation:'engrave',kind:'path',d:labelD,transform:`translate(${m.xMm} ${labelYMm}) rotate(0)`,group:'marker-labels',objectId:m.id});
  }
 }

 return{widthMm:w,heightMm:h,layers,objects,manufacturingWarnings,geometryMetrics:model.metrics,labelMetrics:{placeLabels:renderedPlaceLabels,roadLabels:renderedRoadLabels,rejectedRoadLabels},depthMode:project.bathymetry.mode,...(trueDepth?{bathymetrySource:bathymetrySource!}:{})};
}

export function buildScene(project:MapProject,features:ExtractedFeatures):ManufacturingScene{
 return buildPresentationScene(project,features,buildGeometryLayers(project,features));
}
