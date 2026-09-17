import type {RoadDetail} from '../types';
import {isTierVisible,OPENFREEMAP,ROAD_CLASS_TIERS,ROAD_DETAIL_ORDER,type VectorTileProvider} from './provider';

// An original, minimal MapLibre style: a neutral land background, water fill, and one road line
// layer per detail tier. Nothing else.
//
// The plan asks for exactly this ("Use a small original MapLibre style with only the layers needed
// by the product: neutral land background; water fill; road groups matching the detail policy") and
// the reason is not aesthetics. Phase 3 captures features with queryRenderedFeatures, which can only
// see what the style draws: labels, landuse, buildings and boundaries would all arrive as noise to
// be filtered back out. A style with only the three things the ornament fabricates is the query
// filter.
//
// Layer widths here are presentation only. The plan is explicit that fabrication widths come from a
// physical mm table (Phase 3), never from style pixel widths — "Avoid using map style pixel widths
// as fabrication widths."

// Deliberately flat and low-contrast: this is the material the ornament is cut from, not a map to
// read street names off. Water is darker so the shoreline the user is framing is unmistakable.
export const ORNAMENT_STYLE_COLORS={land:'#efece4',water:'#a9bfcc',road:'#5d6570'} as const;

export const roadLayerId=(tier:RoadDetail)=>`ornament/roads/${tier}`;
export const WATER_LAYER_ID='ornament/water';
export const LAND_LAYER_ID='ornament/land';

// Widths grow with zoom so the preview stays legible while framing, and each tier is thinner than
// the one above it so hierarchy reads at a glance.
const ROAD_WIDTH:Record<RoadDetail,[number,number][]>={
 low:[[7,.6],[12,1.6],[16,4],[19,9]],
 medium:[[7,.3],[12,1],[16,2.4],[19,5.5]],
 high:[[7,.2],[12,.6],[16,1.4],[19,3.2]],
};

const interpolateWidth=(stops:[number,number][]):unknown=>['interpolate',['linear'],['zoom'],...stops.flat()];

export interface OrnamentStyle{
 version:8;
 sources:Record<string,{type:'vector';url:string;attribution:string}>;
 layers:Record<string,unknown>[];
 // MapLibre needs a glyphs URL only when a style draws text. This one never does, which is also why
 // no sprite is declared.
}

export function buildOrnamentStyle(detail:RoadDetail,provider:VectorTileProvider=OPENFREEMAP):OrnamentStyle{
 const source=provider.sourceId;
 return {
  version:8,
  sources:{[source]:{type:'vector',url:provider.tileJsonUrl,attribution:provider.attribution}},
  layers:[
   {id:LAND_LAYER_ID,type:'background',paint:{'background-color':ORNAMENT_STYLE_COLORS.land}},
   {id:WATER_LAYER_ID,type:'fill',source,'source-layer':provider.sourceLayers.water,paint:{'fill-color':ORNAMENT_STYLE_COLORS.water,'fill-antialias':true}},
   // Drawn coarsest last so major roads sit on top of minor ones, matching how the engraving reads.
   ...[...ROAD_DETAIL_ORDER].reverse().map(tier=>({
    id:roadLayerId(tier),
    type:'line',
    source,
    'source-layer':provider.sourceLayers.transportation,
    filter:['in',['get',provider.roadClassProperty],['literal',[...ROAD_CLASS_TIERS[tier]]]],
    layout:{'line-cap':'round','line-join':'round',visibility:isTierVisible(tier,detail)?'visible':'none'},
    paint:{'line-color':ORNAMENT_STYLE_COLORS.road,'line-width':interpolateWidth(ROAD_WIDTH[tier])},
   })),
  ],
 };
}

// The layer ids a given detail level actually draws — what Phase 3 will hand to
// queryRenderedFeatures, and what the map component toggles when the detail control changes.
export const visibleRoadLayerIds=(detail:RoadDetail):string[]=>ROAD_DETAIL_ORDER.filter(tier=>isTierVisible(tier,detail)).map(roadLayerId);

export const allRoadLayerIds=():string[]=>ROAD_DETAIL_ORDER.map(roadLayerId);
