const text=(value,max)=>String(value??'').trim().slice(0,max);
export const statusDefinition=ability=>({statusName:text(ability?.statusName,80),statusDescription:text(ability?.statusDescription,2000)});
export function normalizeStatuses(raw){const seen=new Set();return (Array.isArray(raw)?raw:[]).slice(0,50).filter(s=>s&&typeof s.id==='string').map(s=>({id:text(s.id,120),name:text(s.name,80),description:text(s.description,2000),sourceName:text(s.sourceName,120),sourceKey:text(s.sourceKey,400)})).filter(s=>s.id&&s.name&&!seen.has(s.id)&&seen.add(s.id));}
export function addNarrativeStatus(tracker,status){
 const clean=normalizeStatuses([status])[0];if(!clean?.id||!clean.name)throw Error('Enter a status name.');
 tracker.avallon.statuses??=[];const current=clean.sourceKey&&tracker.avallon.statuses.find(s=>s.sourceKey===clean.sourceKey);
 if(current){Object.assign(current,{...clean,id:current.id});return current;}
 if(tracker.avallon.statuses.length>=50)throw Error('This character has 50 statuses. Ask the GM to remove unused statuses.');
 tracker.avallon.statuses.push(clean);return clean;
}
