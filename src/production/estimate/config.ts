// Everything the estimate is calculated from, in one editable, persisted record. None of these
// numbers belong in components: they are Ben's prices and machine settings, they change, and the
// estimate must say plainly which of them are still unverified.

export const MM_PER_IN=25.4;

// A stock material, independent of which sheet size it is bought in.
export type MaterialType={id:string;name:string;thicknessMm:number;note?:string};

// Something that can be bought: a sheet size (or a pre-cut piece) of one or more material types,
// at a pack price. widthIn/heightIn null means it is bought per piece, already at the size needed.
export type StockItem={id:string;name:string;materialIds:string[];widthIn:number|null;heightIn:number|null;packPrice:number;packQty:number;note?:string};

export const SETTING_FIELDS=['cutSpeedMmS','cutPowerPct','cutPasses','scoreSpeedMmS','scorePowerPct','engraveSpeedMmS','engravePowerPct','lineIntervalMm'] as const;
export type SettingField=typeof SETTING_FIELDS[number];
export const SETTING_LABELS:Record<SettingField,string>={cutSpeedMmS:'cut speed',cutPowerPct:'cut power',cutPasses:'cut passes',scoreSpeedMmS:'score speed',scorePowerPct:'score power',engraveSpeedMmS:'engrave speed',engravePowerPct:'engrave power',lineIntervalMm:'line interval'};

// Laser settings for one material on one machine. `placeholder` lists the fields nobody has entered
// a real value for yet; a field leaves the list the moment it is edited, and the UI labels every
// field still on it.
export type MaterialSettings={materialId:string;cutSpeedMmS:number;cutPowerPct:number;cutPasses:number;scoreSpeedMmS:number;scorePowerPct:number;engraveSpeedMmS:number;engravePowerPct:number;lineIntervalMm:number;placeholder:SettingField[]};

