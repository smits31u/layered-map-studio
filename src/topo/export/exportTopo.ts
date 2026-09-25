import type * as opentype from 'opentype.js';
import type {FontId} from '../../types/project';
import type {TopoCapture} from '../capture/topoCapture';
import type {TerrainResult} from '../terrain/pipeline';
import type {TopoProject} from '../types';
import {buildTopoBoard,type TopoBoard} from './board';
import {buildTopoMetadata,type TopoExportMetadata} from './metadata';
import {runTopoPreflight,type TopoPreflightReport} from './preflight';
import {topoSvg} from './svg';

// The topo builder's one export entry point, shaped exactly like the ornament's exportOrnament:
// build the board, preflight what was built, and serialise only if preflight passed. A blocked
// preflight returns no `svg` at all — nothing that could be written to disk by mistake.
//
// It takes the terrain result as it stands and never regenerates terrain: exporting after a
// presentation change (roads, labels, frame, title, route) costs the overlay and road build, not a
// terrain run.

export interface TopoExportInput{
 project:TopoProject;
 terrain:TerrainResult;
 capture?:TopoCapture;
 font:(id:FontId)=>opentype.Font|undefined;
 generatedAt?:Date;
 appVersion?:string;
}

export interface TopoExportResult{
 ok:boolean;
 preflight:TopoPreflightReport;
 board:TopoBoard;
 metadata:TopoExportMetadata;
 svg?:string;
 projectJson:string;
 fileNames:{svg:string;project:string};
}

const slug=(value:string)=>value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,48);
const size=(mm:number)=>String(Number(mm.toFixed(1)));

// Deterministic: the place (or the centre, when no place was chosen) and the board size, so two
// exports of one design land on one name and different designs do not collide.
export function topoFileNames(project:TopoProject,terrain:TerrainResult):{svg:string;project:string}{
 const [lng,lat]=terrain.view.center;
 const where=slug(project.viewport.selectedPlaceLabel??'')||`${Math.abs(lat).toFixed(4)}${lat<0?'s':'n'}-${Math.abs(lng).toFixed(4)}${lng<0?'w':'e'}`.replace(/\./g,'_');
 const stem=`topo-${where}-${size(terrain.view.widthMm)}x${size(terrain.view.heightMm)}mm`;
 return {svg:`${stem}.svg`,project:`${stem}.json`};
}

export function exportTopo(input:TopoExportInput):TopoExportResult{
 const {project,terrain,capture}=input;
 const board=buildTopoBoard({project,terrain,capture,font:input.font});
 const tabWidths=[...(board.roads?.bridges.spans?[board.roads.bridges.narrowestTabMm!]:[]),...(board.route?.bridgeSpans?[project.route!.widthMm]:[])];
 const metadata=buildTopoMetadata({
  project,terrain,capture,generatedAt:input.generatedAt??new Date(),appVersion:input.appVersion,
  bridges:{spans:(board.roads?.bridges.spans??0)+(board.route?.bridgeSpans??0),...(tabWidths.length?{narrowestTabMm:Math.min(...tabWidths)}:{})},
 });
 const preflight=runTopoPreflight({project,terrain,board,metadata,captured:Boolean(capture)});
 const fileNames=topoFileNames(project,terrain);
 // The whole project, route included: this is the file a reprint is rebuilt from. (The route is
 // deliberately kept out of browser storage; a file the user chose to save is a different thing.)
 const projectJson=JSON.stringify(project,null,2)+'\n';
 if(preflight.blocked)return {ok:false,preflight,board,metadata,projectJson,fileNames};
 return {ok:true,preflight,board,metadata,svg:topoSvg(board,metadata),projectJson,fileNames};
}
