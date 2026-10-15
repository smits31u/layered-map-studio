import type {MeshData} from '../extrude';

// Messages between the 3D preview and its mesh worker. Every layer is built at baseY 0: the preview
// positions pieces itself, so the exploded-view slider never rebuilds geometry.
export type MeshLayerInput={id:string;outlinePaths:string[];widthMm:number;heightMm:number;thicknessMm:number};
export type MeshWorkerRequest={jobId:number;layers:MeshLayerInput[]};
export type MeshWorkerResponse=
 |{jobId:number;kind:'layer';id:string;mesh:MeshData;durationMs:number}
 |{jobId:number;kind:'done';durationMs:number}
 |{jobId:number;kind:'error';error:string};

export const isMeshWorkerResponse=(value:unknown):value is MeshWorkerResponse=>Boolean(value)&&typeof value==='object'&&typeof (value as {jobId?:unknown}).jobId==='number'&&['layer','done','error'].includes((value as {kind?:string}).kind??'');
