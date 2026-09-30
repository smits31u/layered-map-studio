import {describe,expect,it} from 'vitest';
import {topoMetadataXml,type TopoExportMetadata} from '../../src/topo/export/metadata';

// Item 2 of the Phase 0 backlog: does user-typed text (a place name, a provider label, the
// project JSON carried in the CDATA block) survive into the exported SVG's metadata without
// breaking the XML or letting markup through? The ornament tool already has an equivalent test
// (tests/unit/ornamentSvgExport.test.ts, "escapes a place name that would otherwise break the
// XML"); topo's metadata.ts uses the same escapeXml/CDATA-splitting machinery but had no
// regression test of its own, so this covers topo's path specifically.

const DANGEROUS=`Bob & "Sue" <Lake> ]]> 'quote'`;

const baseMetadata=():TopoExportMetadata=>({
 appVersion:'test',
 projectSchemaVersion:1,
 generatedAt:'2026-09-25T12:00:00.000Z',
 viewport:{center:[-122.4,37.8],zoom:12,bearing:0,pitch:0,place:DANGEROUS,frameWidthPx:800,frameHeightPx:600,bounds:[-122.5,37.7,-122.3,37.9]},
 board:{widthMm:228.6,heightMm:228.6},
 providers:[{id:'p1',role:'basemap',title:DANGEROUS,attribution:DANGEROUS,source:'https://example.com',retrievedAt:'2026-09-25T12:00:00.000Z',quality:DANGEROUS}],
 terrain:{tileZoom:12,tileCount:4,grid:'256x256',smoothingRadius:3,elevationMinM:0,elevationMaxM:100,layers:[{index:0,thresholdM:0,coveragePercent:50}],contourElevationsM:[10,20]},
 bridges:{spans:0},
 settings:{route:{name:DANGEROUS},title:DANGEROUS},
});

const parseAsXml=(fragment:string)=>{
 const wrapped=`<?xml version="1.0" encoding="UTF-8"?><root xmlns:lms="https://example.com/ns">${fragment}</root>`;
 const doc=new DOMParser().parseFromString(wrapped,'application/xml');
 const errors=doc.getElementsByTagName('parsererror');
 expect(errors,errors.length?errors[0].textContent??'':'').toHaveLength(0);
 return doc;
};

describe('topo metadata XML escaping',()=>{
 it('produces well-formed XML even with markup-breaking characters in every text field',()=>{
  const xml=topoMetadataXml(baseMetadata());
  parseAsXml(xml);
 });

 it('escapes a place name so raw markup cannot appear outside the CDATA block',()=>{
  const xml=topoMetadataXml(baseMetadata());
  const outsideCdata=xml.replace(/<!\[CDATA\[.*?]]>/gs,'');
  expect(outsideCdata).not.toContain('<Lake>');
  expect(outsideCdata).not.toContain('"Sue"');
  expect(outsideCdata).toContain('&lt;Lake&gt;');
  expect(outsideCdata).toContain('&amp;');
  expect(outsideCdata).toContain('&quot;Sue&quot;');
 });

 it('defensively splits a literal ]]> so it cannot close the project CDATA early',()=>{
  const xml=topoMetadataXml(baseMetadata());
  const projectMatch=/<lms:project><!\[CDATA\[(.*)]]><\/lms:project>/s.exec(xml);
  expect(projectMatch).toBeTruthy();
  const cdataBody=projectMatch![1];
  // The literal sequence never appears intact inside the CDATA body -- it was split into
  // ]]]]><![CDATA[> so the parser cannot terminate the section prematurely.
  expect(cdataBody).not.toMatch(/[^\]]]]>(?!])/);
  const doc=parseAsXml(xml);
  const project=doc.getElementsByTagName('lms:project')[0];
  // The CDATA body is the project JSON (JSON.stringify escapes its own quotes/backslashes), so
  // compare against JSON.parse of it rather than the raw DANGEROUS string.
  expect(JSON.parse(project.textContent!)).toEqual({route:{name:DANGEROUS},title:DANGEROUS});
  expect(project.textContent).toContain(']]>');
 });

 it('round-trips the dangerous text back out through DOM text content, unescaped exactly once',()=>{
  const xml=topoMetadataXml(baseMetadata());
  const doc=parseAsXml(xml);
  const provider=doc.getElementsByTagName('lms:provider')[0];
  expect(provider.getAttribute('title')).toBe(DANGEROUS);
  expect(provider.textContent).toBe(DANGEROUS);
  const viewportEl=doc.getElementsByTagName('lms:viewport')[0];
  expect(viewportEl.getAttribute('place')).toBe(DANGEROUS);
 });
});
