import {formDialog} from './characterTools.js';
import {useArtifact} from '../artifactRules.js';
import {showArtifactMenu} from './artifactMenu.js';
export function installArtifactTools(host){
 let busy=false;
 document.addEventListener('click',event=>{
  const direct=event.target.closest?.('[data-artifact-action]'),card=event.target.closest?.('[data-artifact-open]');
  const node=direct||(!event.target.closest?.('button,input,select,textarea,a,label,summary')?card:null);if(!node||node.disabled||busy)return;
  busy=true;
  (async()=>{
   const token=host.getToken();if(!token||!host.canControl(token))throw Error('You cannot control this character.');
   const id=node.dataset.id||node.dataset.artifactOpen;let action=node.dataset.artifactAction||'menu';
   const tracker=host.tracker(token),item=tracker.avallon.inventory.items.find(i=>i.id===id&&i.kind==='artifact');if(!item)throw Error('Artifact no longer exists.');
   if(action==='menu'){
    const choice=await showArtifactMenu(item,tracker.avallon.effects);if(!choice)return;
    if(host.getToken()?.id!==token.id||!host.canControl(host.getToken(token.id)))throw Error('Selected character changed. Open the artifact again.');
    if(choice==='equip')action='equip';else{
     const current=host.tracker(host.getToken(token.id)).avallon.inventory.items.find(i=>i.id===id),ability=current?.abilities.find(a=>a.id===choice.slice(8));
     if(!current?.equippedPart||!ability)throw Error('Artifact ability is unavailable.');const original=item.abilities.find(a=>a.id===ability.id);if(!original||original.cost!==ability.cost||original.kind!==ability.kind||original.level!==ability.level)throw Error('Artifact ability changed. Open the menu again.');
     if(ability.kind==='attack'){host.prepareAbility(token.id,'implant:'+id+':'+ability.id);host.status('Ability selected in Attack.','success');return;}
     const used=await host.useAbility(token.id,id,ability.id);if(!used)return;host.status(used.summary,used.check&&!['success','critical-success'].includes(used.check.outcome)?'error':'success');return;
    }
   }
   let part='';
   if(action==='use'&&item.artifactEffect==='heal'){
    const choice=await formDialog('Use '+item.name,[{name:'part',label:'Body part',options:Object.entries(tracker.body).filter(([,p])=>host.getRole()==='GM'||!p.hidden).map(([key,p])=>[key,p.label||key])}],{submitLabel:'Use charges'});if(!choice)return;part=choice.part;
   }
   await host.update(token.id,current=>{
    if(!host.canControl(host.getToken(token.id)))throw Error('Character unavailable.');
    const next=structuredClone(current),i=next.avallon.inventory.items.find(i=>i.id===id&&i.kind==='artifact');if(!i||i.quantity<1)throw Error('Artifact unavailable.');
    if(action==='equip')i.equippedPart='artifact';
    else if(action==='unequip'){i.equippedPart='';next.avallon.effects=next.avallon.effects.filter(e=>e.sourceItemId!==id);}
    else if(action==='use')useArtifact(next,id,part);
    return next;
   });host.status(action==='use'?'Artifact used; charges spent.':'Artifact updated.','success');
  })().catch(e=>host.status(e.message,'error')).finally(()=>{busy=false;host.render();});
 });
}
