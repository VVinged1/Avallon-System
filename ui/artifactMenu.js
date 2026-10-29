import {esc} from './characterView.js';
export const artifactActionLabel=kind=>({mana:'Restore mana',heal:'Heal body HP',bonus:'Activate bonuses',attack:'Attack',check:'Skill check',utility:'Use property'})[kind]||kind;
export function artifactActions(item,effects=[]){
 const rows=[];
 for(const a of item.abilities||[])if(['check','bonus','attack','utility','mana','heal'].includes(a.kind))rows.push({id:a.id,kind:a.kind,name:a.name,cost:a.cost||0,level:a.level||0,active:a.kind==='bonus'&&effects.some(e=>e.id==='implant-effect:'+item.id+':'+a.id)});
 return rows;
}
export function showArtifactMenu(item,effects){
 const rows=artifactActions(item,effects),dialog=document.createElement('dialog');dialog.className='od-dialog od-artifact-menu';
 dialog.innerHTML='<div class="cp-row"><h2>'+esc(item.name)+'</h2><button type="button" data-menu-close aria-label="Close artifact menu">×</button></div><p>'+item.charges+' / '+item.chargeMax+' charges</p>'+(!item.equippedPart?'<p>Equip this artifact to use its actions.</p><button type="button" data-menu-choice="equip">Equip</button>':'')+'<div class="od-artifact-actions">'+rows.map(a=>'<button type="button" class="cp-skill-card od-artifact-option" data-menu-choice="'+esc('ability:'+a.id)+'" '+(!item.equippedPart||item.quantity<1||item.charges<a.cost||a.active?'disabled':'')+'><span><b>'+esc(a.name)+'</b><small>'+esc(artifactActionLabel(a.kind))+(a.level!=null?' · '+a.level+'/10':'')+(a.active?' · active':'')+'</small></span><span class="cp-pill">'+a.cost+' charges</span></button>').join('')+(rows.length?'':'<p>No active actions. Passive properties work while equipped.</p>')+'</div>';
 document.body.append(dialog);dialog.showModal();
 return new Promise(resolve=>{let done=false;const finish=value=>{if(done)return;done=true;dialog.close();dialog.remove();resolve(value);};dialog.querySelector('[data-menu-close]').onclick=()=>finish(null);dialog.addEventListener('cancel',e=>{e.preventDefault();finish(null);});dialog.addEventListener('click',e=>{const node=e.target.closest('[data-menu-choice]');if(node&&!node.disabled)finish(node.dataset.menuChoice);});});
}
