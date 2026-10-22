import {memo} from 'react';
import type {MultiPolygonMm} from '../../geometry/shoreline/polygonEngine';
import type {LineMm} from '../../geometry/terrain/contourLines';
import type {GolfBoard,GolfSheet} from '../geometry/board';

// The board preview, in board millimetres (the viewBox is the board): the three sheets bottom to top,
// each piece filled in its sheet's colour, then each sheet's engraved marks and scored lines on top of
// it. It is drawn from the same GolfBoard the export serialises, so what is shown is what is cut.

const SHEET_FILLS=['#d9c49a','#7f9f63','#a9cf86'];
const SHEET_EDGES=['#8c7243','#3f5a2c','#4c7a35'];
const ENGRAVE='#2b2a26',SCORE='#1d4fbf';

const rings=(geometry:MultiPolygonMm)=>geometry.map(p=>p.map(r=>r.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join('')+'Z').join('')).join('');
const lines=(ls:LineMm[])=>ls.map(l=>l.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join('')).join('');

const Sheet=memo(function Sheet({sheet}:{sheet:GolfSheet}){
 const cut=sheet.index===0?sheet.groups.find(g=>g.id==='cut/outline')?.geometry??[]:sheet.pieces.map(p=>p.geometry);
 const engraves=sheet.groups.filter(g=>g.operation==='engrave');
 const scores=sheet.groups.filter(g=>g.operation==='score');
 return <g data-sheet={`L${sheet.index}`} data-role={sheet.role}>
  <path d={rings(cut)} fill={SHEET_FILLS[sheet.index]} stroke={SHEET_EDGES[sheet.index]} strokeWidth={.25} fillRule="evenodd"/>
  {engraves.map(g=><g key={g.id} data-group={g.id}>
   {g.geometry.length?<path d={rings(g.geometry)} fill={g.id==='engrave/water'?'#6f9fb8':ENGRAVE} fillOpacity={g.id==='engrave/water'?.9:.55} fillRule="evenodd"/>:null}
   {g.glyphs.map((glyph,i)=><path key={i} d={glyph.d} fill={ENGRAVE}/>)}
  </g>)}
  {scores.map(g=><path key={g.id} data-group={g.id} d={lines(g.lines)} fill="none" stroke={SCORE} strokeWidth={.3} strokeLinecap="round" strokeLinejoin="round"/>)}
 </g>;
});

export function BoardPreview({board}:{board:GolfBoard}){
 return <svg className="golf-board-preview" viewBox={`0 0 ${board.widthMm} ${board.heightMm}`} role="img" aria-label={`Board preview, ${board.widthMm.toFixed(0)} by ${board.heightMm.toFixed(0)} mm, ${board.sheets[2].pieces.length} surface pieces`} preserveAspectRatio="xMidYMid meet">
  {board.sheets.map(sheet=><Sheet key={sheet.index} sheet={sheet}/>)}
 </svg>;
}
