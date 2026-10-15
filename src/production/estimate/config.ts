// Everything the estimate is calculated from, in one editable, persisted record. None of these
// numbers belong in components: they are Ben's prices and machine settings, they change, and the
// estimate must say plainly which of them are still unverified.

export const MM_PER_IN=25.4;

// A stock material, independent of which sheet size it is bought in.
export type MaterialType={id:string;name:string;thicknessMm:number;note?:string};

// Something that can be bought: a sheet size (or a pre-cut piece) of one or more material types,
// at a pack price. widthIn/heightIn null means it is bought per piece, already at the size needed.
export type StockItem={id:string;name:string;materialIds:string[];widthIn:number|null;heightIn:number|null;packPrice:number;packQty:number;note?:string};

// Laser settings for one material. `placeholder` stays true until a value in the row is edited:
// the defaults are not measured on Ben's machine and the UI says so next to every one of them.
export type MaterialSettings={materialId:string;cutSpeedMmS:number;cutPowerPct:number;cutPasses:number;scoreSpeedMmS:number;scorePowerPct:number;engraveSpeedMmS:number;engravePowerPct:number;lineIntervalMm:number;placeholder:boolean};

export type MachineProfile={
 id:string;
 name:string;
 bedWidthMm:number;
 bedHeightMm:number;
 bedPlaceholder:boolean;
 // Setup and material change per piece, minutes.
 perPieceOverheadMin:number;
 // Multiplies the pure motion time (cut + score + engrave) for travel moves, acceleration and the
 // like. 1 means "the laser only moves while it burns", which no laser does.
 travelMultiplier:number;
 settings:MaterialSettings[];
};

// One run of pieces in a layer recipe, listed top of the finished stack first. 'layer' slots are
// filled from the generated scene's layers in order; a 'border' slot is an extra piece the scene
// does not draw (the TruFlat frame with the lake name on the small sizes). upTo marks a count that
// is a maximum, so a scene using fewer layers is not a mismatch.
export type RecipeSlot={kind:'layer'|'border';materialId:string;count:number;upTo?:boolean;note?:string};

export type LayerRecipe={id:string;label:string;widthIn:number;heightIn:number;slots:RecipeSlot[];frameCost:number|null};

export type Rates={laserPerHour:number;designPerHour:number;designHours:number;suppliesPct:number};

// A finished job whose real machine time is known (xTool Studio's reported job time), recorded next
// to what this estimate said for it at the time.
export type CalibrationEntry={id:string;recordedAt:string;label:string;estimatedMotionMin:number;estimatedOverheadMin:number;multiplierAtTime:number;actualMin:number};

export type EstimateConfig={
 schemaVersion:1;
 machine:MachineProfile;
 materials:MaterialType[];
 stock:StockItem[];
 // Which stock item each material is cut from; 'auto' picks the cheapest one the job fits on.
 stockSelection:Record<string,string>;
 recipes:LayerRecipe[];
 rates:Rates;
 sheetMarginMm:number;
 pieceSpacingMm:number;
 // Charge whole sheets (true) or only the fraction of a sheet the pieces use (false).
 chargeWholeSheets:boolean;
 // Width of the border piece's frame, for its cut length. Not in Ben's notes.
 borderWidthMm:number;
 calibration:CalibrationEntry[];
};

export const BENS_NOTES='from Ben\'s notes, verify';
export const PLACEHOLDER_LABEL='PLACEHOLDER - calibrate';

const settings=(materialId:string,cutSpeedMmS:number):MaterialSettings=>({materialId,cutSpeedMmS,cutPowerPct:100,cutPasses:1,scoreSpeedMmS:100,scorePowerPct:20,engraveSpeedMmS:300,engravePowerPct:30,lineIntervalMm:.1,placeholder:true});

const recipe=(id:string,widthIn:number,heightIn:number,slots:RecipeSlot[]):LayerRecipe=>({id,label:`${widthIn}x${heightIn}`,widthIn,heightIn,slots,frameCost:null});
const smallSlots=(mdf:number):RecipeSlot[]=>[
 {kind:'border',materialId:'truflat',count:1,note:'border with the lake name'},
 {kind:'layer',materialId:'truflat',count:1,note:'top'},
 {kind:'layer',materialId:'mdf-1-8',count:mdf},
];

