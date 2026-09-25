import {describe,expect,it} from 'vitest';
import {GpxError,parseGpx,routeBounds,type GpxErrorCode} from '../../src/topo/gpx';

// GPX parsing per the plan: tracks, then routes, then waypoints; strict rejection of anything
// malformed. Fixtures are synthesized here — no real person's track is checked in.

const gpx11=(body:string)=>`<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">${body}</gpx>`;
const trkpt=(lat:number|string,lon:number|string)=>`<trkpt lat="${lat}" lon="${lon}"><ele>300</ele></trkpt>`;
const rtept=(lat:number,lon:number)=>`<rtept lat="${lat}" lon="${lon}"/>`;
const wpt=(lat:number,lon:number,name='w')=>`<wpt lat="${lat}" lon="${lon}"><name>${name}</name></wpt>`;

const refusal=(text:string,limits?:Parameters<typeof parseGpx>[1]):GpxErrorCode=>{
 try{parseGpx(text,limits);return 'empty' as never}catch(error){expect(error).toBeInstanceOf(GpxError);return (error as GpxError).code}
};

describe('GPX fallback order',()=>{
 it('reads a GPX 1.1 track, one segment per trkseg, in [lon, lat] order',()=>{
  const parsed=parseGpx(gpx11(`<trk><name>Ridge loop</name><trkseg>${trkpt(45.1,-88.1)}${trkpt(45.2,-88.2)}</trkseg><trkseg>${trkpt(45.3,-88.3)}${trkpt(45.4,-88.4)}${trkpt(45.5,-88.5)}</trkseg></trk>`));
  expect(parsed).toEqual({source:'track',name:'Ridge loop',pointCount:5,segments:[[[-88.1,45.1],[-88.2,45.2]],[[-88.3,45.3],[-88.4,45.4],[-88.5,45.5]]]});
 });

 it('keeps a gap between segments rather than joining across it',()=>{
  const parsed=parseGpx(gpx11(`<trk><trkseg>${trkpt(1,1)}${trkpt(1,2)}</trkseg><trkseg>${trkpt(5,5)}${trkpt(5,6)}</trkseg></trk>`));
  expect(parsed.segments).toHaveLength(2);
 });

 it('prefers the track even when the file also has a route and waypoints',()=>{
  const parsed=parseGpx(gpx11(`${wpt(1,1)}${wpt(2,2)}<rte>${rtept(3,3)}${rtept(4,4)}</rte><trk><trkseg>${trkpt(5,5)}${trkpt(6,6)}</trkseg></trk>`));
  expect(parsed.source).toBe('track');
 });

 it('falls back to the route when there is no drawable track',()=>{
  // A track holding one stray fix is not a line; the file's route is used instead.
  const parsed=parseGpx(`<gpx version="1.0" xmlns="http://www.topografix.com/GPX/1/0"><trk><trkseg>${trkpt(9,9)}</trkseg></trk><rte><name>Planned</name>${rtept(3,3)}${rtept(4,4)}${rtept(5,5)}</rte></gpx>`);
  expect(parsed).toMatchObject({source:'route',name:'Planned',pointCount:3});
 });

 it('falls back to the waypoints, in document order, when there is no track or route',()=>{
  const parsed=parseGpx(gpx11(`<metadata><name>Summits</name></metadata>${wpt(10,20)}${wpt(11,21)}${wpt(12,22)}`));
  expect(parsed).toEqual({source:'waypoints',name:'Summits',pointCount:3,segments:[[[20,10],[21,11],[22,12]]]});
 });

 it('drops single-point segments but keeps the drawable ones',()=>{
  const parsed=parseGpx(gpx11(`<trk><trkseg>${trkpt(1,1)}</trkseg><trkseg>${trkpt(2,2)}${trkpt(3,3)}</trkseg></trk>`));
  expect(parsed.segments).toEqual([[[2,2],[3,3]]]);
 });

 it('reads files with no namespace at all',()=>{
  expect(parseGpx(`<gpx><trk><trkseg>${trkpt(1,1)}${trkpt(2,2)}</trkseg></trk></gpx>`).pointCount).toBe(2);
 });
});

describe('GPX refusals',()=>{
 it.each([
  ['an empty file','','empty'],
  ['whitespace only','   \n ','empty'],
  ['malformed XML',gpx11('<trk><trkseg>'),'invalid-xml'],
  ['a DOCTYPE',`<!DOCTYPE gpx [<!ENTITY x "y">]>${gpx11('')}`,'invalid-xml'],
  ['a KML file','<kml xmlns="http://www.opengis.net/kml/2.2"><Placemark/></kml>','not-gpx'],
  ['a GPX with no points',gpx11('<metadata><name>nothing</name></metadata>'),'no-points'],
  ['a single point everywhere',gpx11(`${wpt(1,1)}<trk><trkseg>${trkpt(1,1)}</trkseg></trk>`),'too-few-points'],
  ['a non-numeric latitude',gpx11(`<trk><trkseg>${trkpt('abc',1)}${trkpt(1,1)}</trkseg></trk>`),'invalid-coordinate'],
  ['a blank longitude',gpx11(`<trk><trkseg>${trkpt(1,'')}${trkpt(1,1)}</trkseg></trk>`),'invalid-coordinate'],
  ['an infinite coordinate',gpx11(`<trk><trkseg>${trkpt('Infinity',1)}${trkpt(1,1)}</trkseg></trk>`),'invalid-coordinate'],
  ['a latitude off the globe',gpx11(`<trk><trkseg>${trkpt(91,1)}${trkpt(1,1)}</trkseg></trk>`),'invalid-coordinate'],
  ['a longitude off the globe',gpx11(`<rte>${rtept(1,181)}${rtept(1,1)}</rte>`),'invalid-coordinate'],
 ] as const)('refuses %s',(_,text,code)=>{
  expect(refusal(text)).toBe(code);
 });

 it('refuses a bad point even when it is in a source that would not be used',()=>{
  // Strict means the whole file: a corrupt waypoint list is not ignored because a track exists.
  expect(refusal(gpx11(`${wpt(95,1)}<trk><trkseg>${trkpt(1,1)}${trkpt(2,2)}</trkseg></trk>`))).toBe('invalid-coordinate');
 });

 it('refuses files over the size and point limits',()=>{
  const text=gpx11(`<trk><trkseg>${Array.from({length:10},(_,i)=>trkpt(1+i/100,1)).join('')}</trkseg></trk>`);
  expect(refusal(text,{maxBytes:100,maxPoints:1000})).toBe('too-large');
  expect(refusal(text,{maxBytes:1e6,maxPoints:5})).toBe('too-many-points');
  expect(parseGpx(text,{maxBytes:1e6,maxPoints:10}).pointCount).toBe(10);
 });

 it('says what was wrong, in words',()=>{
  expect(()=>parseGpx(gpx11(`<trk><trkseg>${trkpt(91,1)}${trkpt(1,1)}</trkseg></trk>`))).toThrow('Track point 1 is off the globe');
  expect(()=>parseGpx('<kml/>')).toThrow('its root element is <kml>');
 });
});

describe('route bounds',()=>{
 it('covers every point of every segment',()=>{
  expect(routeBounds([[[-88.5,45.1],[-88.1,45.4]],[[-87.9,45.0],[-88.2,45.6]]])).toEqual([-88.5,45.0,-87.9,45.6]);
 });
});
