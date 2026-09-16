import {useEffect,useMemo,useReducer,useState} from 'react';
import {preloadAllFonts} from '../../text/fontRegistry';
import {createDefaultOrnamentProject} from '../defaults';
import {buildOrnamentGeometry} from '../geometry/ornamentShape';
import {clearOrnamentProject,loadOrnamentProject,saveOrnamentProject} from '../persistence';
import {ornamentReducer} from '../store';
import {fitTextScale,layoutOrnamentText} from '../text/ornamentText';
import {OrnamentControls} from './OrnamentControls';
import {OrnamentPreview} from './OrnamentPreview';

// Fonts resolve asynchronously but text vectorization is synchronous, so the page re-renders once
// they land rather than reading a half-loaded registry (same contract buildScene relies on).
export function OrnamentPage({onExit}:{onExit:()=>void}){
 const [project,dispatch]=useReducer(ornamentReducer,undefined,()=>loadOrnamentProject()??createDefaultOrnamentProject());
 const [fontsReady,setFontsReady]=useState(false);

 useEffect(()=>{let live=true;preloadAllFonts().then(()=>{if(live)setFontsReady(true)});return()=>{live=false}},[]);
 useEffect(()=>{saveOrnamentProject(project)},[project]);

 const geometry=useMemo(()=>buildOrnamentGeometry(project.ornament),[project.ornament]);
 // fontsReady participates in the key so the layout recomputes when a font finishes loading; the
 // layout function itself reads the registry synchronously.
 const textLayout=useMemo(()=>layoutOrnamentText(project,geometry),[project,geometry,fontsReady]);

 return <main>
  <OrnamentControls
   project={project}
   dispatch={dispatch}
   geometry={geometry}
   textLayout={textLayout}
   onReset={()=>{clearOrnamentProject();dispatch({type:'reset'})}}
   onFitText={()=>dispatch({type:'scaleText',factor:fitTextScale(textLayout)})}
  />
  <section className="workspace">
   <nav>
    <button type="button" onClick={onExit}>← Lake map studio</button>
    <span className="mode-note">Ornament template · map arrives in Phase 2</span>
   </nav>
   <OrnamentPreview project={project} geometry={geometry} textLayout={textLayout}/>
  </section>
 </main>;
}
