import {manaStatus} from '../magicRules.js';
import {abilityRows,manaRow} from './magicTools.js';
import {skillCap} from '../avallonConfig.js';
import {groupNamedItems} from '../itemGroups.js';
import {activeImplantAbilities} from '../implantAbilities.js';
import {descriptionButton} from './descriptions.js';
import {weaponCategoryLabel,RANGE_BANDS} from '../rangeRules.js';
import { ARMOR_TRAINING, equipmentFits } from '../characterRules.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export {esc};
const bonusText=b=>[...Object.entries(b?.attributes||{}),...Object.entries(b?.skills||{}),...RANGE_BANDS.filter(([key])=>b?.rangeReduction?.[key]).map(([key,label])=>[label.split(' · ')[0]+' relief',b.rangeReduction[key]])].map(([k,v])=>`${k} ${v>0?'+':''}${v}`).join(' · ');
export function attributeCards(o,fields,editable) {
  return `<div class="cp-screen"><div class="cp-row cp-roll-options"><label>Roll modifier <input type="number" value="0" data-profile-modifier="attribute" aria-label="Characteristic roll modifier"></label></div><div class="cp-attrs">${fields.map(([k,label])=>{const delta=o.modifiers?.attributes?.[k]||0;return `<div class="cp-attr-wrap"><button type="button" class="cp-attr" data-action="profile-roll-char" data-attribute="${esc(k)}" aria-label="Roll ${esc(label)}"><span class="cp-attr-val">${o.attributes[k]??0}</span><span class="cp-attr-code">${esc(label)}</span>${delta?`<span class="cp-mod ${delta>0?'good':'bad'}">${delta>0?'+':''}${delta}</span>`:''}</button>${editable?`<label class="cp-edit-value">Base <input type="number" min="0" max="15" value="${o.baseAttributes?.[k]??o.attributes[k]??0}" data-action="set-avallon-attribute" data-attribute="${esc(k)}" aria-label="Edit ${esc(label)}"></label>`:''}</div>`;}).join('')}</div></div>`;
}
export function skillCards(o,groups,editable) {
 const passives=Object.entries(ARMOR_TRAINING).filter(([k])=>Object.hasOwn(o.skills,k)&&(editable||o.skills[k]===1));
 const skillRow=([k,value])=>{const name=o.skillLabels[k]||k,perks=o.skillPerks[k]||[],mod=o.modifiers?.skills?.[k]||0;
  const relief=RANGE_BANDS.filter(([band])=>o.skillRangeReduction?.[k]?.[band]).map(([band,label])=>'<span class="cp-pill">'+esc(label.split(' · ')[0])+' relief '+o.skillRangeReduction[k][band]+'</span>').join('');
  return '<div class="cp-skill-wrap"><div class="cp-skill-row"><button class="cp-card cp-skill-card" type="button" data-action="profile-roll-skill" data-skill="'+esc(k)+'" aria-label="Roll '+esc(name)+'"><span><b>'+esc(name)+'</b>'+(o.skillStrengthBonuses[k]?'<span class="cp-pill">STR</span>':'')+relief+'</span><span class="cp-skill-level"><span class="cp-pips">'+Array.from({length:skillCap(o.skillCategories[k])},(_,i)=>'<i class="cp-pip '+(i<value?'on':'')+'"></i>').join('')+'</span><strong>'+value+'/'+skillCap(o.skillCategories[k])+'</strong>'+(mod?'<span class="cp-mod '+(mod>0?'good':'bad')+'">'+(mod>0?'+':'')+mod+'</span>':'')+'</span></button>'+descriptionButton(name,o.skillDescriptions?.[k])+(editable&&!o.grantedSkills?.[k]?'<button type="button" class="cp-pencil" data-od-action="edit-skill" data-skill="'+esc(k)+'" aria-label="Edit '+esc(name)+'">✎</button>':'')+'</div>'+(perks.length?'<div class="cp-perks cp-perk-descriptions">'+perks.map(p=>'<span class="cp-pill">'+esc(p)+descriptionButton(p,o.skillPerkDescriptions?.[k]?.[p])+'</span>').join('')+'</div>':'')+'</div>';
 };
 return '<div class="cp-screen"><div class="cp-row cp-roll-options"><label>Roll modifier <input type="number" value="0" data-profile-modifier="skill" aria-label="Skill roll modifier"></label><button type="button" class="secondary" data-action="profile-random-skill">d100 vs d100</button>'+(editable?'<button type="button" class="secondary" data-od-action="add-skill">+ Skill</button>':'')+(editable?'<button type="button" data-magic-action="add">+ Ability</button>':'')+'</div>'+manaRow(o,editable)+groups.filter(([,entries])=>entries.length).map(([label,entries])=>'<div class="cp-section-title">'+esc(label)+'</div><div class="cp-list">'+entries.map(skillRow).join('')+'</div>').join('')+abilityRows(o,editable)+prosthesisAbilityRows(o)+(passives.length?'<div class="cp-passives cp-row"><span class="cp-muted">Armor training</span>'+passives.map(([k,label])=>'<span class="cp-pill">'+esc(label)+' '+o.skills[k]+'</span>').join('')+(editable?'<button type="button" class="cp-pencil" data-od-action="edit-training" aria-label="Edit armor training">✎</button>':'')+'</div>':'')+'</div>';
}
export function effectChips(o,gm) {
  const rows=o.effectRows||[];
  return `<div class="cp-row cp-effects">${rows.map(e=>`<span class="cp-effect" title="${esc(bonusText(e.bonuses))}"><b>${esc(e.name)}</b> ${esc(bonusText(e.bonuses))}${gm&&!e.passive?`<button type="button" data-od-action="remove-effect" data-id="${esc(e.id)}" aria-label="Remove ${esc(e.name)}">×</button>`:''}</span>`).join('')}${o.armorSummary?.total?`<span class="cp-pill">${esc(o.armorSummary.name)} · ${o.armorSummary.total} · ${o.armorSummary.trained?'trained':'untrained'}</span>`:''}</div>`;
}
export function inventoryView(tracker,gm) {
  const o=tracker.avallon,inv=o.inventory;
  const edit=(type,id)=>gm?`<button type="button" class="cp-pencil" data-od-action="edit-entry" data-entry-type="${type}" data-id="${esc(id)}" aria-label="Edit item">✎</button><button type="button" class="danger cp-pencil" data-od-action="delete-entry" data-entry-type="${type}" data-id="${esc(id)}" aria-label="Remove item">×</button>`:'';
  const renderItem=i=>{
    const equipment=['armor','shield','prosthesis'].includes(i.kind),broken=i.kind!=='prosthesis'&&i.criticalMax>0&&i.criticalDamage>=i.criticalMax;
    const usable=['consumable','medical'].includes(i.kind),subtype=i.kind==='medical'?'medkit':i.subtype;
    let controls='';
    if(i.kind==='artifact'){
      controls=(i.artifactEffect==='property'&&!(i.abilities||[]).some(a=>a.kind&&a.kind!=='skill')?'<span class="cp-pill">Passive property</span>':'<span class="cp-pill">Charges '+i.charges+'/'+i.chargeMax+'</span>')+'<button type="button" data-artifact-action="'+(i.equippedPart?'unequip':'equip')+'" data-id="'+esc(i.id)+'">'+(i.equippedPart?'Unequip':'Equip')+'</button>';
    }else if(equipment) {
      const label=i.equippedPart?'<span class="cp-muted">'+esc(tracker.body[i.equippedPart]?.label||i.equippedPart)+'</span>':'';
      if(!gm&&i.kind==='prosthesis'&&!i.playerRemovable)controls=label+'<span class="cp-pill">GM installation / removal only</span>';
      else if(i.equippedPart)controls=label+'<button type="button" data-od-action="unequip" data-id="'+esc(i.id)+'">Unequip</button>';
      else {
        const options=Object.entries(tracker.body).filter(([key,p])=>(gm||!p.hidden)&&equipmentFits(i,key,p)&&(i.kind==='prosthesis'||!inv.items.some(other=>['armor','shield'].includes(other.kind)&&other.equippedPart===key)));
        controls='<label>Slot <select data-equip-part="'+esc(i.id)+'">'+options.map(([key,p])=>'<option value="'+esc(key)+'">'+esc(p.label||key)+'</option>').join('')+'</select></label><button type="button" data-od-action="equip" data-id="'+esc(i.id)+'" '+(!i.quantity||!options.length?'disabled':'')+'>Equip</button>';
      }
    }else if(usable)controls='<button type="button" data-od-action="use-item" data-id="'+esc(i.id)+'" '+(!i.quantity||subtype==='grenade'?'disabled':'')+'>'+(subtype==='grenade'?'Grenade · placeholder':'Use…')+'</button>';
    return '<article class="cp-card"'+(i.kind==='artifact'?' data-artifact-open="'+esc(i.id)+'"':'')+'><div class="cp-row">'+(i.kind==='artifact'?'<button type="button" class="cp-item-open cp-skill-card" data-artifact-action="menu" data-id="'+esc(i.id)+'" aria-label="Open '+esc(i.name)+' actions"><b>'+esc(i.name)+'</b></button>':'<b>'+esc(i.name)+'</b>')+'<span class="cp-pill">'+esc(usable?subtype:i.kind)+'</span><span class="cp-pill">×'+i.quantity+'</span>'+(i.armor?'<span class="cp-pill">Armor '+i.armor+'</span>':'')+(i.kind==='prosthesis'&&i.criticalMax?'<span class="cp-pill">Body HP +'+i.criticalMax+'</span>':i.criticalMax?'<span class="cp-pill '+(broken?'bad':'')+'">Durability '+(i.criticalMax-i.criticalDamage)+'/'+i.criticalMax+'</span>':'')+(usable&&i.useSkill?'<span class="cp-pill">Use: '+esc(i.useSkill)+'</span>':'')+descriptionButton(i.name,i.description)+edit('item',i.id)+'</div>'+(bonusText(i.bonuses)?'<p class="cp-muted">'+esc(bonusText(i.bonuses))+'</p>':'')+'<div class="cp-row">'+controls+'</div></article>';

  };
  const equippedItems=inv.items.filter(i=>i.equippedPart).map(renderItem).join('');
  const items=groupNamedItems(inv.items.filter(i=>!i.equippedPart)).map(rows=>rows.length===1?renderItem(rows[0]):'<details class="cp-card od-named-group"><summary>'+esc(rows[0].name)+' · ×'+rows.reduce((sum,i)=>sum+i.quantity,0)+' · '+rows.length+' variants</summary>'+rows.map(renderItem).join('')+'</details>').join('');
  const ammo=o.ammunition.map(a=>`<article class="cp-card cp-row"><b>${esc(a.name)}</b><span class="cp-pill">Ammo ×${a.quantity}</span><span class="cp-muted">DMG ${a.damage} · AP ${a.penetration}</span>${descriptionButton(a.name,a.description)}${edit('ammo',a.id)}</article>`).join('');
  const mags='';
  const weapons=['melee','ranged'].flatMap(kind=>o.weapons[kind].map((w,index)=>{
    let controls='';
    if(gm&&kind==='ranged') {
      controls='<div class="cp-row"><label>Ammo<select data-reload-kind="'+index+'">'+o.ammunition.filter(a=>w.ammoIds.includes(a.id)).map(a=>'<option value="'+esc(a.id)+'" '+(a.id===w.loadedAmmoId?'selected':'')+'>'+esc(a.name)+' ('+a.quantity+')</option>').join('')+'</select></label><button type="button" data-od-action="reload-weapon" data-index="'+index+'">Reload</button></div>';
    }
    return '<article class="cp-card"><div class="cp-row"><b>'+esc(w.name)+'</b><span class="cp-pill">'+esc(kind==='ranged'?weaponCategoryLabel(w.weaponCategory):kind)+'</span><span class="cp-muted">ACC '+w.accuracy+(kind==='melee'?' · DMG '+w.damage:' · '+'Capacity '+w.loaded+'/'+w.capacity)+'</span>'+(Object.keys(w.rangeReduction||{}).length?'<span class="cp-muted">'+esc(bonusText({rangeReduction:w.rangeReduction}))+'</span>':'')+descriptionButton(w.name,w.description)+edit('weapon-'+kind,w.id||String(index))+'</div>'+controls+'</article>';
  }));
  const group=(label,html)=>html?`<div class="cp-section-title">${label}</div><div class="cp-list">${html}</div>`:'';
  return `<div class="cp-screen">${gm?'<div class="cp-row"><button type="button" data-od-action="add-item">+ Item</button><button type="button" data-od-action="open-item-pool">Campaign item pool</button></div>':''}${group('Equipped',equippedItems)}${group('Items',items)}${group('Weapons',weapons.join(''))}${group('Ammunition',ammo)}${!equippedItems&&!items&&!ammo&&!mags&&!weapons.length?'<p class="cp-muted">Inventory is empty.</p>':''}</div>`;
}

