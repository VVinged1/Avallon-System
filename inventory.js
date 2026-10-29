import {normalizeArtifact} from './artifactRules.js';
import {mergeInventoryStacks} from './itemGroups.js';
import {normalizeWeaponCategory,normalizeRangeReduction} from './rangeRules.js';
import { normalizeBonuses, reconcileEquipment, equipmentFits } from "./characterRules.js";
// Token-owned inventory. Ranged weapons keep ammunition in internal capacity.
const LIMIT = 2000;
const int = (v, max = 999999) => Math.min(max, Math.max(0, Math.floor(Number(v) || 0)));
const text = (v, max = 120) => String(v ?? '').trim().slice(0, max);
const kinds = new Set(['item', 'consumable', 'medical', 'tool', 'resource', 'armor', 'shield', 'prosthesis', 'artifact']);
export function newId() { return globalThis.crypto.randomUUID(); }
function rows(raw, map) {
  const seen = new Set();
  return (Array.isArray(raw) ? raw : []).slice(0, LIMIT).filter(r => r && typeof r === 'object').map(map)
    .filter(r => r.id && !seen.has(r.id) && seen.add(r.id));
}
export function normalizeInventory(raw, weapons = [], preferredId='',skillLabels={}) {
  const items = rows(raw?.items, (input, i) => { const r={...input,kind:input.kind==='implant'?'prosthesis':input.kind}; return ({
    id: text(r.id || `legacy-item-${i}`), name: text(r.name) || 'Item',
    kind: kinds.has(r.kind) ? r.kind : 'item', quantity: int(r.quantity ?? 1),
    description: text(r.description, 2000), armor: int(r.armor, 999),
    subtype: ['grenade','medkit','repairkit','stim'].includes(r.subtype)?r.subtype:r.kind==='medical'?'medkit':'grenade',
    healCritical: int(r.healCritical ?? 1,999), useSkill:text(r.useSkill,80), slots:[...new Set((Array.isArray(r.slots)?r.slots:[r.slot||'any']).map(s=>text(s,40)).filter(Boolean))].slice(0,100), slot: text(r.slot||'any',40),
    criticalMax:int(r.criticalMax,999), criticalDamage:int(r.criticalDamage,int(r.criticalMax,999)),
    playerRemovable:r.playerRemovable===true, bonuses:normalizeBonuses(['resource','prosthesis'].includes(r.kind)?{...r.bonuses,rangeReduction:{}}:r.bonuses),
    abilities:(Array.isArray(r.abilities)?r.abilities:[]).slice(0,20).map((a,j)=>({id:text(a.id||'ability-'+j),name:text(a.name)||'Ability',level:int(a.level,10),cost:Math.round(Math.max(0,Math.min(999,Number(a.cost)||0))*2)/2,description:text(a.description,2000),...(a.kind&&a.kind!=='skill'?{kind:['bonus','attack'].includes(a.kind)?a.kind:'skill',bonuses:normalizeBonuses(a.bonuses),damage:int(a.damage,999),accuracy:Math.max(-999,Math.min(999,Number(a.accuracy)||0))}:{})})),
    ...(r.kind==='artifact'?normalizeArtifact(r):{}),
    legacyEquipment: r.legacyEquipment ?? (raw?.version<3 || !raw?.version),
    equippedPart: text(r.equippedPart, 40), previousArmor: int(r.previousArmor, 999),
  }); });
  // A worn unit owns its durability and bonuses independently of spare copies.
  for(const item of [...items])if(item.equippedPart&&['armor','shield','prosthesis'].includes(item.kind)&&item.quantity>1) {
    let id=(item.id.slice(0,90)+'-reserve'),suffix=1;while(items.some(i=>i.id===id))id=item.id.slice(0,90)+'-reserve-'+suffix++;
    items.push({...structuredClone(item),id,quantity:item.quantity-1,equippedPart:'',previousArmor:0,legacyEquipment:false});item.quantity=1;
  }
  items.splice(0,items.length,...mergeInventoryStacks(items,preferredId,skillLabels));
  // Detachable magazines are migrated once by shared.js; every weapon is internal.
  const magazines=[];
  for(const weapon of weapons){weapon.acceptsMagazines=false;weapon.acceptedMagazineIds=[];weapon.magazineId='';}
  // Each artifact has an independent charge pool, including spare copies.
  for(const item of [...items])if(item.kind==='artifact'&&item.quantity>1){
    const quantity=item.quantity;if(quantity>1000||items.length+quantity-1>2000)throw Error('Too many artifact instances.');
    item.quantity=1;for(let i=1;i<quantity;i++){let id=item.id.slice(0,90)+'-artifact-'+i;while(items.some(x=>x.id===id))id+='x';items.push({...structuredClone(item),id,equippedPart:''});}
  }
  return {version:5,items,magazines,armorHp:Object.fromEntries(Object.entries(raw?.armorHp||{}).filter(([k])=>!['__proto__','constructor','prototype'].includes(k)).map(([k,v])=>[text(k,40),{max:int(v?.max,99999),remaining:int(v?.remaining,99999)}])),baseMax:Object.fromEntries(Object.entries(raw?.baseMax||{}).filter(([k])=>!['__proto__','constructor','prototype'].includes(k)).map(([k,v])=>[text(k,40),int(v,99999)])),baseArmor:Object.fromEntries(Object.entries(raw?.baseArmor||{}).filter(([k])=>!['__proto__','constructor','prototype'].includes(k)).map(([k,v])=>[text(k,40),int(v,999)]))};
}
export function equipItem(tracker,id,partName,gm=true) {
  const item=tracker.avallon.inventory.items.find(i=>i.id===id);
  if(!item||!['armor','shield','prosthesis'].includes(item.kind))throw new Error('Choose equipment.');
  if(item.kind==='prosthesis'&&!gm&&!item.playerRemovable)throw new Error('Only the GM can equip this prosthesis.');
  if(item.quantity<1||item.equippedPart)throw new Error('Item is unavailable or already equipped.');
  const part=tracker.body[partName];if(!part)throw new Error('Body part no longer exists.');
  if(!equipmentFits(item,partName,part))throw new Error('This item does not fit the selected slot.');
  if(item.kind!=='prosthesis'&&tracker.avallon.inventory.items.some(i=>['armor','shield'].includes(i.kind)&&i.equippedPart===partName))throw new Error('Armor is already equipped on this part.');
  if(item.quantity>1) {
    if(tracker.avallon.inventory.items.length>=1000)throw new Error('Inventory is full.');
    tracker.avallon.inventory.items.push({...structuredClone(item),id:newId(),quantity:item.quantity-1,equippedPart:'',previousArmor:0,legacyEquipment:false});item.quantity=1;
  }
  tracker.avallon.inventory.baseArmor??={};
  if(!Object.hasOwn(tracker.avallon.inventory.baseArmor,partName))tracker.avallon.inventory.baseArmor[partName]=part.armor;
  item.equippedPart=partName;item.legacyEquipment=false;reconcileEquipment(tracker);
}
export function unequipItem(tracker,id,gm=true) {
  const item=tracker.avallon.inventory.items.find(i=>i.id===id);if(!item)throw new Error('Item no longer exists.');
  if(item.kind==='prosthesis'&&!gm&&!item.playerRemovable)throw new Error('Only the GM can remove this prosthesis.');
  const part=tracker.body[item.equippedPart],inv=tracker.avallon.inventory;
  if(part&&Object.hasOwn(inv.baseArmor||{},item.equippedPart)) {
    const expected=inv.baseArmor[item.equippedPart]+inv.items.filter(i=>i.equippedPart===item.equippedPart&&['armor','shield','prosthesis'].includes(i.kind)&&i.quantity>0&&(i.kind==='prosthesis'||!i.criticalMax||i.criticalDamage<i.criticalMax)).reduce((sum,i)=>sum+i.armor,0);
    if(part.armor!==expected)inv.baseArmor[item.equippedPart]=part.armor;
  }
  item.equippedPart='';tracker.avallon.effects=(tracker.avallon.effects||[]).filter(e=>e.sourceItemId!==id);reconcileEquipment(tracker);
}
export function consumeItem(tracker, id) {
  const item = tracker.avallon.inventory.items.find(i => i.id === id);
  if (!item || !['consumable','medical','resource'].includes(item.kind) || item.quantity < 1) throw new Error('No usable item available.');
  item.quantity -= 1; // No new automatic healing or combat rules.
}
export function inventoryAmmoTotal(avallon) {
  return avallon.weapons.ranged.filter(w=>w.acceptsMagazines===false).reduce((sum,w)=>sum+w.loaded,0)+avallon.ammunition.reduce((n,a) => n + a.quantity, 0) + avallon.inventory.magazines.reduce((n,m) => n + m.loaded, 0);
}

