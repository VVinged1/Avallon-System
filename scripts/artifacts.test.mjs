import assert from 'node:assert/strict';
import {rulesContext} from './rulesContext.mjs';
import {useArtifact} from '../artifactRules.js';
import {saveInventoryEntry,deleteInventoryEntry,equipItem} from '../inventory.js';
import {manaStatus,setMana} from '../magicRules.js';
import {effectiveAvallon} from '../characterRules.js';
import {captureBlueprint,copyBlueprint} from '../itemPool.js';
const {sanitize}=rulesContext(),blank=()=>sanitize({});
let t=blank();t.avallon.attributes.Magic=8;setMana(t.avallon,2);
const add=(id,extra={})=>saveInventoryEntry(t,null,{kind:'artifact',name:id,quantity:1,chargeMax:5,charges:4,chargeCost:2,artifactEffect:'mana',effectAmount:2.5,...extra},id);
add('wand',{quantity:3});assert.equal(t.avallon.inventory.items.length,3);assert(t.avallon.inventory.items.every(i=>i.quantity===1));
let wand=t.avallon.inventory.items.find(i=>i.id==='wand');assert.throws(()=>useArtifact(t,'wand'),/Equip/);wand.equippedPart='artifact';
useArtifact(t,'wand');assert.equal(manaStatus(t.avallon).current,4.5);assert.equal(wand.charges,2);assert.equal(t.avallon.inventory.items[1].charges,4);
t=sanitize(t);wand=t.avallon.inventory.items.find(i=>i.id==='wand');assert.equal(wand.charges,2);useArtifact(t,'wand');assert.equal(wand.charges,0);const before=JSON.stringify(t);assert.throws(()=>useArtifact(t,'wand'),/Not enough/);assert.equal(JSON.stringify(t),before);
// Editing/refilling an equipped artifact keeps its state and passive bonuses.
saveInventoryEntry(t,{type:'item',id:'wand'},{...wand,charges:5,bonuses:{attributes:{Agility:2}}},'wand');wand=t.avallon.inventory.items.find(i=>i.id==='wand');assert.equal(wand.equippedPart,'artifact');assert.equal(wand.charges,5);assert.equal(effectiveAvallon(t.avallon).attributes.Agility,10);
add('charm',{artifactEffect:'bonus',activeBonuses:{attributes:{Strength:3},skills:{Melee:1}}});const charm=t.avallon.inventory.items.find(i=>i.id==='charm');charm.equippedPart='artifact';useArtifact(t,'charm');assert.equal(effectiveAvallon(t.avallon).attributes.Strength,11);assert.equal(charm.charges,2);assert.throws(()=>useArtifact(t,'charm'),/already active/);assert.equal(charm.charges,2);
charm.equippedPart='';assert.equal(effectiveAvallon(t.avallon).attributes.Strength,8);
// Healing repairs body wounds, leaving equipped armor damage unchanged.
t=blank();saveInventoryEntry(t,null,{kind:'armor',name:'Armor',quantity:1,slots:['Torso'],armor:3,criticalMax:2,criticalDamage:1},'armor');equipItem(t,'armor','Torso');t.body.Torso.current--;add('healer',{artifactEffect:'heal',effectAmount:1,chargeCost:1});t.avallon.inventory.items.find(i=>i.id==='healer').equippedPart='artifact';const hp=t.body.Torso.current;useArtifact(t,'healer','Torso');assert.equal(t.body.Torso.current,hp+1);assert.equal(t.avallon.inventory.items.find(i=>i.id==='armor').criticalDamage,1);
const blueprint=captureBlueprint(t,'item','healer');assert.equal(blueprint.values.charges,5);const copy=blank();copyBlueprint(copy,blueprint,2,'copies');assert.equal(copy.avallon.inventory.items.length,2);assert(copy.avallon.inventory.items.every(i=>i.charges===5&&!i.equippedPart));assert.equal(sanitize(copy).avallon.inventory.items[0].artifactEffect,'heal');
// Legacy implant saves retain bonuses, durability and installation as prostheses.
const legacy=blank();legacy.avallon.inventory.items=[{id:'old',name:'Hand',kind:'implant',quantity:1,equippedPart:'L.Arm',criticalMax:2,bonuses:{attributes:{Strength:1}}}];const migrated=sanitize(legacy);assert.equal(migrated.avallon.inventory.items[0].kind,'prosthesis');assert.equal(effectiveAvallon(migrated.avallon).attributes.Strength,9);
// Mounted rounds stay in the weapon; spare magazines return to reserve once.
const ammo=blank();ammo.avallon.ammunition=[{id:'arrow',name:'Arrow',quantity:10,damage:5}];ammo.avallon.weapons.ranged=[{id:'bow',name:'Bow',capacity:6,loaded:3,loadedAmmoId:'arrow',ammoIds:['arrow'],magazineId:'mounted',acceptsMagazines:true}];ammo.avallon.inventory.magazines=[{id:'mounted',capacity:6,loaded:3,loadedAmmoId:'arrow'},{id:'spare',capacity:6,loaded:4,loadedAmmoId:'arrow'}];const internal=sanitize(ammo);assert.equal(internal.avallon.weapons.ranged[0].loaded,3);assert.equal(internal.avallon.weapons.ranged[0].acceptsMagazines,false);assert.equal(internal.avallon.inventory.magazines.length,0);assert.equal(internal.avallon.ammunition[0].quantity,14);assert.equal(sanitize(internal).avallon.ammunition[0].quantity,14);deleteInventoryEntry(internal,'weapon-ranged','bow');assert.equal(internal.avallon.ammunition[0].quantity,17);
console.log('Artifacts, independent charges, healing, passive/active effects, JSON blueprints, prosthesis and ammunition migrations passed.');
