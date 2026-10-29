export const SKILL_CATEGORIES=[['combat','Combat'],['applied','Applied'],['survival','Survival'],['control','Control'],['social','Social'],['passive','Passive'],['abilities','Abilities'],['spells','Spells']];
export const skillCap=category=>category==='passive'?1:['social','control'].includes(category)?3:5;
export const normalizeSkillCategory=value=>SKILL_CATEGORIES.some(([key])=>key===value)?value:'applied';
