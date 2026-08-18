import type {ManufacturingScene,PhysicalLayer,Shape} from '../scene';

export type PreviewMode='individual'|'composite'|'exploded';
const n=(value:number)=>Number(value.toFixed(3));
const palette=['#e8dfcf','#d8c8ac','#c5ac84','#ad8d62','#927047','#775735','#58819a'];
const cutShape=(shape:Shape)=>shape.kind==='rect'?`<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}"/>`:`<path d="${shape.d}" fill-rule="evenodd"/>`;
const engraveShape=(shape:Shape)=>`<path d="${shape.d}" fill="none" stroke="#25211d" stroke-width="${shape.strokeWidthMm??.45}"/>`;
const layerGroup=(scene:ManufacturingScene,layer:PhysicalLayer,index:number,transform='',showCutEdge=true)=>{const cuts=layer.shapes.filter(shape=>shape.operation==='cut').map(cutShape).join(''),engravings=layer.id==='layer-land'?[...layer.shapes,...scene.objects].filter(shape=>shape.operation==='engrave').map(engraveShape).join(''):'';return`<g data-preview-panel="${layer.id}"${transform?` transform="${transform}"`:''} fill="${palette[index%palette.length]}" stroke="${showCutEdge?'#38332d':'none'}" stroke-width="0.35">${cuts}${engravings}</g>`};

export function scenePreviewSvg(scene:ManufacturingScene,mode:PreviewMode,selectedIndex=0){
 const selected=Math.max(0,Math.min(selectedIndex,scene.layers.length-1));
 if(mode==='individual')return root(scene.widthMm,scene.heightMm,layerGroup(scene,scene.layers[selected],selected));
 if(mode==='composite'){const groups=scene.layers.map((layer,index)=>({layer,index})).reverse().map(({layer,index})=>layerGroup(scene,layer,index,'',false)).join('');return root(scene.widthMm,scene.heightMm,groups)}
 const ordered=scene.layers.map((layer,index)=>({layer,index})).reverse(),columns=Math.min(3,ordered.length),rows=Math.ceil(ordered.length/columns),gap=10,labelHeight=12,width=columns*scene.widthMm+(columns-1)*gap,height=rows*(scene.heightMm+labelHeight)+(rows-1)*gap,groups=ordered.map(({layer,index},position)=>{const column=position%columns,row=Math.floor(position/columns),x=column*(scene.widthMm+gap),y=row*(scene.heightMm+labelHeight+gap),offset=layer.id==='layer-base'?'':scene.geometryMetrics?.artisticOpenings?.[index-1]?.offsetNormalized;return`<g data-exploded-item="${layer.id}" transform="translate(${n(x)} ${n(y)})"><text x="0" y="8" font-size="6" font-family="sans-serif" fill="#25211d">${layer.name.toUpperCase()}${offset!==''&&offset!=null?` · ${offset} UNITS`:''}</text>${layerGroup(scene,layer,index,`translate(0 ${labelHeight})`)}</g>`}).join('');return root(width,height,groups);
}
const root=(width:number,height:number,content:string)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}mm" height="${n(height)}mm" viewBox="0 0 ${n(width)} ${n(height)}">${content}</svg>`;
