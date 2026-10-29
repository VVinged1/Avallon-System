export const SKILL_CATEGORIES=[['combat','Combat'],['applied','Applied'],['survival','Survival'],['control','Control'],['social','Social'],['passive','Passive'],['abilities','Abilities'],['spells','Spells']];
export const skillCap=()=>10;
export const normalizeSkillCategory=value=>SKILL_CATEGORIES.some(([key])=>key===value)?value:'applied';