// Typed editor saves through existing V1 weapon/ammo collections; no duplicate inventory.
export function findInventoryEntry(tracker,type,id) {
  const o=tracker.avallon;
  if(type==='ammo')return o.ammunition.find(a=>a.id===id);
  if(type==='magazine')return o.inventory.magazines.find(m=>m.id===id);
  if(type?.startsWith('weapon-'))return o.weapons[type.slice(7)]?.find((w,index)=>(w.id||String(index))===id);
  return o.inventory.items.find(i=>i.id===id);
}
export function deleteInventoryEntry(tracker,type,id) {
  const o=tracker.avallon;
  if(type==='ammo') {
    if(o.inventory.magazines.some(m=>m.loadedAmmoId===id&&m.loaded)||o.weapons.ranged.some(w=>w.acceptsMagazines===false&&w.loadedAmmoId===id&&w.loaded))throw new Error('Unload weapons using this ammunition first.');
    o.ammunition=o.ammunition.filter(a=>a.id!==id);for(const w of o.weapons.ranged)w.ammoIds=w.ammoIds.filter(a=>a!==id);return;
  }
  if(type?.startsWith('weapon-')) {
    const kind=type.slice(7),index=o.weapons[kind].findIndex((w,j)=>(w.id||String(j))===id);
    if(index<0)throw new Error('Weapon no longer exists.');if(kind==='ranged'){const w=o.weapons.ranged[index];if(w.acceptsMagazines===false&&w.loaded){const a=o.ammunition.find(a=>a.id===w.loadedAmmoId);if(!a||a.quantity+w.loaded>999999)throw new Error('Cannot return loaded ammunition to reserve.');a.quantity+=w.loaded;}}o.weapons[kind].splice(index,1);return;
  }
  const item=o.inventory.items.find(i=>i.id===id);if(!item)throw new Error('Item no longer exists.');if(item.equippedPart)unequipItem(tracker,id,true);o.inventory.items=o.inventory.items.filter(i=>i.id!==id);
}
export function saveInventoryEntry(tracker,origin,values,id) {
  const o=tracker.avallon,existing=origin?findInventoryEntry(tracker,origin.type,origin.id):null;
  if(origin&&!existing)throw new Error('Item no longer exists.');
  const kind=values.kind,weaponKind=values.weaponKind==='ranged'?'ranged':'melee';
  const dest=kind==='weapon'?'weapon-'+weaponKind:kind==='ammo'?'ammo':kind==='magazine'?'magazine':'item';
  if(origin&&origin.type!==dest)deleteInventoryEntry(tracker,origin.type,origin.id);
  const same=origin?.type===dest?existing:null;
  if(kind==='ammo') {
    const row={id,name:values.name,description:text(values.description,2000),damage:Number(values.damage)||0,penetration:Number(values.penetration)||0,quantity:Number(values.quantity)||0};
    if(same)Object.assign(same,row);else {if(o.ammunition.length>=200)throw new Error('Too many ammo types.');o.ammunition.push(row);}return;
  }
  if(kind==='magazine')throw Error('Avallon uses internal weapon capacity.');
  if(kind==='weapon') {
    if([...o.weapons.melee,...o.weapons.ranged].some(w=>w!==same&&w.name===values.name))throw new Error('A weapon with this name already exists.');
    const row={id,name:values.name,description:text(values.description,2000),accuracy:Number(values.accuracy)||0,damage:Number(values.damage)||0};
    if(weaponKind==='ranged') {
      row.weaponCategory=normalizeWeaponCategory(values.weaponCategory);row.rangeReduction=normalizeRangeReduction(values.rangeReduction);
        const capacity=Number(values.capacity),ammoIds=values.ammoIds||[],loaded=Number(values.loaded??same?.loaded??0),loadedAmmoId=String(values.loadedAmmoId??same?.loadedAmmoId??'');
        if(!Number.isInteger(capacity)||capacity<1||capacity>999||!Number.isInteger(loaded)||loaded<0||loaded>capacity)throw new Error('Invalid internal capacity or loaded rounds.');
        if(loaded&&(!ammoIds.includes(loadedAmmoId)||!o.ammunition.some(a=>a.id===loadedAmmoId)))throw new Error('Choose compatible ammunition for loaded rounds.');
        Object.assign(row,{acceptsMagazines:false,acceptedMagazineIds:[],capacity,ammoIds,loaded,loadedAmmoId:loaded?loadedAmmoId:'',magazineId:''});
    }
    if(same)Object.assign(same,row);else{if(o.weapons[weaponKind].length>=20)throw new Error('Weapon limit is 20 per type.');o.weapons[weaponKind].push(row);}return;
  }
  if(same?.equippedPart&& !['armor','shield','prosthesis','artifact'].includes(kind))unequipItem(tracker,id,true);
  const row={...values,...(kind==='artifact'?normalizeArtifact(values):{}),id,quantity:Number(values.quantity)||0,armor:Number(values.armor)||0,healCritical:Number(values.healCritical)||0,criticalMax:Number(values.criticalMax)||0,criticalDamage:Number(values.criticalDamage)||0,playerRemovable:values.playerRemovable===true,legacyEquipment:false,equippedPart:same?.equippedPart||'',previousArmor:same?.previousArmor||0};
  if(!['armor','shield','prosthesis'].includes(kind)){row.armor=0;row.criticalMax=0;row.criticalDamage=0;}
  if(kind==='prosthesis')row.criticalDamage=0;
  if(row.equippedPart&&row.quantity>1&&o.inventory.items.length>=1000)throw new Error('Inventory is full; cannot separate equipped and spare items.');
  if(row.criticalDamage>row.criticalMax)throw new Error('Critical damage cannot exceed durability.');
  if(kind!=='artifact'&&same?.equippedPart&&!equipmentFits(row,same.equippedPart,tracker.body[same.equippedPart]))throw new Error('Unequip before changing the equipment slot.');
  if(same)Object.assign(same,row);else{if(o.inventory.items.length>=1000)throw new Error('Inventory limit is 1000 items.');o.inventory.items.push(row);}o.inventory=normalizeInventory(o.inventory,o.weapons.ranged,id,o.skillLabels);reconcileEquipment(tracker);
}
