export type CompassStyle='classic'|'rose'|'minimal';
export type CompassCorner='top-left'|'top-right'|'bottom-left'|'bottom-right';

const MARGIN_MM=8;

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
 return classicArrow(h);
}
