import * as polygonClipping from 'polygon-clipping';
import ClipperLib from 'clipper-lib';

// Polygon booleans that do not give up on complex real shorelines.
//
// polygon-clipping is a floating-point sweep. On a few real, island-heavy coastlines it throws
// ("Unable to complete output ring…", "Unable to find segment…") instead of returning an answer.
// Willow Flowage (zoom 13) and Turtle-Flambeau Flowage (zoom 10) both do this on the water union,
// which stopped every depth mode from generating at all. It stays the first choice, so every
// shoreline that already worked keeps byte-identical output. When it throws, the same operation
// runs in Clipper's integer arithmetic, which is exact apart from rounding each vertex to the grid.
// For millimetre geometry that grid is 0.001 mm (the scale polygonEngine's offsets already use),
// about 1/150 of a laser kerf. Only if Clipper also fails does the caller see an error.

type Ring=[number,number][];
type Polygon=Ring[];
type MultiPolygon=Polygon[];
export type BooleanOp='union'|'intersection'|'difference';

// 1 unit = 0.001 mm for millimetre geometry. Callers working in degrees pass their own scale.
export const ROBUST_BOOLEAN_SCALE_MM=1000;

// A Polygon's first ring's first point is [x,y]; a MultiPolygon is one level deeper.
const asMulti=(geometry:Polygon|MultiPolygon):MultiPolygon=>typeof (geometry as Polygon)[0]?.[0]?.[0]==='number'?[geometry as Polygon]:geometry as MultiPolygon;

function toPaths(geometry:MultiPolygon,scale:number):ClipperLib.Path[]{
 const paths:ClipperLib.Path[]=[];
 for(const polygon of geometry)polygon.forEach((ring,index)=>{
  const points=ring.length>1&&ring[0][0]===ring[ring.length-1][0]&&ring[0][1]===ring[ring.length-1][1]?ring.slice(0,-1):ring;
  const path=points.map(([x,y])=>({X:Math.round(x*scale),Y:Math.round(y*scale)}));
  if(path.length<3)return;
  // Outer rings one way, holes the other, so non-zero filling reads each polygon correctly and
  // overlapping polygons union rather than cancel.
  if(ClipperLib.Clipper.Orientation(path)!==(index===0))path.reverse();
  paths.push(path);
 });
 return paths;
}

function fromTree(tree:ClipperLib.PolyTree,scale:number):MultiPolygon{
 const ring=(path:ClipperLib.Path):Ring=>{const out=path.map(p=>[p.X/scale,p.Y/scale] as [number,number]);out.push([out[0][0],out[0][1]]);return out};
 return ClipperLib.JS.PolyTreeToExPolygons(tree).filter(ex=>ex.outer.length>=3).map(ex=>[ring(ex.outer),...ex.holes.filter(h=>h.length>=3).map(ring)]);
}

function clipperBoolean(op:BooleanOp,subject:MultiPolygon,clips:MultiPolygon[],scale:number):MultiPolygon{
 const run=(type:ClipperLib.ClipType,a:ClipperLib.Path[],b:ClipperLib.Path[])=>{
  const clipper=new ClipperLib.Clipper(),tree=new ClipperLib.PolyTree();
  clipper.StrictlySimple=true;
  clipper.AddPaths(a,ClipperLib.PolyType.ptSubject,true);
  if(b.length)clipper.AddPaths(b,ClipperLib.PolyType.ptClip,true);
  if(!clipper.Execute(type,tree,ClipperLib.PolyFillType.pftNonZero,ClipperLib.PolyFillType.pftNonZero))throw new Error(`Clipper ${op} failed`);
  return tree;
 };
 if(op==='union')return fromTree(run(ClipperLib.ClipType.ctUnion,toPaths([subject,...clips].flat(),scale),[]),scale);
 if(op==='difference')return fromTree(run(ClipperLib.ClipType.ctDifference,toPaths(subject,scale),toPaths(clips.flat(),scale)),scale);
 // Intersection of several: fold pairwise, each result re-entering as the next subject.
 let result=subject;
 for(const clip of clips)result=fromTree(run(ClipperLib.ClipType.ctIntersection,toPaths(result,scale),toPaths(clip,scale)),scale);
 return result;
}

// polygon-clipping first; Clipper if it throws. `label` names the operation in the error a caller
// sees when both fail.
export function robustBoolean(op:BooleanOp,subject:Polygon|MultiPolygon,clips:(Polygon|MultiPolygon)[],scale=ROBUST_BOOLEAN_SCALE_MM):MultiPolygon{
 try{return polygonClipping[op](subject,...clips) as MultiPolygon}
 catch(floatError){
  try{return clipperBoolean(op,asMulti(subject),clips.map(asMulti),scale)}
  catch{throw floatError}
 }
}
