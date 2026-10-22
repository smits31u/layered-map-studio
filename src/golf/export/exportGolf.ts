import type * as opentype from 'opentype.js';
import {deterministicZip} from '../../export/zip';
import {APP_VERSION} from '../../ornament/export/metadata';
import {formatMm as n} from '../../ornament/export/svg';
import type {GolfSnapshot} from '../../server/golf/types';
import type {FontId} from '../../types/project';
import {coverageReport} from '../coverage';
import {buildGolfBoard,titleValues,type GolfBoard,type GolfSheet} from '../geometry/board';
import {GOLF_PRODUCT} from '../../production/adapters/golfBoard';
import type {GolfProject} from '../types';
import {golfPreflightSummary,runGolfPreflight,type GolfPreflightReport} from './preflight';
import {sheetSvg} from './svg';

// The golf starter's one export entry point, shaped like the topo builder's exportTopo: build the
// board, preflight what was built, and only if preflight passed, write the ZIP — one SVG per sheet
// (docs/GOLF_MODULE_PLAN.md §7), manifest.json, and whatever extra files the caller packs beside them
// (the estimate summary). A blocked preflight returns no ZIP at all.
//
// The ZIP is deterministic: pinned entry timestamps (src/export/zip.ts) and nothing time-based in any
// file except the snapshot's own fetchedAt, so exporting the same course twice gives identical bytes.

export const GOLF_EXPORT_SCHEMA='layered-map-studio.golf-export/1';

// "Mid Vallee Golf Course" → "mid-vallee". The plan's filename convention (§7).
export function courseSlug(name:string):string{
 const slug=name.normalize('NFKD').replace(/[̀-ͯ]/g,'')
  .replace(/\b(golf\s+(course|club|links)|country\s+club|g\.?c\.?|c\.?c\.?)\b/gi,'')
  .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,48).replace(/-+$/,'');
 return slug||'golf-course';
}

export const sheetFileName=(slug:string,sheet:Pick<GolfSheet,'index'|'role'>,stockMm:number)=>`${slug}-L${sheet.index}-${sheet.role}-${n(stockMm)}mm.svg`;

export interface GolfExportInput{
 project:GolfProject;
 snapshot:GolfSnapshot;
 font:(id:FontId)=>opentype.Font|undefined;
 // Stock thickness per sheet index, from the estimate's materials (decision 4).
 stockMm:(sheetIndex:number)=>number;
 extraFiles?:Record<string,string>;
 appVersion?:string;
 // A board already built from the same inputs, to skip building it twice.
 board?:GolfBoard;
}

export interface GolfExportResult{ok:boolean;board:GolfBoard;preflight:GolfPreflightReport;zip?:Uint8Array;zipName:string;fileNames:string[];manifest:ReturnType<typeof golfManifest>}

