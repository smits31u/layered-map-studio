import * as polygonClipping from 'polygon-clipping';
import type {MultiPolygonMm} from '../../geometry/shoreline/polygonEngine';
import type {OrnamentProject} from '../types';
import {ARC_TOLERANCE_MM,circle,halfPlaneAbove,halfPlaneBelow} from './circle';

export type OrnamentIssue={code:string;severity:'error'|'warning';message:string};

export type LoopEvaluation={
 centerY:number;
 outerRadiusMm:number;
 innerRadiusMm:number;
 // Width of the material ring around the loop hole — the loop's own thinnest section.
 annulusWidthMm:number;
 // Width of the join where the loop circle crosses the ornament body: the chord of intersection of
 // the two circles. Zero when they do not intersect, which means the loop is a detached island.
 junctionWidthMm:number;
 intersectsBody:boolean;
 connected:boolean;
};

export type OrnamentGeometry={
 frame:MultiPolygonMm;
 mapOpening:MultiPolygonMm;
 textBand:MultiPolygonMm;
 outerRadiusMm:number;
 innerRadiusMm:number;
 chordYMm:number;
 textBandHeightMm:number;
 mapOpeningHeightMm:number;
 loop:LoopEvaluation;
 issues:OrnamentIssue[];
};

type LoopSpec=OrnamentProject['ornament']['hangingLoop'];

// Geometry, not a heuristic: the loop sits above the ornament and is pushed `overlapMm` into it, so
// its centre is at -(R - overlap + Rlo). The two circles' radical line is at distance
// x = (d² + R² - Rlo²) / 2d from the ornament centre, and the join is the chord 2·sqrt(R² - x²).
//
// This is what the plan means by sizing the loop "from minimum material width, not a magic
// fraction": both the loop's own annulus and its join to the body are measured in millimetres and
// checked against a stored minimum, so scaling the ornament cannot silently produce a fragile neck.
export function evaluateHangingLoop(diameterMm:number,loop:LoopSpec):LoopEvaluation{
 const R=diameterMm/2,outerRadiusMm=loop.outerDiameterMm/2,innerRadiusMm=loop.innerDiameterMm/2;
 const centerY=-R+loop.overlapMm-outerRadiusMm;
 const d=Math.abs(centerY);
 const annulusWidthMm=outerRadiusMm-innerRadiusMm;
 const intersectsBody=d<R+outerRadiusMm&&d>Math.abs(R-outerRadiusMm)&&d>0;
 let junctionWidthMm=0;
 if(intersectsBody){
  const x=(d*d+R*R-outerRadiusMm*outerRadiusMm)/(2*d);
  const half=R*R-x*x;
  junctionWidthMm=half>0?2*Math.sqrt(half):0;
 }
 const connected=intersectsBody&&junctionWidthMm>=loop.minNeckWidthMm&&annulusWidthMm>=loop.minNeckWidthMm;
 return {centerY,outerRadiusMm,innerRadiusMm,annulusWidthMm,junctionWidthMm,intersectsBody,connected};
}

const boolean=(label:string,run:()=>MultiPolygonMm):MultiPolygonMm=>{
 try{return run()}catch(error){throw new Error(`Ornament ${label} failed: ${(error as Error).message}`)}
};

