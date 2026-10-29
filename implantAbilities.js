import {normalizeBonuses,itemAbilityAvailable} from './characterRules.js';
import {manaStatus,spendMana} from './magicRules.js';
// Preserve saved selection/effect IDs for existing prosthesis abilities.
export function activeImplantAbilities(o){return (o.inventory?.items||[]).filter(itemAbilityAvailable).flatMap(item=>(item.abilities||[]).filter(a=>['attack','bonus','utility'].includes(a.kind)).map(ability=>({item,ability,key:'implant:'+item.id+':'+ability.id})));}
export function implantAttacks(o){return activeImplantAbilities(o).filter(({ability})=>ability.kind==='attack').map(({item,ability,key})=>({id:key,selectionKey:key,name:item.name+' · '+ability.name,damage:ability.damage,accuracy:ability.accuracy||0,level:ability.level||0,implantId:item.id,abilityId:ability.id,cost:ability.cost||0,resourceType:item.kind==='artifact'?'charges':'mana'}));}
export function resolveAbilitySkill(o,label){return Object.keys(o.skills).find(k=>k.toLocaleLowerCase()===String(label).trim().toLocaleLowerCase()||String(o.skillLabels[k]||k).toLocaleLowerCase()===String(label).trim().toLocaleLowerCase())||'';}
export function checkItemAbilityCost(tracker,itemId,abilityId){
 const row=activeImplantAbilities(tracker.avallon).find(r=>r.item.id===itemId&&r.ability.id===abilityId);if(!row)throw Error('Item ability is unavailable. Carry the resource or equip the item.');
 const cost=Math.max(0,Number(row.ability.cost)||0),currency=row.item.kind==='artifact'?'charges':'mana',available=currency==='charges'?row.item.charges:manaStatus(tracker.avallon).current;
 if(available<cost)throw Error(currency==='charges'?'Not enough artifact charges.':'Not enough mana.');return {...row,cost,currency};
}
export function spendItemAbilityCost(tracker,itemId,abilityId){const row=checkItemAbilityCost(tracker,itemId,abilityId);if(row.currency==='charges')row.item.charges=Math.round((row.item.charges-row.cost)*2)/2;else spendMana(tracker.avallon,row.cost);return row;}
export function activateImplantAbility(tracker,itemId,abilityId){
 const row=checkItemAbilityCost(tracker,itemId,abilityId);if(row.ability.kind==='attack')throw Error('Choose the ability in Attack.');
 const effect={id:'implant-effect:'+itemId+':'+abilityId,name:row.item.name+' · '+row.ability.name,sourceItemId:itemId,bonuses:normalizeBonuses(row.ability.bonuses)};
 tracker.avallon.effects??=[];if(row.ability.kind==='bonus'){
  if(tracker.avallon.effects.some(e=>e.id===effect.id))throw Error('Ability is already active.');if(tracker.avallon.effects.length>=100)throw Error('Too many active effects.');
 }
 spendItemAbilityCost(tracker,itemId,abilityId);if(row.ability.kind==='bonus')tracker.avallon.effects.push(effect);
 return {...effect,cost:row.cost,currency:row.currency};
}
