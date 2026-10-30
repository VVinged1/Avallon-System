export const INITIATIVE_KEY='com.avallon.initiative/metadata';
const token=item=>item?.type==='IMAGE'&&['CHARACTER','MOUNT'].includes(item.layer);
export async function changeInitiativeMembership(sdk,items,add){
 if(await sdk.player.getRole()!=='GM')throw Error('Only the GM can change Avallon initiative.');
 const ids=[...new Set(items.filter(token).map(item=>item.id))];if(!ids.length)throw Error('Select character or mount tokens for Avallon initiative.');
 let changed=0;
 await sdk.scene.items.updateItems(ids,current=>{for(const item of current){if(!token(item))continue;
  if(add){const old=item.metadata[INITIATIVE_KEY];if(!old||typeof old.count!=='string'||typeof old.active!=='boolean'){item.metadata[INITIATIVE_KEY]={count:'0',active:false};changed++;}}
  else if(Object.hasOwn(item.metadata,INITIATIVE_KEY)){delete item.metadata[INITIATIVE_KEY];changed++;}
 }});
 return {selected:ids.length,changed};
}
export async function installInitiativeMenus(sdk,icons){
 // Menu creation replaces the handler. Do not wait for obsolete-menu cleanup:
 // a missing old menu must never prevent registration of the current commands.
 void sdk.contextMenu.remove('com.avallon.initiative/menu/toggle').catch(()=>{});
 for(const [name,add]of [['add',true],['remove',false]]){await sdk.contextMenu.create({
  id:'com.avallon.initiative/menu/'+name,
  icons:[{icon:icons[name],label:add?'Add to Avallon Initiative':'Remove from Avallon Initiative',filter:{roles:['GM'],permissions:['UPDATE'],every:[{key:'type',value:'IMAGE'}],some:[{key:'layer',value:'CHARACTER'},{key:'layer',value:'MOUNT'}]}}],
  onClick:async context=>{try{const result=await changeInitiativeMembership(sdk,context.items,add);await sdk.notification.show('Avallon Initiative · '+(result.changed?(add?'added: ':'removed: ')+result.changed+' token(s)':add?'selected tokens are already in this tracker':'selected tokens are not in this tracker'),result.changed?'SUCCESS':'INFO');}
   catch(error){console.error('[Avallon Initiative]',error);await sdk.notification.show('Avallon Initiative · '+(error?.message||'Unable to update initiative.'),'ERROR').catch(()=>{});}},
 });}
}
