import {describe,expect,it} from 'vitest';
import {geometryAreaMm2} from '../../src/ornament/geometry/polygonRepair';
import type {ExportPreset} from '../../src/ornament/types';
import {GOLDEN_FIXTURE_NAMES} from '../fixtures/ornament/captures';
import {goldenExport,sha256} from '../helpers/ornamentSheetGolden';

// Golden files for the *sheet* — the pieces, groups and bytes that reach the cutter — where the
// feature-geometry goldens next door stop at roads, water and land.
//
// Classic mode is recorded as the SHA-256 of the whole serialised SVG, per fixture and per preset.
// It was recorded before the hanging loop moved to the backing in three-piece mode, so it is the
// proof that the move left two-piece output byte-identical: one changed coordinate anywhere in the
// file changes the hash. Preflight's verdict and finding codes are pinned beside it, because a
// classic export that silently started blocking would be the same regression by another route.
//
// Three-piece mode is recorded as a reviewable digest — per piece: components, holes, area, bounds
// and sheet offset — plus the hash. A hash alone says only *that* something moved; the digest says
// which piece, and whether the loop went with it.

const PRESETS:ExportPreset[]=['semantic','lightburn-colors'];
const round=(value:number)=>Number(value.toFixed(3));

describe('classic two-piece sheet golden',()=>{
 describe.each(GOLDEN_FIXTURE_NAMES)('%s',name=>{
  it('serialises to the recorded bytes under both presets',async()=>{
   const record=PRESETS.map(preset=>{
    const {result,svg}=goldenExport(name,'classic-2-piece',preset);
    return {
     preset,
     sha256:sha256(svg),
     bytes:Buffer.byteLength(svg,'utf8'),
     blocked:result.preflight.blocked,
     findings:result.preflight.findings.map(finding=>`${finding.severity}:${finding.code}`).sort(),
     neckMm:result.preflight.neck.measuredMm,
    };
   });
   await expect(JSON.stringify(record,null,1)+'\n').toMatchFileSnapshot(`../fixtures/ornament/golden/sheet/${name}.classic.json`);
  },60_000);
 });
});

describe('water-cutout three-piece sheet golden',()=>{
 describe.each(GOLDEN_FIXTURE_NAMES)('%s',name=>{
  it('records the backing with the loop and the frame without it',async()=>{
   const {result,svg}=goldenExport(name,'water-cutout-3-piece');
   const {pieces,preflight}=result;
   const record={
    sha256:sha256(svg),
    bytes:Buffer.byteLength(svg,'utf8'),
    loopPiece:pieces.loopPiece,
    sheetMm:[round(pieces.sheet.widthMm),round(pieces.sheet.heightMm)],
    finishedDiameterMm:round(pieces.finishedDiameterMm),
    pieces:pieces.pieces.map(piece=>({
     id:piece.id,
     components:piece.cutLocal.length,
     holes:piece.cutLocal.reduce((count,polygon)=>count+polygon.length-1,0),
     areaMm2:round(geometryAreaMm2(piece.cutLocal)),
     localBounds:[piece.localBounds.minX,piece.localBounds.minY,piece.localBounds.maxX,piece.localBounds.maxY].map(round),
     offsetMm:piece.offsetMm.map(round),
    })),
    neck:{measuredMm:preflight.neck.measuredMm,requiredMm:preflight.neck.requiredMm,meetsMinimum:preflight.neck.meetsMinimum},
    blocked:preflight.blocked,
    findings:preflight.findings.map(finding=>`${finding.severity}:${finding.code}`).sort(),
   };
   await expect(JSON.stringify(record,null,1)+'\n').toMatchFileSnapshot(`../fixtures/ornament/golden/sheet/${name}.water-cutout.json`);
  },60_000);
 });
});