export function templatesView(library, gm) {
  if(!gm)return "";
  return `<div class="cp-screen cp-templates"><div class="cp-section-title">Character Templates</div><p class="cp-muted">Templates are saved in this browser. Export JSON for backup, or save a library scene to your Owlbear account. Account save opens the Assets folder picker; it creates a snapshot.</p><div class="cp-row"><button type="button" data-od-action="save-template">Save character as template</button><button type="button" data-od-action="export-library">Export JSON</button><button type="button" data-od-action="import-library">Import JSON</button><button type="button" data-od-action="account-save">Save to account</button><button type="button" data-od-action="account-load">Load from account</button></div><div class="cp-list">${library.templates.map(t=>`<article class="cp-card cp-row"><b>${esc(t.name)}</b>${gm?`<button type="button" data-od-action="apply-template" data-id="${esc(t.id)}">Apply to token…</button>`:''}<button type="button" class="secondary" data-od-action="rename-template" data-id="${esc(t.id)}">Rename</button><button type="button" class="secondary" data-od-action="duplicate-template" data-id="${esc(t.id)}">Duplicate</button><button type="button" class="danger" data-od-action="delete-template" data-id="${esc(t.id)}">Remove</button></article>`).join('')||'<p class="cp-muted">No templates saved.</p>'}</div></div>`;
}

