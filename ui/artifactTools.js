import {formDialog} from './characterTools.js';
import {useArtifact} from '../artifactRules.js';
export function installArtifactTools(host){
 let busy=false;
 document.addEventListener('click',event=>{
  const node=event.target.closest?.('[data-artifact-action]');if(!node||node.disabled||busy)return;
  busy=true;
  (async()=>{
   const token=host.getToken();if(!token||!host.canControl(token))throw Error('You cannot control this character.');
   const id=node.dataset.id,action=node.dataset.artifactAction;
   const tracker=host.tracker(token),item=tracker.avallon.inventory.items.find(i=>i.id===id&&i.kind==='artifact');if(!item)throw Error('Artifact no longer exists.');
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
