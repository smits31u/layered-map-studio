import {OPENFREEMAP} from '../map/provider';
import type {FeatureCapture} from '../capture/featureTypes';
import type {BuildMode,ExportPreset,OrnamentProject} from '../types';
import type {OrnamentSheet} from './pieces';

// What the file says about where it came from.
//
// The point of recording this is that a cut file outlives the session that made it. Six months after
// the fact, the only things that can answer "which version produced this, and can I reproduce it"
// are the bytes in the file. Everything here is chosen so that a reprint is possible from the SVG
// alone plus the project JSON exported beside it.

export const APP_VERSION:string=typeof __APP_VERSION__==='string'?__APP_VERSION__:'0.0.0-dev';

export interface ExportMetadata{
 appVersion:string;
 projectSchemaVersion:number;
 buildMode:BuildMode;
 exportPreset:ExportPreset;
 viewport:{center:[number,number];zoom:number;bearing:0;pitch:0;place?:string};
 providers:{id:string;label:string;attribution:string}[];
 dimensions:{sheetWidthMm:number;sheetHeightMm:number;finishedDiameterMm:number;specifiedDiameterMm:number};
 // ISO 8601. The one field that is not a function of the inputs, which is why it is an argument
 // rather than a `new Date()` buried in the serializer: a test has to be able to pin it, and a
 // golden-file comparison of two exports of the same design has to be able to ignore it.
 generatedAt:string;
 capture?:{takenAt:string;roads:number;water:number;detail:string;mmPerPx:number};
 settings:OrnamentProject;
}

export interface MetadataInput{
 project:OrnamentProject;
 sheet:OrnamentSheet;
 finishedDiameterMm:number;
 generatedAt:Date;
 capture?:FeatureCapture;
 appVersion?:string;
}

const round=(value:number)=>{
 const rounded=Number(value.toFixed(3));
 return Object.is(rounded,-0)?0:rounded;
};

export function buildExportMetadata(input:MetadataInput):ExportMetadata{
 const {project,sheet,capture}=input;
 return {
  appVersion:input.appVersion??APP_VERSION,
  projectSchemaVersion:project.schemaVersion,
  buildMode:project.buildMode,
  exportPreset:project.exportPreset,
  viewport:{
   center:[round(project.viewport.center[0]),round(project.viewport.center[1])],
   zoom:project.viewport.zoom,
   bearing:0,
   pitch:0,
   place:project.viewport.selectedPlaceLabel,
  },
  // Attribution travels with the file rather than only being shown in the app. The tiles are
  // OpenStreetMap-derived and the licence follows the derived work, not the browser tab it was
  // viewed in.
  providers:[{id:OPENFREEMAP.id,label:OPENFREEMAP.label,attribution:OPENFREEMAP.attribution}],
  dimensions:{
   sheetWidthMm:round(sheet.widthMm),
   sheetHeightMm:round(sheet.heightMm),
   finishedDiameterMm:round(input.finishedDiameterMm),
   specifiedDiameterMm:round(project.ornament.diameterMm),
  },
  generatedAt:input.generatedAt.toISOString(),
  capture:capture?{
   takenAt:new Date(capture.capturedAt).toISOString(),
   roads:capture.features.roads.length,
   water:capture.features.water.length,
   detail:capture.detail,
   mmPerPx:round(capture.mmPerPx),
  }:undefined,
  settings:project,
 };
}

const ESCAPES:Record<string,string>={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'};

export const escapeXml=(value:string):string=>value.replace(/[&<>"']/g,character=>ESCAPES[character]);

// Metadata goes in as a namespaced element plus a CDATA block of the project itself.
//
// Two forms because they answer different questions. The elements are readable in a text editor and
// survive a round trip through software that keeps `<metadata>` but knows nothing about the
// namespace. The CDATA block is the exact project JSON, so an export can be reloaded even if the
// `.json` file beside it has been lost — which, in a downloads folder, it will be.
export const METADATA_NAMESPACE='https://oldglorydecor.com/ns/layered-map-studio/ornament/1';

export function metadataXml(metadata:ExportMetadata):string{
 const element=(name:string,value:string|number|undefined)=>
  value===undefined||value===''?'':`<lms:${name}>${escapeXml(String(value))}</lms:${name}>`;
 const {viewport,dimensions,capture}=metadata;
 return [
  `<metadata><lms:ornament xmlns:lms="${METADATA_NAMESPACE}">`,
  element('app-version',metadata.appVersion),
  element('project-schema',metadata.projectSchemaVersion),
  element('build-mode',metadata.buildMode),
  element('export-preset',metadata.exportPreset),
  element('generated-at',metadata.generatedAt),
  `<lms:viewport center="${viewport.center[0]} ${viewport.center[1]}" zoom="${viewport.zoom}" bearing="0" pitch="0"${viewport.place?` place="${escapeXml(viewport.place)}"`:''}/>`,
  `<lms:dimensions sheet-width-mm="${dimensions.sheetWidthMm}" sheet-height-mm="${dimensions.sheetHeightMm}" finished-diameter-mm="${dimensions.finishedDiameterMm}" specified-diameter-mm="${dimensions.specifiedDiameterMm}"/>`,
  capture?`<lms:capture taken-at="${escapeXml(capture.takenAt)}" roads="${capture.roads}" water="${capture.water}" detail="${escapeXml(capture.detail)}" mm-per-px="${capture.mmPerPx}"/>`:'',
  '<lms:providers>',
  ...metadata.providers.map(provider=>`<lms:provider id="${escapeXml(provider.id)}" label="${escapeXml(provider.label)}">${escapeXml(provider.attribution)}</lms:provider>`),
  '</lms:providers>',
  // `]]>` cannot occur in JSON.stringify output — every `]` and `>` is emitted literally and the
  // sequence would need a `]]` immediately followed by `>`, which only string content could
  // produce. Split defensively anyway, because the alternative is a corrupt file rather than a
  // rendering glitch.
  `<lms:project><![CDATA[${JSON.stringify(metadata.settings).replace(/]]>/g,']]]]><![CDATA[>')}]]></lms:project>`,
  '</lms:ornament></metadata>',
 ].filter(Boolean).join('');
}