export type MachineProfile={
 id:string;
 name:string;
 location:string;
 bedWidthMm:number;
 bedHeightMm:number;
 bedPlaceholder:boolean;
 // What an hour on this machine costs.
 hourlyRate:number;
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
// is a maximum, so a scene using fewer layers is not a mismatch. manual marks pieces made by hand:
// their material is bought, but they take no laser time.
export type RecipeSlot={kind:'layer'|'border';materialId:string;count:number;upTo?:boolean;manual?:boolean;note?:string};

// machineId: which laser this size is cut on. Absent, the smallest bed the board fits on is used.
export type LayerRecipe={id:string;label:string;widthIn:number;heightIn:number;slots:RecipeSlot[];frameCost:number|null;machineId?:string};

// designHours is the default for a job with no design timer running.
export type Rates={designPerHour:number;designHours:number;suppliesPct:number};

// A finished job whose real machine time is known (the time the laser software reported), recorded
// next to what this estimate said for it at the time, on the machine it ran on.
export type CalibrationEntry={id:string;recordedAt:string;label:string;machineId:string;estimatedMotionMin:number;estimatedOverheadMin:number;multiplierAtTime:number;actualMin:number};

// How stroked lines (the lake tool's roads) are run: engraved (rastered as an area of length x
// stroke width) or scored (one vector pass along the line).
export type StrokedLineMode='engrave'|'score';

export type EstimateConfig={
 schemaVersion:1;
 machines:MachineProfile[];
 // Used when no recipe names a machine and no machine's bed fits the board.
 defaultMachineId:string;
 materials:MaterialType[];
 stock:StockItem[];
 // Which stock item each material is cut from; 'auto' picks the cheapest one the job fits on.
 stockSelection:Record<string,string>;
 recipes:LayerRecipe[];
 rates:Rates;
 strokedLines:StrokedLineMode;
 sheetMarginMm:number;
 pieceSpacingMm:number;
 // Charge whole sheets (true) or only the fraction of a sheet the pieces use (false).
 chargeWholeSheets:boolean;
 // Width of a laser-cut border piece's frame, for its cut length. Unused while borders are made by hand.
 borderWidthMm:number;
 calibration:CalibrationEntry[];
 // How the line interval is shown and typed. Stored in mm either way.
 lineIntervalUnit:LineIntervalUnit;
};

// xTool Studio shows engrave density as lines per cm; LightBurn-style software uses an interval in
// mm or lines per inch (DPI). The config stores mm; these convert for display and entry.
export type LineIntervalUnit='lpcm'|'lpi'|'mm';
export const LINE_INTERVAL_UNITS:Record<LineIntervalUnit,string>={lpcm:'lines/cm',lpi:'lines/in (DPI)',mm:'mm'};
export const lineIntervalToUnit=(mm:number,unit:LineIntervalUnit)=>unit==='mm'?mm:unit==='lpcm'?10/mm:MM_PER_IN/mm;
export const lineIntervalFromUnit=(value:number,unit:LineIntervalUnit)=>unit==='mm'?value:unit==='lpcm'?10/value:MM_PER_IN/value;

export const BENS_NOTES='from Ben\'s notes, verify';
export const PLACEHOLDER_LABEL='PLACEHOLDER - calibrate';

// Ben, 2026-10-15: line interval "300", read as xTool Studio's lines per cm: 10/300 mm.
export const BEN_LINE_INTERVAL_MM=10/300;
const settings=(materialId:string,placeholder:SettingField[]):MaterialSettings=>({materialId,cutSpeedMmS:50,cutPowerPct:70,cutPasses:1,scoreSpeedMmS:100,scorePowerPct:20,engraveSpeedMmS:400,engravePowerPct:30,lineIntervalMm:BEN_LINE_INTERVAL_MM,placeholder:[...placeholder]});
const MATERIAL_IDS=['mdf-1-8','birch','truflat'];
// Ben, 2026-10-15: "for the cutting I always use 50mm/s at 70% power; for engraving (top layer) I use
// 400mm/s", line interval 300 (lines/cm), and the Sterlings machines run the same settings for now.
// Engrave power and scoring are still unknown; neither changes the time of a job that engraves roads.
const UNKNOWN:SettingField[]=['scoreSpeedMmS','scorePowerPct','engravePowerPct'];

const machine=(id:string,name:string,location:string,bedWidthMm:number,bedHeightMm:number,bedPlaceholder:boolean,placeholder:SettingField[]):MachineProfile=>({id,name,location,bedWidthMm,bedHeightMm,bedPlaceholder,hourlyRate:25,perPieceOverheadMin:3,travelMultiplier:1.3,settings:MATERIAL_IDS.map(m=>settings(m,placeholder))});

const recipe=(id:string,widthIn:number,heightIn:number,machineId:string,slots:RecipeSlot[]):LayerRecipe=>({id,label:`${widthIn}x${heightIn}`,widthIn,heightIn,slots,frameCost:null,machineId});
const smallSlots=(mdf:number):RecipeSlot[]=>[
 {kind:'border',materialId:'truflat',count:1,manual:true,note:'border with the lake name, made by hand'},
 {kind:'layer',materialId:'truflat',count:1,note:'top'},
 {kind:'layer',materialId:'mdf-1-8',count:mdf},
];

export function createDefaultEstimateConfig():EstimateConfig{
 return {
  schemaVersion:1,
  machines:[
   // P2S work area as published by xTool, not measured here.
   machine('xtool-p2s-55w','xTool P2S 55W CO2','Home',600,308,true,UNKNOWN),
   // OMTech model not known: the bed is a stand-in just large enough for the 18x24 boards it runs.
   machine('omtech-sterlings','OMTech','Sterlings',711,508,true,UNKNOWN),
   // Thunder bed: 3 ft x 5 ft (Ben, 2026-10-15).
   machine('thunder-sterlings','Thunder','Sterlings',1524,914.4,false,UNKNOWN),
  ],
  defaultMachineId:'xtool-p2s-55w',
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
   {id:'truflat-12x19',name:'TruFlat premium top 12x19 in',materialIds:['truflat'],widthIn:12,heightIn:19,packPrice:5.25,packQty:1,note:BENS_NOTES},
  ],
  stockSelection:{'mdf-1-8':'auto',birch:'auto',truflat:'auto'},
  recipes:[
   recipe('8x10',8,10,'xtool-p2s-55w',smallSlots(4)),
   recipe('10x10',10,10,'xtool-p2s-55w',smallSlots(4)),
   recipe('12x12',12,12,'xtool-p2s-55w',smallSlots(4)),
   recipe('11x14',11,14,'xtool-p2s-55w',smallSlots(4)),
   recipe('12x18',12,18,'xtool-p2s-55w',smallSlots(6)),
   recipe('18x24',18,24,'omtech-sterlings',[{kind:'layer',materialId:'birch',count:1,note:'top'},{kind:'layer',materialId:'mdf-1-8',count:7,upTo:true}]),
   recipe('24x36',24,36,'thunder-sterlings',[{kind:'layer',materialId:'birch',count:1,note:'top'},{kind:'layer',materialId:'mdf-1-8',count:5}]),
  ],
  rates:{designPerHour:25,designHours:0,suppliesPct:10},
  strokedLines:'engrave',
  // No edge margin by default, so a board bought at its finished size (a 24x36 on a 24x36 sheet)
  // still fits; spacing covers kerf and clearance between pieces sharing a sheet.
  sheetMarginMm:0,
  pieceSpacingMm:2,
  chargeWholeSheets:true,
  borderWidthMm:25.4,
  calibration:[],
  lineIntervalUnit:'lpcm',
 };
}
