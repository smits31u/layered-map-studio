// Marching squares over a sampled scalar field, and the stitching of its segments into closed rings.
// Pure grid arithmetic in *index space*: sample (column,row) sits at (column,row), so a marching
// cell spans [column,column+1]×[row,row+1]. Mapping to millimetres is the caller's job.
//
// ## Conventions
//
// A corner is *above* the threshold when value >= threshold. Corners are walked in the cyclic order
//   0 TL (c,r)   1 TR (c+1,r)   2 BR (c+1,r+1)   3 BL (c,r+1)
// which is clockwise on screen in this codebase's y-down space. Local edge k joins corner k to
// corner k+1: 0 top, 1 right, 2 bottom, 3 left. The case index is TL·1 + TR·2 + BR·4 + BL·8, so the
// two ambiguous diagonal cases are 5 (TL+BR above) and 10 (TR+BL above).
//
// Walking a cell's boundary in that order, the contour is crossed alternately *leaving* the above
// region (an exit) and *entering* it. Every segment runs from an exit to an entry, which puts the
// above region on the right of every segment. Stitched rings therefore wind one consistent way: a
// ring around an above region has positive shoelace area, a ring around a hole in it negative —
// the same outer-positive, hole-negative convention the ornament's repair pass normalizes to.
//
// ## The ambiguous cases: asymptotic decider
//
// In cases 5 and 10 the above corners sit on a diagonal, and the four crossings can be paired two
// ways: either the above corners join through the middle of the cell, or they stay separate. The
// choice here is the asymptotic decider. It takes the value at the saddle point of the bilinear
// interpolant through the four corners,
//   s = (TL·BR − TR·BL) / (TL + BR − TR − BL),
// and joins the above corners if s >= threshold. That is the choice that makes the stitched
// contours match the topology of the bilinear surface. The simpler "average the four corners" rule
// gets this wrong in some configurations. The denominator cannot be 0 in a saddle case, because
// both diagonal corners are >= threshold and both others are < threshold.
//
// The decider also matters for nesting. s does not depend on the threshold, so a cell that joins
// its corners at a deeper threshold joins them at every shallower one too. That, together with
// crossing points that move monotonically along each edge as the threshold rises, is what makes
// raw contours at increasing thresholds nest inside one another cell by cell.
//
// ## Stitching and the grid edge
//
// Each grid edge carries at most one crossing. Its point is computed once from that edge alone, so
// the two cells sharing the edge get bit-identical coordinates. Stitching therefore matches
// segments by edge identity, not by comparing coordinates within a tolerance. Each crossed edge is
// the start of exactly one segment and the end of exactly one, so the segments form disjoint
// cycles.
//
// Samples outside the grid read as `outside` (TraceOptions), which must be below the threshold. So
// a contour that runs off the grid is closed half a cell beyond it rather than left open. The
// default, 0, is what depth grids need: their outside is the shore, and their thresholds are > 0.
// The depth-terrain grid already has a padding ring of zero-depth cells, so for it this never comes
// into play. An elevation grid passes -Infinity, "below every threshold" symbolically, because
// its thresholds can be 0 or negative (sea level, below sea level); its crossings against the
// outside are then placed hard against the outside sample, half a cell beyond the grid, so a band
// that reaches the grid edge reaches the board edge once clipped to it.
//
// traceContourLines is the other mode: no virtual outside at all, so a contour that reaches the
// grid edge ends there as an open polyline instead of being closed around the outside. That is what
// contour *lines* need (a score line that leaves the board stops at the board), where bands need
// closed regions.
//
// A crossing point is kept at least EDGE_CROSSING_MARGIN (in cells) away from both ends of its
// edge. A value exactly at the threshold would otherwise put the crossing on the sample point
// itself, where up to four cells' segments meet in one pinch vertex. The clamp is monotonic, so it
// does not disturb nesting.

export const EDGE_CROSSING_MARGIN=1e-6;

export interface CellSegment{fromEdge:number;toEdge:number}

export const caseIndex=(tl:number,tr:number,br:number,bl:number,threshold:number)=>(tl>=threshold?1:0)|(tr>=threshold?2:0)|(br>=threshold?4:0)|(bl>=threshold?8:0);

// Value of the bilinear interpolant at its saddle point. Only meaningful in cases 5 and 10.
export const saddleValue=(tl:number,tr:number,br:number,bl:number)=>(tl*br-tr*bl)/(tl+br-tr-bl);

