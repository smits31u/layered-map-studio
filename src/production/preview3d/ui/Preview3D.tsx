import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {AmbientLight,Box3,BufferAttribute,BufferGeometry,CanvasTexture,Color,DirectionalLight,Group,HemisphereLight,Mesh,MeshStandardMaterial,PCFSoftShadowMap,PerspectiveCamera,PlaneGeometry,Scene,ShadowMaterial,SRGBColorSpace,Vector2,Vector3,WebGLRenderer} from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import type {EstimateConfig} from '../../estimate/config';
import {downloadFile,fileSlug} from '../../download';
import type {JobPiece,ProductionJob} from '../../job';
import {extrudePolygons,type MeshData} from '../extrude';
import {EXPORT_ASPECTS,EXPORT_WIDTHS,exportSize,finalizePreviewPng,PROOF_BACKGROUND,RENDER_NOTICE,watermarkText,type ExportAspect,type WatermarkOptions} from '../previewImage';
import {defaultLayerColors,explodedY,stackHeight,stackLayers} from '../stack';
import {createMeshRunner,isMeshBuildCancelled} from '../worker/meshRunner';
import './preview3d.css';

// The stacked 3D preview: every piece of the generated scene as a solid at its material's real
// thickness, in stack order, built from the same outline paths the SVG export writes. Lazy-loaded
// by the tool (three.js lives only in this chunk), so it costs nothing until it is opened.

type View='three-quarter'|'top'|'front';
const VIEW_DIRECTIONS:Record<View,[number,number,number]>={'three-quarter':[.55,.85,1],top:[0,1,.0005],front:[0,.16,1]};
const EDGE_TONE=new Color('#2b1d12');
const ENGRAVE_TONE='#3a2414';
const TEXTURE_LONG_SIDE=4096;

// Applies an SVG transform list ("translate(x y) rotate(d)") to a 2D canvas context.
function applySvgTransform(ctx:CanvasRenderingContext2D,transform?:string){
 if(!transform)return;
 for(const [,fn,args] of transform.matchAll(/(translate|rotate|scale)\(([^)]*)\)/g)){
  const v=args.split(/[\s,]+/).filter(Boolean).map(Number);
  if(fn==='translate')ctx.translate(v[0]??0,v[1]??0);
  else if(fn==='scale')ctx.scale(v[0]??1,v[1]??v[0]??1);
  else{const [deg=0,cx=0,cy=0]=v;ctx.translate(cx,cy);ctx.rotate(deg*Math.PI/180);ctx.translate(-cx,-cy)}
 }
}

// The top piece's engraving, scores and inner cut lines, drawn at physical scale onto a texture for
// its top face. White is "no mark": the texture multiplies the piece's colour.
function engravingCanvas(piece:JobPiece):HTMLCanvasElement{
 const scale=TEXTURE_LONG_SIDE/Math.max(piece.widthMm,piece.heightMm);
 const canvas=document.createElement('canvas');
 canvas.width=Math.round(piece.widthMm*scale);canvas.height=Math.round(piece.heightMm*scale);
 const ctx=canvas.getContext('2d')!;
 ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
 ctx.lineJoin='round';ctx.lineCap='round';
 for(const shape of piece.shapes){
  if(shape.outline)continue;
  ctx.save();
  ctx.scale(scale,scale);
  applySvgTransform(ctx,shape.transform);
  const path=new Path2D(shape.d);
  if(shape.operation==='engrave'){ctx.globalAlpha=.9;ctx.fillStyle=ENGRAVE_TONE;ctx.fill(path,'evenodd')}
  else if(shape.operation==='score'){ctx.globalAlpha=.8;ctx.strokeStyle=ENGRAVE_TONE;ctx.lineWidth=Math.max(.2,shape.strokeWidthMm??.25);ctx.stroke(path)}
  else{ctx.globalAlpha=.9;ctx.strokeStyle='#20140a';ctx.lineWidth=.15;ctx.stroke(path)}
  ctx.restore();
 }
 return canvas;
}