export function createDefaultEstimateConfig():EstimateConfig{
 return {
  schemaVersion:1,
  machine:{
   id:'xtool-p2s-55w',
   name:'xTool P2S 55W CO2',
   // P2S work area as published by xTool. Not measured here.
   bedWidthMm:600,
   bedHeightMm:308,
   bedPlaceholder:true,
   perPieceOverheadMin:3,
   travelMultiplier:1.3,
   settings:[settings('mdf-1-8',15),settings('birch',12),settings('truflat',15)],
  },
  materials:[
   {id:'mdf-1-8',name:'1/8" MDF',thicknessMm:3.175},
   {id:'birch',name:'Birch ply',thicknessMm:3.175,note:'thickness: verify against stock'},
   {id:'truflat',name:'TruFlat premium top (maple/cherry)',thicknessMm:3.175,note:'thickness: verify against stock'},
  ],
  stock:[
   {id:'mdf-12x20',name:'1/8" MDF 12x20 in (12-pack)',materialIds:['mdf-1-8'],widthIn:12,heightIn:20,packPrice:26,packQty:12,note:BENS_NOTES},
   {id:'mdf-18x38',name:'1/8" MDF 18x38 in',materialIds:['mdf-1-8'],widthIn:18,heightIn:38,packPrice:6.5,packQty:1,note:BENS_NOTES},
   {id:'mdf-20x48',name:'1/8" MDF 20x48 in',materialIds:['mdf-1-8'],widthIn:20,heightIn:48,packPrice:9.5,packQty:1,note:BENS_NOTES},
   {id:'mdf-birch-24x36',name:'1/8" MDF or birch 24x36 in (6-pack)',materialIds:['mdf-1-8','birch'],widthIn:24,heightIn:36,packPrice:110,packQty:6,note:BENS_NOTES},
   {id:'birch-18x36',name:'Birch ply 18x36 in',materialIds:['birch'],widthIn:18,heightIn:36,packPrice:12.45,packQty:1,note:BENS_NOTES},
   {id:'birch-20x48',name:'Birch ply 20x48 in',materialIds:['birch'],widthIn:20,heightIn:48,packPrice:19,packQty:1,note:`${BENS_NOTES} (approx. price)`},
   {id:'truflat-piece',name:'TruFlat premium top, per piece',materialIds:['truflat'],widthIn:null,heightIn:null,packPrice:5.25,packQty:1,note:`${BENS_NOTES}; piece size not in notes, assumed bought at the piece size`},
  ],
  stockSelection:{'mdf-1-8':'auto',birch:'auto',truflat:'auto'},
  recipes:[
   recipe('8x10',8,10,smallSlots(4)),
   recipe('10x10',10,10,smallSlots(4)),
   recipe('12x12',12,12,smallSlots(4)),
   recipe('11x14',11,14,smallSlots(4)),
   recipe('12x18',12,18,smallSlots(7)),
   // Ben's notes give "up to 7 MDF + 1 birch" and "5 MDF + 1 birch" without saying where the birch
   // sits. Top is assumed (the premium face, like TruFlat on the small sizes); edit if it is the back.
   recipe('18x24',18,24,[{kind:'layer',materialId:'birch',count:1,note:'top (assumed)'},{kind:'layer',materialId:'mdf-1-8',count:7,upTo:true}]),
   recipe('24x36',24,36,[{kind:'layer',materialId:'birch',count:1,note:'top (assumed)'},{kind:'layer',materialId:'mdf-1-8',count:5}]),
  ],
  rates:{laserPerHour:25,designPerHour:25,designHours:0,suppliesPct:10},
  // No edge margin by default, so a board bought at its finished size (a 24x36 on a 24x36 sheet)
  // still fits; spacing covers kerf and clearance between pieces sharing a sheet.
  sheetMarginMm:0,
  pieceSpacingMm:2,
  chargeWholeSheets:true,
  borderWidthMm:25.4,
  calibration:[],
 };
}
