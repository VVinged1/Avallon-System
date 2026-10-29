import {normalizeBonuses,useItemOnTracker} from './characterRules.js';
import {manaStatus,setMana} from './magicRules.js';
const count=(v,max=999)=>Math.max(0,Math.min(max,Math.floor(Number(v)||0)));
export function normalizeArtifact(raw={}) {
 const chargeMax=count(raw.chargeMax);
 return {chargeMax,charges:count(raw.charges??chargeMax,chargeMax),chargeCost:count(raw.chargeCost??1),artifactEffect:['mana','heal','bonus','property'].includes(raw.artifactEffect)?raw.artifactEffect:'property',effectAmount:Math.round(Math.max(0,Math.min(999,Number(raw.effectAmount)||0))*2)/2,activeBonuses:normalizeBonuses(raw.activeBonuses)};
}
export function useArtifact(tracker,id,partName='') {
 const item=tracker.avallon.inventory.items.find(i=>i.id===id&&i.kind==='artifact'&&i.quantity>0);
 if(!item||!item.equippedPart)throw Error('Equip the artifact before using it.');
 if(item.artifactEffect==='property')throw Error('This artifact grants a passive property.');
 if(item.charges<item.chargeCost)throw Error('Not enough artifact charges.');
 const effectId='artifact-effect:'+id;
 if(item.artifactEffect==='mana'){
  const pool=manaStatus(tracker.avallon);if(!item.effectAmount||pool.current>=pool.max)throw Error('No mana to restore.');
  setMana(tracker.avallon,Math.min(pool.max,pool.current+item.effectAmount));
 }else if(item.artifactEffect==='heal'){
  useItemOnTracker(tracker,{subtype:'medkit',healCritical:Math.floor(item.effectAmount)},partName,effectId);
 }else{
  if(tracker.avallon.effects.some(e=>e.id===effectId))throw Error('Artifact effect is already active.');
  if(tracker.avallon.effects.length>=100)throw Error('Too many active effects.');
  tracker.avallon.effects.push({id:effectId,name:item.name,sourceItemId:id,bonuses:normalizeBonuses(item.activeBonuses)});
 }
 item.charges-=item.chargeCost;
 return item;
}