function drawWatermark(ctx:CanvasRenderingContext2D,width:number,height:number,w:WatermarkOptions){
 const {headline,caption}=watermarkText(w);
 ctx.save();
 ctx.translate(width/2,height/2);ctx.rotate(-20*Math.PI/180);
 ctx.font=`800 ${Math.round(width*.16)}px system-ui,sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
 ctx.lineWidth=Math.max(2,width*.002);ctx.strokeStyle='rgba(20,20,20,.28)';ctx.fillStyle='rgba(255,255,255,.34)';
 ctx.fillText(headline,0,0);ctx.strokeText(headline,0,0);
 ctx.restore();
 const size=Math.round(width*.016),pad=Math.round(size*.7),band=caption.length*size*1.35+pad*2;
 ctx.fillStyle='rgba(15,20,28,.72)';ctx.fillRect(0,height-band,width,band);
 ctx.fillStyle='#ffffff';ctx.font=`600 ${size}px system-ui,sans-serif`;ctx.textAlign='left';ctx.textBaseline='top';
 caption.forEach((line,i)=>ctx.fillText(line,pad,height-band+pad+i*size*1.35));
}

const toGeometry=(mesh:MeshData)=>{
 const g=new BufferGeometry();
 g.setAttribute('position',new BufferAttribute(mesh.positions,3));
 g.setAttribute('normal',new BufferAttribute(mesh.normals,3));
 g.setAttribute('uv',new BufferAttribute(mesh.uvs,2));
 g.setIndex(new BufferAttribute(mesh.indices,1));
 g.addGroup(0,mesh.topIndexCount,0);
 g.addGroup(mesh.topIndexCount,mesh.indices.length-mesh.topIndexCount,1);
 g.computeBoundingSphere();
 return g;
};

type Three={renderer:WebGLRenderer;scene:Scene;camera:PerspectiveCamera;controls:OrbitControls;stack:Group;frame:Group;light:DirectionalLight;ground:Mesh;render():void};

export function Preview3D({job,config,title,sizeLabel,appVersion}:{job:ProductionJob;config:EstimateConfig;title:string;sizeLabel:string;appVersion:string}){
 const layers=useMemo(()=>stackLayers(job,config),[job,config]);
 const layerKey=layers.map(l=>`${l.id}:${l.thicknessMm}`).join('|');
 const hostRef=useRef<HTMLDivElement>(null),threeRef=useRef<Three|undefined>(undefined);
 const meshesRef=useRef(new Map<string,Mesh>());
 const[colors,setColors]=useState<Record<string,string>>({});
 const[explode,setExplode]=useState(0);
 const[frame,setFrame]=useState({enabled:false,widthMm:19,color:'#4a3526'});
 const[background,setBackground]=useState({transparent:false,color:PROOF_BACKGROUND});
 const[exportWidth,setExportWidth]=useState<number>(3000),[aspect,setAspect]=useState<ExportAspect>('4:3');
 const[watermark,setWatermark]=useState<WatermarkOptions>({enabled:false,text:'PROOF',customer:'',lake:title,size:sizeLabel});
 const[build,setBuild]=useState<{state:'building'|'ready'|'error';built:number;message:string}>({state:'building',built:0,message:''});
 const[exporting,setExporting]=useState('');
 const defaults=useMemo(()=>defaultLayerColors(layers,job.product),[layers,job.product]);
 const colorOf=useCallback((id:string)=>colors[id]??defaults[layers.findIndex(l=>l.id===id)]??'#888888',[colors,defaults,layers]);
 useEffect(()=>{setWatermark(w=>({...w,lake:w.lake||title,size:sizeLabel}))},[title,sizeLabel]);

 // Renderer, camera, lights. Rendering is on demand (after a change), not a loop: a still preview
 // costs no GPU time, and it renders the same in a hidden tab as in a visible one.
 useEffect(()=>{
  const host=hostRef.current!;
  const renderer=new WebGLRenderer({antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1));
  renderer.outputColorSpace=SRGBColorSpace;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=PCFSoftShadowMap;
  renderer.setClearColor(0x000000,0);
  host.appendChild(renderer.domElement);
  const scene=new Scene(),camera=new PerspectiveCamera(35,1,1,20000);
  scene.add(new HemisphereLight(0xffffff,0xb9a68a,1.1),new AmbientLight(0xffffff,.25));
  const light=new DirectionalLight(0xffffff,2.1);
  light.castShadow=true;light.shadow.mapSize.set(2048,2048);light.shadow.bias=-.0004;light.shadow.normalBias=.4;
  scene.add(light,light.target);
  const ground=new Mesh(new PlaneGeometry(1,1),new ShadowMaterial({opacity:.22}));
  ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);
  const stack=new Group(),frameGroup=new Group();scene.add(stack,frameGroup);
  const controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=false;controls.maxPolarAngle=Math.PI*.495;
  const three:Three={renderer,scene,camera,controls,stack,frame:frameGroup,light,ground,render:()=>renderer.render(scene,camera)};
  controls.addEventListener('change',three.render);
  const resize=()=>{const w=host.clientWidth||800,h=host.clientHeight||600;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();three.render()};
  const observer=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(resize);
  observer?.observe(host);resize();
  threeRef.current=three;
  return ()=>{
   observer?.disconnect();controls.dispose();
   scene.traverse(o=>{const m=o as Mesh;if(m.isMesh){m.geometry.dispose();for(const mat of [m.material].flat()){(mat as MeshStandardMaterial).map?.dispose();mat.dispose()}}});
   renderer.dispose();renderer.domElement.remove();threeRef.current=undefined;
  };
 },[]);

 // Places the camera along a view direction at a distance that fits the whole stack.
 const fit=useCallback((view?:View)=>{
  const t=threeRef.current;if(!t)return;
  const box=new Box3().setFromObject(t.stack);
  if(t.frame.children.length&&t.frame.visible)box.union(new Box3().setFromObject(t.frame));
  if(box.isEmpty())return;
  const center=box.getCenter(new Vector3()),radius=box.getSize(new Vector3()).length()/2;
  const direction=view?new Vector3(...VIEW_DIRECTIONS[view]).normalize():t.camera.position.clone().sub(t.controls.target).normalize();
  const vfov=t.camera.fov*Math.PI/180,hfov=2*Math.atan(Math.tan(vfov/2)*t.camera.aspect);
  const distance=radius/Math.sin(Math.min(vfov,hfov)/2)*1.05;
  t.controls.target.copy(center);
  t.camera.position.copy(center).addScaledVector(direction,distance);
  t.camera.near=Math.max(.5,distance/200);t.camera.far=distance*20;t.camera.updateProjectionMatrix();
  // A sphere is a loose fit for a flat board. Pull in until the box's projected corners fill about
  // 90% of the frame; a few rounds converge because the projection is nearly linear in 1/distance.
  const corners=[0,1,2,3,4,5,6,7].map(i=>new Vector3(i&1?box.max.x:box.min.x,i&2?box.max.y:box.min.y,i&4?box.max.z:box.min.z));
  let d=distance;
  for(let round=0;round<4;round++){
   t.camera.updateMatrixWorld();t.camera.lookAt(center);t.camera.updateMatrixWorld();
   const extent=Math.max(...corners.map(c=>{const p=c.clone().project(t.camera);return Math.max(Math.abs(p.x),Math.abs(p.y))}));
   if(!Number.isFinite(extent)||extent<=0)break;
   d*=extent/.9;
   t.camera.position.copy(center).addScaledVector(direction,d);
  }
  t.camera.near=Math.max(.5,d/200);t.camera.far=d*20;t.camera.updateProjectionMatrix();
  t.controls.update();t.render();
 },[]);

 // Geometry: rebuilt only when the pieces or their thicknesses change, in the worker, layer by layer.
 useEffect(()=>{
  const t=threeRef.current;if(!t)return;
  const runner=createMeshRunner();
  for(const mesh of meshesRef.current.values()){t.stack.remove(mesh);mesh.geometry.dispose();for(const m of [mesh.material].flat()){(m as MeshStandardMaterial).map?.dispose();m.dispose()}}
  meshesRef.current.clear();
  setBuild({state:'building',built:0,message:''});
  const top=job.pieces.find(p=>p.id===layers.at(-1)?.id);
  let built=0;
  const handle=runner.build(layers.map(l=>({id:l.id,outlinePaths:l.outlinePaths,widthMm:job.widthMm,heightMm:job.heightMm,thicknessMm:l.thicknessMm})),(id,data)=>{
   const isTop=id===top?.id;
   const topMaterial=new MeshStandardMaterial({roughness:.85,metalness:0});
   if(isTop&&top){const texture=new CanvasTexture(engravingCanvas(top));texture.colorSpace=SRGBColorSpace;texture.anisotropy=t.renderer.capabilities.getMaxAnisotropy();topMaterial.map=texture}
   const mesh=new Mesh(toGeometry(data),[topMaterial,new MeshStandardMaterial({roughness:.9,metalness:0})]);
   mesh.castShadow=true;mesh.receiveShadow=true;mesh.name=id;
   meshesRef.current.set(id,mesh);t.stack.add(mesh);
   built++;setBuild({state:'building',built,message:''});
  });
  handle.done.then(({durationMs})=>{setBuild({state:'ready',built,message:`Built ${built} layers in ${durationMs<1000?`${Math.max(1,Math.round(durationMs))} ms`:`${(durationMs/1000).toFixed(1)} s`}${runner.offMainThread?' off the main thread':''}.`})},error=>{if(!isMeshBuildCancelled(error))setBuild({state:'error',built,message:(error as Error).message})});
  return ()=>{handle.cancel();runner.dispose()};
  // layerKey, not layers: a config edit that changes neither the pieces nor their thicknesses (a
  // price, a recipe's material) must not throw away and rebuild every solid.
 },[layerKey,job]);

 // Placement, colour, frame and lighting: cheap, applied on every change without touching geometry.
 useEffect(()=>{
  const t=threeRef.current;if(!t)return;
  t.stack.position.set(-job.widthMm/2,0,-job.heightMm/2);
  for(const layer of layers){
   const mesh=meshesRef.current.get(layer.id);if(!mesh)continue;
   mesh.position.y=explodedY(layer,explode);
   const [top,side]=mesh.material as MeshStandardMaterial[],color=new Color(colorOf(layer.id));
   top.color.copy(color);side.color.copy(color).lerp(EDGE_TONE,.45);
  }
  // Frame outline: a plain moulding around the assembled stack, as tall as the stack plus a lip.
  for(const child of [...t.frame.children]){t.frame.remove(child);const m=child as Mesh;m.geometry.dispose();(m.material as MeshStandardMaterial).dispose()}
  t.frame.visible=frame.enabled;
  if(frame.enabled){
   const fw=frame.widthMm,w=job.widthMm,h=job.heightMm;
   const outer:[number,number][]=[[-fw,-fw],[w+fw,-fw],[w+fw,h+fw],[-fw,h+fw]],inner:[number,number][]=[[0,0],[w,0],[w,h],[0,h]];
   const data=extrudePolygons([{outer,holes:[inner]}],{widthMm:w,heightMm:h,baseY:0,thicknessMm:stackHeight(layers)+1.5});
   const material=new MeshStandardMaterial({color:new Color(frame.color),roughness:.7,metalness:0});
   const m=new Mesh(toGeometry(data),[material,material]);m.castShadow=true;m.receiveShadow=true;
   t.frame.add(m);t.frame.position.set(-w/2,0,-h/2);
  }
  const span=Math.max(job.widthMm,job.heightMm)+2*(frame.enabled?frame.widthMm:0);
  t.light.position.set(-span*.6,span*1.4,span*.9);t.light.target.position.set(0,0,0);
  const cam=t.light.shadow.camera;cam.left=-span;cam.right=span;cam.top=span;cam.bottom=-span;cam.near=1;cam.far=span*5;cam.updateProjectionMatrix();
  t.ground.scale.set(span*4,span*4,1);
  t.render();
 },[layers,explode,colorOf,frame,build.built,job]);

 // Frame the stack once its first piece is in (so there is something to look at while the rest
 // build) and again when it is complete. Declared after the placement effect so it measures placed pieces.
 useEffect(()=>{if(build.built===1||build.state==='ready')fit('three-quarter')},[build.built===1,build.state,fit]);

 // 'proof' is the one-click customer proof / listing photo: the chosen size and watermark, always on
 // the opaque neutral background whatever the background setting says.
 const exportPng=async(kind:'export'|'proof'='export')=>{
  const t=threeRef.current;if(!t)return;
  const bg=kind==='proof'?{transparent:false,color:PROOF_BACKGROUND}:background;
  setExporting('Rendering…');
  const {width,height}=exportSize(exportWidth,aspect);
  const {renderer,camera}=t;
  const previous={size:renderer.getSize(new Vector2()),ratio:renderer.getPixelRatio(),aspect:camera.aspect,fov:camera.fov};
  try{
   const gl=renderer.getContext(),maxDims=gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array,maxRb=gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number;
   if(width>Math.min(maxDims[0],maxRb)||height>Math.min(maxDims[1],maxRb))throw new Error(`This browser's GPU limit is ${Math.min(maxDims[0],maxRb)} px; choose a smaller width.`);
   // Keep everything that is visible on screen in frame: a narrower image keeps the screen's
   // horizontal field of view instead of its vertical one.
   const exportAspect=width/height;
   if(exportAspect<previous.aspect){const hfov=2*Math.atan(Math.tan(previous.fov*Math.PI/360)*previous.aspect);camera.fov=2*Math.atan(Math.tan(hfov/2)/exportAspect)*180/Math.PI}
   camera.aspect=exportAspect;camera.updateProjectionMatrix();
   renderer.setPixelRatio(1);renderer.setSize(width,height,false);
   renderer.setClearColor(new Color(bg.color),bg.transparent?0:1);
   renderer.render(t.scene,camera);
   const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
   const ctx=canvas.getContext('2d')!;
   // Read the frame back in the same task it was drawn in, before the browser can clear it.
   ctx.drawImage(renderer.domElement,0,0,width,height);
   if(watermark.enabled)drawWatermark(ctx,width,height,watermark);
   setExporting('Encoding PNG…');
   const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('The browser could not encode the image.')),'image/png'));
   const png=finalizePreviewPng(new Uint8Array(await blob.arrayBuffer()),{width,height},{title:`${title||'Layered map'} - 3D preview`,customer:watermark.customer,lake:watermark.lake,size:watermark.size,appVersion,createdAt:new Date().toISOString(),watermarked:watermark.enabled});
   downloadFile(`${fileSlug(title,'layered-map')}-3d-${kind==='proof'?'proof':'preview'}-${width}x${height}${watermark.enabled?'-watermarked':''}.png`,png,'image/png');
   setExporting(`Exported ${width} x ${height} px.`);
  }catch(error){setExporting(`PNG export failed: ${(error as Error).message}`)}
  finally{
   renderer.setClearColor(0x000000,0);
   renderer.setPixelRatio(previous.ratio);renderer.setSize(previous.size.x,previous.size.y);
   camera.fov=previous.fov;camera.aspect=previous.aspect;camera.updateProjectionMatrix();t.render();
  }
 };

 return <div className="preview3d" data-testid="preview3d" data-state={build.state} data-layers-built={build.built} data-layers-total={layers.length}>
  <div className="preview3d-canvas" ref={hostRef} style={{background:background.transparent?undefined:background.color}} aria-label="3D stacked preview" role="img"/>
  <div className="preview3d-toolbar">
   {(['three-quarter','top','front'] as View[]).map(v=><button key={v} onClick={()=>fit(v)}>{v==='three-quarter'?'3/4':v==='top'?'Top':'Front'}</button>)}
   <button onClick={()=>fit()}>Fit</button>
   <button onClick={()=>{setExplode(0);fit('three-quarter')}}>Reset</button>
   <label className="preview3d-explode">Explode <input type="range" min="0" max="40" step="1" value={explode} onChange={e=>setExplode(+e.target.value)} aria-label="Exploded view separation in millimetres"/><output>{explode} mm</output></label>
  </div>
  <p className="preview3d-badge">{RENDER_NOTICE}</p>
  <aside className="preview3d-panel" aria-label="3D preview settings">
   <p className="preview3d-status" role="status" data-testid="preview3d-status">{build.state==='building'?`Building layers ${build.built}/${layers.length}…`:build.state==='error'?`3D preview failed: ${build.message}`:build.message}</p>
   <details open><summary>Layers</summary>
    {[...layers].reverse().map(l=><div key={l.id} className="preview3d-layer"><input type="color" value={colorOf(l.id)} onChange={e=>setColors({...colors,[l.id]:e.target.value})} aria-label={`Colour of ${l.name}`}/><span>{l.name}</span><span className="preview3d-thickness">{l.thicknessMm} mm</span></div>)}
    <button className="btn-quiet" onClick={()=>setColors({})}>Default colours</button>
    <small>Thickness comes from each layer's material in the estimate settings.</small>
   </details>
   <details><summary>Frame and background</summary>
    <label className="check"><input type="checkbox" checked={frame.enabled} onChange={e=>setFrame({...frame,enabled:e.target.checked})}/> Frame outline</label>
    {frame.enabled&&<><label>Frame width mm <input type="number" min="3" max="80" step="1" value={frame.widthMm} onChange={e=>setFrame({...frame,widthMm:Math.max(3,+e.target.value||3)})}/></label><label>Frame colour <input type="color" value={frame.color} onChange={e=>setFrame({...frame,color:e.target.value})}/></label></>}
    <label className="check"><input type="checkbox" checked={background.transparent} onChange={e=>setBackground({...background,transparent:e.target.checked})}/> Transparent background</label>
    {!background.transparent&&<label>Background <input type="color" value={background.color} onChange={e=>setBackground({...background,color:e.target.value})}/></label>}
   </details>
   <details open><summary>Export PNG</summary>
    <div className="field-pair">
     <label>Width <select value={exportWidth} onChange={e=>setExportWidth(+e.target.value)} aria-label="Export width">{EXPORT_WIDTHS.map(w=><option key={w} value={w}>{w} px</option>)}</select></label>
     <label>Shape <select value={aspect} onChange={e=>setAspect(e.target.value as ExportAspect)} aria-label="Export aspect">{EXPORT_ASPECTS.map(a=><option key={a.id} value={a.id}>{a.id}</option>)}</select></label>
    </div>
    <small>{(()=>{const s=exportSize(exportWidth,aspect);return `${s.width} x ${s.height} px`})()}</small>
    <label className="check"><input type="checkbox" checked={watermark.enabled} onChange={e=>setWatermark({...watermark,enabled:e.target.checked})}/> PROOF watermark</label>
    {watermark.enabled&&<>
     <label>Watermark <input value={watermark.text} onChange={e=>setWatermark({...watermark,text:e.target.value})}/></label>
     <label>Customer <input value={watermark.customer} onChange={e=>setWatermark({...watermark,customer:e.target.value})}/></label>
     <label>Lake <input value={watermark.lake} onChange={e=>setWatermark({...watermark,lake:e.target.value})}/></label>
     <label>Size <input value={watermark.size} onChange={e=>setWatermark({...watermark,size:e.target.value})}/></label>
     <small>The watermark always includes "{RENDER_NOTICE}".</small>
    </>}
    <div className="preview3d-export-actions">
     <button className="btn-primary" onClick={()=>void exportPng('proof')} disabled={build.state!=='ready'||Boolean(exporting&&/…$/.test(exporting))} data-testid="preview3d-proof">Save proof PNG</button>
     <button onClick={()=>void exportPng('export')} disabled={build.state!=='ready'||Boolean(exporting&&/…$/.test(exporting))}>Export PNG</button>
    </div>
    <small>Proof PNG: neutral background, for customer proofs and listing photos. Export PNG uses the background setting above.</small>
    {exporting&&<small role="status" data-testid="preview3d-export-status">{exporting}</small>}
    <small>Every exported PNG is labelled a rendered preview in its metadata.</small>
   </details>
  </aside>
 </div>;
}

export default Preview3D;
