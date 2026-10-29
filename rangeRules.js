// Categories are explicit: legacy weapons remain unclassified until edited by the GM.
export const WEAPON_CATEGORIES=[['','Unclassified'],['bow','Bow'],['crossbow','Crossbow'],['pistol','Pistol'],['musket','Musket'],['thrown','Thrown'],['siege','Siege weapon']];
export const normalizeWeaponCategory=value=>WEAPON_CATEGORIES.some(([key])=>key===value)?value:'';
export const weaponCategoryLabel=value=>WEAPON_CATEGORIES.find(([key])=>key===value)?.[1]||'Unclassified';

export function distanceMeters(cells,scale) {
  const value=Number(scale?.parsed?.multiplier),unit=String(scale?.parsed?.unit||'').trim().toLowerCase();
  const factor=({m:1,meter:1,meters:1,metre:1,metres:1,'м':1,cm:0.01,'см':0.01,km:1000,'км':1000,ft:0.3048,foot:0.3048,feet:0.3048,'фут':0.3048,'футы':0.3048,in:0.0254,inch:0.0254,inches:0.0254,yd:0.9144,yard:0.9144,yards:0.9144,mi:1609.344,mile:1609.344,miles:1609.344})[unit];
  return Number.isFinite(cells)&&cells>=0&&Number.isFinite(value)&&value>0&&factor?cells*value*factor:null;
}
export const RANGE_BANDS=[];
export function distanceBand(){return null;}

export function normalizeRangeReduction(raw) {
  return Object.fromEntries(RANGE_BANDS.map(([key])=>[key,Math.max(0,Math.min(999,Math.trunc(Number(raw?.[key])||0)))]).filter(([,v])=>v));
}
export function rangeAdjustment(weapon,meters,avallon={},skill='') {
  return {category:normalizeWeaponCategory(weapon?.weaponCategory),band:null,raw:0,reduction:0,modifier:0,required:false,configured:false};
}
export function rangeAdjustmentLabel(result) {
  if(result.configured===false)return result.category?'Range modifiers not configured':'';
  if(!result.category)return 'Range: unclassified';
  if(result.required)return 'Range: distance in metres required';
  const band=RANGE_BANDS.find(([key])=>key===result.band)[1].split(' · ')[0],signed=n=>(n>=0?'+':'')+n;
  return band+' · '+signed(result.modifier)+(result.raw<0&&result.reduction?' (base '+result.raw+', relief '+Math.min(result.reduction,-result.raw)+')':'');
}
