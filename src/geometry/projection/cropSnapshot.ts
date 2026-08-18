import type {CropGeography,LngLat,MapProject} from '../../types/project';

export type CropSnapshot={
 center:{lat:number;lon:number};
 zoom:number;
 bearing:number;
 crop:{nw:LngLat;ne:LngLat;se:LngLat;sw:LngLat;bbox:{north:number;south:number;east:number;west:number}};
 dimensions:{widthMm:number;heightMm:number};
};

export function serializeCropSnapshot(project:MapProject):CropSnapshot{
 const crop=project.map.crop;
 if(!crop)throw new Error('No crop selected — load visible vector features before exporting the crop.');
 const [west,south,east,north]=crop.bbox;
 return{
  center:{lat:project.map.latitude,lon:project.map.longitude},
  zoom:project.map.zoom,
  bearing:project.map.bearing,
  crop:{nw:crop.nw,ne:crop.ne,se:crop.se,sw:crop.sw,bbox:{north,south,east,west}},
  dimensions:{widthMm:project.dimensions.widthMm,heightMm:project.dimensions.heightMm},
 };
}

export function cropGeographyFromSnapshot(snapshot:CropSnapshot):CropGeography{
 const {nw,ne,se,sw,bbox}=snapshot.crop;
 return{nw,ne,se,sw,bbox:[bbox.west,bbox.south,bbox.east,bbox.north]};
}

export function applyCropSnapshot(project:MapProject,snapshot:CropSnapshot):MapProject{
 return{
  ...project,
  map:{...project.map,latitude:snapshot.center.lat,longitude:snapshot.center.lon,zoom:snapshot.zoom,bearing:snapshot.bearing,crop:cropGeographyFromSnapshot(snapshot)},
  dimensions:{...project.dimensions,widthMm:snapshot.dimensions.widthMm,heightMm:snapshot.dimensions.heightMm},
 };
}

// Deterministic, dependency-free short identifier for a crop — not cryptographic, just enough
// to tell two crops apart at a glance and to tag regression fixtures with their source framing.
export function hashCropSnapshot(snapshot:CropSnapshot):string{
 const key=[snapshot.crop.nw.lng,snapshot.crop.nw.lat,snapshot.crop.ne.lng,snapshot.crop.ne.lat,snapshot.crop.se.lng,snapshot.crop.se.lat,snapshot.crop.sw.lng,snapshot.crop.sw.lat,snapshot.dimensions.widthMm,snapshot.dimensions.heightMm].map(n=>n.toFixed(6)).join('|');
 let hash=0;
 for(let i=0;i<key.length;i++)hash=(Math.imul(hash,31)+key.charCodeAt(i))|0;
 return(hash>>>0).toString(16).padStart(8,'0');
}
