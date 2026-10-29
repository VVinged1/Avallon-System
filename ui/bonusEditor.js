import {ATTRIBUTES,normalizeBonuses} from '../characterRules.js';
import {SKILL_CATEGORIES} from '../avallonConfig.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const find=(skills,name)=>skills.find(([key,label])=>[key,label].some(v=>String(v).trim().toLocaleLowerCase()===String(name).trim().toLocaleLowerCase()));
const names=prefix=>prefix==='ability'?['abilityAttr:','abilitySkill:','abilityCategory:']:prefix==='active'?['activeAttr:','activeSkill:','activeCategory:']:['attr:','skill:','skillCategory:'];
export function compactBonusEditor(value={},skills=[],{prefix='',label='Passive bonuses',allowSkills=true}={}){
 return '<fieldset class="od-bonuses od-compact-bonuses" data-bonus-editor="'+esc(prefix)+'" data-allow-skills="'+allowSkills+'"><legend>'+esc(label)+'</legend>'+contents(value,skills,prefix,allowSkills)+'</fieldset>';
}
function contents(value,skills,prefix,allowSkills){
 const [attrName,skillName,categoryName]=names(prefix),b=normalizeBonuses(value);
 const rows=[...Object.entries(b.attributes).map(([key,v])=>['attribute',key,v]),...Object.entries(b.skills).map(([key,v])=>['skill',key,v])];
 const assigned=new Set(rows.map(([type,key])=>(type==='attribute'?'a:':'s:')+key));
 const options=(type,entries)=>entries.filter(([k])=>!assigned.has(type+':'+k)).map(([k,label])=>'<option value="'+esc(type+':'+k)+'">'+esc(label)+'</option>').join('');
 const categories=SKILL_CATEGORIES.map(([k,label])=>'<option value="'+k+'" '+(k==='applied'?'selected':'')+'>'+esc(label)+'</option>').join('');
 return '<div class="od-bonus-assigned">'+rows.map(([type,key,v])=>{
  const own=type==='skill'?find(skills,key):null,label=own?.[1]||key,category=own?.[2]||b.skillCategories?.[key]||'applied';
  return '<div class="od-compact-bonus-row" data-bonus-row data-type="'+type+'" data-key="'+esc(key)+'"><span class="od-bonus-label"><b>'+esc(label)+'</b><small>'+esc(type==='attribute'?'Characteristic':SKILL_CATEGORIES.find(([k])=>k===category)?.[1]||'Skill')+'</small></span><input type="number" name="'+esc((type==='attribute'?attrName:skillName)+key)+'" value="'+v+'" min="-999" max="999" step="1" aria-label="'+esc(label)+' bonus">'+(type==='skill'?'<input type="hidden" name="'+esc(categoryName+key)+'" value="'+esc(category)+'">':'')+'<button type="button" data-bonus-remove title="Remove bonus" aria-label="Remove '+esc(label)+' bonus">×</button></div>';
 }).join('')+'</div><div class="od-compact-bonus-picker"><label>Characteristic'+(allowSkills?' / skill':'')+'<select data-bonus-choice><option value="">Choose bonus</option><optgroup label="Characteristics">'+options('a',ATTRIBUTES.map(k=>[k,k]))+'</optgroup>'+(allowSkills?'<optgroup label="Skills">'+options('s',skills)+'</optgroup>':'')+'</select></label><label>Bonus<input data-bonus-value type="number" value="1" min="-999" max="999" step="1"></label><button type="button" data-bonus-add title="Add selected bonus" aria-label="Add selected bonus">+</button></div>'+(allowSkills?'<details class="od-new-bonus-skill"><summary>New skill</summary><div class="od-bonus-new-fields"><label>New skill name<input data-new-bonus-name maxlength="40"></label><label>Bonus<input data-new-bonus-value type="number" value="1" min="-999" max="999" step="1"></label><label data-new-bonus-category>Category<select>'+categories+'</select></label><button type="button" data-bonus-new title="Add new skill bonus" aria-label="Add new skill bonus">+</button></div></details>':'');
}
export function readCompactBonuses(root){
 const value={attributes:{},skills:{},skillCategories:{}};
 for(const row of root?.querySelectorAll('[data-bonus-row]')||[]){const key=row.dataset.key,n=Number(row.querySelector('[type="number"]').value)||0;if(n)value[row.dataset.type==='attribute'?'attributes':'skills'][key]=n;const category=row.querySelector('[type="hidden"]')?.value;if(category)value.skillCategories[key]=category;}
 return normalizeBonuses(value);
}
export function installBonusEditors(dialog,skills){
 dialog.addEventListener('input',e=>{const root=e.target.closest('[data-bonus-editor]');if(!root||!e.target.matches('[data-new-bonus-name]'))return;root.querySelector('[data-new-bonus-category]').hidden=!!find(skills,e.target.value);});
 dialog.addEventListener('click',e=>{
  const button=e.target.closest('[data-bonus-add],[data-bonus-new],[data-bonus-remove]'),root=button?.closest('[data-bonus-editor]');if(!root)return;e.preventDefault();
  const b=readCompactBonuses(root);let key,type,n;
  if(button.hasAttribute('data-bonus-remove')){const row=button.closest('[data-bonus-row]');delete b[row.dataset.type==='attribute'?'attributes':'skills'][row.dataset.key];delete b.skillCategories?.[row.dataset.key];}
  else if(button.hasAttribute('data-bonus-add')){const value=root.querySelector('[data-bonus-choice]').value;if(!value)return;type=value[0];key=value.slice(2);n=Number(root.querySelector('[data-bonus-value]').value)||0;if(!n)return;b[type==='a'?'attributes':'skills'][key]=n;if(type==='s'){b.skillCategories??={};b.skillCategories[key]=find(skills,key)?.[2]||'applied';}}
  else{const input=root.querySelector('[data-new-bonus-name]'),name=input.value.trim();if(!name||['__proto__','constructor','prototype'].includes(name)){input.setCustomValidity('Enter a skill name (1–40 characters).');input.reportValidity();input.oninput=()=>input.setCustomValidity('');return;}const own=find(skills,name);key=own?.[0]||name;n=Number(root.querySelector('[data-new-bonus-value]').value)||0;if(!n)return;b.skills[key]=n;b.skillCategories??={};b.skillCategories[key]=own?.[2]||root.querySelector('[data-new-bonus-category] select').value;}
  const prefix=root.dataset.bonusEditor,legend=root.querySelector('legend').outerHTML;root.innerHTML=legend+contents(b,skills,prefix,root.dataset.allowSkills==='true');
 });
}
