import type {ManufacturingScene,Shape} from '../scene';
import type {ExportLayout} from '../../types/project';
const n=(v:number)=>Number(v.toFixed(3));
export function layoutDimensions(scene:ManufacturingScene,layout:ExportLayout,gap:number){return layout==='production'?{width:scene.layers.length*scene.widthMm+Math.max(0,scene.layers.length-1)*gap,height:scene.heightMm}:{width:scene.widthMm,height:scene.heightMm}}
const shapeXml=(s:Shape)=>s.kind==='rect'?`<rect id="${s.id}" x="${s.x}" y="${s.y}" width="${s.width}" height="${s.height}"${s.transform?` transform="${s.transform}"`:''}/>`:`<path id="${s.id}" d="${s.d}" fill-rule="evenodd"${s.strokeWidthMm?` stroke-width="${s.strokeWidthMm}"`:''}${s.transform?` transform="${s.transform}"`:''}/>`;
// Named sub-groups (Phase 10: roads-major, roads-minor, road-labels, place-labels, title,
// title-backer, subtitle, compass) — only emitted when they actually have content, in a fixed,
// predictable order. Any group name not in this list still renders (appended after, in first-seen
// order) rather than being silently dropped — this list documents the expected set, it is not a
// filter, so a future object type can never lose its geometry just because nobody remembered to add
// its group name here.
const GROUP_ORDER=['roads-major','roads-minor','road-labels','place-labels','title','title-backer','subtitle','compass'];
function groupedXml(shapes:Shape[]):string{
 const grouped=shapes.filter(s=>s.group),ungrouped=shapes.filter(s=>!s.group);
 const groupNames=[...GROUP_ORDER.filter(g=>grouped.some(s=>s.group===g)),...new Set(grouped.map(s=>s.group!).filter(g=>!GROUP_ORDER.includes(g)))];
 const named=groupNames.map(group=>`<g id="${group}">${grouped.filter(s=>s.group===group).map(shapeXml).join('')}</g>`).join('');
 return ungrouped.map(shapeXml).join('')+named;
}
export function sceneToSvg(scene:ManufacturingScene,layout:Exclude<ExportLayout,'individual'>,gap=10,annotations=true){const size=layoutDimensions(scene,layout,gap);const groups=scene.layers.map((l,i)=>{const x=layout==='production'?i*(scene.widthMm+gap):0;const objs=l.id==='layer-land'?scene.objects:[];const cutShapes=[...l.shapes,...objs].filter(s=>s.operation==='cut'),engraveShapes=[...l.shapes,...objs].filter(s=>s.operation==='engrave');return`<g id="${l.id}" transform="translate(${n(x)} 0)"><g id="${l.id}-cut" data-operation="cut">${groupedXml(cutShapes)}</g><g id="${l.id}-engrave" data-operation="engrave">${groupedXml(engraveShapes)}</g></g>`}).join('');const ann=annotations&&layout==='production'?`<g id="production-annotations" data-operation="annotation"></g>`:'';return`<svg xmlns="http://www.w3.org/2000/svg" width="${n(size.width)}mm" height="${n(size.height)}mm" viewBox="0 0 ${n(size.width)} ${n(size.height)}" fill="none" stroke="#000" stroke-linejoin="round" stroke-linecap="round">${groups}${ann}</svg>`}
export function individualSvgs(scene:ManufacturingScene){return Object.fromEntries(scene.layers.map(l=>[`${l.id}.svg`,sceneToSvg({...scene,layers:[l]},'registered',0,false)]))}
