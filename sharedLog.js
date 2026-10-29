// Shared public log transport. Private GM rolls never enter this channel.
export const LOG_KEY='com.avallon.system/debugLog';
export const LOG_CHANNEL='com.avallon.system/debug';
const queues=new WeakMap();
let lastId=0;
export function createLogEntry(title,body,kind='info'){
 lastId=Math.max(Date.now()*1000,lastId+1);
 return {id:lastId,title,body,kind,timestamp:new Date().toLocaleTimeString()};
}
export function persistLogEntries(sdk,entries){
 const task=(queues.get(sdk)||Promise.resolve()).catch(()=>{}).then(async()=>{
  const metadata=await sdk.room.getMetadata(),merged=new Map();
  for(const entry of [...(Array.isArray(metadata?.[LOG_KEY])?metadata[LOG_KEY]:[]),...entries])if(entry&&Number.isFinite(entry.id))merged.set(entry.id,entry);
  await sdk.room.setMetadata({[LOG_KEY]:[...merged.values()].sort((a,b)=>b.id-a.id).slice(0,50)});
 });queues.set(sdk,task);return task;
}
export async function publishLogEntry(sdk,entry,isGm){
 const tasks=[sdk.broadcast.sendMessage(LOG_CHANNEL,{type:'debug-entry',entry},{destination:'ALL'})];
 if(isGm)tasks.push(persistLogEntries(sdk,[entry]));
 const results=await Promise.allSettled(tasks);
 // A persisted GM event remains readable even when live delivery fails.
 if(results.every(result=>result.status==='rejected'))throw results[0].reason;
}