// The segment(s) one cell contributes, as local edge pairs (exit edge → entry edge).
export function cellSegments(tl:number,tr:number,br:number,bl:number,threshold:number):CellSegment[]{
 const above=[tl>=threshold,tr>=threshold,br>=threshold,bl>=threshold];
 const exits:number[]=[],entries:number[]=[];
 for(let k=0;k<4;k++){
  const from=above[k],to=above[(k+1)&3];
  if(from&&!to)exits.push(k);
  else if(!from&&to)entries.push(k);
 }
 if(!exits.length)return [];
 if(exits.length===1)return [{fromEdge:exits[0],toEdge:entries[0]}];
 // Saddle: exits and entries alternate around the cell. Joined corners pair each exit with the
 // next entry (each segment cuts off a *below* corner). Separate corners pair it with the previous
 // entry (each segment cuts off an *above* corner).
 const joined=saddleValue(tl,tr,br,bl)>=threshold;
 return exits.map(exit=>({fromEdge:exit,toEdge:joined?(exit+1)&3:(exit+3)&3}));
}

// Where the contour crosses the edge from value a to value b: the fraction of the way from the
// *lower* end toward the higher. Measuring from the lower end makes the result independent of the
// direction the edge is walked in, which is what lets two cells agree on a shared edge.
export function crossingFraction(low:number,high:number,threshold:number):number{
 // An infinitely low end (the symbolic "below everything" outside) has no finite interpolation;
 // the crossing sits against it. Unreachable with a finite outside value, so depth grids never
 // take this branch.
 if(low===-Infinity)return EDGE_CROSSING_MARGIN;
 const f=(threshold-low)/(high-low);
 return f<EDGE_CROSSING_MARGIN?EDGE_CROSSING_MARGIN:f>1-EDGE_CROSSING_MARGIN?1-EDGE_CROSSING_MARGIN:f;
}

export interface IndexRing{
 // Closed ring (first point repeated at the end) in index space.
 points:[number,number][];
 // Tag of the above corner the ring's first segment was emitted beside (see traceContourRings).
 tag:number;
}

// Traces every contour of `values` at `threshold` into closed rings. `tagOf(sampleIndex)` labels
// each ring by one of the above samples it borders (the depth pipeline passes the water-body id).
// Rings come out in ascending order of their lowest edge id, so the output is deterministic.
export interface TraceOptions{
 // The value every sample outside the grid reads as. Must be below the threshold. Default 0.
 outside?:number;
}

export function traceContourRings(values:ArrayLike<number>,columns:number,rows:number,threshold:number,tagOf:(sampleIndex:number)=>number=()=>0,options:TraceOptions={}):IndexRing[]{
 const outside=options.outside??0;
 if(!(threshold>outside))throw new Error(outside===0?`Contour threshold must be > 0 (got ${threshold}); samples outside the grid are treated as 0.`:`Contour threshold must be above the outside value ${outside} (got ${threshold}).`);
 const stride=columns+2,edgeCount=2*stride*(rows+2);
 // Edge ids over the virtually padded lattice, columns -1..columns and rows -1..rows.
 const hEdge=(c:number,r:number)=>((r+1)*stride+(c+1))*2;
 const vEdge=(c:number,r:number)=>((r+1)*stride+(c+1))*2+1;
 const sample=(c:number,r:number)=>c<0||r<0||c>=columns||r>=rows?outside:values[r*columns+c];
 const next=new Int32Array(edgeCount).fill(-1),tags=new Int32Array(edgeCount);
 for(let r=-1;r<rows;r++){
  for(let c=-1;c<columns;c++){
   const tl=sample(c,r),tr=sample(c+1,r),br=sample(c+1,r+1),bl=sample(c,r+1);
   const index=caseIndex(tl,tr,br,bl,threshold);
   if(index===0||index===15)continue;
   const edges=[hEdge(c,r),vEdge(c+1,r),hEdge(c,r+1),vEdge(c,r)];
   const corners:[number,number][]=[[c,r],[c+1,r],[c+1,r+1],[c,r+1]];
   const cornerValues=[tl,tr,br,bl];
   for(const segment of cellSegments(tl,tr,br,bl,threshold)){
    const from=edges[segment.fromEdge];
    if(next[from]!==-1)throw new Error('Contour tracing: an edge was claimed as a segment start twice. This is a bug.');
    next[from]=edges[segment.toEdge];
    // The exit edge runs from an above corner (fromEdge's own start corner) to a below one.
    const [ac,ar]=corners[segment.fromEdge];
    if(!(cornerValues[segment.fromEdge]>=threshold))throw new Error('Contour tracing: exit edge does not start at an above corner. This is a bug.');
    tags[from]=tagOf(ar*columns+ac);
   }
  }
 }
 const point=(edge:number):[number,number]=>{
  const node=edge>>1,c=node%stride-1,r=Math.floor(node/stride)-1;
  const [c2,r2]=edge&1?[c,r+1]:[c+1,r];
  const a=sample(c,r),b=sample(c2,r2);
  if(a<b){const f=crossingFraction(a,b,threshold);return [c+f*(c2-c),r+f*(r2-r)]}
  const f=crossingFraction(b,a,threshold);return [c2+f*(c-c2),r2+f*(r-r2)];
 };
 const rings:IndexRing[]=[],visited=new Uint8Array(edgeCount);
 for(let start=0;start<edgeCount;start++){
  if(next[start]===-1||visited[start])continue;
  const points:[number,number][]=[];
  let edge=start;
  do{
   if(visited[edge])throw new Error('Contour tracing: rings share an edge. This is a bug.');
   visited[edge]=1;points.push(point(edge));
   edge=next[edge];
   if(edge===-1)throw new Error('Contour tracing: a contour chain did not close. This is a bug.');
  }while(edge!==start);
  points.push([points[0][0],points[0][1]]);
  rings.push({points,tag:tags[start]});
 }
 return rings;
}

