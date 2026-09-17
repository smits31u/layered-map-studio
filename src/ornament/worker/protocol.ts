import type {FeatureGeometryInput,FeatureGeometryResult} from '../geometry/featureGeometry';

// The message contract between the page and the geometry worker.
//
// In its own file so neither side can drift: the worker imports it and nothing else from the app,
// and the client imports it and the worker's URL. Both messages carry `jobId`, because the whole
// point of the worker is that several runs can be in flight — one the user started, one they
// cancelled, and one they started after that — and a result is meaningless without knowing which.

export interface GeometryWorkerRequest{jobId:number;input:FeatureGeometryInput}

export type GeometryWorkerResponse=
 |{jobId:number;ok:true;result:FeatureGeometryResult;durationMs:number}
 |{jobId:number;ok:false;error:string};

export const isGeometryWorkerResponse=(value:unknown):value is GeometryWorkerResponse=>
 typeof value==='object'&&value!==null&&typeof (value as {jobId?:unknown}).jobId==='number'&&typeof (value as {ok?:unknown}).ok==='boolean';
