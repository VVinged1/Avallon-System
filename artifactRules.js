import {activateImplantAbility} from './implantAbilities.js';
const half=(v,max=999)=>Math.max(0,Math.min(max,Math.round((Number(v)||0)*2)/2));
export function normalizeArtifact(raw={}) {const chargeMax=half(raw.chargeMax);return {chargeMax,charges:half(raw.charges??chargeMax,chargeMax),artifactEffect:'property'};}
// Migrate the old default action into an independently priced ability exactly once.
export function artifactAbilities(raw={}){
 // SDK updates provide Immer drafts. Copy the container; inventory normalization
 // reads each ability into plain fields before it leaves the draft callback.
 const rows=Array.isArray(raw.abilities)?Array.from(raw.abilities):[];
 if(['mana','heal','bonus'].includes(raw.artifactEffect)){
  let id='artifact-default';while(rows.some(a=>a.id===id))id+='-legacy';
  rows.push({id,legacyDefault:true,name:({mana:'Restore mana',heal:'Heal body HP',bonus:'Activate bonuses'})[raw.artifactEffect],kind:raw.artifactEffect,level:0,cost:half(raw.chargeCost??1),effectAmount:half(raw.effectAmount),bonuses:raw.activeBonuses,description:'Converted from the artifact’s former default action.'});
 }
 return rows;
}
// Compatibility entry point for previously saved default actions.
export function useArtifact(tracker,id,partName=''){
 const item=tracker.avallon.inventory.items.find(i=>i.id===id&&i.kind==='artifact');
 if(!item?.equippedPart)throw Error('Equip the artifact before using it.');
 const ability=item.abilities.find(a=>a.legacyDefault);if(!ability)throw Error('Choose an artifact ability.');
 activateImplantAbility(tracker,id,ability.id,{partName});return item;
}
