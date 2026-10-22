import type {CoverageRole,GolfSnapshot} from '../server/golf/types';

// The coverage gate (docs/GOLF_MODULE_PLAN.md §3): what OpenStreetMap has for this course, shown as
// a checklist before anything is generated, so a missing green is found on screen and not at the
// laser.
//
//   blocking  no hole lines, or fewer greens than holes. The board would be missing obvious
//             features; the user can go on only after confirming (GolfProject.coverageConfirmedFor).
//   soft      no bunkers, no tees, or no rough. Worth knowing; nothing waits on it.
//   info      a hole count that is not 9/18/27/36 (executive and par-3 courses exist).

export type CoverageLevel='blocking'|'soft'|'info';
export interface CoverageFinding{level:CoverageLevel;code:string;message:string}
export interface CoverageItem{role:CoverageRole;label:string;count:number;ok:boolean}
export interface CoverageReport{items:CoverageItem[];findings:CoverageFinding[];blocking:boolean;key:string}

// The checklist the plan names, in its order. Rough and cart paths are counted too: rough because
// its absence is a soft warning, cart paths because they become marks.
const CHECKLIST:{role:CoverageRole;label:string}[]=[
 {role:'holes',label:'Holes'},{role:'fairways',label:'Fairways'},{role:'greens',label:'Greens'},{role:'tees',label:'Tees'},
 {role:'bunkers',label:'Bunkers'},{role:'water',label:'Water'},{role:'trees',label:'Trees'},{role:'rough',label:'Rough'},{role:'cartpaths',label:'Cart paths'},
];

export const coverageKey=(snapshot:GolfSnapshot)=>`${snapshot.course.osmType}-${snapshot.course.osmId}@${snapshot.fetchedAt}`;

export function coverageReport(snapshot:GolfSnapshot):CoverageReport{
 const c=snapshot.coverage;
 const findings:CoverageFinding[]=[];
 if(c.holes===0)findings.push({level:'blocking',code:'no-holes',message:'OpenStreetMap has no hole lines (golf=hole) for this course, so there is no routing, no hole numbers and no par.'});
 else if(c.greens<c.holes)findings.push({level:'blocking',code:'missing-greens',message:`OpenStreetMap has ${c.greens} green${c.greens===1?'':'s'} for ${c.holes} holes. At least ${c.holes-c.greens} green${c.holes-c.greens===1?' is':'s are'} missing from the map, so the board will be missing ${c.holes-c.greens===1?'it':'them'} too.`});
 if(c.bunkers===0)findings.push({level:'soft',code:'no-bunkers',message:'No bunkers are mapped.'});
 if(c.tees===0)findings.push({level:'soft',code:'no-tees',message:'No tees are mapped.'});
 if(c.rough===0)findings.push({level:'soft',code:'no-rough',message:'No rough is mapped. Generated rough comes in a later phase.'});
 if(c.holes>0&&![9,18,27,36].includes(c.holes))findings.push({level:'info',code:'unusual-hole-count',message:`${c.holes} holes are mapped. That is fine for an executive or par-3 course; on a full course some holes may be missing.`});
 return {
  items:CHECKLIST.map(({role,label})=>({role,label,count:c[role]??0,ok:(c[role]??0)>0})),
  findings,
  blocking:findings.some(f=>f.level==='blocking'),
  key:coverageKey(snapshot),
 };
}

// Whether generation may go ahead: always, unless the gate blocks and this snapshot has not been
// confirmed.
export const coverageCleared=(report:CoverageReport,confirmedFor:string|null)=>!report.blocking||confirmedFor===report.key;
