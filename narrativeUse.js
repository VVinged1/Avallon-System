import {activateAbility} from './magicRules.js';
import {activateImplantAbility,checkItemAbilityCost} from './implantAbilities.js';
import {addNarrativeStatus} from './statusRules.js';
export function applyNarrativeAbility({source,target,itemId='',abilityId,sourceTokenId,sourceName,statusId,expected,rollSkill,modifier=0}){
 const ability=itemId?checkItemAbilityCost(source,itemId,abilityId).ability:source.avallon.abilities.find(a=>a.id===abilityId);
 if(!ability||ability.kind!=='utility'||!ability.statusName)throw Error('Narrative status ability is unavailable.');
 const definition=JSON.stringify([ability.kind,ability.cost,ability.level,ability.statusName,ability.statusDescription]);if(expected&&expected!==definition)throw Error('Ability changed. Choose the target again.');
 const nextSource=structuredClone(source),projected=structuredClone(target);
 const status=addNarrativeStatus(projected,{id:statusId,name:ability.statusName,description:ability.statusDescription||ability.description||'',sourceName,sourceKey:sourceTokenId+':'+itemId+':'+abilityId});
 const used=itemId?activateImplantAbility(nextSource,itemId,abilityId):{...activateAbility(nextSource,abilityId,{rollSkill,modifier}),currency:'mana'};
 const success=!used.check||['success','critical-success'].includes(used.check.outcome);
 if(success&&source===target)nextSource.avallon.statuses=projected.avallon.statuses;
 return {source:nextSource,target:source===target?nextSource:success?projected:target,status:success?status:null,used,success};
}
