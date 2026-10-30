export const INITIATIVE_KEY='com.avallon.initiative/metadata';
const token=item=>item?.type==='IMAGE'&&['CHARACTER','MOUNT'].includes(item.layer);
export async function changeInitiativeMembership(sdk,items,add){
 if(await sdk.player.getRole()!=='GM')return;
 const ids=[...new Set(items.filter(token).map(item=>item.id))];if(!ids.length)return;
 await sdk.scene.items.updateItems(ids,current=>{for(const item of current){if(!token(item))continue;
  if(add){const old=item.metadata[INITIATIVE_KEY];if(!old||typeof old.count!=='string'||typeof old.active!=='boolean')item.metadata[INITIATIVE_KEY]={count:'0',active:false};}
  else delete item.metadata[INITIATIVE_KEY];
 }});
}
export async function installInitiativeMenus(sdk,icons){
 await sdk.contextMenu.remove('com.avallon.initiative/menu/toggle').catch(()=>{});
 for(const [name,add]of [['add',true],['remove',false]]){await sdk.contextMenu.remove('com.avallon.initiative/menu/'+name).catch(()=>{});await sdk.contextMenu.create({
  id:'com.avallon.initiative/menu/'+name,
  icons:[{icon:icons[name],label:add?'Add to Initiative':'Remove from Initiative',filter:{roles:['GM'],permissions:['UPDATE'],every:[{key:'type',value:'IMAGE'}],some:[{key:'layer',value:'CHARACTER'},{key:'layer',value:'MOUNT'}]}}],
  onClick:context=>changeInitiativeMembership(sdk,context.items,add),
 });}
}
