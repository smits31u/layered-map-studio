import type {GeoLine,MapProject,RoadClass} from '../../types/project';
import type {CropProjection,PointMm} from '../projection/cropProjection';
const MAIN=new Set<RoadClass>(['motorway','trunk','primary','secondary']);
export function includeRoad(cls:RoadClass,mode:MapProject['roads']['mode']){return mode==='all'||(mode==='main'&&MAIN.has(cls))}
export function projectRoads(roads:GeoLine[],projection:CropProjection,mode:MapProject['roads']['mode']){return roads.filter(r=>includeRoad(r.class,mode)).map(r=>({...r,points:r.coordinates.map(p=>projection.project(p)).filter(inBounds(projection))})).filter(r=>r.points.length>1)}
const inBounds=(p:CropProjection)=>(q:PointMm)=>q.x>=0&&q.y>=0&&q.x<=p.widthMm&&q.y<=p.heightMm;
