import earcut from 'earcut';
import {nestRings,parsePathData,ringSignedArea,type NestedPolygon,type Point} from '../geometry/pathData';

// Extrudes a piece's outline into a closed solid: the even-odd polygons of its cut paths, with
// holes, as top and bottom caps joined by side walls. Pure and renderer-free, so the 3D preview's
// worker, its tests and any future tool share one implementation, and so the solid is built from
// the very `d` strings the SVG export writes.
//
// Coordinates: x is the SVG x, z is the SVG y (so north stays at the back of the board seen from the
// front), and y is up, in millimetres. Triangles are wound so their geometric normal agrees with the
// normal stored for them, which keeps back-face culling and lighting correct whatever direction the
// source rings happened to be wound in.

export type MeshData={
 positions:Float32Array;
 normals:Float32Array;
 // Top-cap texture coordinates across the piece (u along x, v up the board as an image is drawn),
 // zero elsewhere. The preview maps the engraving onto the top face with them.
 uvs:Float32Array;
 indices:Uint32Array;
 // The first topIndexCount indices are the top cap, so the top face can carry its own material.
 topIndexCount:number;
};

export type ExtrudeOptions={widthMm:number;heightMm:number;baseY:number;thicknessMm:number};

// The outline polygons of a piece, from the `d` strings of its outline cut paths.
export function outlinePolygons(paths:string[]):NestedPolygon[]{
 return nestRings(paths.flatMap(d=>parsePathData(d)).map(s=>s.points));
}

const vertexCount=(polygons:NestedPolygon[])=>polygons.reduce((n,p)=>n+p.outer.length+p.holes.reduce((m,h)=>m+h.length,0),0);

export function extrudePolygons(polygons:NestedPolygon[],{widthMm,heightMm,baseY,thicknessMm}:ExtrudeOptions):MeshData{
 const ringVertices=vertexCount(polygons);
 // Caps share their vertices (one normal per cap); each side quad has its own four (flat shading).
 const vertices=ringVertices*2+ringVertices*4;
 const positions=new Float32Array(vertices*3),normals=new Float32Array(vertices*3),uvs=new Float32Array(vertices*2);
 const capTriangles:number[][]=[];
 const topY=baseY+thicknessMm;
 let v=0;
 const put=(x:number,y:number,z:number,nx:number,ny:number,nz:number,u=0,w=0)=>{
  positions[v*3]=x;positions[v*3+1]=y;positions[v*3+2]=z;
  normals[v*3]=nx;normals[v*3+1]=ny;normals[v*3+2]=nz;
  uvs[v*2]=u;uvs[v*2+1]=w;
  return v++;
 };
 // Caps: earcut per polygon, written once at the top and once at the bottom.
 const top:number[]=[],bottom:number[]=[];
 for(const polygon of polygons){
  const rings=[polygon.outer,...polygon.holes],flat:number[]=[],holeIndices:number[]=[];
  for(const ring of rings){if(ring!==polygon.outer)holeIndices.push(flat.length/2);for(const [x,y] of ring)flat.push(x,y)}
  const tris=earcut(flat,holeIndices.length?holeIndices:undefined,2);
  const n=flat.length/2,topStart=v;
  for(let k=0;k<n;k++)put(flat[k*2],topY,flat[k*2+1],0,1,0,widthMm?flat[k*2]/widthMm:0,heightMm?1-flat[k*2+1]/heightMm:0);
  const bottomStart=v;
  for(let k=0;k<n;k++)put(flat[k*2],baseY,flat[k*2+1],0,-1,0);
  for(let t=0;t<tris.length;t+=3){
   const a=tris[t],b=tris[t+1],c=tris[t+2];
   // Winding in the x/z plane: the y component of (b-a) x (c-a) is dz1*dx2 - dx1*dz2.
   const dx1=flat[b*2]-flat[a*2],dz1=flat[b*2+1]-flat[a*2+1],dx2=flat[c*2]-flat[a*2],dz2=flat[c*2+1]-flat[a*2+1];
   const up=dz1*dx2-dx1*dz2>0;
   top.push(topStart+a,...(up?[topStart+b,topStart+c]:[topStart+c,topStart+b]));
   bottom.push(bottomStart+a,...(up?[bottomStart+c,bottomStart+b]:[bottomStart+b,bottomStart+c]));
  }
  capTriangles.push(tris);
 }
 // Side walls. The solid lies left of an edge when the ring is an outer boundary wound
 // counter-clockwise (positive signed area) or a hole wound clockwise; the wall's normal points away
 // from it.
 const sides:number[]=[];
 for(const polygon of polygons){
  for(const ring of [polygon.outer,...polygon.holes]){
   const outer=ring===polygon.outer,positive=ringSignedArea(ring)>0,solidLeft=outer===positive;
   for(let k=0;k<ring.length;k++){
    const p:Point=ring[k],q:Point=ring[(k+1)%ring.length];
    const du=q[0]-p[0],dv=q[1]-p[1],len=Math.hypot(du,dv);
    if(len===0)continue;
    const nx=(solidLeft?dv:-dv)/len,nz=(solidLeft?-du:du)/len;
    const a=put(p[0],baseY,p[1],nx,0,nz),b=put(q[0],baseY,q[1],nx,0,nz),c=put(q[0],topY,q[1],nx,0,nz),d=put(p[0],topY,p[1],nx,0,nz);
    // Geometric normal of (a, b, c) is (b-a) x (c-a); keep it pointing along the wall's normal.
    const ex=q[0]-p[0],ez=q[1]-p[1],fx=q[0]-p[0],fy=thicknessMm,fz=q[1]-p[1];
    const gx=0*fz-ez*fy,gz=ex*fy-0*fx;
    if(gx*nx+gz*nz>=0)sides.push(a,b,c,a,c,d);else sides.push(a,c,b,a,d,c);
   }
  }
 }
 const indices=new Uint32Array(top.length+bottom.length+sides.length);
 indices.set(top,0);indices.set(bottom,top.length);indices.set(sides,top.length+bottom.length);
 return {positions:positions.subarray(0,v*3),normals:normals.subarray(0,v*3),uvs:uvs.subarray(0,v*2),indices,topIndexCount:top.length};
}

// Total area of the top cap's triangles, mm². Equal to the even-odd area of the outline when the
// triangulation covers it exactly, which is what the tests hold the preview to.
export function topCapArea(mesh:MeshData):number{
 let area=0;
 const p=mesh.positions;
 for(let t=0;t<mesh.topIndexCount;t+=3){
  const a=mesh.indices[t]*3,b=mesh.indices[t+1]*3,c=mesh.indices[t+2]*3;
  area+=Math.abs((p[b]-p[a])*(p[c+2]-p[a+2])-(p[c]-p[a])*(p[b+2]-p[a+2]))/2;
 }
 return area;
}

// Signed volume by the divergence theorem. A closed solid with every triangle wound outward gives
// area x thickness; a flipped or missing face shows up immediately as a wrong value.
export function meshVolume(mesh:MeshData):number{
 let volume=0;
 const p=mesh.positions,ix=mesh.indices;
 for(let t=0;t<ix.length;t+=3){
  const a=ix[t]*3,b=ix[t+1]*3,c=ix[t+2]*3;
  volume+=(p[a]*(p[b+1]*p[c+2]-p[b+2]*p[c+1])-p[a+1]*(p[b]*p[c+2]-p[b+2]*p[c])+p[a+2]*(p[b]*p[c+1]-p[b+1]*p[c]))/6;
 }
 return volume;
}
