import type {FeatureCapture} from '../capture/featureTypes';
import type {FeatureGeometryResult} from '../geometry/featureGeometry';
import type {OrnamentGeometry} from '../geometry/ornamentShape';
import type {OrnamentTextLayout} from '../text/ornamentText';
import type {OrnamentProject} from '../types';
import {buildExportMetadata,type ExportMetadata} from './metadata';
import {buildOrnamentPieces,type OrnamentPieceSet} from './pieces';
import {runPreflight,type PreflightReport} from './preflight';
import {ornamentSvg} from './svg';

// The one entry point. Build the pieces, run preflight over what was built, and serialise only if
// preflight passed.
//
// The ordering is the whole design. Preflight runs on `OrnamentPieceSet` — the placed, sheet-
// coordinate geometry that is one function call away from being text in a file — rather than on the
// project settings or on the editor's in-memory model. Everything the checks look at is therefore
// what actually gets cut, including the parts assembled during layout, and a bug introduced between
// the editor and the sheet cannot slip past by being introduced late.
//
// When preflight blocks there is no `svg` on the result at all. Not an SVG with a warning attached,
// not an SVG the caller is trusted to throw away — nothing to accidentally write to disk.

export interface OrnamentExportInput{
 project:OrnamentProject;
 geometry:OrnamentGeometry;
 textLayout:OrnamentTextLayout;
 featureGeometry?:FeatureGeometryResult;
 // The capture the feature geometry was built from, so the export can record what it was made of.
 capture?:FeatureCapture;
 generatedAt?:Date;
 appVersion?:string;
}

export interface OrnamentExportResult{
 ok:boolean;
 preflight:PreflightReport;
 pieces:OrnamentPieceSet;
 metadata:ExportMetadata;
 // Absent when preflight blocked.
 svg?:string;
 projectJson:string;
 fileNames:{svg:string;project:string};
}

const slug=(value:string|undefined):string=>{
 const cleaned=(value??'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
 return cleaned.slice(0,48)||'ornament';
};

export function exportFileNames(project:OrnamentProject):{svg:string;project:string}{
 const mode=project.buildMode==='water-cutout-3-piece'?'3piece':'2piece';
 const stem=`ornament-${slug(project.viewport.selectedPlaceLabel)}-${Number(project.ornament.diameterMm.toFixed(1))}mm-${mode}`;
 return {svg:`${stem}.svg`,project:`${stem}.json`};
}

export function exportOrnament(input:OrnamentExportInput):OrnamentExportResult{
 const {project,geometry,textLayout,featureGeometry,capture}=input;

 const pieces=buildOrnamentPieces({
  project,
  geometry,
  textLayout,
  featureGeometry,
 });

 const metadata=buildExportMetadata({
  project,
  sheet:pieces.sheet,
  finishedDiameterMm:pieces.finishedDiameterMm,
  generatedAt:input.generatedAt??new Date(),
  capture,
  appVersion:input.appVersion,
 });

 const preflight=runPreflight({project,geometry,textLayout,pieces,featureGeometry});
 const fileNames=exportFileNames(project);
 // Two spaces, sorted by nothing in particular but stable: this is the file a customer reprint is
 // rebuilt from, and it should survive being opened in an editor and diffed.
 const projectJson=JSON.stringify(project,null,2)+'\n';

 if(preflight.blocked)return {ok:false,preflight,pieces,metadata,projectJson,fileNames};

 return {
  ok:true,
  preflight,
  pieces,
  metadata,
  svg:ornamentSvg(pieces,metadata,{preset:project.exportPreset}),
  projectJson,
  fileNames,
 };
}
