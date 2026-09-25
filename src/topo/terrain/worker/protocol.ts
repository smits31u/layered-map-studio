import type {TerrainErrorCode} from '../errors';
import type {TerrainJob,TerrainResult,TerrainStage} from '../pipeline';

// The message contract between the topo page and the terrain worker. Same shape as the ornament's
// geometry worker protocol (src/ornament/worker/protocol.ts), plus progress messages: every message
// carries the job id, so the echo of a cancelled or superseded job is recognisable and dropped.

export interface TerrainWorkerRequest{jobId:number;job:TerrainJob}

export type TerrainWorkerResponse=
 |{jobId:number;type:'progress';stage:TerrainStage}
 |{jobId:number;type:'done';ok:true;result:TerrainResult;durationMs:number}
 |{jobId:number;type:'done';ok:false;error:string;code?:TerrainErrorCode};

export const isTerrainWorkerResponse=(value:unknown):value is TerrainWorkerResponse=>
 typeof value==='object'&&value!==null&&typeof (value as {jobId?:unknown}).jobId==='number'&&((value as {type?:unknown}).type==='progress'||(value as {type?:unknown}).type==='done');
