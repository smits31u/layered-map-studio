import type {RoadDetail} from '../types';

// The vector-tile provider adapter.
//
// The plan is specific here: "Do not depend solely on hard-coded style layer IDs. Keep source-layer
// names and class mapping in a provider adapter. Validate the style schema on load and surface a
// compatibility error if required source layers disappear." Everything this app assumes about the
// upstream tile schema is written down once, in this file, so pointing the ornament at a
// self-hosted or different OpenMapTiles server is a config change rather than a hunt through style
// definitions.

export interface VectorTileProvider{
 id:string;
 label:string;
 // A TileJSON URL, not a style URL: the ornament builds its own minimal style (see style.ts) and
 // only needs the data.
 tileJsonUrl:string;
 attribution:string;
 sourceId:string;
 sourceLayers:{water:string;transportation:string};
 // The feature property carrying the road classification. OpenMapTiles calls it `class`.
 roadClassProperty:string;
}

export const OPENFREEMAP:VectorTileProvider={
 id:'openfreemap',
 label:'OpenFreeMap (OpenMapTiles schema)',
 // Overridable so a self-hosted OpenMapTiles server can be dropped in without a code change.
 tileJsonUrl:import.meta.env.VITE_ORNAMENT_TILES_URL||'https://tiles.openfreemap.org/planet',
 attribution:'© OpenStreetMap contributors · tiles by OpenFreeMap',
 sourceId:'ornament-vector',
 sourceLayers:{water:'water',transportation:'transportation'},
 roadClassProperty:'class',
};

// The plan's detail policy, verbatim:
//   Low:    motorway, trunk, primary, secondary.
//   Medium: Low plus tertiary, residential, unclassified/minor.
//   High:   Medium plus service, track, path, pedestrian.
//
// Each tier lists only what it *adds*, so the style can render one layer per tier and switching
// detail is a visibility toggle rather than a style rebuild — and so Phase 3 can query exactly the
// layers that are on.
//
// OpenMapTiles folds residential, unclassified and living_street into class `minor`, and footway,
// cycleway, steps and pedestrian into class `path` with a `subclass`. The raw OSM highway values are
// listed alongside the OpenMapTiles ones because some servers pass them through unfolded; a class
// that never appears simply never matches.
export const ROAD_CLASS_TIERS={
 low:['motorway','trunk','primary','secondary'],
 medium:['tertiary','minor','residential','unclassified','living_street'],
 high:['service','track','path','pedestrian','footway','cycleway','steps','bridleway'],
} as const satisfies Record<RoadDetail,readonly string[]>;

export const ROAD_DETAIL_ORDER=['low','medium','high'] as const;

// Every class visible at a given detail level — the union of that tier and the ones below it.
export function roadClassesForDetail(detail:RoadDetail):string[]{
 const upTo=ROAD_DETAIL_ORDER.slice(0,ROAD_DETAIL_ORDER.indexOf(detail)+1);
 return upTo.flatMap(tier=>[...ROAD_CLASS_TIERS[tier]]);
}

export const isTierVisible=(tier:RoadDetail,detail:RoadDetail)=>ROAD_DETAIL_ORDER.indexOf(tier)<=ROAD_DETAIL_ORDER.indexOf(detail);

export interface ProviderCompatibility{compatible:boolean;missing:string[];message?:string}

// Checked against the vector source once it loads. A missing `water` or `transportation` layer means
// the ornament cannot produce the geometry it exists to produce, and the plan asks for that to be
// said out loud rather than discovered as an empty export three phases later.
//
// Two shapes are accepted because there are two things worth checking: raw TileJSON, which lists
// `vector_layers`, and a live MapLibre vector source, which flattens the same information into
// `vectorLayerIds`. Anything else — including a source that has not finished loading — is reported
// as unknown rather than missing, so a slow tile server is never mistaken for a broken one.
export function checkProviderCompatibility(provider:VectorTileProvider,source:unknown):ProviderCompatibility{
 const record=source as {vector_layers?:{id?:unknown}[];vectorLayerIds?:unknown[]}|undefined|null;
 const ids=Array.isArray(record?.vectorLayerIds)
  ?record.vectorLayerIds.map(id=>String(id))
  :Array.isArray(record?.vector_layers)
   ?record.vector_layers.map(layer=>String(layer?.id??''))
   :undefined;
 if(!ids)return {compatible:false,missing:[],message:`${provider.label} did not describe its vector layers, so the ornament cannot confirm it carries road and water data.`};
 const present=new Set(ids);
 const missing=Object.values(provider.sourceLayers).filter(name=>!present.has(name));
 return missing.length
  ?{compatible:false,missing,message:`${provider.label} no longer provides the ${missing.join(' and ')} layer${missing.length>1?'s':''} this ornament needs.`}
  :{compatible:true,missing:[]};
}
