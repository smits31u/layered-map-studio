import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {normalizeSnapshot,type OverpassElement} from '../../src/server/golf/normalize';
import type {GolfSnapshot} from '../../src/server/golf/types';

// The recorded Overpass response for Mid Vallee Golf Course, De Pere, WI (OSM way 29060461), fetched
// once on 2026-10-22. Data © OpenStreetMap contributors, ODbL: see
// tests/fixtures/golf/mid-vallee.ATTRIBUTION.md. Unit tests never call a public service.
//
// The recording is one response holding the boundary and the features. The live route makes two
// requests (boundary, then the padded bbox); the fixture is split the same way here.

export const MID_VALLEE_FETCHED_AT='2026-10-22T20:24:48.000Z';

export function midValleeElements():{boundary:OverpassElement;features:OverpassElement[];osmBase?:string}{
 const raw=JSON.parse(readFileSync(resolve(__dirname,'..','fixtures','golf','mid-vallee.overpass.json'),'utf8')) as {elements:OverpassElement[];osm3s?:{timestamp_osm_base?:string}};
 const boundary=raw.elements.find(e=>e.type==='way'&&e.id===29060461)!;
 return {boundary,features:raw.elements.filter(e=>e!==boundary),osmBase:raw.osm3s?.timestamp_osm_base};
}

export function midValleeSnapshot():GolfSnapshot{
 const {boundary,features,osmBase}=midValleeElements();
 return normalizeSnapshot({boundary,features,fetchedAt:MID_VALLEE_FETCHED_AT,osmBase});
}
