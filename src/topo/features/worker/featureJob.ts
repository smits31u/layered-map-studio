import type {MultiPolygonMm} from '../../../geometry/shoreline/polygonEngine';
import type {CapturedRoad} from '../../../ornament/capture/featureTypes';
import type {PolylineMm} from '../../../ornament/geometry/clipLine';
import type {FrozenTerrainView} from '../../terrain/pipeline';
import {buildTopoRoads,type TopoRoadLayer,type TopoRoadSettings} from '../roads';
import {buildRouteGeometry,type TopoRouteLayer} from '../route';

// The fabrication-geometry jobs the feature worker runs: plain serializable input, one pure function.
// `water` is the terrain's water, for bridge tabs across genuine crossings.
export type FeatureJob=
 |{kind:'roads';roads:readonly CapturedRoad[];view:FrozenTerrainView;settings:TopoRoadSettings;land:MultiPolygonMm;water:MultiPolygonMm;tunnelRoadKeys?:readonly string[];simplifyToleranceMm?:number}
 |{kind:'route';lines:readonly PolylineMm[];widthMm:number;land:MultiPolygonMm;water:MultiPolygonMm;board:{widthMm:number;heightMm:number}};

export type FeatureJobResult={kind:'roads';layer:TopoRoadLayer}|{kind:'route';layer:TopoRouteLayer};

export function buildFeatureJob(job:FeatureJob):FeatureJobResult{
 if(job.kind==='roads')return {kind:'roads',layer:buildTopoRoads(job.roads,job.view,job.settings,job.land,{water:job.water,tunnelRoadKeys:job.tunnelRoadKeys,simplifyToleranceMm:job.simplifyToleranceMm})};
 return {kind:'route',layer:buildRouteGeometry(job.lines,job.widthMm,job.land,job.water,job.board)};
}