export interface IndexLine{
 // Index-space points; a closed line repeats its first point at the end.
 points:[number,number][];
 closed:boolean;
}

// Contour lines rather than regions: the same segments, stitched by the same edge identity, but
// with no virtual outside. Cells run only across the grid, so a contour that reaches the grid edge
// has no segment beyond it and simply ends there — an open polyline — while one that stays inside
// closes on itself. Any finite threshold is valid.
//
// An open chain starts at a crossed edge that no segment leads into and runs to one that leads
// nowhere; both are necessarily on the grid boundary. Open chains come first, in ascending order of
// their starting edge id, then closed ones in ascending order of their lowest edge id, so the output
// is deterministic. Winding follows the same convention as the rings: higher ground on the right.
export function traceContourLines(values:ArrayLike<number>,columns:number,rows:number,threshold:number):IndexLine[]{
 if(!Number.isFinite(threshold))throw new Error(`Contour threshold must be a finite number (got ${threshold}).`);
 const stride=columns+2,edgeCount=2*stride*(rows+2);
 const hEdge=(c:number,r:number)=>((r+1)*stride+(c+1))*2;
 const vEdge=(c:number,r:number)=>((r+1)*stride+(c+1))*2+1;
 const sample=(c:number,r:number)=>values[r*columns+c];
 const next=new Int32Array(edgeCount).fill(-1),hasPrev=new Uint8Array(edgeCount);
 for(let r=0;r<rows-1;r++){
  for(let c=0;c<columns-1;c++){
   const tl=sample(c,r),tr=sample(c+1,r),br=sample(c+1,r+1),bl=sample(c,r+1);
   const index=caseIndex(tl,tr,br,bl,threshold);
   if(index===0||index===15)continue;
   const edges=[hEdge(c,r),vEdge(c+1,r),hEdge(c,r+1),vEdge(c,r)];
   for(const segment of cellSegments(tl,tr,br,bl,threshold)){
    const from=edges[segment.fromEdge],to=edges[segment.toEdge];
    if(next[from]!==-1)throw new Error('Contour tracing: an edge was claimed as a segment start twice. This is a bug.');
    next[from]=to;hasPrev[to]=1;
   }
  }
 }
 const point=(edge:number):[number,number]=>{
  const node=edge>>1,c=node%stride-1,r=Math.floor(node/stride)-1;
  const [c2,r2]=edge&1?[c,r+1]:[c+1,r];
  const a=sample(c,r),b=sample(c2,r2);
  if(a<b){const f=crossingFraction(a,b,threshold);return [c+f*(c2-c),r+f*(r2-r)]}
  const f=crossingFraction(b,a,threshold);return [c2+f*(c-c2),r2+f*(r-r2)];
 };
 const lines:IndexLine[]=[],visited=new Uint8Array(edgeCount);
 for(let start=0;start<edgeCount;start++){
  if(next[start]===-1||hasPrev[start]||visited[start])continue;
  const points:[number,number][]=[];
  for(let edge=start;edge!==-1;edge=next[edge]){visited[edge]=1;points.push(point(edge))}
  lines.push({points,closed:false});
 }
 for(let start=0;start<edgeCount;start++){
  if(next[start]===-1||visited[start])continue;
  const points:[number,number][]=[];
  let edge=start;
  do{
   if(visited[edge])throw new Error('Contour tracing: lines share an edge. This is a bug.');
   visited[edge]=1;points.push(point(edge));
   edge=next[edge];
   if(edge===-1)throw new Error('Contour tracing: an interior contour did not close. This is a bug.');
  }while(edge!==start);
  points.push([points[0][0],points[0][1]]);
  lines.push({points,closed:true});
 }
 return lines;
}
