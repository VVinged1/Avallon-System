import {activateAbility} from './magicRules.js';
import {activateImplantAbility,checkItemAbilityCost} from './implantAbilities.js';
import {addNarrativeStatus} from './statusRules.js';
export function applyNarrativeAbility({source,target,itemId='',abilityId,sourceTokenId,sourceName,statusId,expected}){
 const ability=itemId?checkItemAbilityCost(source,itemId,abilityId).ability:source.avallon.abilities.find(a=>a.id===abilityId);
 if(!ability||ability.kind!=='utility'||!ability.statusName)throw Error('Narrative status ability is unavailable.');
 const definition=JSON.stringify([ability.kind,ability.cost,ability.statusName,ability.statusDescription]);if(expected&&expected!==definition)throw Error('Ability changed. Choose the target again.');
 const nextSource=structuredClone(source),nextTarget=source===target?nextSource:structuredClone(target);
 const status=addNarrativeStatus(nextTarget,{id:statusId,name:ability.statusName,description:ability.statusDescription||ability.description||'',sourceName,sourceKey:sourceTokenId+':'+itemId+':'+abilityId});
 const used=itemId?activateImplantAbility(nextSource,itemId,abilityId):{...activateAbility(nextSource,abilityId),currency:'mana'};
 return {source:nextSource,target:nextTarget,status,used};
}
