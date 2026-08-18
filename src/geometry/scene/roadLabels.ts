import type {MapProject,ObjectOverride,RoadClass} from '../../types/project';
import type {PointMm} from '../projection/cropProjection';
import {resolvePlacement} from './overrides';

export type RoadLabelCandidate={
 id:string;
 name:string;
 roadClass:RoadClass;
 baseXMm:number;
 baseYMm:number;
 tangentAngleDeg:number; // orientation-corrected so text never renders upside down
 segmentLengthMm:number; // longest straight sub-segment available to fit text against
 perpUnit:{x:number;y:number}; // unit vector perpendicular to the tangent, "up" side (flipSide false)
};

export type RoadLabelSceneObject=RoadLabelCandidate&{
 xMm:number;
 yMm:number;
 flipSide:boolean;
 visible:boolean;
};

const length=(a:PointMm,b:PointMm)=>Math.hypot(b.x-a.x,b.y-a.y);

function longestSegment(points:PointMm[]):{a:PointMm;b:PointMm;lengthMm:number}|undefined{
 let best:{a:PointMm;b:PointMm;lengthMm:number}|undefined;
 for(let i=1;i<points.length;i++){
  const lengthMm=length(points[i-1],points[i]);
  if(!best||lengthMm>best.lengthMm)best={a:points[i-1],b:points[i],lengthMm};
 }
 return best;
}

// Groups raw (often tile-fragmented) road features into one candidate per named road+class rather
// than labeling every fragment. This is intentionally simple — pick the single longest straight
// sub-segment across every fragment sharing the same name+class — not full polyline chaining,
// per the brief's "does not need to be perfect yet" allowance. Takes already-projected, already
// mode-filtered/bounds-clipped roads (the same list buildScene draws road strokes from) so labels
// stay consistent with what's actually drawn.
export function buildRoadLabelCandidates(roads:Array<{class:RoadClass;name?:string;points:PointMm[]}>):RoadLabelCandidate[]{
 const groups=new Map<string,{name:string;roadClass:RoadClass;lines:PointMm[][]}>();
 for(const road of roads){
  const name=road.name?.trim();
  if(!name)continue; // unnamed roads are never labeled
  const points=road.points;
  if(points.length<2)continue;
  const key=`${road.class}|${name.toLowerCase()}`;
  const group=groups.get(key)??{name,roadClass:road.class,lines:[]};
  group.lines.push(points);
  groups.set(key,group);
 }
 const candidates:RoadLabelCandidate[]=[];
 for(const [key,group] of groups){
  let best:{a:PointMm;b:PointMm;lengthMm:number}|undefined;
  for(const line of group.lines){
   const segment=longestSegment(line);
   if(segment&&(!best||segment.lengthMm>best.lengthMm))best=segment;
  }
  if(!best)continue;
  const dx=best.b.x-best.a.x,dy=best.b.y-best.a.y,len=Math.hypot(dx,dy)||1;
  let angleDeg=Math.atan2(dy,dx)*180/Math.PI;
  if(angleDeg>90)angleDeg-=180;else if(angleDeg<-90)angleDeg+=180; // never upside down
  const perpUnit={x:-dy/len,y:dx/len};
  candidates.push({
   id:`road-label-${key}`,
   name:group.name,
   roadClass:group.roadClass,
   baseXMm:(best.a.x+best.b.x)/2,
   baseYMm:(best.a.y+best.b.y)/2,
   tangentAngleDeg:angleDeg,
   segmentLengthMm:best.lengthMm,
   perpUnit,
  });
 }
 return candidates;
}

export function resolveRoadLabelObject(candidate:RoadLabelCandidate,config:MapProject['roadLabels'],override:ObjectOverride|undefined):RoadLabelSceneObject{
 const flipSide=(override?.flipSide??false)!==config.flipAllSides;
 const sign=flipSide?-1:1;
 const defaultXMm=candidate.baseXMm+candidate.perpUnit.x*config.offsetMm*sign;
 const defaultYMm=candidate.baseYMm+candidate.perpUnit.y*config.offsetMm*sign;
 const resolved=resolvePlacement({xMm:defaultXMm,yMm:defaultYMm,flipSide:false},override?{...override,flipSide:undefined}:undefined);
 return {...candidate,xMm:resolved.xMm,yMm:resolved.yMm,flipSide,visible:resolved.visible};
}
