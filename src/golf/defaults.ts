import type {GolfProject,TitleField} from './types';

const MM_PER_IN=25.4;

// Defaults are original choices (docs/GOLF_MODULE_PLAN.md §0, clean-room boundary). The board is
// 18 x 12 in exactly (457.2 x 304.8 mm), which the plan rounds to 457 x 305.
export function createDefaultGolfProject():GolfProject{
 const show:Record<TitleField,boolean>={above:false,name:true,location:true,par:true,length:false,rating:false,slope:false,year:false,architect:false,personal:false};
 const text:Record<TitleField,string>={above:'',name:'',location:'',par:'',length:'',rating:'',slope:'',year:'',architect:'',personal:''};
 return {
  schemaVersion:1,
  course:null,
  displayUnit:'in',
  board:{widthMm:18*MM_PER_IN,heightMm:12*MM_PER_IN,marginMm:8,northUp:true},
  coverageConfirmedFor:null,
  nines:null,
  marks:{bunkers:'engrave',tees:'engrave',cartpaths:'score',streams:'score',routing:'score',floorWater:'engrave',greenInset:true,greenCollar:true,holeNumbers:true},
  title:{layout:'header',fontId:'cinzel',sizeMm:12,show,text},
 };
}
