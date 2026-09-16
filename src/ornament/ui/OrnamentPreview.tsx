import {geometryPath} from '../../geometry/shoreline/polygonEngine';
import type {OrnamentGeometry} from '../geometry/ornamentShape';
import type {OrnamentTextLayout} from '../text/ornamentText';
import type {OrnamentProject} from '../types';

type Props={project:OrnamentProject;geometry:OrnamentGeometry;textLayout:OrnamentTextLayout};

// Semantic roles, not decoration: cut lines are strokes with no fill, engraving is filled. Colours
// are a preset the export layer will swap (plan §SVG fabrication contract: "colour is a preset, not
// the only semantic signal"), so the preview names the role in the group id too.
const CUT='#d8503f',BAND='#2f3d4b',ENGRAVE='#12181e';

export function OrnamentPreview({project,geometry,textLayout}:Props){
 const blocked=geometry.issues.some(issue=>issue.severity==='error');
 if(blocked)return <div className="empty">
  <p>Ornament geometry cannot be built yet.</p>
  <ul className="ornament-issues">{geometry.issues.filter(i=>i.severity==='error').map((issue,index)=><li key={`${issue.code}-${index}`} className="error">{issue.message}</li>)}</ul>
 </div>;

 const loopTop=geometry.loop.centerY-geometry.loop.outerRadiusMm;
 const margin=Math.max(4,geometry.outerRadiusMm*.08);
 const minX=-geometry.outerRadiusMm-margin,minY=loopTop-margin;
 const width=geometry.outerRadiusMm*2+margin*2,height=geometry.outerRadiusMm-loopTop+margin*2;

 return <div className="ornament-preview">
  <svg viewBox={`${minX} ${minY} ${width} ${height}`} width="100%" height="100%" role="img" aria-label={`Ornament preview, ${project.ornament.diameterMm}mm diameter`}>
   <g id="piece/frame/cut">
    <path d={geometryPath(geometry.frame)} fill="#e8ece9" stroke={CUT} strokeWidth={Math.max(.15,geometry.outerRadiusMm/250)} fillRule="evenodd"/>
   </g>
   <g id="preview/text-band" aria-hidden="true">
    <path d={geometryPath(geometry.textBand)} fill="none" stroke={BAND} strokeWidth={Math.max(.1,geometry.outerRadiusMm/400)} strokeDasharray="1.5 1.5"/>
   </g>
   <g id="piece/frame/text-engrave" fill={ENGRAVE} fillRule="nonzero">
    {textLayout.lines.map(line=>line.d?<path key={line.key} d={line.d} data-line={line.key}/>:null)}
   </g>
  </svg>
  <div className="ornament-metrics">
   <span>Finished diameter {project.ornament.diameterMm.toFixed(1)}mm</span>
   <span>Text band {geometry.textBandHeightMm.toFixed(1)}mm · block {textLayout.blockHeightMm.toFixed(1)}mm</span>
   <span>Loop join {geometry.loop.junctionWidthMm.toFixed(2)}mm</span>
  </div>
 </div>;
}
