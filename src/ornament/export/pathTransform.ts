// Translating SVG path *data*, rather than wrapping it in a group transform.
//
// Every path an ornament export emits carries absolute sheet coordinates, and nothing in the file
// relies on a `transform` attribute. That is a fabrication decision, not a stylistic one: a group
// transform is the thing CAM importers most often drop or mis-apply, and when one is dropped the
// piece is silently cut in the wrong place on the sheet rather than failing to import. Polygon
// geometry is translated at the coordinate level before serialisation; glyph outlines from
// opentype.js arrive as strings, so they are translated here.
//
// Only *absolute* commands move. A relative command's numbers are deltas, and a translation does not
// change a delta — with the one exception of a path that opens with a relative `m`, whose first pair
// is measured from the origin and is therefore absolute in everything but spelling.

// Numbers per segment for each command, and how many trailing numbers of that segment are the
// coordinate pair. `A` is the awkward one: seven numbers of which only the last two are a point —
// radii and flags must survive a translation untouched.
const SEGMENT:Record<string,{count:number;pairsFromStart:number;trailingPair:boolean}>={
 M:{count:2,pairsFromStart:1,trailingPair:false},
 L:{count:2,pairsFromStart:1,trailingPair:false},
 T:{count:2,pairsFromStart:1,trailingPair:false},
 C:{count:6,pairsFromStart:3,trailingPair:false},
 S:{count:4,pairsFromStart:2,trailingPair:false},
 Q:{count:4,pairsFromStart:2,trailingPair:false},
 A:{count:7,pairsFromStart:0,trailingPair:true},
 H:{count:1,pairsFromStart:0,trailingPair:false},
 V:{count:1,pairsFromStart:0,trailingPair:false},
 Z:{count:0,pairsFromStart:0,trailingPair:false},
};

const TOKENS=/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

export class UntranslatablePathError extends Error{
 constructor(detail:string){
  super('A path could not be moved into sheet coordinates: '+detail+'. This is a bug in the export pipeline — the ornament would have been cut in the wrong place on the sheet.');
  this.name='UntranslatablePathError';
 }
}

// Three decimals, matching the rest of the export. -0 is normalised to 0 so the same geometry never
// serialises two ways depending on which side of zero a rounding error landed on.
const n=(value:number):string=>{
 const rounded=Number(value.toFixed(3));
 return String(Object.is(rounded,-0)?0:rounded);
};

export function translatePathData(d:string,dx:number,dy:number):string{
 if(!d)return d;
 if(!Number.isFinite(dx)||!Number.isFinite(dy))throw new UntranslatablePathError('the offset was not a finite number');
 if(!dx&&!dy)return d;
 const tokens=d.match(TOKENS)??[];
 const out:string[]=[];
 let command='';
 let index=0;
 let first=true;
 while(index<tokens.length){
  const token=tokens[index];
  if(/^[A-Za-z]$/.test(token)){
   command=token;
   index++;
   out.push(token);
   if(command==='Z'||command==='z'){first=false;continue}
  }
  if(!command)throw new UntranslatablePathError('it began with a number rather than a command');
  const upper=command.toUpperCase();
  const spec=SEGMENT[upper];
  if(!spec)throw new UntranslatablePathError(`it used the unsupported command "${command}"`);
  if(spec.count===0){first=false;continue}
  const args=tokens.slice(index,index+spec.count).map(Number);
  if(args.length<spec.count||args.some(value=>!Number.isFinite(value)))
   throw new UntranslatablePathError(`the "${command}" command was short of arguments or carried a non-finite number`);
  index+=spec.count;
  // A leading relative `m` is absolute in effect, so its first pair moves; every later relative
  // command carries deltas, which a translation must leave exactly as they are.
  const absolute=command===upper||(first&&upper==='M');
  const moved=args.slice();
  if(absolute){
   if(upper==='H')moved[0]=args[0]+dx;
   else if(upper==='V')moved[0]=args[0]+dy;
   else if(spec.trailingPair){moved[5]=args[5]+dx;moved[6]=args[6]+dy}
   else for(let pair=0;pair<spec.pairsFromStart;pair++){moved[pair*2]=args[pair*2]+dx;moved[pair*2+1]=args[pair*2+1]+dy}
  }
  out.push(moved.map(n).join(' '));
  first=false;
 }
 if(index<tokens.length)throw new UntranslatablePathError('it carried trailing numbers after the last complete command');
 return out.join(' ');
}

// Bounding box of path data, deliberately the conservative hull — control points are included
// rather than solving for curve extrema — because every consumer of this box (sheet sizing, piece
// layout) is safe when the box is too big and wrong when it is too small.
//
// This lived in the ornament's marker module until the marker was removed from the generator. It is
// a property of path data, not of markers, and the translation above is checked against it, so it
// moved here rather than leaving a one-function file behind.

export interface BoundsMm{minX:number;minY:number;maxX:number;maxY:number}

// Numbers-per-segment for each SVG path command, and which of those numbers are coordinates.
const ARGS:Record<string,number>={M:2,L:2,H:1,V:1,C:6,S:4,Q:4,T:2,A:7,Z:0};

// Conservative bounding box of SVG path data.
//
// Every Bézier lies inside the convex hull of its control points, so including control points
// without solving for extrema over-estimates rather than under-estimates — which is the safe
// direction for every use it is put to. An elliptical arc is bounded by expanding its endpoints by its radii,
// which is likewise conservative for any rotation or sweep.
export function pathBoundsMm(d:string):BoundsMm{
 const tokens=d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi)??[];
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 let x=0,y=0,startX=0,startY=0;
 let command='',index=0;
 const see=(px:number,py:number)=>{
  if(!Number.isFinite(px)||!Number.isFinite(py))return;
  minX=Math.min(minX,px);minY=Math.min(minY,py);maxX=Math.max(maxX,px);maxY=Math.max(maxY,py);
 };
 while(index<tokens.length){
  const token=tokens[index];
  if(/^[A-Za-z]$/.test(token)){command=token;index++;if(command==='Z'||command==='z'){x=startX;y=startY;continue}}
  const upper=command.toUpperCase();
  const relative=command!==upper;
  const count=ARGS[upper];
  if(count===undefined||count===0)break;
  const args=tokens.slice(index,index+count).map(Number);
  if(args.length<count||args.some(n=>!Number.isFinite(n)))break;
  index+=count;
  if(upper==='H'){x=relative?x+args[0]:args[0];see(x,y)}
  else if(upper==='V'){y=relative?y+args[0]:args[0];see(x,y)}
  else if(upper==='A'){
   const [rx,ry,,,,ax,ay]=args;
   const ex=relative?x+ax:ax,ey=relative?y+ay:ay;
   // The arc stays within the radii of both its endpoints, whatever its rotation and sweep.
   see(x-Math.abs(rx),y-Math.abs(ry));see(x+Math.abs(rx),y+Math.abs(ry));
   see(ex-Math.abs(rx),ey-Math.abs(ry));see(ex+Math.abs(rx),ey+Math.abs(ry));
   x=ex;y=ey;
  }else{
   for(let pair=0;pair<count;pair+=2){
    const px=relative?x+args[pair]:args[pair];
    const py=relative?y+args[pair+1]:args[pair+1];
    see(px,py);
    if(pair+2>=count){x=px;y=py}
   }
   if(upper==='M'){startX=x;startY=y;
    // A second coordinate pair after M is an implicit lineto, which the loop above already handled.
    if(relative)command='l';else command='L';
   }
  }
 }
 return Number.isFinite(minX)?{minX,minY,maxX,maxY}:{minX:0,minY:0,maxX:0,maxY:0};
}