function prosthesisAbilityRows(o){
  const rows=activeImplantAbilities(o),mana=manaStatus(o);if(!rows.length)return '';
  return '<div class="cp-section-title">Item abilities</div>'+rows.map(({item,ability,key})=>{
    const artifact=item.kind==='artifact',currency=artifact?'charges':'mana',cost=ability.cost||0,available=artifact?item.charges:mana.current,max=artifact?item.chargeMax:mana.max,active=ability.kind==='bonus'&&(o.effects||[]).some(e=>e.id==='implant-effect:'+item.id+':'+ability.id);
    const action=ability.kind==='attack'?'implant-attack':'activate-implant';
    return '<div class="cp-skill-row"><button type="button" class="cp-card cp-skill-card od-ability-card" data-od-action="'+action+'" data-id="'+esc(item.id)+'" data-ability-id="'+esc(ability.id)+'" data-key="'+esc(key)+'" '+(available<cost||active?'disabled':'')+'><span class="od-ability-caption"><span><b>'+esc(ability.name)+'</b><small class="od-ability-level">Lvl '+(ability.level||0)+'</small></span><small class="cp-muted">'+esc(item.name)+(ability.kind==='attack'?' · DMG '+ability.damage:'')+(active?' · active':'')+'</small></span><span class="od-ability-resources"><span class="cp-pill" data-ability-pool>'+(artifact?'Charges ':'Mana ')+available+'/'+max+'</span><small data-ability-cost>Cost '+cost+' '+currency+'</small></span></button>'+descriptionButton(ability.name,ability.description)+'</div>';
  }).join('');
}
