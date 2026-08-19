import type {ManufacturingScene,PhysicalLayer,Shape} from '../scene';

export type PreviewMode='individual'|'composite'|'exploded';
const n=(value:number)=>Number(value.toFixed(3));
const palette=['#e8dfcf','#d8c8ac','#c5ac84','#ad8d62','#927047','#775735','#58819a'];
const objectAttr=(shape:Shape)=>shape.objectId?` data-object-id="${shape.objectId}"`:'';
const cutShape=(shape:Shape)=>shape.kind==='rect'?`<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}"${shape.transform?` transform="${shape.transform}"`:''}${objectAttr(shape)}/>`:`<path d="${shape.d}" fill-rule="evenodd"${shape.transform?` transform="${shape.transform}"`:''}${objectAttr(shape)}/>`;
const engraveShape=(shape:Shape)=>`<path d="${shape.d}" fill="none" stroke="#25211d" stroke-width="${shape.strokeWidthMm??.45}"${shape.transform?` transform="${shape.transform}"`:''}${objectAttr(shape)}/>`;
// Editor-only invisible click target (never emitted by exportSvg.ts — hitRadiusMm is preview-only
// by construction, see Shape's doc comment). fill="transparent" is deliberate, not fill="none": an
// SVG shape with fill:none only receives pointer events on its stroke, which is exactly the
// hollow-outline problem this exists to work around (see M-COMPASS's classic-rose ring finding).
const hitAreaShape=(shape:Shape)=>shape.hitRadiusMm?`<circle r="${shape.hitRadiusMm}" fill="transparent" stroke="none"${shape.transform?` transform="${shape.transform}"`:''}${objectAttr(shape)}/>`:'';
const layerGroup=(scene:ManufacturingScene,layer:PhysicalLayer,index:number,transform='',showCutEdge=true)=>{const withObjects=layer.id==='layer-land'?[...layer.shapes,...scene.objects]:layer.shapes;const hitAreas=withObjects.map(hitAreaShape).join(''),cuts=withObjects.filter(shape=>shape.operation==='cut').map(cutShape).join(''),engravings=withObjects.filter(shape=>shape.operation==='engrave').map(engraveShape).join('');return`<g data-preview-panel="${layer.id}"${transform?` transform="${transform}"`:''} fill="${palette[index%palette.length]}" stroke="${showCutEdge?'#38332d':'none'}" stroke-width="0.35">${hitAreas}${cuts}${engravings}</g>`};

export function scenePreviewSvg(scene:ManufacturingScene,mode:PreviewMode,selectedIndex=0){
 const selected=Math.max(0,Math.min(selectedIndex,scene.layers.length-1));
 if(mode==='individual')return root(scene.widthMm,scene.heightMm,layerGroup(scene,scene.layers[selected],selected));
 if(mode==='composite'){const groups=scene.layers.map((layer,index)=>({layer,index})).reverse().map(({layer,index})=>layerGroup(scene,layer,index,'',false)).join('');return root(scene.widthMm,scene.heightMm,groups)}
 const ordered=scene.layers.map((layer,index)=>({layer,index})).reverse(),columns=Math.min(3,ordered.length),rows=Math.ceil(ordered.length/columns),gap=10,labelHeight=12,width=columns*scene.widthMm+(columns-1)*gap,height=rows*(scene.heightMm+labelHeight)+(rows-1)*gap,groups=ordered.map(({layer,index},position)=>{const column=position%columns,row=Math.floor(position/columns),x=column*(scene.widthMm+gap),y=row*(scene.heightMm+labelHeight+gap),offset=layer.id==='layer-base'?'':scene.geometryMetrics?.artisticOpenings?.[index-1]?.offsetNormalized;return`<g data-exploded-item="${layer.id}" transform="translate(${n(x)} ${n(y)})"><text x="0" y="8" font-size="6" font-family="sans-serif" fill="#25211d">${layer.name.toUpperCase()}${offset!==''&&offset!=null?` · ${offset} UNITS`:''}</text>${layerGroup(scene,layer,index,`translate(0 ${labelHeight})`)}</g>`}).join('');return root(width,height,groups);
}
const root=(width:number,height:number,content:string)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}mm" height="${n(height)}mm" viewBox="0 0 ${n(width)} ${n(height)}">${content}</svg>`;
