export type CompassStyle='classic'|'rose'|'minimal'|'classic-rose';
export type CompassCorner='top-left'|'top-right'|'bottom-left'|'bottom-right';

const MARGIN_MM=8;

// Minimum-feature-size design constants (M-COMPASS). These exist because a compass rose is a
// laser-engraved object, not a screen icon: features smaller than this become unreliable to cut
// (letters that fill in, gaps that scorch/merge, rings so thin they're fragile). All three are
// absolute mm floors, independent of how small a project.compass.sizeMm a user requests.
// MIN_COMPASS_SIZE_MM clamps the *effective* size used to derive the classic-rose's proportional
// geometry (ring/star/gap radii) — it does not silently change what's stored in project state, it
// only stops the generated geometry from collapsing below a manufacturable scale. The Controls UI
// additionally sets this as the <input min> for Size mm so a user seldom has to discover the clamp
// by surprise. RECOMMENDED_MIN_COMPASS_SIZE_MM is softer guidance (a size below which the design
// still renders correctly but starts looking cramped) for a UI-level hint, not a hard clamp.
export const MIN_COMPASS_SIZE_MM=12;
export const RECOMMENDED_MIN_COMPASS_SIZE_MM=18;
export const MIN_LETTER_SIZE_MM=3;
export const MIN_FEATURE_GAP_MM=0.5;

// Corner presets only ever *assign* a starting xMm/yMm (the compass center) — they are not a live
// formula the render path re-evaluates. Once assigned (or dragged), the stored xMm/yMm is
// authoritative; 'custom' simply means "don't overwrite these on the next preset click".
export function cornerPosition(corner:CompassCorner,widthMm:number,heightMm:number,sizeMm:number):{xMm:number;yMm:number}{
 const half=sizeMm/2;
 const left=MARGIN_MM+half,right=widthMm-MARGIN_MM-half,top=MARGIN_MM+half,bottom=heightMm-MARGIN_MM-half;
 switch(corner){
  case'top-left':return{xMm:left,yMm:top};
  case'top-right':return{xMm:right,yMm:top};
  case'bottom-left':return{xMm:left,yMm:bottom};
  case'bottom-right':return{xMm:right,yMm:bottom};
 }
}

// All paths are centered at local (0,0) with north pointing toward -y (up) at rotationDeg=0 — the
// caller positions/rotates with an SVG group transform (translate then rotate), never baking world
// coordinates or rotation into the path data itself.
function classicArrow(h:number):string{
 return `M${-h} ${h} L0 ${-h} L${h} ${h} L0 ${h*.44} Z M0 ${-h} L0 ${h}`;
}

function compassRose(h:number):string{
 const cardinalR=h,interR=h*.55,valleyR=h*.12;
 const points:[number,number][]=[];
 for(let i=0;i<8;i++){
  const spikeAngle=(i*45-90)*Math.PI/180,spikeR=i%2===0?cardinalR:interR;
  points.push([spikeR*Math.cos(spikeAngle),spikeR*Math.sin(spikeAngle)]);
  const valleyAngle=(i*45-90+22.5)*Math.PI/180;
  points.push([valleyR*Math.cos(valleyAngle),valleyR*Math.sin(valleyAngle)]);
 }
 return 'M'+points.map(([x,y],i)=>`${i?'L':''}${x.toFixed(3)} ${y.toFixed(3)}`).join(' ')+' Z';
}

function minimalArrow(h:number):string{
 return `M0 ${-h} L${h*.12} ${h*.15} L0 0 L${-h*.12} ${h*.15} Z M0 0 L0 ${h}`;
}

export function compassPathData(style:CompassStyle,sizeMm:number):string{
 const h=sizeMm/2;
 if(style==='rose')return compassRose(h);
 if(style==='minimal')return minimalArrow(h);
 if(style==='classic-rose')return classicRoseGeometry(sizeMm).starD;
 return classicArrow(h);
}

function circlePath(r:number):string{
 return `M${(-r).toFixed(3)} 0 A${r.toFixed(3)} ${r.toFixed(3)} 0 1 0 ${r.toFixed(3)} 0 A${r.toFixed(3)} ${r.toFixed(3)} 0 1 0 ${(-r).toFixed(3)} 0 Z`;
}

function starPath(cardinalR:number,interR:number,valleyR:number):string{
 const points:[number,number][]=[];
 for(let i=0;i<8;i++){
  const spikeAngle=(i*45-90)*Math.PI/180,spikeR=i%2===0?cardinalR:interR;
  points.push([spikeR*Math.cos(spikeAngle),spikeR*Math.sin(spikeAngle)]);
  const valleyAngle=(i*45-90+22.5)*Math.PI/180;
  points.push([valleyR*Math.cos(valleyAngle),valleyR*Math.sin(valleyAngle)]);
 }
 return 'M'+points.map(([x,y],i)=>`${i?'L':''}${x.toFixed(3)} ${y.toFixed(3)}`).join(' ')+' Z';
}

export type CardinalPoint='N'|'E'|'S'|'W';
export type ClassicRoseGeometry={
 ringD:string;
 starD:string;
 centerD:string;
 letterSizeMm:number;
 footprintRadiusMm:number; // the true rendered outer extent — what keep-out/selection math should use, not raw sizeMm/2
 letterPositions:Record<CardinalPoint,{x:number;y:number}>;
};

// A traditional "strong" rose: outer ring, an 8-point star (4 long cardinal spikes + 4 shorter
// diagonal spikes, same kite-point technique as compassRose() above but re-proportioned to leave
// room for lettering), a small center boss, and N/E/S/W set in the gap between the star's cardinal
// tips and the ring — never on top of either. All of this is real vector geometry (circles/polygon
// paths here, opentype glyph outlines for the letters, composed by the caller); nothing is a
// bitmap/font-rendered <text> element. Letters are returned only as *positions/size* here — the
// caller (buildScene.ts) already owns font loading and textPathData, so this module stays free of
// any font dependency, matching how every other object type in this codebase keeps geometry and
// text-vectorization concerns separate.
export function classicRoseGeometry(sizeMm:number):ClassicRoseGeometry{
 const h=Math.max(sizeMm,MIN_COMPASS_SIZE_MM)/2;
 const ringR=h*.95,cardinalR=h*.62,interR=h*.34,valleyR=h*.08,centerR=Math.max(h*.09,MIN_FEATURE_GAP_MM);
 const letterR=(cardinalR+ringR)/2,letterSizeMm=Math.max(h*.26,MIN_LETTER_SIZE_MM);
 return{
  ringD:circlePath(ringR),
  starD:starPath(cardinalR,interR,valleyR),
  centerD:circlePath(centerR),
  letterSizeMm,
  footprintRadiusMm:ringR,
  letterPositions:{N:{x:0,y:-letterR},E:{x:letterR,y:0},S:{x:0,y:letterR},W:{x:-letterR,y:0}},
 };
}

// Outer radius of the rendered compass, in mm, for keep-out/selection math — deliberately not just
// sizeMm/2, since classic-rose clamps its effective size (MIN_COMPASS_SIZE_MM) and other styles'
// path extents don't reach exactly to sizeMm/2 either (see classicArrow/compassRose/minimalArrow
// above, whose `h` is a half-size, not a hard radius). Padded circle, not a tight outline; the
// point is a safe conservative footprint for masking other geometry, not a pixel-perfect bound.
export function compassFootprintRadiusMm(style:CompassStyle,sizeMm:number):number{
 if(style==='classic-rose')return classicRoseGeometry(sizeMm).footprintRadiusMm;
 return sizeMm/2;
}