// Builds the frame piece exactly as the plan's §Original ornament template specifies:
//   1. outer ornament disk plus loop outer disk
//   2. subtract the loop hole
//   3. subtract the inner map/text opening
//   4. what remains is the ring, the bottom text band, and the loop bridge, already unioned
//   5. polygon-clipping returns non-self-intersecting output, so no separate repair pass is needed
//
// The text band is part of the frame piece, not the map piece — the plan's classic mode puts the
// personalisation text on the frame ("circular frame plus hanging loop and text converted to
// paths"), so the band has to be solid material there and the map window is the only void.
export function buildOrnamentGeometry(ornament:OrnamentProject['ornament'],toleranceMm=ARC_TOLERANCE_MM):OrnamentGeometry{
 const issues:OrnamentIssue[]=[];
 const outerRadiusMm=ornament.diameterMm/2;
 const innerRadiusMm=outerRadiusMm-ornament.rimWidthMm;
 const chordYMm=ornament.mapToTextBoundaryMm;
 const loop=evaluateHangingLoop(ornament.diameterMm,ornament.hangingLoop);
 const textBandHeightMm=Math.max(0,innerRadiusMm-chordYMm);
 const mapOpeningHeightMm=Math.max(0,chordYMm+innerRadiusMm);

 if(!(outerRadiusMm>0))issues.push({code:'diameter-invalid',severity:'error',message:'Ornament diameter must be greater than zero.'});
 if(!(innerRadiusMm>0))issues.push({code:'rim-too-wide',severity:'error',message:`Rim width ${ornament.rimWidthMm}mm leaves no opening inside a ${ornament.diameterMm}mm ornament.`});
 if(innerRadiusMm>0&&textBandHeightMm<=0)issues.push({code:'no-text-band',severity:'error',message:'The map/text boundary is at or below the opening, leaving no text band.'});
 if(innerRadiusMm>0&&mapOpeningHeightMm<=0)issues.push({code:'no-map-opening',severity:'error',message:'The map/text boundary is at or above the opening, leaving no map window.'});
 if(!loop.intersectsBody)issues.push({code:'loop-detached',severity:'error',message:'The hanging loop does not meet the ornament body — increase the overlap.'});
 else if(loop.junctionWidthMm<ornament.hangingLoop.minNeckWidthMm)issues.push({code:'loop-neck-too-narrow',severity:'error',message:`The loop joins the body over ${loop.junctionWidthMm.toFixed(2)}mm, below the ${ornament.hangingLoop.minNeckWidthMm}mm minimum neck width.`});
 if(loop.annulusWidthMm<ornament.hangingLoop.minNeckWidthMm)issues.push({code:'loop-annulus-too-thin',severity:'error',message:`The loop material is ${loop.annulusWidthMm.toFixed(2)}mm thick, below the ${ornament.hangingLoop.minNeckWidthMm}mm minimum neck width.`});

 if(issues.some(i=>i.severity==='error'))return {frame:[],mapOpening:[],textBand:[],outerRadiusMm,innerRadiusMm,chordYMm,textBandHeightMm,mapOpeningHeightMm,loop,issues};

 const extent=(outerRadiusMm+loop.outerRadiusMm)*3;
 const body=circle(0,0,outerRadiusMm,toleranceMm);
 const loopOuter=circle(0,loop.centerY,loop.outerRadiusMm,toleranceMm);
 const loopHole=circle(0,loop.centerY,loop.innerRadiusMm,toleranceMm);
 const opening=circle(0,0,innerRadiusMm,toleranceMm);

 const mapOpening=boolean('map window',()=>polygonClipping.intersection(opening,halfPlaneAbove(chordYMm,extent)) as MultiPolygonMm);
 const textBand=boolean('text band',()=>polygonClipping.intersection(opening,halfPlaneBelow(chordYMm,extent)) as MultiPolygonMm);
 const withLoop=boolean('loop union',()=>polygonClipping.union(body,loopOuter) as MultiPolygonMm);
 const bored=boolean('loop hole',()=>polygonClipping.difference(withLoop,loopHole) as MultiPolygonMm);
 const frame=boolean('map window subtraction',()=>polygonClipping.difference(bored,mapOpening) as MultiPolygonMm);

 if(frame.length>1)issues.push({code:'frame-disconnected',severity:'warning',message:`The frame resolves to ${frame.length} separate pieces; they will cut as loose parts.`});

 return {frame,mapOpening,textBand,outerRadiusMm,innerRadiusMm,chordYMm,textBandHeightMm,mapOpeningHeightMm,loop,issues};
}
