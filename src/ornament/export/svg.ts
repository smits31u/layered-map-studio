import type {MultiPolygonMm} from '../../geometry/shoreline/polygonEngine';
import type {ExportPreset} from '../types';
import {colourPreset,groupStyle} from './lightburn';
import {escapeXml,metadataXml,type ExportMetadata} from './metadata';
import {ORNAMENT_GROUP_ORDER,type ExportGroup,type OrnamentGroupId,type OrnamentPieceSet} from './pieces';

// The manufacturing serializer.
//
// Three properties this file exists to guarantee, all of them fabrication rather than presentation:
//
//   * The document is in real millimetres. `width`/`height` carry the `mm` unit and the viewBox is
//     1:1 with them, so an importer that honours physical units and one that assumes user-units-are-
//     pixels both land on the same size. Getting this wrong is how a 101.6mm ornament arrives as a
//     383mm one.
//   * Every number is rounded once, to three decimals, through one function. Two exports of the same
//     design are byte-identical apart from the timestamp, which is what makes it possible to diff a
//     re-export against whatever went to the cutter.
//   * Nothing depends on a transform, a live font, or a stylesheet. What is in the file is what gets
//     cut.

// One micron. Finer than any machine this targets resolves, and coarse enough that float noise from
// the boolean engine never reaches the file.
const n=(value:number):string=>{
 const rounded=Number(value.toFixed(3));
 return String(Object.is(rounded,-0)?0:rounded);
};

export function geometryPathMm(geometry:MultiPolygonMm):string{
 return geometry
  .flat()
  .map(ring=>ring.map(([x,y],index)=>`${index?'L':'M'}${n(x)} ${n(y)}`).join(' ')+' Z')
  .join(' ');
}

// Glyph outlines stay one path per line under nonzero winding, or the counter of an "o" fills in.
//
// There used to be a second case here — marker artwork, split into one element per subpath because
// the registry's pin is a head and a tip that deliberately overlap and either fill rule would have
// XOR'd the overlap into a void. The generator no longer emits a marker, so the splitter went with
// it.

const FILL_RULE:Partial<Record<OrnamentGroupId,'evenodd'|'nonzero'>>={
 'piece/frame/text-engrave':'nonzero',
 'labels/non-production':'nonzero',
};

function groupBody(group:ExportGroup):string{
 const parts:string[]=[];
 if(group.geometry.length){
  const d=geometryPathMm(group.geometry);
  if(d)parts.push(`<path d="${d}"/>`);
 }
 for(const d of group.paths){
  if(!d)continue;
  parts.push(`<path d="${d}"/>`);
 }
 return parts.join('');
}

export interface SvgOptions{preset:ExportPreset}

export function ornamentSvg(pieces:OrnamentPieceSet,metadata:ExportMetadata,options:SvgOptions):string{
 const preset=colourPreset(options.preset);
 const {sheet}=pieces;
 const byId=new Map(pieces.groups.map(group=>[group.id,group]));

 // Emitted in the plan's order, and every group that applies to this build mode is emitted even when
 // it is empty. An absent group therefore means "this mode does not have one", never "this mode has
 // one and it came out empty" — a distinction an operator cannot recover any other way.
 const groups=ORNAMENT_GROUP_ORDER.map(id=>{
  const group=byId.get(id);
  if(!group||!group.applicable)return '';
  const style=groupStyle(preset,id,group.operation,FILL_RULE[id]??'evenodd');
  const attributes=[
   `id="${id}"`,
   `data-piece="${group.piece}"`,
   `data-operation="${group.operation}"`,
   `data-production="${group.production?'true':'false'}"`,
   `fill="${style.fill}"`,
   `stroke="${style.stroke}"`,
   style.strokeWidthMm?`stroke-width="${n(style.strokeWidthMm)}"`:'',
   `fill-rule="${style.fillRule}"`,
  ].filter(Boolean).join(' ');
  return `<g ${attributes}>${groupBody(group)}</g>`;
 }).filter(Boolean).join('');

 const title=`Ornament · ${escapeXml(metadata.viewport.place??'untitled')} · ${n(metadata.dimensions.finishedDiameterMm)}mm`;

 return [
  '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
  `<svg xmlns="http://www.w3.org/2000/svg" version="1.1"`,
  ` width="${n(sheet.widthMm)}mm" height="${n(sheet.heightMm)}mm"`,
  ` viewBox="0 0 ${n(sheet.widthMm)} ${n(sheet.heightMm)}"`,
  ` data-units="mm" data-build-mode="${metadata.buildMode}" data-export-preset="${metadata.exportPreset}"`,
  ` data-finished-diameter-mm="${n(metadata.dimensions.finishedDiameterMm)}"`,
  ' stroke-linejoin="round" stroke-linecap="round">',
  `<title>${title}</title>`,
  metadataXml(metadata),
  groups,
  '</svg>',
 ].join('');
}