export function golfManifest({board,snapshot,project,files,stockMm,appVersion,preflight}:{board:GolfBoard;snapshot:GolfSnapshot;project:GolfProject;files:string[];stockMm:(i:number)=>number;appVersion:string;preflight:GolfPreflightReport}){
 const values=titleValues(snapshot,project,board.par);
 const round=(v:number,p=3)=>Number(v.toFixed(p));
 return {
  schema:GOLF_EXPORT_SCHEMA,
  appVersion,
  product:GOLF_PRODUCT,
  course:{name:values.name,location:values.location,osm:{type:snapshot.course.osmType,id:snapshot.course.osmId,url:`https://www.openstreetmap.org/${snapshot.course.osmType}/${snapshot.course.osmId}`}},
  snapshot:{fetchedAt:snapshot.fetchedAt,...(snapshot.osmBase?{osmBase:snapshot.osmBase}:{}),queryVersion:snapshot.queryVersion},
  attribution:`${snapshot.attribution}. Course data from OpenStreetMap, available under the Open Database License (https://www.openstreetmap.org/copyright).`,
  board:{widthMm:round(board.widthMm),heightMm:round(board.heightMm),marginMm:project.board.marginMm,northUp:project.board.northUp,rotationDeg:round(board.fit.rotationDeg,2),scale:`1:${Math.round(board.fit.scaleDenominator)}`,coverageM:{width:round(board.fit.coverageM.width,1),height:round(board.fit.coverageM.height,1)}},
  // Bottom of the stack first, the order they are glued in.
  stack:board.sheets.map((sheet,i)=>({
   index:sheet.index,role:sheet.role,name:sheet.name,file:files[i],stockMm:stockMm(sheet.index),
   pieces:sheet.index===0?1:sheet.pieces.length,
   groups:Object.fromEntries(sheet.groups.map(g=>[g.id,g.geometry.length+g.lines.length+g.glyphs.length])),
  })),
  pieces:board.sheets.flatMap(sheet=>sheet.pieces.map(p=>({tag:p.tag,sheet:sheet.index,areaMm2:round(p.areaMm2,1),centroidMm:[round(p.centroidMm[0],1),round(p.centroidMm[1],1)]}))),
  holes:board.holes.map(h=>({number:h.number,ref:h.hole.ref,...(h.hole.nine?{nine:h.hole.nine}:{}),...(h.hole.par!==undefined?{par:h.hole.par}:{}),...(h.hole.handicap!==undefined?{handicap:h.hole.handicap}:{}),numbered:board.badges.some(b=>b.holeId===h.hole.id)})),
  ...(board.par!==undefined?{par:board.par}:{}),
  gluing:[
   'L0 Floor is the backing. Glue each L1 Ground piece onto it where it sits; every sheet is the whole board in place, so line up the board edges.',
   'Surface pieces (L2) are cut where they go: lift each one off its sheet without turning it and glue it onto the ground under the same spot. The manifest lists every piece by tag (S01, S02, …), top of the board to the bottom.',
   'Marks are already on the sheet they show on: nothing is engraved on material that another sheet covers.',
  ],
  coverage:{...snapshot.coverage,confirmed:project.coverageConfirmedFor===coverageReport(snapshot).key,findings:coverageReport(snapshot).findings.map(f=>f.code)},
  preflight:{summary:golfPreflightSummary(preflight),findings:preflight.findings.map(f=>({check:f.check,severity:f.severity,code:f.code,...(f.sheet!==undefined?{sheet:f.sheet}:{})}))},
  settings:project,
 };
}

export function exportGolf(input:GolfExportInput):GolfExportResult{
 const {project,snapshot,font,stockMm}=input;
 const appVersion=input.appVersion??APP_VERSION;
 const board=input.board??buildGolfBoard({project,snapshot,font});
 const preflight=runGolfPreflight({board,snapshot,project});
 const values=titleValues(snapshot,project,board.par);
 const slug=courseSlug(values.name||project.course?.label||'golf-course');
 const fileNames=board.sheets.map(sheet=>sheetFileName(slug,sheet,stockMm(sheet.index)));
 const manifest=golfManifest({board,snapshot,project,files:fileNames,stockMm,appVersion,preflight});
 const zipName=`${slug}-${n(board.widthMm)}x${n(board.heightMm)}mm.zip`;
 if(preflight.blocked)return {ok:false,board,preflight,zipName,fileNames,manifest};
 const osm=`${snapshot.course.osmType}/${snapshot.course.osmId}`;
 const svgs=board.sheets.map((sheet,i)=>[fileNames[i],sheetSvg(board,sheet,{courseName:values.name||'Golf course',osm,fileName:fileNames[i],stockMm:stockMm(sheet.index),attribution:snapshot.attribution,appVersion})] as const);
 const extra=Object.entries(input.extraFiles??{});
 for(const [name] of extra)if(fileNames.includes(name)||name==='manifest.json')throw new Error(`${name} would replace a sheet file in the ZIP.`);
 const zip=deterministicZip([...svgs,['manifest.json',JSON.stringify(manifest,null,1)],...extra]);
 return {ok:true,board,preflight,zip,zipName,fileNames,manifest};
}
