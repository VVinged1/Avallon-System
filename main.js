import {playerBodyPartsView} from './ui/playerBodyParts.js';
import {createLogEntry,publishLogEntry,persistLogEntries} from './sharedLog.js';
import {applyNarrativeAbility} from './narrativeUse.js';
import {statusView,installStatusTools} from './ui/statusTools.js';
import {SKILL_CATEGORIES,skillCap,attributeCap} from './avallonConfig.js';
import {manaStatus,spendMana,abilityAttacks,activateAbility} from './magicRules.js';
import {installArtifactTools} from './ui/artifactTools.js';
import {installMagicTools} from './ui/magicTools.js';
import {implantAttacks,activateImplantAbility,checkItemAbilityCost,spendItemAbilityCost} from './implantAbilities.js';
import {applyCheckedItemUse,itemUseSummary} from './itemUse.js';
import {createFieldDrafts,createTokenWriteQueue} from './fieldDrafts.js';
import {rangeAdjustment,rangeAdjustmentLabel} from './rangeRules.js';
import {createTargetDistance} from './targetDistance.js';
import {arrangeCombatPanels} from './ui/combatLayout.js';
import {installCompactButtons} from './ui/compactButtons.js';
import {ARMOR_TRAINING,partWounds,adjustPartWound,useItemOnTracker,absorbEquipmentCritical,setCombinedPartHp,setCombinedPartMax,reconcileEquipment} from './characterRules.js';
import { compactHud } from "./ui/compactHud.js";
import { attributeCards, skillCards, effectChips } from "./ui/characterView.js";
import { installCharacterTools,formDialog } from "./ui/characterTools.js";
import { profileData } from "./profiles.js";
import { Command, buildImage, buildPath, buildRuler } from "@owlbear-rodeo/sdk";
import { reloadMagazine, getAmmoShot, consumeAmmo, effectiveArmor } from "./ammunition.js";
import {
  ABILITIES_SKILL_CATEGORY,
  APPLIED_SKILL_CATEGORY,
  BODY_ORDER,
  BODY_PART_SLOTS,
  BODY_PART_SLOT_LABELS,
  COMBAT_SKILL_CATEGORY,
  DEFAULT_AVALLON_SKILLS,
  MELEE_SKILL_NAME,
  META_KEY,
  OBR,
  PARRY_SKILL_NAME,
  canPlayerControlToken,
  clamp,
  enableActionResize,
  ensureOverlayForToken,
  formatOverlayText,
  getArmorTotal,
  getAvailableWeapons,
  getBodyTotals,
  getBodyPartNames,
  getBodyPartAttackPenalty,
  getBodyPartLabel,
  getCharacterName,
  getAvallonData as getTokenAvallonData,
  getTargetableBodyParts,
  getTrackerData,
  hasConfiguredSpecial,
  SHIELD_PART_NAME,
  SPECIAL_PART_NAME,
  isCharacterToken,
  isTrackedCharacter,
  removeOverlaysForToken,
  sanitizeTrackerData,
  sortCharacters,
  syncTrackedOverlays,
  updateTrackerData as persistTrackerData,
} from "./shared.js";
import {
  formatAttackOutcomeLabel,
  getAttackOutcomeIcon,
  resolveAttack,
  rollDice,
} from "./avallon_rules.js";

const DEBUG_LOG_KEY = "com.avallon.system/debugLog";
const DEBUG_BROADCAST_CHANNEL = "com.avallon.system/debug";
const DEBUG_ENTRY_LIMIT = 50;
const TARGET_PICK_TOOL_ID = "com.avallon.system/attack-target-picker";
const TARGET_PICK_MODE_ID = "pick-target";
const TARGET_HIGHLIGHT_KEY = "com.avallon.system/local-attack-target";
const LOCAL_SELF_VIEW_KEY = "com.avallon.system/local-self-view";
const ATTACK_TARGET_CONTEXT_MENU_ID = "com.avallon.system/set-attack-target";
const SHOW_EMBEDDED_PUBLIC_LOG = false;
const EXTENSION_ICON_URL = new URL("./icon.svg", window.location.href).href;
const TARGET_PICK_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <circle cx="16" cy="16" r="3.25" fill="#ef4444" stroke="#7f1d1d" stroke-width="1.5"/>
    <path d="M16 2v8M16 22v8M2 16h8M22 16h8" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M16 6v4M16 22v4M6 16h4M22 16h4" stroke="#7f1d1d" stroke-width="1.2" stroke-linecap="round"/>
  </svg>`,
)}") 16 16, crosshair`;
const HUD_MODE = new URLSearchParams(window.location.search).get("hud") === "1";
let measuredTargetDistance=null,targetDistance=null;
function paintTargetDistance(reading) {
  measuredTargetDistance=reading;
  for(const node of document.querySelectorAll('[data-target-distance]'))node.textContent=reading?.sourceId===activeTokenId?reading.label:'—';
  paintRangeAdjustments();
}
function paintRangeAdjustments() {
  const token=getCharacterById(activeTokenId);if(!token)return;
  const avallon=getAvallonData(token);
  for(const node of document.querySelectorAll('[data-range-modifier]')) {
    const manual=node.dataset.rangeModifier==='manual',prefix=manual?'data-manual-attack-field':'data-attack-field';
    const weapon=getWeaponByName(token,getActionFieldValue(`[${prefix}="weaponName"]`));
    const skill=getActionFieldValue(`[${prefix}="skill"]`),raw=getActionFieldValue('[data-manual-attack-field="distanceMeters"]');
    const meters=manual?(String(raw??'').trim()===''?null:Number(raw)):(measuredTargetDistance?.sourceId===token.id?measuredTargetDistance.meters:null);
    const result=rangeAdjustment(weapon,meters,avallon,skill);node.hidden=!result.category;node.textContent=rangeAdjustmentLabel(result);node.classList.toggle('bad',result.modifier<0);node.classList.toggle('good',result.modifier>0);
  }
}
function refreshTargetDistance() {
  if(!targetDistance)return;
  if(targetPickState.active){const source=getCharacterById(targetPickState.attackerTokenId);if(!source||!canUseToken(source)||source.id!==activeTokenId)void stopTargetPick();return;}
  const source=getCharacterById(activeTokenId),targetId=source?getAvallonData(source).attackDraft.targetTokenId:'';
  const target=getCharacterById(targetId);
  if(source&&target&&target.visible!==false&&canUseToken(source))void targetDistance.measure(source,target);else paintTargetDistance(null);
}

document.documentElement.classList.toggle("od-hud-mode", HUD_MODE);
const CORE_COMBAT_SKILLS = Object.keys(DEFAULT_AVALLON_SKILLS);
const ATTACK_ONLY_EXCLUDED_SKILLS = new Set([PARRY_SKILL_NAME]);
const UNARMED_WEAPON_NAME = "Not Armed";
const TOKEN_EXPORT_FORMAT = "avallon-token-profile";
const TOKEN_EXPORT_VERSION = 1;
const ATTRIBUTE_FIELDS = [
  ["Strength", "Strength"],
  ["Agility", "Agility"],
  ["Reaction", "Reaction"],
  ["Endurance", "Endurance"],
  ["Perception", "Perception"],
  ["Intelligence", "Intelligence"],
  ["Charisma", "Charisma"],
  ["Willpower", "Willpower"],
  ["Magic", "Magic"],
];

const ATTRIBUTE_UI_FIELDS = [
  ["Strength", "Strength"],
  ["Agility", "Agility"],
  ["Reaction", "Reaction"],
  ["Endurance", "Endurance"],
  ["Perception", "Perception"],
  ["Intelligence", "Intelligence"],
  ["Charisma", "Charisma"],
  ["Willpower", "Willpower"],
  ["Magic", "Magic"],
];

const ui = {
  roleBadge: document.getElementById("roleBadge"),
  refreshBtn: document.getElementById("refreshBtn"),
  syncBtn: document.getElementById("syncBtn"),
  statusBox: document.getElementById("statusBox"),
  selectionHint: document.getElementById("selectionHint"),
  selectedTokenPanel: document.getElementById("selectedTokenPanel"),
  debugConsole: document.getElementById("debugConsole"),
  clearDebugBtn: document.getElementById("clearDebugBtn"),
  trackedSection: document.getElementById("trackedSection"),
  trackedCount: document.getElementById("trackedCount"),
  trackedList: document.getElementById("trackedList"),
  allTokensSection: document.getElementById("allTokensSection"),
  allCount: document.getElementById("allCount"),
  allTokensList: document.getElementById("allTokensList"),
};

let characterTools = null;
let profileRollPending = false;
let playerRole = "PLAYER";
let playerId = "";
let playerName = "";
let playerColor = "#facc15";
let sceneItems = [];
let localSceneItems = [];
let selectionIds = [];
let activeTokenId = null;
let debugEntries = [];
let partyPlayers = [];
let sortedPartyPlayersCache = [];
let characterListCache = [];
let trackedCharacterListCache = [];
let charactersByIdCache = new Map();
let gmPrivateEntries = [];
let ammunitionAddOpen = false;
let weaponAddOpen = false;
let bodyPartAddOpen = false;
let skillAddOpen = false;
let skillPerkAddSkill = "";
const pendingLocalDebugEntryIds = new Set();
let pendingLocalDebugClear = false;
const collapsibleSectionState = new Map();
const attackFormDrafts = new Map();
const inputAutosaveTimers = new Map();
const pendingFieldDrafts=createFieldDrafts();
const queueTrackerWrite=createTokenWriteQueue();
let selectionPollTimer = null;
let renderScheduled = false;
let sceneSideEffectsTimer = null;
const targetPickState = {
  active: false,
  attackerTokenId: null,
  previousToolId: "",
  previousModeId: undefined,
  toolReady: false,
  restoring: false,
};

function rebuildSceneCaches() {
  characterListCache = sortCharacters(sceneItems.filter(isCharacterToken));
  trackedCharacterListCache = characterListCache.filter(isTrackedCharacter);
  charactersByIdCache = new Map(characterListCache.map((item) => [item.id, item]));
}

function setSceneItems(items) {
  sceneItems = Array.isArray(items) ? items : [];
  rebuildSceneCaches();
}

function setLocalSceneItems(items) {
  localSceneItems = Array.isArray(items) ? items : [];
}

function setSelectionState(selection) {
  selectionIds = selection ?? [];
}

function setPartyPlayersState(players) {
  partyPlayers = players ?? [];
  sortedPartyPlayersCache = [...partyPlayers].sort((left, right) =>
    String(left?.name ?? "").localeCompare(String(right?.name ?? ""))
  );
}

function removeLocalItemsFromCache(ids) {
  if (!ids.length) return;
  const removeSet = new Set(ids);
  setLocalSceneItems(localSceneItems.filter((item) => !removeSet.has(item.id)));
}

function upsertLocalItemsInCache(items) {
  if (!items.length) return;
  const byId = new Map(localSceneItems.map((item) => [item.id, item]));
  for (const item of items) {
    byId.set(item.id, item);
  }
  setLocalSceneItems([...byId.values()]);
}

function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  window.requestAnimationFrame(() => {
    renderScheduled = false;
    render();
  });
}

function scheduleSceneSideEffects(items = sceneItems) {
  if (sceneSideEffectsTimer) {
    clearTimeout(sceneSideEffectsTimer);
  }

  sceneSideEffectsTimer = window.setTimeout(() => {
    sceneSideEffectsTimer = null;
    void syncLocalOwnedHiddenTokenViews(items).catch((error) => {
      console.warn("[Body HP] Unable to sync local hidden-token views", error);
    });
    void syncTargetHighlight().catch((error) => {
      console.warn("[Body HP] Unable to sync target highlight", error);
    });
  }, 60);
}

function sanitizeDebugEntries(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      id: Number(entry.id) || Date.now(),
      title: String(entry.title ?? "Debug"),
      body: String(entry.body ?? ""),
      kind: String(entry.kind ?? "info"),
      timestamp: String(entry.timestamp ?? ""),
    }))
    .slice(0, DEBUG_ENTRY_LIMIT);
}

function mergeDebugEntries(...entryGroups) {
  const merged = new Map();

  for (const group of entryGroups) {
    for (const entry of sanitizeDebugEntries(group)) {
      merged.set(entry.id, entry);
    }
  }

  return [...merged.values()]
    .sort((left, right) => Number(right.id) - Number(left.id))
    .slice(0, DEBUG_ENTRY_LIMIT);
}

function setStatus(message, kind = "info") {
  ui.statusBox.textContent = message;
  ui.statusBox.className = `status ${kind}`;
  console[kind === "error" ? "error" : "log"](`[Body HP] ${message}`);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getSkillCategory(avallon, skillName) {
  return avallon?.skillCategories?.[skillName]||'applied';
}

function getSkillStrengthBonusFlag(avallon, skillName) {
  return Boolean(avallon?.skillStrengthBonuses?.[skillName]);
}

function getSkillLabel(avallon, skillName) {
  const ability=[...implantAttacks(avallon||{}),...abilityAttacks(avallon||{})].find(w=>w.selectionKey===skillName);
  return ability?ability.name:String(avallon?.skillLabels?.[skillName] ?? skillName).trim() || skillName;
}

function getSortedSkillEntries(avallon) {
  return Object.entries(avallon?.skills ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  );
}

function getCombatSkillEntries(avallon) {
  return getSortedSkillEntries(avallon).filter(
    ([skillName]) => getSkillCategory(avallon, skillName) === COMBAT_SKILL_CATEGORY,
  );
}

function getAbilitiesSkillEntries(avallon) {
  return getSortedSkillEntries(avallon).filter(
    ([skillName]) => getSkillCategory(avallon, skillName) === ABILITIES_SKILL_CATEGORY,
  );
}

function getAttackSkillEntries(avallon) {
  const attacks=[...implantAttacks(avallon),...abilityAttacks(avallon)];
  return [...new Map([...getCombatSkillEntries(avallon),...getAbilitiesSkillEntries(avallon)]).entries()].filter(([key])=>!ATTACK_ONLY_EXCLUDED_SKILLS.has(key)).concat(attacks.map(w=>[w.selectionKey,w.level||0]));
}

function getAppliedSkillEntries(avallon) {
  return getSortedSkillEntries(avallon).filter(
    ([skillName]) => getSkillCategory(avallon, skillName) === APPLIED_SKILL_CATEGORY,
  );
}

function buildSkillOptions(skillEntries, selectedValue = "", avallon = null) {
  return skillEntries
    .map(
      ([key, value]) => `<option value="${escapeHtml(key)}" ${
        key === selectedValue ? "selected" : ""
      }>${escapeHtml(getSkillLabel(avallon, key))} (${value})</option>`,
    )
    .join("");
}

function buildGroupedSkillOptions(avallon, selectedValue = "") {
  const combatOptions = buildSkillOptions(getCombatSkillEntries(avallon), selectedValue, avallon);
  const abilitiesOptions = buildSkillOptions(getAbilitiesSkillEntries(avallon), selectedValue, avallon);
  const appliedOptions = buildSkillOptions(getAppliedSkillEntries(avallon), selectedValue, avallon);

  return [
    combatOptions ? `<optgroup label="Combat">${combatOptions}</optgroup>` : "",
    abilitiesOptions ? `<optgroup label="Abilities">${abilitiesOptions}</optgroup>` : "",
    appliedOptions ? `<optgroup label="Applied">${appliedOptions}</optgroup>` : "",
  ]
    .filter(Boolean)
    .join("");
}

function getTransientFieldKey(field) {
  if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) {
    return "";
  }

  if(field.dataset.bodyField)return 'new-body:'+field.dataset.bodyField;
  if(field.dataset.weaponDraft){const row=field.closest('.weapon-entry');return 'weapon-draft:'+(row?.dataset.weaponType||'new')+':'+(row?.dataset.weaponIndex||'')+':'+field.dataset.weaponDraft+':'+(field.dataset.ammoId||'');}
  if(field.dataset.ammoDraft){const row=field.closest('.ammo-entry');return 'ammo-draft:'+(row?.dataset.ammoId||'new')+':'+field.dataset.ammoDraft;}
  if(field.dataset.skillPerkField)return 'new-perk:'+skillPerkAddSkill+':'+field.dataset.skillPerkField;
  if(field.dataset.action==='rename-body-part')return 'part-label:'+field.dataset.part;
  if (field.dataset.attackField === "ammoId" || field.dataset.manualAttackField === "ammoId") return "";
  if (field.dataset.attackField) return `attack:${field.dataset.attackField}`;
  if (field.dataset.manualAttackField) return `manual-attack:${field.dataset.manualAttackField}`;
  if (field.dataset.weaponMag !== undefined) return `inventory:weapon-mag:${field.dataset.weaponMag}`;
  if (field.dataset.magAmmo) return `inventory:mag-ammo:${field.dataset.magAmmo}`;
  if (field.dataset.equipPart) return `inventory:equip-part:${field.dataset.equipPart}`;
  if (field.dataset.profileModifier) return `profile:${field.dataset.profileModifier}`;
  if (field.dataset.rollField) return `roll:${field.dataset.rollField}`;
  if (field.dataset.rollCharField) return `roll-char:${field.dataset.rollCharField}`;
  if (field.dataset.rollSkillField) return `roll-skill:${field.dataset.rollSkillField}`;
  if (field.dataset.gmRollField) return `gm-roll:${field.dataset.gmRollField}`;
  if (field.dataset.skillField) return `new-skill:${field.dataset.skillField}`;
  if (field.dataset.weaponField) return `new-weapon:${field.dataset.weaponField}`;

  if (field.dataset.action === "select-owner-player") return "owner";
  if (field.dataset.action === "set-avallon-skill") return `skill:${field.dataset.skill ?? ""}`;
  if (field.dataset.action === "set-skill-strength-bonus") {
    return `skill-strength:${field.dataset.skill ?? ""}`;
  }
  if (field.dataset.action === "set-avallon-attribute") {
    return `attribute:${field.dataset.attribute ?? ""}`;
  }
  if (field.dataset.action === "set-weapon-name") {
    return `weapon-name:${field.dataset.weaponIndex ?? ""}`;
  }
  if (field.dataset.action === "set-weapon-damage") {
    return `weapon-damage:${field.dataset.weaponIndex ?? ""}`;
  }
  if (field.dataset.action === "set-weapon-accuracy") {
    return `weapon-accuracy:${field.dataset.weaponIndex ?? ""}`;
  }
  if (field.dataset.action === "set-field") {
    return `part:${field.dataset.part ?? ""}:${field.dataset.field ?? ""}`;
  }

  return "";
}

function shouldPreserveFieldValue(fieldKey, focusedKey) {
  return (
    fieldKey === focusedKey ||
    pendingFieldDrafts.get(ui.selectedTokenPanel.dataset.tokenId,fieldKey)||
    fieldKey.startsWith('new-body:')||fieldKey.startsWith('weapon-draft:')||fieldKey.startsWith('ammo-draft:')||fieldKey.startsWith('new-perk:')||
    fieldKey.startsWith("attack:") ||
    fieldKey.startsWith("manual-attack:") ||
    fieldKey.startsWith("inventory:") ||
    fieldKey.startsWith("profile:") ||
    fieldKey.startsWith("roll:") ||
    fieldKey.startsWith("roll-char:") ||
    fieldKey.startsWith("roll-skill:") ||
    fieldKey.startsWith("gm-roll:") ||
    fieldKey.startsWith("new-skill:") ||
    fieldKey.startsWith("new-weapon:")
  );
}

function captureSelectedPanelState() {
  ui.selectedTokenPanel.querySelectorAll("details[data-section-key]").forEach(section=>collapsibleSectionState.set(section.dataset.sectionKey,section.open));
  const renderedTokenId = String(ui.selectedTokenPanel.dataset.tokenId ?? "").trim();
  if (!renderedTokenId || !ui.selectedTokenPanel.childElementCount) return null;

  let focusedKey = "";
  let selectionStart = null;
  let selectionEnd = null;
  const activeField = document.activeElement;
  if (
    (activeField instanceof HTMLInputElement || activeField instanceof HTMLSelectElement) &&
    ui.selectedTokenPanel.contains(activeField)
  ) {
    focusedKey = getTransientFieldKey(activeField);
    if (
      activeField instanceof HTMLInputElement &&
      typeof activeField.selectionStart === "number" &&
      typeof activeField.selectionEnd === "number"
    ) {
      selectionStart = activeField.selectionStart;
      selectionEnd = activeField.selectionEnd;
    }
  }

  const fields = [];
  ui.selectedTokenPanel.querySelectorAll("input, select").forEach((field) => {
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) return;
    const key = getTransientFieldKey(field);
    if (!key || !shouldPreserveFieldValue(key, focusedKey)) return;
    fields.push([
      key,
      field instanceof HTMLInputElement && field.type === "checkbox"
        ? { kind: "checkbox", checked: field.checked }
        : { kind: "value", value: pendingFieldDrafts.get(renderedTokenId,key)?.value ?? field.value },
    ]);
  });

  return {
    tokenId: renderedTokenId,
    fields,
    focusedKey,
    selectionStart,
    selectionEnd,
  };
}

function restoreSelectedPanelState(panelState) {
  if (!panelState || panelState.tokenId !== activeTokenId) return;

  const fieldValues = new Map(panelState.fields ?? []);
  let focusedField = null;

  ui.selectedTokenPanel.querySelectorAll("input, select").forEach((field) => {
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) return;
    const key = getTransientFieldKey(field);
    if (!key || !fieldValues.has(key)) return;

    const nextValue = fieldValues.get(key);
    if (
      field instanceof HTMLInputElement &&
      field.type === "checkbox" &&
      nextValue &&
      typeof nextValue === "object" &&
      nextValue.kind === "checkbox"
    ) {
      field.checked = Boolean(nextValue.checked);
    } else {
      const normalizedValue =
        nextValue && typeof nextValue === "object" && nextValue.kind === "value"
          ? nextValue.value
          : typeof nextValue === "string"
            ? nextValue
            : "";
      if (field instanceof HTMLSelectElement) {
        const hasMatchingOption = Array.from(field.options).some(
          (option) => option.value === normalizedValue,
        );
        if (!hasMatchingOption) return;
      }
      field.value = (field.dataset.attackField === "rounds" || field.dataset.manualAttackField === "rounds")
        ? String(Math.max(1, Math.min(Number(normalizedValue) || 1, Number(field.max))))
        : normalizedValue;
    }
    if (key === panelState.focusedKey) {
      focusedField = field;
    }
  });

  if (!focusedField) return;

  focusedField.focus({ preventScroll: true });
  if (
    focusedField instanceof HTMLInputElement &&
    typeof panelState.selectionStart === "number" &&
    typeof panelState.selectionEnd === "number"
  ) {
    try {
      focusedField.setSelectionRange(panelState.selectionStart, panelState.selectionEnd);
    } catch (error) {
      console.warn("[Body HP] Unable to restore cursor position", error);
    }
  }
}

function getSortedPartyPlayers() {
  return sortedPartyPlayersCache;
}

function getCharacters() {
  return characterListCache;
}

function getTrackedCharacters() {
  return trackedCharacterListCache;
}

function getControllableCharacters() {
  return getTrackedCharacters().filter((token) =>
    canPlayerControlToken(playerRole, playerId, token)
  );
}

function getCharacterById(tokenId) {
  return charactersByIdCache.get(tokenId) ?? null;
}

function resolveActiveTokenId() {
  const characters = getCharacters();
  const selectedCharacterId = selectionIds.find((id) =>
    characters.some((character) => character.id === id)
  );

  if (selectedCharacterId) return selectedCharacterId;
  if (activeTokenId && characters.some((character) => character.id === activeTokenId)) {
    return activeTokenId;
  }

  if (playerRole !== "GM") {
    const firstControllable = getControllableCharacters()[0];
    if (firstControllable) return firstControllable.id;
  }

  const firstTracked = getTrackedCharacters()[0];
  if (firstTracked) return firstTracked.id;

  return characters[0]?.id ?? null;
}

function isEditable() {
  return playerRole === "GM";
}

function getAvallonData(token){return getTokenAvallonData(token,characterListCache);}
function canUseToken(token) {
  return canPlayerControlToken(playerRole, playerId, token,characterListCache);
}

function canEditTokenData(token) {
  return canUseToken(token);
}

function canViewAttackBlock(token) {
  return canUseToken(token);
}

function canViewBodyHpSummary(token) {
  return canUseToken(token);
}

function canViewDiceBlock(token) {
  return canUseToken(token);
}

function canViewOverlayPreview(token) {
  return canUseToken(token);
}

function applyLocalTrackerDataUpdate(tokenId, updater) {
  const nextItems = sceneItems.map((item) => {
    if (item.id !== tokenId) return item;
    const nextItem = structuredClone(item);
    nextItem.metadata ??= {};
    nextItem.metadata[META_KEY] = updater(getTrackerData(item));
    return nextItem;
  });

  setSceneItems(nextItems);
}

async function updateTrackerData(tokenId, updater) {
  return queueTrackerWrite(tokenId,async()=>{
  applyLocalTrackerDataUpdate(tokenId, updater);
  scheduleRender();
  try {
    await persistTrackerData(tokenId, updater);
  } catch (error) {
    setSceneItems(await OBR.scene.items.getItems());
    scheduleRender();
    throw error;
  }
  });
}

async function initializeCharacterToken(tokenId) {
  const token = getCharacterById(tokenId);
  if (!token || !isCharacterToken(token)) return false;
  const shouldInitialize = !isTrackedCharacter(token);
  if (!shouldInitialize) return false;

  await updateTrackerData(tokenId, (current) => current);
  await ensureOverlayForToken(tokenId);
  return shouldInitialize;
}

function resolveDefaultTargetTokenId(attackerId) {
  const visibleTargets = getCharacters().filter(
    (token) => token.id !== attackerId && token.visible !== false,
  );
  const otherSelected = selectionIds.find(
    (id) => id !== attackerId && visibleTargets.some((token) => token.id === id),
  );
  if (otherSelected) return otherSelected;
  const fallback = visibleTargets[0];
  return fallback?.id ?? "";
}

async function pushDebugEntry(title, body, kind = "info") {
  const entry = createLogEntry(title,body,kind);
  const metadata = await OBR.room.getMetadata();
  const nextEntries = mergeDebugEntries([entry], metadata?.[DEBUG_LOG_KEY], debugEntries);
  debugEntries = nextEntries;
  renderDebugConsole();
  characterTools?.syncPool();
  pendingLocalDebugEntryIds.add(entry.id);
  await publishLogEntry(OBR,entry,playerRole === "GM");
}

async function clearDebugConsole() {
  if (playerRole !== "GM") {
    setStatus("Only the GM can clear the debug console.", "error");
    return;
  }

  debugEntries = [];
  renderDebugConsole();
  pendingLocalDebugClear = true;
  await OBR.broadcast.sendMessage(
    DEBUG_BROADCAST_CHANNEL,
    { type: "debug-clear" },
    { destination: "ALL" },
  );
  await OBR.room.setMetadata({
    [DEBUG_LOG_KEY]: [],
  });
  setStatus("Debug console cleared.", "success");
}

function renderDebugConsole() {
  if (!debugEntries.length) {
    ui.debugConsole.innerHTML = `
      <div class="hint-box">
        <div class="field-label">Current viewer</div>
        <pre class="console-output">Name: ${escapeHtml(playerName || "Unknown")}
Player ID: ${escapeHtml(playerId || "Unavailable")}

Actions from all players and the GM will appear here after rolls and attacks.</pre>
      </div>`;
    return;
  }

  ui.debugConsole.innerHTML = debugEntries
    .map(
      (entry) => `
        <div class="debug-entry">
          <div class="debug-head">
            <div class="debug-title">${escapeHtml(entry.title)}</div>
            <div class="muted">${escapeHtml(entry.timestamp)}</div>
          </div>
          <pre class="console-output">${escapeHtml(entry.body)}</pre>
        </div>`
    )
    .join("");
}

async function loadSharedDebugConsole() {
  const metadata = await OBR.room.getMetadata();
  debugEntries = sanitizeDebugEntries(metadata?.[DEBUG_LOG_KEY]);
}

function arraysEqual(left, right) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

async function handleSelectionChange(selection, allowInitialize = true) {
  const nextSelection = selection ?? [];
  setSelectionState(nextSelection);

  const selectedCharacterId = nextSelection.find((id) => charactersByIdCache.has(id));
  if (selectedCharacterId) {
    activeTokenId = selectedCharacterId;
    if (allowInitialize) {
      await initializeCharacterToken(selectedCharacterId);
    }
  } else if (activeTokenId && !charactersByIdCache.has(activeTokenId)) {
    activeTokenId = null;
  } else {
    activeTokenId = resolveActiveTokenId();
  }

  scheduleRender();
  await syncTargetHighlight();
}

function startSelectionPolling() {
  if (selectionPollTimer) {
    clearInterval(selectionPollTimer);
  }

  selectionPollTimer = setInterval(() => {
    void OBR.player
      .getSelection()
      .then((selection) => selection ?? [])
      .then((selection) => {
        if (!arraysEqual(selectionIds, selection)) {
          return handleSelectionChange(selection);
        }
        return null;
      })
      .catch((error) => {
        console.warn("[Body HP] Selection polling failed", error);
      });
  }, 1500);
}

function formatAttackDebug({
  range,
  distance,
  attackerName,
  targetName,
  targetPart,
  attackSkillName,
  attackSkillValue,
  weaponDamage,
  weaponAccuracy,
  strengthBonus,
  manualAttackBonuses,
  totalAttackBonuses,
  manualAttackPenalties,
  automaticTargetPenalty,
  totalAttackPenalties,
  defenseBonuses,
  defensePenalties,
  baseTargetParry,
  targetParry,
  parryMode,
  targetArmor,
  specialArmor,
  specialActive,
  result,
  beforeHp,
  afterHp,
  specialBeforeHp,
  specialAfterHp,
  beforeMinor,
  afterMinor,
  beforeSerious,
  afterSerious,
  critApplied,
  damageAppliedLabel,
}) {
  const accuracyTable = formatTextTable(
    ["Side", "Attacking", "Defending"],
    [
      [
        "Accuracy",
        `${result.attackRoll} + ${attackSkillValue * 10} + ${totalAttackBonuses} - ${totalAttackPenalties} = ${result.attackTotal}`,
        `${result.defenseRoll} + ${targetParry * 10} + ${defenseBonuses} - ${defensePenalties} = ${result.defenseTotal}`,
      ],
      [
        "Damage",
        `${result.attackTotal} + ${weaponDamage}`,
        `${result.defenseTotal} + ${targetArmor}`,
      ],
      [
        "Result",
        `${result.damage?.totalAttack ?? result.attackTotal}`,
        `${result.damage?.totalDefense ?? result.defenseTotal}`,
      ],
    ],
  );

  const damageRows = [
    ["Attacker", attackerName],
    ["Target", `${targetName} -> ${targetPart}`],
    ["Attack Skill", `${attackSkillName} (${attackSkillValue})`],
    ["Strength Bonus", strengthBonus],
    ["Weapon Accuracy", weaponAccuracy],
    ...(range?.category?[["Weapon range",rangeAdjustmentLabel(range)]]:[]),
    ["Manual Attack Bonus", manualAttackBonuses],
    ["Total Attack Bonus", totalAttackBonuses],
    ["Manual Attack Penalty", manualAttackPenalties],
    ["Auto Target Penalty", automaticTargetPenalty],
    ["Parry Mode", getParryModeLabel(parryMode)],
    ...(distance?[["Target distance",distance.label]]:[]),
    ["Base Parry", baseTargetParry],
    ["Effective Parry", targetParry],
    ["Armor", targetArmor],
  ];

  if (specialActive) {
    damageRows.push(["Special Armor", specialArmor]);
    damageRows.push(["Special HP", formatStateTransition(specialBeforeHp, specialAfterHp)]);
  }

  damageRows.push(
    ["Outcome", formatAttackOutcomeLabel(result.outcome)],
    ["Applied Damage", damageAppliedLabel ?? formatAppliedDamageLabel(result.damage, critApplied)],
    ["Damage Diff", result.damage?.damageDiff ?? 0],
    ["Damage Label", result.damage?.label ?? "No damage"],
    ["Applied Min/Sir/Crit", `${result.damage?.minor ?? 0} / ${result.damage?.serious ?? 0} / ${result.damage?.crit ?? 0}`],
    ["Converted Crit", critApplied],
  );

  const damageTable = formatTextTable(
    ["Parameter", "Value"],
    damageRows,
  );

  return [
    `Damage Applied: ${damageAppliedLabel ?? formatAppliedDamageLabel(result.damage, critApplied)}`,
    `Result: ${formatAttackOutcomeLabel(result.outcome)}`,
    "",
    accuracyTable,
    "",
    damageTable,
  ].join("\n");
}

function projectPartDamage(part, damage) {
  const next = {
    current: Number(part?.current) || 0,
    max: Number(part?.max) || 0,
    armor: Number(part?.armor) || 0,
    minor: Number(part?.minor) || 0,
    serious: Number(part?.serious) || 0,
  };

  next.minor = Math.max(0, next.minor + (Number(damage?.minor) || 0));
  next.serious = Math.max(0, next.serious + (Number(damage?.serious) || 0));

  const promotedSerious = Math.floor(next.minor / 4);
  next.minor %= 4;
  next.serious += promotedSerious;

  const convertedCrit = Math.floor(next.serious / 2);
  next.serious %= 2;

  const directCrit = Math.max(0, Number(damage?.crit) || 0);
  const totalCrit = directCrit + convertedCrit;
  next.current = clamp(next.current - totalCrit, 0, next.max);

  return {
    ...next,
    critApplied: totalCrit,
  };
}

function getNormalizedPartState(part) {
  return {
    current: Number(part?.current) || 0,
    max: Number(part?.max) || 0,
    armor: Number(part?.armor) || 0,
    minor: Number(part?.minor) || 0,
    serious: Number(part?.serious) || 0,
  };
}

function projectDamageWithSpecialProtection({
  specialPart,
  targetPart,
  damage,
  targetPartName,
}) {
  const normalizedSpecial = getNormalizedPartState(specialPart);
  const normalizedTarget = getNormalizedPartState(targetPart);

  if (!damage) {
    return {
      specialProjectedState: normalizedSpecial,
      projectedTargetState: {
        ...normalizedTarget,
        critApplied: 0,
      },
      specialActive: false,
      specialArmor: 0,
      damageAppliedLabel: "No Damage",
    };
  }

  const specialActive =
    hasConfiguredSpecial({ body: { [SPECIAL_PART_NAME]: normalizedSpecial } }) &&
    normalizedSpecial.max > 0 &&
    normalizedSpecial.current > 0;

  if (!specialActive) {
    const projectedTargetState = projectPartDamage(normalizedTarget, damage);
    return {
      specialProjectedState: normalizedSpecial,
      projectedTargetState,
      specialActive: false,
      specialArmor: 0,
      damageAppliedLabel: formatAppliedDamageLabel(damage, projectedTargetState.critApplied ?? 0),
    };
  }

  const specialProjectedState = projectPartDamage(normalizedSpecial, damage);
  const absorbedHp = Math.max(0, normalizedSpecial.current - specialProjectedState.current);
  const totalSpecialCrit = Math.max(0, Number(specialProjectedState.critApplied) || 0);
  const specialCritApplied = Math.min(totalSpecialCrit, absorbedHp);
  const overflowCrit = Math.max(0, totalSpecialCrit - specialCritApplied);
  const overflowDamage = overflowCrit > 0 ? { crit: overflowCrit, serious: 0, minor: 0 } : null;
  const projectedTargetState = overflowDamage
    ? projectPartDamage(normalizedTarget, overflowDamage)
    : {
        ...normalizedTarget,
        critApplied: 0,
      };
  const specialAppliedLabel = formatAppliedDamageLabel(
    {
      serious: damage.serious,
      minor: damage.minor,
    },
    specialCritApplied,
  );
  const targetAppliedLabel = overflowDamage
    ? formatAppliedDamageLabel(overflowDamage, projectedTargetState.critApplied ?? 0)
    : "No Damage";

  let damageAppliedLabel = "No Damage";
  if (specialAppliedLabel !== "No Damage") {
    damageAppliedLabel = `Special ${specialAppliedLabel}`;
  }
  if (targetAppliedLabel !== "No Damage") {
    damageAppliedLabel =
      damageAppliedLabel === "No Damage"
        ? `${targetPartName} ${targetAppliedLabel}`
        : `${damageAppliedLabel}; ${targetPartName} ${targetAppliedLabel}`;
  }

  return {
    specialProjectedState,
    projectedTargetState,
    specialActive: true,
    specialArmor: normalizedSpecial.armor,
    damageAppliedLabel,
  };
}

function formatRawDiceRolls(result) {
  return result.rolls.join(", ");
}

function formatDiceRollsWithModifier(result) {
  const modifier = Number(result.modifier) || 0;
  return result.rolls.map((roll) => (Number(roll) || 0) + modifier).join(", ");
}

function buildDiceRollSummary(diceLabel, result) {
  return `Rolled ${diceLabel}: raw [${formatRawDiceRolls(result)}], sum ${result.subtotal}, with modifier ${formatDiceRollsWithModifier(result)}`;
}

function formatOverlayPreviewText(data) {
  return `Armor Total ${getArmorTotal(data)}\n${formatOverlayText(data)}`;
}

function formatDiceDebug({ tokenName, result }) {
  return formatTextTable(
    ["Parameter", "Value"],
    [
      ["Actor", tokenName],
      ["Dice", `${result.count}d${result.sides}`],
      ["Raw Dice", formatRawDiceRolls(result)],
      ["Dice Sum", result.subtotal],
      ["With Modifier", formatDiceRollsWithModifier(result)],
    ],
  );
}

function getCurrentPlayerColor() {
  return String(
    playerColor ||
      partyPlayers.find((player) => player?.id === playerId)?.color ||
      "#facc15",
  );
}

function getParryDivisor(mode) {
  if (mode === "off") return 0;
  const numeric = Number(mode);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 5) {
    return numeric;
  }
  return 1;
}

function getParryModeLabel(mode) {
  if (mode === "off") return "Ignore Parry";
  const divisor = getParryDivisor(mode);
  return `${divisor} Opponent${divisor === 1 ? "" : "s"}`;
}

function formatAppliedDamageLabel(damage, critApplied = 0) {
  const parts = [];
  const totalCrit = Math.max(0, Number(critApplied) || 0);
  const serious = Math.max(0, Number(damage?.serious) || 0);
  const minor = Math.max(0, Number(damage?.minor) || 0);

  if (totalCrit > 0) {
    parts.push(`${totalCrit} Crit`);
  }
  if (serious > 0) {
    parts.push(`${serious} Serious`);
  }
  if (minor > 0) {
    parts.push(`${minor} Minor`);
  }

  return parts.length ? parts.join(", ") : "No Damage";
}

function formatStateTransition(before, after) {
  if (before == null || after == null) return "-";
  return `${before} -> ${after}`;
}

function getCheckResultIcon(resultLabel) {
  return String(resultLabel).trim() === "Check Passed" ? "✅" : "❌";
}

function formatCheckResultLabel(resultLabel) {
  const normalized = String(resultLabel).trim() || "Check Failed";
  return `${getCheckResultIcon(normalized)} ${normalized}`;
}

function getResolvedCheckResultIcon(resultLabel) {
  const normalized = String(resultLabel).trim();
  if (normalized === "Critical Success") return "🎯";
  if (normalized === "Critical Failure") return "💀";
  if (normalized === "Check Passed") return "✅";
  return "❌";
}

function isResolvedCheckResultSuccess(resultLabel) {
  const normalized = String(resultLabel).trim();
  return normalized === "Check Passed" || normalized === "Critical Success";
}

function formatResolvedCheckResultLabel(resultLabel) {
  const normalized = String(resultLabel).trim() || "Check Failed";
  return `${getResolvedCheckResultIcon(normalized)} ${normalized}`;
}

function formatRollCharDebug({ tokenName, attributeLabel, result }) {
  return [
    `Character: ${tokenName}`,
    `Characteristic: ${attributeLabel}`,
    `${formatResolvedCheckResultLabel(result.result)}`,
    "",
    formatTextTable(
      ["Roll", "Base Attribute", "Modifier", "Final Attribute"],
      [[result.roll, result.baseAttribute, result.modifier, result.finalAttribute]],
    ),
  ].join("\n");
}

function formatRollSkillDebug({ tokenName, skillName, result }) {
  return [
    `Character: ${tokenName}`,
    `Skill: ${skillName}`,
    `${formatResolvedCheckResultLabel(result.result)}`,
    "",
    formatTextTable(
      ["Parameter", "Value"],
      [
        ["First Roll", `${result.rollPrimary} + ${result.baseSkill * 10} + ${result.modifier} = ${result.totalPrimary}`],
        ["Second Roll", `${result.rollSecondary} = ${result.totalSecondary}`],
      ],
    ),
  ].join("\n");
}

function formatTextTable(headers, rows) {
  const normalizedHeaders = headers.map((cell) => String(cell ?? ""));
  const normalizedRows = rows.map((row) => row.map((cell) => String(cell ?? "")));
  const widths = normalizedHeaders.map((header, columnIndex) =>
    Math.max(
      header.length,
      ...normalizedRows.map((row) => (row[columnIndex] ?? "").length),
    ),
  );

  const renderBorder = (left, middle, right, fill) =>
    `${left}${widths.map((width) => fill.repeat(width + 2)).join(middle)}${right}`;
  const renderRow = (row) =>
    `│ ${row
      .map((cell, columnIndex) => String(cell ?? "").padEnd(widths[columnIndex], " "))
      .join(" │ ")} │`;

  return [
    renderBorder("╒", "╤", "╕", "═"),
    renderRow(normalizedHeaders),
    renderBorder("╞", "╪", "╡", "═"),
    ...normalizedRows.map(renderRow),
    renderBorder("╘", "╧", "╛", "═"),
  ].join("\n");
}

function getAttackDraft(token, data, targetCharacters) {
  const availableWeapons = getAttackSelectableWeapons(token);
  const defaultWeapon = getDefaultAttackWeapon(token);
  const stored = attackFormDrafts.get(token.id) ?? {};
  const persistedTargetTokenId = String(data.avallon?.attackDraft?.targetTokenId ?? "").trim();
  const persistedTargetTokenName = String(data.avallon?.attackDraft?.targetTokenName ?? "").trim();
  const combatSkillNames = getAttackSkillEntries(data.avallon).map(([skillName]) => skillName);
  const fallbackSkill =
    combatSkillNames[0] ??
    CORE_COMBAT_SKILLS.find((key) => key in data.avallon.skills) ??
    CORE_COMBAT_SKILLS[0];
  const hasStoredTargetTokenId = Object.prototype.hasOwnProperty.call(stored, "targetTokenId");
  const draftTargetTokenId = persistedTargetTokenId ||
    (hasStoredTargetTokenId ? String(stored.targetTokenId ?? "").trim() : null);
  const draftTargetTokenName =
    persistedTargetTokenName || String(stored.targetTokenName ?? "").trim();
  const targetTokenId =
    draftTargetTokenId && draftTargetTokenId !== token.id
      ? draftTargetTokenId
      : "";
  const resolvedTarget = targetTokenId
    ? targetCharacters.find((target) => target.id === targetTokenId) ?? null
    : null;
  const storedWeaponName = String(stored.weaponName ?? "").trim();
  const selectedWeapon =
    availableWeapons.find((weapon) => (weapon.selectionKey ?? weapon.name) === storedWeaponName) ?? defaultWeapon;

  return {
    skill: combatSkillNames.includes(stored.skill)
      ? stored.skill
      : fallbackSkill,
    targetTokenId,
    targetTokenName: resolvedTarget ? getCharacterName(resolvedTarget) : draftTargetTokenName,
    targetPart:
      String(stored.targetPart ?? "").trim() && stored.targetPart !== SPECIAL_PART_NAME
        ? String(stored.targetPart).trim()
        : "Torso",
    weaponName: selectedWeapon?.selectionKey ?? selectedWeapon?.name ?? defaultWeapon.name,
    weaponDamage: stored.weaponDamage ?? String(selectedWeapon?.damage ?? defaultWeapon.damage ?? 0),
    weaponAccuracy: String(selectedWeapon?.accuracy ?? defaultWeapon.accuracy ?? 0),
    attackBonuses: stored.attackBonuses ?? "0",
    attackPenalties: stored.attackPenalties ?? "0",
    manualAttackBonuses: stored.manualAttackBonuses ?? stored.attackBonuses ?? "0",
    manualAttackPenalties: stored.manualAttackPenalties ?? stored.attackPenalties ?? "0",
    defenseBonuses: stored.defenseBonuses ?? "0",
    defensePenalties: stored.defensePenalties ?? "0",
    distanceMeters: stored.distanceMeters ?? "",
    manualArmor: stored.manualArmor ?? "0",
    manualParry: stored.manualParry ?? "0",
    rounds: stored.rounds ?? "1",
    parryMode: ["off", "1", "2", "3", "4", "5"].includes(String(stored.parryMode))
      ? String(stored.parryMode)
      : (getAvallonData(token).preferences?.parryMode || "off"),
  };
}

function saveAttackDraftValue(tokenId, field, value) {
  if (!tokenId || !field) return;
  const current = attackFormDrafts.get(tokenId) ?? {};
  attackFormDrafts.set(tokenId, {
    ...current,
    [field]: value,
  });
}

function getSharedAttackDraftField(manualField) {
  if (manualField === "distanceMeters") return "distanceMeters";
  if (manualField === "rounds") return "rounds";
  if (manualField === "targetPart") return "targetPart";
  if (manualField === "skill") return "skill";
  if (manualField === "weaponName") return "weaponName";
  if (manualField === "weaponDamage") return "weaponDamage";
  if (manualField === "attackBonuses") return "manualAttackBonuses";
  if (manualField === "attackPenalties") return "manualAttackPenalties";
  if (manualField === "manualArmor") return "manualArmor";
  if (manualField === "manualParry") return "manualParry";
  return "";
}

function buildWeaponOptions(weapons, selectedWeaponName = "") {
  return weapons
    .map(
      (weapon) => `<option value="${escapeHtml(weapon.selectionKey ?? weapon.name)}" ${
        (weapon.selectionKey ?? weapon.name) === selectedWeaponName ? "selected" : ""
      }>${escapeHtml(weapon.name)} (${weapon.rangedIndex == null ? `DMG ${weapon.damage}, ` : `Ammo ${weapon.loaded}/${weapon.capacity}, `}ACC ${weapon.accuracy >= 0 ? "+" : ""}${weapon.accuracy})</option>`,
    )
    .join("");
}

function getAttackSelectableWeapons(token) {
  const avallon = getAvallonData(token);
  const meleeWeapons = avallon.weapons?.melee ?? [];
  return [
    { name: UNARMED_WEAPON_NAME, damage: 0, accuracy: 0 },
    ...meleeWeapons,
    ...implantAttacks(avallon),
    ...abilityAttacks(avallon),
    ...(avallon.weapons?.ranged ?? []).map((weapon, rangedIndex) => ({ ...weapon, damage: 0, rangedIndex, selectionKey: `ranged:${weapon.id}` })),
  ];
}

function getDefaultAttackWeapon(token) {
  const avallon = getAvallonData(token);
  const meleeWeapons = avallon.weapons?.melee ?? [];
  return meleeWeapons[0] ?? { name: UNARMED_WEAPON_NAME, damage: 0, accuracy: 0 };
}

function getWeaponByName(token, weaponName) {
  const normalizedWeaponName = String(weaponName ?? "").trim();
  const weapons = getAttackSelectableWeapons(token);
  return weapons.find((weapon) => (weapon.selectionKey ?? weapon.name) === normalizedWeaponName) ?? getDefaultAttackWeapon(token);
}

function paintAbilityAttackFields(){
  if(!activeTokenId)return;const t=getCharacterById(activeTokenId);if(!t)return;
  for(const prefix of ['data-attack-field','data-manual-attack-field','data-hud-attack-field']){
    const skill=ui.selectedTokenPanel.querySelector('['+prefix+'="skill"]');
    const ability=[...implantAttacks(getAvallonData(t)),...abilityAttacks(getAvallonData(t))].find(w=>w.selectionKey===skill?.value);
    const select=ui.selectedTokenPanel.querySelector('['+prefix+'="weaponName"]');if(select?.closest('label'))select.closest('label').hidden=!!ability;
    const damage=ui.selectedTokenPanel.querySelector('['+prefix+'="weaponDamage"]');if(damage&&ability){damage.value=ability.damage;damage.disabled=true;}
  }
}
function syncAttackWeaponInputs(tokenId, weaponName, weaponDamage, weaponAccuracy = 0) {
  scheduleRender();
  if (!tokenId) return;

  const chosen=getWeaponByName(getCharacterById(tokenId),weaponName);
  if(chosen.implantId||chosen.magicAbilityId){saveAttackDraftValue(tokenId,'skill',weaponName);}
  else {const stored=attackFormDrafts.get(tokenId);if(stored?.skill?.startsWith('magic:')||stored?.skill?.startsWith('implant:'))saveAttackDraftValue(tokenId,'skill',getCombatSkillEntries(getAvallonData(getCharacterById(tokenId)))[0]?.[0]||'Melee');}

  saveAttackDraftValue(tokenId, "weaponName", weaponName);
  saveAttackDraftValue(tokenId, "weaponDamage", String(weaponDamage));
  saveAttackDraftValue(tokenId, "weaponAccuracy", String(weaponAccuracy));

  const attackWeaponSelect = ui.selectedTokenPanel.querySelector('[data-attack-field="weaponName"]');
  if (attackWeaponSelect instanceof HTMLSelectElement) {
    const hasOption = Array.from(attackWeaponSelect.options).some(
      (option) => option.value === weaponName,
    );
    if (hasOption) {
      attackWeaponSelect.value = weaponName;
    }
  }

  const manualWeaponSelect = ui.selectedTokenPanel.querySelector('[data-manual-attack-field="weaponName"]');
  if (manualWeaponSelect instanceof HTMLSelectElement) {
    const hasOption = Array.from(manualWeaponSelect.options).some(
      (option) => option.value === weaponName,
    );
    if (hasOption) {
      manualWeaponSelect.value = weaponName;
    }
  }

  ui.selectedTokenPanel
    .querySelectorAll('[data-attack-field="weaponDamage"], [data-manual-attack-field="weaponDamage"]')
    .forEach((field) => {
      if (field instanceof HTMLInputElement) {
        field.value = String(weaponDamage);
      }
    });

  ui.selectedTokenPanel
    .querySelectorAll("[data-weapon-accuracy-display]")
    .forEach((field) => {
      field.textContent = `${weaponAccuracy >= 0 ? "+" : ""}${weaponAccuracy}`;
    });
}

function sanitizeFileName(value) {
  return String(value ?? "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 80) || "token";
}

function buildTokenExportPayload(token) {
  return {format:TOKEN_EXPORT_FORMAT, version:TOKEN_EXPORT_VERSION, exportedAt:new Date().toISOString(), tokenName:getCharacterName(token), data:profileData(getTrackerData(token))};
}
function normalizeImportedTokenPayload(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Invalid token profile.");
  const source = raw.format === TOKEN_EXPORT_FORMAT && raw.data ? raw.data : raw.trackerData ?? raw;
  return profileData(sanitizeTrackerData(source));
}

function downloadTextFile(filename, content, mimeType = "application/json") {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

async function exportSelectedTokenData() {
  const token = getCharacterById(activeTokenId);
  if (!token) {
    setStatus("Select a character first.", "error");
    return;
  }
  if (!isEditable()) {
    setStatus("Only the GM can export token data.", "error");
    return;
  }

  const payload = buildTokenExportPayload(token);
  const timestamp = new Date().toISOString().slice(0, 10);
  const fileName = `${sanitizeFileName(getCharacterName(token))}-${timestamp}.avallon-token.json`;
  downloadTextFile(fileName, JSON.stringify(payload, null, 2));
  setStatus(`Exported ${getCharacterName(token)} data to ${fileName}.`, "success");
}

function openTokenImportPicker() {
  const token = getCharacterById(activeTokenId);
  if (!token) {
    setStatus("Select a character first.", "error");
    return;
  }
  if (!isEditable()) {
    setStatus("Only the GM can import token data.", "error");
    return;
  }

  const input = ui.selectedTokenPanel.querySelector("[data-token-import-input]");
  if (!(input instanceof HTMLInputElement)) {
    setStatus("Import control is not available for this token.", "error");
    return;
  }
  input.value = "";
  input.click();
}

async function importSelectedTokenData(file) {
  const token = getCharacterById(activeTokenId);
  if (!token) {
    setStatus("Select a character first.", "error");
    return;
  }
  if (!isEditable()) {
    setStatus("Only the GM can import token data.", "error");
    return;
  }
  if (!(file instanceof File)) {
    setStatus("Choose an import file first.", "error");
    return;
  }

  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error("Import file must contain valid JSON.");
  }

  const imported = normalizeImportedTokenPayload(parsed);
  await updateTrackerData(token.id, (current) => {
    const next = structuredClone(current);
    next.enabled = imported.enabled;
    next.minor = imported.minor;
    next.serious = imported.serious;
    next.body = structuredClone(imported.body);
    next.avallon.skills = structuredClone(imported.avallon.skills);
    next.avallon.skillCategories = structuredClone(imported.avallon.skillCategories);
    next.avallon.skillStrengthBonuses = structuredClone(imported.avallon.skillStrengthBonuses);
    next.avallon.skillLabels = structuredClone(imported.avallon.skillLabels);
    next.avallon.skillPerks = structuredClone(imported.avallon.skillPerks);
    next.avallon.attributes = structuredClone(imported.avallon.attributes);
    next.avallon.weapons = structuredClone(imported.avallon.weapons);
    next.avallon.ammunition = structuredClone(imported.avallon.ammunition);
    next.avallon.inventory = structuredClone(imported.avallon.inventory);
    return next;
  });
  await ensureOverlayForToken(token.id);
  const fallbackWeapon = getDefaultAttackWeapon(getCharacterById(token.id) ?? token);
  syncAttackWeaponInputs(
    token.id,
    fallbackWeapon.name,
    fallbackWeapon.damage,
    fallbackWeapon.accuracy ?? 0,
  );
  setStatus(`Imported token data into ${getCharacterName(token)}.`, "success");
}

async function persistAttackTargetToken(tokenId, targetTokenId) {
  if (!tokenId) return;

  const token = getCharacterById(tokenId);
  if (!token) return;

  const normalizedTargetTokenId = String(targetTokenId ?? "").trim();
  const targetToken = normalizedTargetTokenId ? getCharacterById(normalizedTargetTokenId) : null;
  const normalizedTargetTokenName = targetToken ? getCharacterName(targetToken) : "";
  const currentAttackDraft = getAvallonData(token).attackDraft ?? {};
  const currentTargetTokenId = String(currentAttackDraft.targetTokenId ?? "").trim();
  const currentTargetTokenName = String(currentAttackDraft.targetTokenName ?? "").trim();
  if (
    currentTargetTokenId === normalizedTargetTokenId &&
    currentTargetTokenName === normalizedTargetTokenName
  ) {
    return;
  }

  await updateTrackerData(token.id, (current) => {
    const next = structuredClone(current);
    next.avallon ??= structuredClone(getTrackerData(token).avallon);
    next.avallon.attackDraft ??= { targetTokenId: "", targetTokenName: "" };
    next.avallon.attackDraft.targetTokenId = normalizedTargetTokenId;
    next.avallon.attackDraft.targetTokenName = normalizedTargetTokenName;
    return next;
  });
}

async function assignAttackTarget(attacker, target, successMessage) {
  if (!attacker || !isCharacterToken(attacker)) {
    setStatus("Select an attacker token first.", "error");
    return false;
  }

  if (!canUseToken(attacker)) {
    setStatus("You cannot roll for this attacker token.", "error");
    return false;
  }

  if (!target || !isCharacterToken(target)) {
    setStatus("Choose a valid target token.", "error");
    return false;
  }

  if (target.visible === false) {
    setStatus("Hidden tokens cannot be targeted.", "error");
    return false;
  }

  if (target.id === attacker.id) {
    setStatus("Attacker and target must be different tokens.", "error");
    return false;
  }

  saveAttackDraftValue(attacker.id, "targetTokenId", target.id);
  saveAttackDraftValue(attacker.id, "targetTokenName", getCharacterName(target));
  await persistAttackTargetToken(attacker.id, target.id);
  activeTokenId = attacker.id;
  scheduleRender();

  const targetField = ui.selectedTokenPanel.querySelector('[data-attack-field="targetTokenId"]');
  if (targetField instanceof HTMLInputElement || targetField instanceof HTMLSelectElement) {
    targetField.value = target.id;
  }

  await syncTargetHighlight();
  setStatus(successMessage || `Target set to ${getCharacterName(target)}.`, "success");
  return true;
}

function buildCircleCommands(radius, segments = 28) {
  const safeRadius = Math.max(radius, 8);
  const commands = [];

  for (let index = 0; index <= segments; index += 1) {
    const angle = (Math.PI * 2 * index) / segments - Math.PI / 2;
    const x = Math.cos(angle) * safeRadius;
    const y = Math.sin(angle) * safeRadius;

    if (index === 0) {
      commands.push([Command.MOVE, x, y]);
    } else {
      commands.push([Command.LINE, x, y]);
    }
  }

  commands.push([Command.CLOSE]);
  return commands;
}

function isLocalTargetHighlight(item) {
  return Boolean(item?.metadata?.[TARGET_HIGHLIGHT_KEY]);
}

async function clearTargetHighlight() {
  const highlightIds = localSceneItems
    .filter(isLocalTargetHighlight)
    .map((item) => item.id);

  if (highlightIds.length) {
    await OBR.scene.local.deleteItems(highlightIds);
    removeLocalItemsFromCache(highlightIds);
  }
}

async function buildTargetHighlightItem(targetToken) {
  let bounds = null;
  try {
    bounds = await OBR.scene.items.getItemBounds([targetToken.id]);
  } catch (error) {
    console.warn("[Body HP] Unable to read target bounds for highlight", error);
  }

  const width = Math.max(
    bounds?.width ?? 0,
    (targetToken.width || 140) * Math.abs(targetToken.scale?.x ?? 1),
    56,
  );
  const height = Math.max(
    bounds?.height ?? 0,
    (targetToken.height || 140) * Math.abs(targetToken.scale?.y ?? 1),
    56,
  );
  const diameter = Math.max(24, Math.min(width, height));
  const radius = diameter / 2;
  const center = bounds?.center ?? targetToken.position;

  return buildPath()
    .name(`Attack Target: ${getCharacterName(targetToken)}`)
    .commands(buildCircleCommands(radius))
    .position(center)
    .rotation(0)
    .attachedTo(targetToken.id)
    .disableAttachmentBehavior(["ROTATION"])
    .layer("ATTACHMENT")
    .locked(true)
    .disableHit(true)
    .fillColor(getCurrentPlayerColor())
    .fillOpacity(0.22)
    .strokeColor(getCurrentPlayerColor())
    .strokeOpacity(0)
    .strokeWidth(0)
    .metadata({
      [TARGET_HIGHLIGHT_KEY]: {
        playerId,
        playerName,
        attackerTokenId: activeTokenId ?? "",
        targetTokenId: targetToken.id,
      },
    })
    .build();
}

async function syncTargetHighlight() {
  const attacker = getCharacterById(activeTokenId);
  if (!attacker || !isCharacterToken(attacker) || !canViewAttackBlock(attacker)) {
    await clearTargetHighlight();
    return;
  }

  const targetCharacters = getCharacters().filter(
    (item) => item.id !== attacker.id && item.visible !== false,
  );
  const draft = getAttackDraft(attacker, getTrackerData(attacker), targetCharacters);
  const target = getCharacterById(draft.targetTokenId);
  const existingHighlights = localSceneItems.filter(isLocalTargetHighlight);

  if (!target || !isCharacterToken(target) || target.visible === false || target.id === attacker.id) {
    if (existingHighlights.length) {
      const highlightIds = existingHighlights.map((item) => item.id);
      await OBR.scene.local.deleteItems(highlightIds);
      removeLocalItemsFromCache(highlightIds);
    }
    return;
  }

  if (
    existingHighlights.length === 1 &&
    existingHighlights[0]?.metadata?.[TARGET_HIGHLIGHT_KEY]?.targetTokenId === target.id &&
    existingHighlights[0]?.metadata?.[TARGET_HIGHLIGHT_KEY]?.attackerTokenId === attacker.id
  ) {
    return;
  }

  if (existingHighlights.length) {
    const highlightIds = existingHighlights.map((item) => item.id);
    await OBR.scene.local.deleteItems(highlightIds);
    removeLocalItemsFromCache(highlightIds);
  }

  const nextHighlight = await buildTargetHighlightItem(target);
  await OBR.scene.local.addItems([nextHighlight]);
  upsertLocalItemsInCache([nextHighlight]);
}

function isLocalSelfViewItem(item) {
  return Boolean(item?.metadata?.[LOCAL_SELF_VIEW_KEY]);
}

function buildLocalSelfViewSignature(token) {
  return [
    token.lastModified,
    token.position?.x ?? 0,
    token.position?.y ?? 0,
    token.rotation ?? 0,
    token.scale?.x ?? 1,
    token.scale?.y ?? 1,
    token.zIndex ?? 0,
  ].join("|");
}

async function buildLocalSelfViewItem(token) {
  return buildImage(token.image, token.grid)
    .name(`${getCharacterName(token)} (Local View)`)
    .position(token.position)
    .rotation(token.rotation ?? 0)
    .scale(token.scale ?? { x: 1, y: 1 })
    .zIndex((token.zIndex ?? 0) + 1)
    .visible(true)
    .layer("CHARACTER")
    .locked(true)
    .disableHit(true)
    .metadata({
      [LOCAL_SELF_VIEW_KEY]: {
        tokenId: token.id,
        ownerPlayerId: playerId,
        signature: buildLocalSelfViewSignature(token),
      },
    })
    .build();
}

async function clearLocalSelfViews() {
  const localViewIds = localSceneItems.filter(isLocalSelfViewItem).map((item) => item.id);
  if (localViewIds.length) {
    await OBR.scene.local.deleteItems(localViewIds);
    removeLocalItemsFromCache(localViewIds);
  }
}

async function syncLocalOwnedHiddenTokenViews(items = sceneItems) {
  if (playerRole === "GM" || !playerId) {
    await clearLocalSelfViews();
    return;
  }

  const desiredTokens = items.filter(
    (item) => isCharacterToken(item) && item.visible === false && canUseToken(item),
  );
  const desiredTokenIds = new Set(desiredTokens.map((token) => token.id));
  const existingViews = localSceneItems.filter(isLocalSelfViewItem);
  const staleViewIds = existingViews
    .filter((item) => !desiredTokenIds.has(String(item.metadata?.[LOCAL_SELF_VIEW_KEY]?.tokenId ?? "")))
    .map((item) => item.id);

  if (staleViewIds.length) {
    await OBR.scene.local.deleteItems(staleViewIds);
    removeLocalItemsFromCache(staleViewIds);
  }

  const currentViews = localSceneItems.filter(isLocalSelfViewItem);
  const viewIdsToReplace = [];
  const itemsToAdd = [];

  for (const token of desiredTokens) {
    const existingView = currentViews.find(
      (item) => item.metadata?.[LOCAL_SELF_VIEW_KEY]?.tokenId === token.id,
    );
    const nextSignature = buildLocalSelfViewSignature(token);
    if (existingView?.metadata?.[LOCAL_SELF_VIEW_KEY]?.signature === nextSignature) {
      continue;
    }
    if (existingView) {
      viewIdsToReplace.push(existingView.id);
    }
    itemsToAdd.push(await buildLocalSelfViewItem(token));
  }

  if (viewIdsToReplace.length) {
    await OBR.scene.local.deleteItems(viewIdsToReplace);
    removeLocalItemsFromCache(viewIdsToReplace);
  }
  if (itemsToAdd.length) {
    await OBR.scene.local.addItems(itemsToAdd);
    upsertLocalItemsInCache(itemsToAdd);
  }
}

async function teardownTargetPickerTool() {
  if (!targetPickState.toolReady) return;

  try {
    await OBR.tool.removeMode(TARGET_PICK_MODE_ID);
  } catch (error) {
    console.warn("[Body HP] Unable to remove target picker mode", error);
  }

  try {
    await OBR.tool.remove(TARGET_PICK_TOOL_ID);
  } catch (error) {
    console.warn("[Body HP] Unable to remove target picker tool", error);
  }

  targetPickState.toolReady = false;
}

async function restorePreviousTool() {
  const previousToolId = targetPickState.previousToolId;
  const previousModeId = targetPickState.previousModeId;
  if (!previousToolId || previousToolId === TARGET_PICK_TOOL_ID) return;

  targetPickState.restoring = true;
  try {
    await OBR.tool.activateTool(previousToolId);
    if (previousModeId) {
      try {
        await OBR.tool.activateMode(previousToolId, previousModeId);
      } catch (error) {
        console.warn("[Body HP] Unable to restore previous tool mode", error);
      }
    }
  } finally {
    targetPickState.restoring = false;
  }
}

async function stopTargetPick(statusMessage = "", statusKind = "info") {
  const wasActive = targetPickState.active;
  targetPickState.active = false;
  targetPickState.attackerTokenId = null;
  await targetDistance?.clear();
  scheduleRender();

  if (wasActive) {
    await restorePreviousTool();
  }

  await teardownTargetPickerTool();

  targetPickState.previousToolId = "";
  targetPickState.previousModeId = undefined;

  if (statusMessage) {
    setStatus(statusMessage, statusKind);
  }
}

async function ensureTargetPickerTool() {
  if (targetPickState.toolReady) return;

  await OBR.tool.create({
    id: TARGET_PICK_TOOL_ID,
    icons: [{ icon: EXTENSION_ICON_URL, label: "Pick Attack Target" }],
    defaultMode: TARGET_PICK_MODE_ID,
  });

  await OBR.tool.createMode({
    id: TARGET_PICK_MODE_ID,
    icons: [{ icon: EXTENSION_ICON_URL, label: "Pick Attack Target" }],
    cursors: [{ cursor: TARGET_PICK_CURSOR }],
    onToolMove: (_context,event)=>{
      if(!targetPickState.active||!targetDistance)return;
      const source=getCharacterById(targetPickState.attackerTokenId);if(!source||!canUseToken(source))return;
      const hovered=event.target&&isCharacterToken(event.target)&&event.target.visible!==false?getCharacterById(event.target.id)||event.target:null;
      const target=hovered||event.pointerPosition;if(target)targetDistance.preview(source,target);
    },
    onToolClick: async (_context, event) => {
      if (!targetPickState.active) return false;

      const attacker = getCharacterById(targetPickState.attackerTokenId);
      const clickedTargetId = event.target?.id ?? "";
      const liveItems = clickedTargetId ? await OBR.scene.items.getItems() : [];
      const target =
        (clickedTargetId ? liveItems.find((item) => item.id === clickedTargetId) : null) ?? event.target;

      if (!attacker || !isCharacterToken(attacker)) {
        await stopTargetPick("Select an attacker token first.", "error");
        return false;
      }

      if (!target || !isCharacterToken(target)) {
        setStatus("Click a visible character token to use it as target.", "error");
        return false;
      }

      if (target.visible === false) {
        setStatus("Hidden tokens cannot be targeted.", "error");
        return false;
      }

      if (target.id === attacker.id) {
        setStatus("Attacker and target must be different tokens.", "error");
        return false;
      }

      const assigned = await assignAttackTarget(attacker, target);
      if (!assigned) return false;
      await stopTargetPick();
      return false;
    },
    onKeyDown: (_context, event) => {
      if (event.key === "Escape" && targetPickState.active) {
        void stopTargetPick("Target picking cancelled.", "info");
      }
    },
    onDeactivate: () => {
      if (targetPickState.active && !targetPickState.restoring) {
        void stopTargetPick("Target picking cancelled.", "info");
      }
    },
  });

  targetPickState.toolReady = true;
}

async function startTargetPick() {
  const attacker = getCharacterById(activeTokenId);
  if (!attacker) {
    setStatus("Select an attacker token first.", "error");
    return;
  }
  if (!canUseToken(attacker)) {
    setStatus("You cannot roll for this attacker token.", "error");
    return;
  }

  const targetCharacters = getCharacters().filter(
    (item) => item.id !== attacker.id && item.visible !== false,
  );
  if (!targetCharacters.length) {
    setStatus("Add at least one visible target token.", "error");
    return;
  }

  if (targetPickState.active && targetPickState.attackerTokenId === attacker.id) {
    await stopTargetPick("Target picking cancelled.", "info");
    return;
  }

  if (targetPickState.active) {
    await stopTargetPick();
  }

  targetPickState.previousToolId = await OBR.tool.getActiveTool();
  targetPickState.previousModeId = await OBR.tool.getActiveToolMode();
  targetPickState.attackerTokenId = attacker.id;
  targetPickState.active = true;
  measuredTargetDistance=null;

  await ensureTargetPickerTool();
  await OBR.tool.activateTool(TARGET_PICK_TOOL_ID);
  await OBR.tool.activateMode(TARGET_PICK_TOOL_ID, TARGET_PICK_MODE_ID);
  scheduleRender();
  setStatus("Click a visible target token on the map to assign it.", "info");
}

async function removeAttackTargetContextMenu() {
  try {
    await OBR.contextMenu.remove(ATTACK_TARGET_CONTEXT_MENU_ID);
  } catch (_error) {
    // Ignore missing menu registrations from older extension builds.
  }
}

function renderCollapsibleSection(title, content, open = false, sectionKey = "") {
  const scopedSectionKey = `${activeTokenId ?? "global"}:${sectionKey || title}`;
  const resolvedOpen = collapsibleSectionState.has(scopedSectionKey)
    ? collapsibleSectionState.get(scopedSectionKey)
    : open;

  return `
    <details class="collapsible-block" data-section-key="${escapeHtml(scopedSectionKey)}" ${resolvedOpen ? "open" : ""}>
      <summary class="collapsible-title">${escapeHtml(title)}</summary>
      <div class="collapsible-body">${content}</div>
    </details>
  `;
}

function pushPrivateGmEntry(title, body) {
  gmPrivateEntries = [
    {
      id: Date.now(),
      title,
      body,
      timestamp: new Date().toLocaleTimeString(),
    },
    ...gmPrivateEntries,
  ].slice(0, 12);
}

function rollCharacterCheck(attributeValue, modifier = 0) {
  const baseAttribute = Number(attributeValue) || 0;
  const finalAttribute = Math.max(0, baseAttribute + (Number(modifier) || 0));
  const roll = Math.floor(Math.random() * 20) + 1;
  let result = roll <= finalAttribute ? "Check Passed" : "Check Failed";
  let outcome = result === "Check Passed" ? "success" : "failure";

  if (roll === 1) {
    result = "Critical Success";
    outcome = "critical-success";
  } else if (roll === 20) {
    result = "Critical Failure";
    outcome = "critical-failure";
  }

  return {
    roll,
    baseAttribute,
    modifier: Number(modifier) || 0,
    finalAttribute,
    result,
    outcome,
  };
}

function rollSkillCheck(skillValue, modifier = 0) {
  const baseSkill = Number(skillValue) || 0;
  const rollPrimary = Math.floor(Math.random() * 100) + 1;
  const rollSecondary = Math.floor(Math.random() * 100) + 1;
  const totalPrimary = rollPrimary + baseSkill * 10 + (Number(modifier) || 0);
  const totalSecondary = rollSecondary;
  let result = totalPrimary > totalSecondary ? "Check Passed" : "Check Failed";
  let outcome = result === "Check Passed" ? "success" : "failure";

  if (rollPrimary >= 95) {
    result = "Critical Success";
    outcome = "critical-success";
  } else if (rollPrimary <= 5) {
    result = "Critical Failure";
    outcome = "critical-failure";
  }

  return {
    rollPrimary,
    rollSecondary,
    baseSkill,
    modifier: Number(modifier) || 0,
    totalPrimary,
    totalSecondary,
    result,
    outcome,
  };
}

function renderOwnerFields(data, disabledAttr) {
  const playerOptions = [
    `<option value="">Unassigned</option>`,
    ...getSortedPartyPlayers().map(
      (player) => `
        <option value="${escapeHtml(player.id)}" ${
          data.avallon.owner.playerId === player.id ? "selected" : ""
        }>${escapeHtml(player.name || player.id)}</option>`
    ),
  ].join("");

  return renderCollapsibleSection(
    "Ownership",
    `
      <div class="hint-box">
        <div class="field-label">Current viewer</div>
        <pre class="console-output">Name: ${escapeHtml(playerName || "Unknown")}
Player ID: ${escapeHtml(playerId || "Unavailable")}</pre>
      </div>
      <div class="form-grid">
        <label class="field-stack">
          <span class="field-label">Assigned Player</span>
          <select data-action="select-owner-player" ${disabledAttr}>${playerOptions}</select>
        </label>
      </div>
      <div class="ownership-transfer">
        <input type="file" accept=".json,.txt,.avallon-token.json" data-token-import-input hidden>
        ${isEditable()&&characterTools?characterTools.renderTemplates():""}
      </div>
    `,
    false,
  );
}

function legacyRenderCharacteristicsBlock(data, disabledAttr) {
  const attributeInputs = ATTRIBUTE_FIELDS.map(
    ([key, label]) => `
      <label class="field-stack">
        <span class="field-label">${escapeHtml(label)}</span>
        <input type="text" inputmode="numeric" value="${data.avallon.attributes[key] ?? 0}" data-action="set-avallon-attribute" data-attribute="${escapeHtml(key)}" ${disabledAttr}>
      </label>`
  ).join("");

  return renderCollapsibleSection(
    "Characteristics",
    `<div class="form-grid">${attributeInputs}</div>`,
    false,
  );
}

function legacyRenderSkillsBlock(data, disabledAttr) {
  const skillRows = Object.entries(data.avallon.skills)
    .map(
      ([key, value]) => `
        <div class="skill-row">
          <div class="skill-name">${escapeHtml(key)}</div>
          <input type="number" min="0" max="10" value="${value}" data-action="set-avallon-skill" data-skill="${escapeHtml(key)}" ${disabledAttr}>
          <button type="button" class="danger" data-action="remove-skill" data-skill="${escapeHtml(key)}" ${disabledAttr}>Remove</button>
        </div>`
    )
    .join("");

  return renderCollapsibleSection(
    "Навыки",
    `
      <div class="list">${skillRows || '<div class="empty">No skills yet.</div>'}</div>
      <div class="form-grid">
        <label class="field-stack">
          <span class="field-label">Название Навыка</span>
          <input type="text" data-skill-field="new-name" placeholder="New skill" ${disabledAttr}>
        </label>
        <label class="field-stack">
          <span class="field-label">Значение</span>
          <input type="number" min="0" max="10" value="0" data-skill-field="new-value" ${disabledAttr}>
        </label>
      </div>
      <div class="row row-gap">
        <button type="button" class="secondary" data-action="add-skill" ${disabledAttr}>Add Skill</button>
      </div>
    `,
    false,
  );
}

function legacyRenderCombatBlock(token, data, tokenLocked) {
  const targetCharacters = getCharacters().filter((item) => item.id !== token.id);
  const defaultTargetId = resolveDefaultTargetTokenId(token.id);
  const disabledAttr = tokenLocked || !targetCharacters.length ? "disabled" : "";
  const skillOptions = Object.entries(data.avallon.skills)
    .map(([key, value]) => `<option value="${escapeHtml(key)}">${escapeHtml(key)} (${value})</option>`)
    .join("");
  const defaultWeapon = getAvailableWeapons(token, "melee")[0] ?? { damage: 0 };

  return renderCollapsibleSection(
    "Атака",
    `
      <div class="form-grid">
        <label class="field-stack">
          <span class="field-label">Attack skill</span>
          <select data-attack-field="skill">${skillOptions}</select>
        </label>
        <label class="field-stack">
          <span class="field-label">Target token</span>
          <select data-attack-field="targetTokenId" ${disabledAttr}>
            ${targetCharacters
              .map(
                (target) =>
                  `<option value="${target.id}" ${target.id === draft.targetTokenId ? "selected" : ""}>${escapeHtml(
                    getCharacterName(target)
                  )}</option>`
              )
              .join("")}
          </select>
        </label>
        <label class="field-stack">
          <span class="field-label">Target body part</span>
          <select data-attack-field="targetPart">
            ${BODY_ORDER.map(
              (part) =>
                `<option value="${part}" ${part === draft.targetPart ? "selected" : ""}>${part}</option>`
            ).join("")}
          </select>
        </label>
        <label class="field-stack">
          <span class="field-label">Weapon damage</span>
          <input type="number" value="${draft.weaponDamage}" data-attack-field="weaponDamage" ${disabledAttr}>
        </label>
        <label class="field-stack">
          <span class="field-label">Attack bonuses</span>
          <input type="number" value="${draft.attackBonuses}" data-attack-field="attackBonuses" ${disabledAttr}>
        </label>
        <label class="field-stack">
          <span class="field-label">Attack penalties</span>
          <input type="number" value="${draft.attackPenalties}" data-attack-field="attackPenalties" ${disabledAttr}>
        </label>
        <label class="field-stack">
          <span class="field-label">Defense bonuses</span>
          <input type="number" value="${draft.defenseBonuses}" data-attack-field="defenseBonuses" ${disabledAttr}>
        </label>
        <label class="field-stack">
          <span class="field-label">Defense penalties</span>
          <input type="number" value="${draft.defensePenalties}" data-attack-field="defensePenalties" ${disabledAttr}>
        </label>
      </div>
      <div class="muted">${
        targetCharacters.length
          ? "Attack goes from the selected attacker token to the chosen target token."
          : "Add at least two character tokens to perform an attack."
      }</div>
      <div class="muted">For Hand/Cold attacks, Strength above 10 adds bonus weapon damage automatically.</div>
      <div class="row row-gap">
        <button type="button" class="success" data-action="perform-attack" ${disabledAttr}>Attack</button>
      </div>
    `,
    true,
  );
}

function legacyRenderDiceBlock(token, data, tokenLocked) {
  if (!canViewDiceBlock(token)) return "";

  const attributeOptions = ATTRIBUTE_FIELDS
    .filter(([key]) => key !== "Parry")
    .map(
      ([key, label]) =>
        `<option value="${escapeHtml(key)}">${escapeHtml(label)} (${data.avallon.attributes[key] ?? 0})</option>`
    )
    .join("");
  const skillOptions = Object.entries(data.avallon.skills)
    .map(([key, value]) => `<option value="${escapeHtml(key)}">${escapeHtml(key)} (${value})</option>`)
    .join("");
  const tokenLockedAttr = tokenLocked ? "disabled" : "";

  return renderCollapsibleSection(
    "Dice",
    `
      <div class="form-grid">
        <label class="field-stack">
          <span class="field-label">Dice sides</span>
          <input type="number" min="2" value="20" data-roll-field="dice">
        </label>
        <label class="field-stack">
          <span class="field-label">Modifier</span>
          <input type="number" value="0" data-roll-field="modifier">
        </label>
      </div>
      <div class="row row-gap">
        <button type="button" data-action="perform-roll-dice">Roll Dice</button>
      </div>

      <div class="form-grid">
        <label class="field-stack">
          <span class="field-label">Roll_Char</span>
          <select data-roll-char-field="attribute" ${tokenLockedAttr}>${attributeOptions}</select>
        </label>
        <label class="field-stack">
          <span class="field-label">Bonus / Penalty</span>
          <input type="number" value="0" data-roll-char-field="modifier" ${tokenLockedAttr}>
        </label>
      </div>
      <div class="row row-gap">
        <button type="button" data-action="perform-roll-char" ${tokenLockedAttr}>Roll Char</button>
      </div>

      <div class="form-grid">
        <label class="field-stack">
          <span class="field-label">Roll_Skill</span>
          <select data-roll-skill-field="skill" ${tokenLockedAttr}>${skillOptions}</select>
        </label>
        <label class="field-stack">
          <span class="field-label">Bonus / Penalty</span>
          <input type="number" value="0" data-roll-skill-field="modifier" ${tokenLockedAttr}>
        </label>
      </div>
      <div class="row row-gap">
        <button type="button" data-action="perform-roll-skill" ${tokenLockedAttr}>Roll Skill</button>
      </div>
    `,
    false,
  );
}

function legacyRenderPrivateGmDiceBlock() {
  if (!isEditable()) return "";

  const privateLog = gmPrivateEntries.length
    ? gmPrivateEntries
        .map(
          (entry) => `
            <div class="debug-entry">
              <div class="debug-head">
                <div class="debug-title">${escapeHtml(entry.title)}</div>
                <div class="muted">${escapeHtml(entry.timestamp)}</div>
              </div>
              <pre class="console-output">${escapeHtml(entry.body)}</pre>
            </div>`
        )
        .join("")
    : '<div class="empty">Private GM rolls will stay visible only here.</div>';

  return renderCollapsibleSection(
    "GM Private Dice",
    `
      <div class="form-grid">
        <label class="field-stack">
          <span class="field-label">Dice sides</span>
          <input type="number" min="2" value="20" data-gm-roll-field="dice">
        </label>
        <label class="field-stack">
          <span class="field-label">Modifier</span>
          <input type="number" value="0" data-gm-roll-field="modifier">
        </label>
      </div>
      <div class="row row-gap">
        <button type="button" data-action="perform-gm-private-roll">GM Roll</button>
      </div>
      <div class="list">${privateLog}</div>
    `,
    false,
  );
}

function legacyRenderSelectedToken() {
  activeTokenId = resolveActiveTokenId();
  const token = getCharacterById(activeTokenId);

  if (!token) {
    ui.selectionHint.textContent = "No character token selected";
    delete ui.selectedTokenPanel.dataset.tokenId;
    ui.selectedTokenPanel.innerHTML =
      '<div class="empty">Add a character token to the map from Owlbear Rodeo Characters, then select it.</div>';
    return;
  }

  const tracked = isTrackedCharacter(token);
  const data = getTrackerData(token);
  const avallon = getAvallonData(token);
  const totals = getBodyTotals(data);
  const selected = selectionIds.includes(token.id);
  const tokenLocked = !canUseToken(token);
  const lastRollText = data.lastRoll
    ? escapeHtml(data.lastRoll.summary || "Last roll recorded")
    : "No rolls synced yet";

  ui.selectionHint.textContent = selected ? "Selected on map" : "Showing current focus";

  const fieldDisabled = !canEditTokenData(token) ? "disabled" : "";
  const avallonOwnerDisabled = !isEditable() ? "disabled" : "";

  ui.selectedTokenPanel.dataset.tokenId = token.id;
  ui.selectedTokenPanel.innerHTML = `
    <div class="selected-card">
      <div class="selected-head">
        <div>
          <div class="token-name">${escapeHtml(getCharacterName(token))}</div>
          <div class="token-meta">${escapeHtml(token.id.slice(0, 8))} - ${
            tracked ? "Initialized" : "Auto-init on selection"
          } - ${tokenLocked ? "Read only" : "Controllable"}</div>
        </div>
        <div class="row row-gap">
          <button type="button" data-action="open-character-hud" class="secondary">Floating HUD</button>
          <button type="button" data-action="focus-token" class="secondary">Select On Map</button>
          <button type="button" data-action="reload-token-visuals" class="secondary" ${tokenLocked ? "disabled" : ""}>Reload Token</button>
        </div>
      </div>

      <div class="summary-strip">
        ${
          canViewBodyHpSummary(token)
            ? `
              <div class="stat-chip">
                <span class="chip-label">Body HP</span>
                <span class="chip-value">${totals.current}/${totals.max}</span>
              </div>
            `
            : ""
        }
        <div class="stat-chip">
          <span class="chip-label">Owner</span>
          <span class="chip-value">${escapeHtml(avallon.owner.playerName || avallon.owner.playerId || "Unassigned")}</span>
        </div>
      </div>

      ${renderOwnerFields({ avallon }, avallonOwnerDisabled)}
      ${renderCharacteristicsBlock({ avallon }, avallonOwnerDisabled)}
      ${renderSkillsBlock({ avallon }, avallonOwnerDisabled)}
      ${renderCombatBlock(token, { avallon }, tokenLocked)}
      ${renderDiceBlock(token, { avallon }, tokenLocked)}
      ${
        SHOW_EMBEDDED_PUBLIC_LOG
          ? renderCollapsibleSection(
              "Last roll summary",
              `<pre class="console-output">${lastRollText}</pre>`,
              false,
            )
          : ""
      }
      ${renderCollapsibleSection(
        "Part",
        `
          <div class="row row-gap">
            <button type="button" class="secondary" data-action="heal-limbs" ${fieldDisabled}>Heal</button>
          </div>
          <div class="body-table-wrap">
            <table class="body-table">
              <thead>
                <tr>
                  <th>Part</th>
                  <th>Current HP</th>
                  <th>Max HP</th>
                  <th>Armor</th>
                </tr>
              </thead>
              <tbody>
                ${BODY_ORDER.map((partName) => {
                  const part = data.body[partName];
                  return `
                    <tr>
                      <td class="part-name">${escapeHtml(partName)}</td>
                      <td>
                        <div class="inline-stepper">
                          <button type="button" data-action="change-part" data-part="${escapeHtml(
                            partName
                          )}" data-field="current" data-delta="-1" ${fieldDisabled}>-</button>
                          <input type="text" inputmode="numeric" min="0" max="${part.max}" value="${part.current}" data-action="set-field" data-part="${escapeHtml(
                            partName
                          )}" data-field="current" ${fieldDisabled}>
                          <button type="button" data-action="change-part" data-part="${escapeHtml(
                            partName
                          )}" data-field="current" data-delta="1" ${fieldDisabled}>+</button>
                        </div>
                      </td>
                      <td>
                        <input class="compact-input" type="text" inputmode="numeric" min="0" max="999" value="${part.max}" data-action="set-field" data-part="${escapeHtml(
                          partName
                        )}" data-field="max" ${fieldDisabled}>
                      </td>
                      <td>
                        <input class="compact-input" type="text" inputmode="numeric" min="0" max="999" value="${part.armor}" data-action="set-field" data-part="${escapeHtml(
                          partName
                        )}" data-field="armor" ${fieldDisabled}>
                      </td>
                    </tr>
                  `;
                }).join("")}
              </tbody>
            </table>
          </div>
        `,
        true,
      )}
      ${
        canViewOverlayPreview(token)
          ? renderCollapsibleSection(
              "Overlay preview",
              `<pre class="console-output">${escapeHtml(formatOverlayPreviewText(data))}</pre>`,
              false,
            )
          : ""
      }
    </div>`;
}

function renderCharacteristicsBlock(data) {
  return renderCollapsibleSection("Characteristics", attributeCards(data.avallon, ATTRIBUTE_UI_FIELDS, isEditable()&&!data.avallon.pilot), true);
}

function renderSkillsBlock(data, disabledAttr) {
  const skillRows = Object.entries(data.avallon.skills)
    .map(
      ([key, value]) => `
        <div class="skill-row">
          <div class="skill-name">${escapeHtml(key)}</div>
          <input type="number" min="0" max="10" value="${value}" data-action="set-avallon-skill" data-skill="${escapeHtml(key)}" ${disabledAttr}>
          <button type="button" class="danger" data-action="remove-skill" data-skill="${escapeHtml(key)}" ${
            CORE_COMBAT_SKILLS.includes(key) ? "disabled" : disabledAttr
          }>${CORE_COMBAT_SKILLS.includes(key) ? "Core" : "Remove"}</button>
        </div>`
    )
    .join("");

  return renderCollapsibleSection(
    "Навыки",
    `
      <div class="list">${skillRows || '<div class="empty">No skills yet.</div>'}</div>
      <div class="form-grid">
        <label class="field-stack">
          <span class="field-label">Название навыка</span>
          <input type="text" data-skill-field="new-name" placeholder="New skill" ${disabledAttr}>
        </label>
        <label class="field-stack">
          <span class="field-label">Значение</span>
          <input type="number" min="0" max="10" value="0" data-skill-field="new-value" ${disabledAttr}>
        </label>
      </div>
      <div class="row row-gap">
        <button type="button" class="secondary" data-action="add-skill" ${disabledAttr}>Add Skill</button>
      </div>
    `,
    false,
  );
}

function renderCombatBlock(token, data, tokenLocked) {
  const targetCharacters = getCharacters().filter(
    (item) => item.id !== token.id && item.visible !== false,
  );
  const disabledAttr = tokenLocked || !targetCharacters.length ? "disabled" : "";
  const draft = getAttackDraft(token, data, targetCharacters);
  const skillOptions = CORE_COMBAT_SKILLS.map(
    (key) =>
      `<option value="${escapeHtml(key)}" ${
        draft.skill === key ? "selected" : ""
      }>${escapeHtml(key)} (${data.avallon.skills[key] ?? 0})</option>`
  ).join("");

  return renderCollapsibleSection(
    "Атака",
    `
      <div class="form-grid">
        <label class="field-stack">
          <span class="field-label">Attack skill</span>
          <select data-attack-field="skill" ${disabledAttr}>${skillOptions}</select>
        </label>
        <label class="field-stack">
          <span class="field-label">Target token</span>
          <select data-attack-field="targetTokenId" ${disabledAttr}>
            ${targetCharacters
              .map(
                (target) =>
                  `<option value="${target.id}" ${target.id === draft.targetTokenId ? "selected" : ""}>${escapeHtml(
                    getCharacterName(target)
                  )}</option>`
              )
              .join("")}
          </select>
        </label>
        <label class="field-stack">
          <span class="field-label">Target body part</span>
          <select data-attack-field="targetPart" ${disabledAttr}>
            ${BODY_ORDER.map(
              (part) =>
                `<option value="${part}" ${part === draft.targetPart ? "selected" : ""}>${part}</option>`
            ).join("")}
          </select>
        </label>
        <label class="field-stack">
          <span class="field-label">Weapon damage</span>
          <input type="number" value="${draft.weaponDamage}" data-attack-field="weaponDamage" ${disabledAttr}>
        </label>
        <label class="field-stack">
          <span class="field-label">Attack bonuses</span>
          <input type="number" value="${draft.attackBonuses}" data-attack-field="attackBonuses" ${disabledAttr}>
        </label>
        <label class="field-stack">
          <span class="field-label">Attack penalties</span>
          <input type="number" value="${draft.attackPenalties}" data-attack-field="attackPenalties" ${disabledAttr}>
        </label>
        <label class="field-stack">
          <span class="field-label">Defense bonuses</span>
          <input type="number" value="${draft.defenseBonuses}" data-attack-field="defenseBonuses" ${disabledAttr}>
        </label>
        <label class="field-stack">
          <span class="field-label">Defense penalties</span>
          <input type="number" value="${draft.defensePenalties}" data-attack-field="defensePenalties" ${disabledAttr}>
        </label>
      </div>
      <div class="muted">${
        targetCharacters.length
          ? "Attack goes from the selected attacker token to the chosen target token."
          : "Add at least two character tokens to perform an attack."
      }</div>
      <div class="muted">For Hand/Cold attacks, Strength above 10 adds bonus weapon damage automatically.</div>
      <div class="row row-gap">
        <button type="button" class="success" data-action="perform-attack" ${disabledAttr}>Attack</button>
      </div>
    `,
    true,
  );
}

function renderDiceBlock(token, data, tokenLocked) {
  const attributeOptions = ATTRIBUTE_UI_FIELDS
    .filter(([key]) => key !== "Parry")
    .map(
      ([key, label]) =>
        `<option value="${escapeHtml(key)}">${escapeHtml(label)} (${data.avallon.attributes[key] ?? 0})</option>`
    )
    .join("");
  const skillOptions = Object.entries(data.avallon.skills)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `<option value="${escapeHtml(key)}">${escapeHtml(key)} (${value})</option>`)
    .join("");
  const tokenLockedAttr = tokenLocked ? "disabled" : "";

  return renderCollapsibleSection(
    "Dice",
    `
      <div class="form-grid">
        <label class="field-stack">
          <span class="field-label">Dice sides</span>
          <input type="number" min="2" value="20" data-roll-field="dice">
        </label>
        <label class="field-stack">
          <span class="field-label">Modifier</span>
          <input type="number" value="0" data-roll-field="modifier">
        </label>
      </div>
      <div class="row row-gap">
        <button type="button" data-action="perform-roll-dice">Roll Dice</button>
      </div>

      <div class="form-grid">
        <label class="field-stack">
          <span class="field-label">Roll_Char</span>
          <select data-roll-char-field="attribute" ${tokenLockedAttr}>${attributeOptions}</select>
        </label>
        <label class="field-stack">
          <span class="field-label">Bonus / Penalty</span>
          <input type="number" value="0" data-roll-char-field="modifier" ${tokenLockedAttr}>
        </label>
      </div>
      <div class="row row-gap">
        <button type="button" data-action="perform-roll-char" ${tokenLockedAttr}>Roll Char</button>
      </div>

      <div class="form-grid">
        <label class="field-stack">
          <span class="field-label">Roll_Skill</span>
          <select data-roll-skill-field="skill" ${tokenLockedAttr}>${skillOptions}</select>
        </label>
        <label class="field-stack">
          <span class="field-label">Bonus / Penalty</span>
          <input type="number" value="0" data-roll-skill-field="modifier" ${tokenLockedAttr}>
        </label>
      </div>
      <div class="row row-gap">
        <button type="button" data-action="perform-roll-skill" ${tokenLockedAttr}>Roll Skill</button>
      </div>
    `,
    false,
  );
}

function renderAvallonSkillRows(avallon, skillEntries, disabledAttr) {
  return skillEntries
    .map(
      ([key, value]) => {
        const perks = Array.isArray(avallon.skillPerks?.[key]) ? avallon.skillPerks[key] : [];
        const canRemove = !CORE_COMBAT_SKILLS.includes(key);
        return `
        <div class="skill-row">
          <div class="skill-name"><input type="text" value="${escapeHtml(getSkillLabel(avallon, key))}" data-action="rename-avallon-skill" data-skill="${escapeHtml(key)}" maxlength="40" ${disabledAttr}></div>
          <input type="number" min="0" max="10" value="${value}" data-action="set-avallon-skill" data-skill="${escapeHtml(key)}" ${disabledAttr}>
          <label class="skill-toggle">
            <input type="checkbox" data-action="set-skill-strength-bonus" data-skill="${escapeHtml(key)}" ${disabledAttr} ${
              getSkillStrengthBonusFlag(avallon, key) ? "checked" : ""
            }>
            <span>STR Bonus</span>
          </label>
          ${canRemove ? `<button type="button" class="square-icon-button danger" data-action="remove-skill" data-skill="${escapeHtml(key)}" title="Remove skill" aria-label="Remove ${escapeHtml(getSkillLabel(avallon, key))}" ${disabledAttr}>×</button>` : ""}
          ${perks.length ? `<div class="skill-perks">${perks.map((perk, perkIndex) => `<span class="skill-perk">${escapeHtml(perk)}<button type="button" data-action="remove-skill-perk" data-skill="${escapeHtml(key)}" data-perk-index="${perkIndex}" title="Remove perk" aria-label="Remove perk">-</button></span>`).join("")}</div>` : ""}
          ${skillPerkAddSkill === key ? `<div class="skill-perk-editor"><input type="text" maxlength="40" placeholder="Perk name" data-skill-perk-field="name"><button type="button" class="square-icon-button" data-action="save-skill-perk" data-skill="${escapeHtml(key)}" title="Save perk" aria-label="Save perk">▣</button><button type="button" class="square-icon-button danger" data-action="cancel-skill-perk" title="Cancel" aria-label="Cancel">×</button></div>` : ""}
          <div class="skill-perk-actions"><button type="button" class="skill-perk-add" data-action="open-skill-perk" data-skill="${escapeHtml(key)}" title="Add perk" aria-label="Add perk" ${disabledAttr}>+</button></div>
        </div>`;
      },
    )
    .join("");
}

function renderAvallonSkillsBlock(data, disabledAttr) {
  const combatSkillRows = renderAvallonSkillRows(
    data.avallon,
    getCombatSkillEntries(data.avallon),
    disabledAttr,
  );
  const appliedSkillRows = renderAvallonSkillRows(
    data.avallon,
    getAppliedSkillEntries(data.avallon),
    disabledAttr,
  );

  return renderCollapsibleSection(
    "РќР°РІС‹РєРё",
    `
      <div class="field-label">Боевые</div>
      <div class="list">${combatSkillRows || '<div class="empty">Нет боевых навыков.</div>'}</div>
      <div class="field-label">Прикладные</div>
      <div class="list">${appliedSkillRows || '<div class="empty">Нет прикладных навыков.</div>'}</div>
      <div class="form-grid">
        <label class="field-stack">
          <span class="field-label">РќР°Р·РІР°РЅРёРµ РЅР°РІС‹РєР°</span>
          <input type="text" data-skill-field="new-name" placeholder="New skill" ${disabledAttr}>
        </label>
        <label class="field-stack">
          <span class="field-label">Р—РЅР°С‡РµРЅРёРµ</span>
          <input type="number" min="0" max="10" value="0" data-skill-field="new-value" ${disabledAttr}>
        </label>
        <label class="field-stack">
          <span class="field-label">Категория</span>
          <select data-skill-field="new-category" ${disabledAttr}>
            <option value="${COMBAT_SKILL_CATEGORY}">Боевой</option>
            <option value="${ABILITIES_SKILL_CATEGORY}">Abilities</option>
            <option value="${APPLIED_SKILL_CATEGORY}" selected>Прикладной</option>
          </select>
        </label>
      </div>
      <div class="row row-gap">
        <button type="button" class="secondary" data-action="add-skill" ${disabledAttr}>Add Skill</button>
      </div>
    `,
    false,
  );
}

function renderAvallonAttackBlock(token, data, tokenLocked) {
  const targetCharacters = getCharacters().filter(
    (item) => item.id !== token.id && item.visible !== false,
  );
  const disabledAttr = tokenLocked || !targetCharacters.length ? "disabled" : "";
  const draft = getAttackDraft(token, data, targetCharacters);
  const combatSkillEntries = getCombatSkillEntries(data.avallon);
  const skillOptions = buildSkillOptions(combatSkillEntries, draft.skill, data.avallon);

  return renderCollapsibleSection(
    "РђС‚Р°РєР°",
    `
      <div class="form-grid">
        <label class="field-stack">
          <span class="field-label">Attack skill</span>
          <select data-attack-field="skill" ${disabledAttr}>${skillOptions}</select>
        </label>
        <label class="field-stack">
          <span class="field-label">Target token</span>
          <select data-attack-field="targetTokenId" ${disabledAttr}>
            ${targetCharacters
              .map(
                (target) =>
                  `<option value="${target.id}" ${target.id === draft.targetTokenId ? "selected" : ""}>${escapeHtml(
                    getCharacterName(target)
                  )}</option>`
              )
              .join("")}
          </select>
        </label>
        <label class="field-stack">
          <span class="field-label">Target body part</span>
          <select data-attack-field="targetPart" ${disabledAttr}>
            ${BODY_ORDER.map(
              (part) =>
                `<option value="${part}" ${part === draft.targetPart ? "selected" : ""}>${part}</option>`
            ).join("")}
          </select>
        </label>
        <label class="field-stack">
          <span class="field-label">Weapon damage</span>
          <input type="number" value="${draft.weaponDamage}" data-attack-field="weaponDamage" ${disabledAttr}>
        </label>
        <label class="field-stack">
          <span class="field-label">Attack bonuses</span>
          <input type="number" value="${draft.attackBonuses}" data-attack-field="attackBonuses" ${disabledAttr}>
        </label>
        <label class="field-stack">
          <span class="field-label">Attack penalties</span>
          <input type="number" value="${draft.attackPenalties}" data-attack-field="attackPenalties" ${disabledAttr}>
        </label>
        <label class="field-stack">
          <span class="field-label">Defense bonuses</span>
          <input type="number" value="${draft.defenseBonuses}" data-attack-field="defenseBonuses" ${disabledAttr}>
        </label>
        <label class="field-stack">
          <span class="field-label">Defense penalties</span>
          <input type="number" value="${draft.defensePenalties}" data-attack-field="defensePenalties" ${disabledAttr}>
        </label>
      </div>
      <div class="muted">${
        targetCharacters.length
          ? "Attack goes from the selected attacker token to the chosen target token."
          : "Add at least two character tokens to perform an attack."
      }</div>
      <div class="muted">Для навыка "${escapeHtml(MELEE_SKILL_NAME)}" сила выше 10 автоматически добавляется к урону оружия.</div>
      <div class="row row-gap">
        <button type="button" class="success" data-action="perform-attack" ${disabledAttr}>Attack</button>
      </div>
    `,
    true,
  );
}

function renderAvallonDiceBlock(token, data, tokenLocked) {
  const attributeOptions = ATTRIBUTE_UI_FIELDS
    .filter(([key]) => key !== "Parry")
    .map(
      ([key, label]) =>
        `<option value="${escapeHtml(key)}">${escapeHtml(label)} (${data.avallon.attributes[key] ?? 0})</option>`
    )
    .join("");
  const skillOptions = buildGroupedSkillOptions(data.avallon);
  const tokenLockedAttr = tokenLocked ? "disabled" : "";

  return renderCollapsibleSection(
    "Dice",
    `
      <div class="form-grid">
        <label class="field-stack">
          <span class="field-label">Dice sides</span>
          <input type="number" min="2" value="20" data-roll-field="dice">
        </label>
        <label class="field-stack">
          <span class="field-label">Modifier</span>
          <input type="number" value="0" data-roll-field="modifier">
        </label>
      </div>
      <div class="row row-gap">
        <button type="button" data-action="perform-roll-dice">Roll Dice</button>
      </div>

      <div class="form-grid">
        <label class="field-stack">
          <span class="field-label">Характеристика</span>
          <select data-roll-char-field="attribute" ${tokenLockedAttr}>${attributeOptions}</select>
        </label>
        <label class="field-stack">
          <span class="field-label">Bonus / Penalty</span>
          <input type="number" value="0" data-roll-char-field="modifier" ${tokenLockedAttr}>
        </label>
      </div>
      <div class="row row-gap">
        <button type="button" data-action="perform-roll-char" ${tokenLockedAttr}>Характеристика</button>
      </div>

      <div class="form-grid">
        <label class="field-stack">
          <span class="field-label">Навык</span>
          <select data-roll-skill-field="skill" ${tokenLockedAttr}>${skillOptions}</select>
        </label>
        <label class="field-stack">
          <span class="field-label">Bonus / Penalty</span>
          <input type="number" value="0" data-roll-skill-field="modifier" ${tokenLockedAttr}>
        </label>
      </div>
      <div class="row row-gap">
        <button type="button" data-action="perform-roll-skill" ${tokenLockedAttr}>Навык</button>
      </div>
    `,
    false,
  );
}

function renderEnglishSkillsBlock(data) {
  const groups=SKILL_CATEGORIES.map(([key,label])=>[label,getSortedSkillEntries(data.avallon).filter(([name])=>getSkillCategory(data.avallon,name)===key&&(key!=='passive'||isEditable()||data.avallon.skills[name]>=1))]);
  return renderCollapsibleSection("Skills",skillCards(data.avallon,groups.map(([label,entries])=>[label,entries.filter(([key])=>!Object.hasOwn(ARMOR_TRAINING,key))]),isEditable()&&!data.avallon.pilot),true);
}

function renderAmmunitionBlock(avallon) {
  const numberField = (ammo, field, label, min = 0, max = 999) => `
    <label class="field-stack"><span class="field-label">${label}</span>
      <input type="number" min="${min}" max="${max}" step="1" value="${ammo[field]}"
        data-ammo-draft="${field}"></label>`;
  return renderCollapsibleSection("Ammunition", `
    ${(avallon.ammunition ?? []).map((ammo) => `
      <div class="ammo-entry" data-ammo-id="${escapeHtml(ammo.id)}">
        <label class="field-stack"><span class="field-label">Name</span>
          <input type="text" value="${escapeHtml(ammo.name)}" data-ammo-draft="name"></label>
        <div class="ammo-stats">
          ${numberField(ammo, "damage", "Damage / Round")}
          ${numberField(ammo, "penetration", "Armor Penetration", -999)}
          ${numberField(ammo, "quantity", "Reserve", 0, 999999)}
        </div>
        <div class="ammo-actions">
          <button type="button" class="square-icon-button" data-action="ammo-save" data-ammo-id="${escapeHtml(ammo.id)}" title="Save ammunition" aria-label="Save ammunition">▣</button>
          <button type="button" class="square-icon-button danger" data-action="ammo-remove" data-ammo-id="${escapeHtml(ammo.id)}" title="Remove ammunition" aria-label="Remove ammunition">×</button>
        </div>
      </div>`).join("") || '<div class="empty">No ammunition.</div>'}
    ${ammunitionAddOpen ? `<div class="ammo-entry ammo-new-form">
	  <label class="field-stack">
		<span class="field-label">Ammunition Name</span>
		<input type="text" data-ammo-draft="name" placeholder="New ammunition">
	  </label>

	  <div class="ammo-stats">
		<label class="field-stack"><span class="field-label">Damage / Round</span>
		  <input type="number" min="0" max="999" value="0" data-ammo-draft="damage"></label>
		<label class="field-stack"><span class="field-label">Armor Penetration</span>
		  <input type="number" min="-999" max="999" value="0" data-ammo-draft="penetration"></label>
		<label class="field-stack"><span class="field-label">Reserve</span>
		  <input type="number" min="0" max="999999" value="0" data-ammo-draft="quantity"></label>
	  </div>
	  <div class="ammo-actions"><button type="button" class="square-icon-button" data-action="ammo-save" title="Save ammunition" aria-label="Save ammunition">▣</button><button type="button" class="square-icon-button danger" data-action="close-ammo-add" title="Cancel" aria-label="Cancel">×</button></div>
	</div>` : ""}
    <div class="item-toolbar item-toolbar-bottom"><button type="button" class="square-icon-button" data-action="open-ammo-add" title="Add ammunition" aria-label="Add ammunition">+</button></div>
  `, false);
}

function renderWeaponRow(weapon, type, index, ammunition, disabledAttr) {
  const ranged = type === "ranged";
  const identity = weapon ? `data-weapon-type="${type}" data-weapon-index="${index}"` : "";
  return `
    <div class="weapon-entry" ${identity}>
      <div class="weapon-form-grid">
        <label class="field-stack"><span class="field-label">Type</span>
          <select data-weapon-draft="type" ${disabledAttr}>
            <option value="melee" ${!ranged ? "selected" : ""}>Melee</option>
            <option value="ranged" ${ranged ? "selected" : ""}>Ranged</option>
          </select></label>
        <label class="field-stack weapon-name-field"><span class="field-label">Weapon</span>
          <input type="text" value="${escapeHtml(weapon?.name ?? "")}" data-weapon-draft="name" ${disabledAttr}></label>
        <label class="field-stack"><span class="field-label">Accuracy</span>
          <input type="number" min="-999" max="999" value="${weapon?.accuracy ?? 0}" data-weapon-draft="accuracy" ${disabledAttr}></label>
        <label class="field-stack weapon-melee-fields ${ranged ? "hidden" : ""}"><span class="field-label">Weapon Damage</span>
          <input type="number" min="-999" max="999" value="${weapon?.damage ?? 0}" data-weapon-draft="damage" ${disabledAttr}></label>
        <label class="field-stack weapon-ranged-fields ${ranged ? "" : "hidden"}"><span class="field-label">Internal Capacity</span>
          <input type="number" min="0" max="999" step="1" value="${weapon?.capacity ?? 0}" data-weapon-draft="capacity" ${disabledAttr}></label>
        ${weapon && ranged ? `<div class="weapon-loaded"><span class="field-label">Loaded</span>
          <strong>${weapon.loaded} / ${weapon.capacity}</strong><span>${escapeHtml(ammunition.find((ammo) => ammo.id === weapon.loadedAmmoId)?.name || "Empty")}</span></div>` : ""}
      </div>
      ${weapon && ranged ? `
        <details data-section-key="ammo-compatible:${escapeHtml(weapon.id)}"><summary>Compatible Ammunition</summary>
          ${ammunition.map((ammo) => `<label class="ammo-choice"><input type="checkbox"
            data-weapon-draft="compatible" data-ammo-id="${escapeHtml(ammo.id)}"
            ${weapon.ammoIds.includes(ammo.id) ? "checked" : ""} ${disabledAttr}>${escapeHtml(ammo.name)}</label>`).join("")}
        </details>
        <div class="weapon-reload">
          <label class="field-stack"><span class="field-label">Reload Ammo</span>
            <select data-reload-ammo="${index}" ${disabledAttr}>
              ${ammunition.filter((ammo) => weapon.ammoIds.includes(ammo.id)).map((ammo) => `<option value="${escapeHtml(ammo.id)}" ${ammo.id === weapon.loadedAmmoId ? "selected" : ""}>${escapeHtml(ammo.name)} (${ammo.quantity})</option>`).join("")}
            </select></label>
          <div class="weapon-actions">
            <button type="button" data-action="ammo-reload" data-ranged-index="${index}" ${disabledAttr}>Reload</button>
            <button type="button" class="secondary" data-action="ammo-unload" data-ranged-index="${index}" ${disabledAttr}>Unload</button>
          </div>
        </div>
      ` : ""}
      <div class="weapon-actions weapon-actions-footer">
        <button type="button" class="square-icon-button" data-action="weapon-save" ${identity} ${disabledAttr} title="Save weapon" aria-label="Save weapon">▣</button>
        ${weapon ? `<button type="button" class="square-icon-button danger" data-action="weapon-remove" ${identity} ${disabledAttr} title="Remove weapon" aria-label="Remove weapon">×</button>` : `<button type="button" class="square-icon-button danger" data-action="close-weapon-add" ${disabledAttr} title="Cancel" aria-label="Cancel">×</button>`}
      </div>
    </div>`;
}

function toggleWeaponDraftFields(select) {
  const row = select.closest(".weapon-entry");
  if (!row) return;
  const ranged = select.value === "ranged";
  row.querySelectorAll(".weapon-melee-fields").forEach((field) => field.classList.toggle("hidden", ranged));
  row.querySelectorAll(".weapon-ranged-fields").forEach((field) => field.classList.toggle("hidden", !ranged));
}

async function saveWeapon(node) {
  if (!isEditable()) {
    throw new Error("Only the GM can edit weapons.");
  }

  const token = getCharacterById(activeTokenId);
  if (!token) throw new Error("Select a token first.");

  const row = node.closest(".weapon-entry");
  if (!row) throw new Error("Weapon form is missing.");
  const read = (field) => row.querySelector(`[data-weapon-draft="${field}"]`);
  const name = String(read("name")?.value ?? "").trim();
  const nextType = read("type")?.value === "ranged" ? "ranged" : "melee";
  const type = node.dataset.weaponType;
  const index = Number(node.dataset.weaponIndex);
  const accuracy = clamp(Number(read("accuracy")?.value) || 0, -999, 999);
  const damage = clamp(Number(read("damage")?.value) || 0, -999, 999);
  const capacity = clamp(Number(read("capacity")?.value) || 0, 0, 999);
  const ammoIds = Array.from(row.querySelectorAll('[data-weapon-draft="compatible"]:checked')).map((field) => field.dataset.ammoId);
  if (!name) throw new Error("Enter a weapon name first.");

  await updateTrackerData(token.id, (current) => {
    const next = structuredClone(current);
    const source = type ? next.avallon.weapons[type] ?? [] : [];
    const weapon = Number.isInteger(index) ? source[index] : null;
    const allWeapons = [...(next.avallon.weapons.melee ?? []), ...(next.avallon.weapons.ranged ?? [])];
    if (allWeapons.some((item) => item !== weapon && item.name === name)) throw new Error("A weapon with this name already exists.");
    if (weapon && type !== nextType) {
      if (type === "ranged" && weapon.loaded > 0) {
        const loadedAmmo = next.avallon.ammunition.find((ammo) => ammo.id === weapon.loadedAmmoId);
        if (loadedAmmo) loadedAmmo.quantity += weapon.loaded;
      }
      source.splice(index, 1);
    }
    if (nextType === "ranged") {
      const ranged = weapon && type === "ranged" ? weapon : { id: crypto.randomUUID(), loaded: 0, loadedAmmoId: "", ammoIds: [], damage: 0 };
      if (capacity < ranged.loaded) throw new Error("Unload rounds before reducing capacity.");
      if (ranged.loaded > 0 && !ammoIds.includes(ranged.loadedAmmoId)) throw new Error("Loaded ammunition must remain compatible.");
      Object.assign(ranged, { name, accuracy, capacity, ammoIds });
      if (!weapon || type !== "ranged") next.avallon.weapons.ranged.push(ranged);
    } else {
      const melee = weapon && type === "melee" ? weapon : {};
      Object.assign(melee, { name, damage, accuracy });
      if (!weapon || type !== "melee") next.avallon.weapons.melee.push(melee);
    }
    return next;
  });
}

async function saveAmmunition(node) {
  if (!isEditable()) throw new Error("Only the GM can edit ammunition.");
  const token = getCharacterById(activeTokenId);
  if (!token) throw new Error("Select a token first.");

  const row = node.closest(".ammo-entry");
  if (!row) throw new Error("Ammunition form is missing.");
  const read = (field) => row.querySelector(`[data-ammo-draft="${field}"]`);
  const name = String(read("name")?.value ?? "").trim();
  const ammoId = node.dataset.ammoId;
  if (!name) throw new Error("Enter an ammunition name first.");

  await updateTrackerData(token.id, (current) => {
    const next = structuredClone(current);
    const ammunition = next.avallon.ammunition ??= [];
    const ammo = ammunition.find((item) => item.id === ammoId);
    if (ammunition.some((item) => item !== ammo && item.name === name)) throw new Error("Ammunition with this name already exists.");
    const values = {
      name,
      damage: clamp(Number(read("damage")?.value) || 0, 0, 999),
      penetration: clamp(Number(read("penetration")?.value) || 0, -999, 999),
      quantity: clamp(Number(read("quantity")?.value) || 0, 0, 999999),
    };
    if (ammo) Object.assign(ammo, values);
    else ammunition.push({ id: crypto.randomUUID(), ...values });
    return next;
  });
}

function renderEnglishWeaponsBlock(data, disabledAttr) {
  const ammunition = data.avallon.ammunition ?? [];
  const weapons = [
    ...(data.avallon.weapons?.melee ?? []).map((weapon, index) => renderWeaponRow(weapon, "melee", index, ammunition, disabledAttr)),
    ...(data.avallon.weapons?.ranged ?? []).map((weapon, index) => renderWeaponRow(weapon, "ranged", index, ammunition, disabledAttr)),
  ].join("");
  return renderCollapsibleSection("Weapons", `
    ${weapons || '<div class="empty">No weapons yet.</div>'}
    ${weaponAddOpen ? renderWeaponRow(null, "melee", -1, ammunition, disabledAttr) : ""}
    <div class="item-toolbar item-toolbar-bottom"><button type="button" class="square-icon-button" data-action="open-weapon-add" title="Add weapon" aria-label="Add weapon">+</button></div>
  `, false);
}

function renderAttackAmmunition(token, draft, manual, disabledAttr) {
  const weapon = getWeaponByName(token, draft.weaponName);
  if (weapon.rangedIndex == null) return "";
  const ammo = getAvallonData(token).ammunition ?? [];
  const prefix = manual ? "data-manual-attack-field" : "data-attack-field";
  return `<label class="field-stack"><span class="field-label">Ammunition (${weapon.loaded}/${weapon.capacity})</span>
    <select ${prefix}="ammoId" ${disabledAttr}>
      <option value="" ${!weapon.loadedAmmoId ? "selected" : ""}>Empty</option>
      ${ammo.filter((item) => weapon.ammoIds.includes(item.id)).map((item) => `<option value="${escapeHtml(item.id)}"
        ${item.id === weapon.loadedAmmoId ? "selected" : "disabled"}>${escapeHtml(item.name)} (DMG ${item.damage}, AP ${item.penetration})${item.id === weapon.loadedAmmoId ? "" : " - Not loaded"}</option>`).join("")}
    </select></label>
    <label class="field-stack"><span class="field-label">Rounds / Attack</span>
      <input type="number" min="1" max="${weapon.loaded}" step="1" value="${Math.min(Number(draft.rounds) || 1, weapon.loaded) || 1}" ${prefix}="rounds" ${disabledAttr} ${weapon.loaded ? "" : "disabled"}></label>`;
}

async function editAmmunition(action, node) {
  if (!isEditable()) throw new Error("Only the GM can edit ammunition and reload weapons.");
  const token = getCharacterById(activeTokenId);
  if (!token) throw new Error("Select a token first.");
  const index = Number(node.dataset.rangedIndex);
  const ammoId = node.dataset.ammoId;
  const reloadId = action === "ammo-reload" ? getActionFieldValue(`[data-reload-ammo="${index}"]`) : "";
  await updateTrackerData(token.id, (current) => {
    const next = structuredClone(current);
    const data = next.avallon;
    data.ammunition ??= [];
    const weapon = data.weapons.ranged[index];
    if (action === "ammo-remove") {
      if (data.weapons.ranged.some((item) => item.loadedAmmoId === ammoId && item.loaded > 0)) throw new Error("Unload this ammunition before removing it.");
      data.ammunition = data.ammunition.filter((item) => item.id !== ammoId);
      for (const item of data.weapons.ranged) item.ammoIds = item.ammoIds.filter((id) => id !== ammoId);
    }
    if (action === "ammo-reload") {
      reloadMagazine(data, index, reloadId);
    }
    if ((action === "ranged-remove" || action === "ammo-unload") && weapon) {
      const loadedAmmo = data.ammunition.find((item) => item.id === weapon.loadedAmmoId);
      if (weapon.loaded && !loadedAmmo) throw new Error("Loaded ammunition is missing.");
      if (loadedAmmo) {
        if (loadedAmmo.quantity + weapon.loaded > 999999) throw new Error("Ammo reserve is full.");
        loadedAmmo.quantity += weapon.loaded;
      }
      weapon.loaded = 0;
      weapon.loadedAmmoId = "";
      if (action === "ranged-remove") data.weapons.ranged.splice(index, 1);
    }
    return next;
  });
}

function renderEnglishAttackBlock(token, data, tokenLocked) {
  if (!canViewAttackBlock(token)) return "";

  const targetCharacters = getCharacters().filter(
    (item) => item.id !== token.id && item.visible !== false,
  );
  const disabledAttr = tokenLocked ? "disabled" : "";
  const pickDisabledAttr = tokenLocked || !targetCharacters.length ? "disabled" : "";
  const draft = getAttackDraft(token, data, targetCharacters);
  const skillOptions = buildSkillOptions(getAttackSkillEntries(data.avallon), draft.skill, data.avallon);
  const weaponOptions = buildWeaponOptions(getAttackSelectableWeapons(token), draft.weaponName);
  const selectedTarget = targetCharacters.find((target) => target.id === draft.targetTokenId) ?? null;
  const selectedTargetData = selectedTarget ? getTrackerData(selectedTarget) : null;
  const targetableBodyParts = getTargetableBodyParts(selectedTargetData, isEditable());
  const targetName = selectedTarget
    ? getCharacterName(selectedTarget)
    : draft.targetTokenName || "No target selected";
  const isPickingTarget = targetPickState.active && targetPickState.attackerTokenId === token.id;
  const attackDisabledAttr = tokenLocked || !draft.targetTokenId ? "disabled" : "";
  const weaponAccuracyDisplay = Number(draft.weaponAccuracy) || 0;

  return renderCollapsibleSection(
    "Attack",
    `
      <div data-combat-layout="attack">
      <div class="combat-form-grid">
        <input type="hidden" value="${escapeHtml(draft.targetTokenId)}" data-attack-field="targetTokenId">
        <label class="field-stack">
          <span class="field-label">Attack Skill</span>
          <select data-attack-field="skill" ${disabledAttr}>${skillOptions}</select>
        </label>
        <label class="field-stack">
          <span class="field-label">Weapon</span>
          <select data-attack-field="weaponName" ${disabledAttr}>${weaponOptions}</select>
          <span class="od-range-readout cp-muted" data-range-modifier="attack"></span>
        </label>
        <label class="field-stack">
          <span class="field-label">Current Target</span>
          <div class="combat-value">${escapeHtml(targetName)}</div>
          <span class="od-target-distance" data-target-distance title="Distance between token centres">${measuredTargetDistance?.sourceId===token.id?escapeHtml(measuredTargetDistance.label):"—"}</span>
        </label>
        <label class="field-stack">
          <span class="field-label">Pick On Map</span>
          <button type="button" class="secondary" data-action="pick-attack-target" ${pickDisabledAttr}>
            ${isPickingTarget ? "Cancel Target Pick" : "Pick Target On Map"}
          </button>
        </label>
        <label class="field-stack">
          <span class="field-label">Target Body Part</span>
          <select data-attack-field="targetPart" ${disabledAttr}>
            ${targetableBodyParts.map(
              (part) =>
                `<option value="${part}" ${part === draft.targetPart ? "selected" : ""}>${escapeHtml(getBodyPartLabel(selectedTargetData, part))}</option>`
            ).join("")}
          </select>
        </label>
        <label class="field-stack ${getWeaponByName(token, draft.weaponName).rangedIndex != null ? "hidden" : ""}">
          <span class="field-label">Weapon Damage</span>
          <input type="number" value="${getWeaponByName(token, draft.weaponName).rangedIndex != null ? 0 : draft.weaponDamage}" data-attack-field="weaponDamage" ${disabledAttr} ${getWeaponByName(token, draft.weaponName).rangedIndex != null ? "disabled" : ""}>
        </label>
        ${renderAttackAmmunition(token, draft, false, disabledAttr)}
        <label class="field-stack">
          <span class="field-label">Weapon Accuracy</span>
          <div class="combat-value" data-weapon-accuracy-display>${weaponAccuracyDisplay >= 0 ? "+" : ""}${weaponAccuracyDisplay}</div>
        </label>
      </div>
      <div class="combat-modifiers">
        <label class="field-stack">
          <span class="field-label">Attack Bonus</span>
          <input type="number" value="${draft.attackBonuses}" data-attack-field="attackBonuses" ${disabledAttr}>
        </label>
        <label class="field-stack">
          <span class="field-label">Attack Penalty</span>
          <input type="number" value="${draft.attackPenalties}" data-attack-field="attackPenalties" ${disabledAttr}>
        </label>
        <label class="field-stack">
          <span class="field-label">Defense Bonus</span>
          <input type="number" value="${draft.defenseBonuses}" data-attack-field="defenseBonuses" ${disabledAttr}>
        </label>
        <label class="field-stack">
          <span class="field-label">Defense Penalty</span>
          <input type="number" value="${draft.defensePenalties}" data-attack-field="defensePenalties" ${disabledAttr}>
        </label>
        <label class="field-stack">
          <span class="field-label">Parry Mode</span>
          <select data-attack-field="parryMode" ${disabledAttr}>
            <option value="off" ${draft.parryMode === "off" ? "selected" : ""}>Do Not Count Parry</option>
            ${[1, 2, 3, 4, 5]
              .map(
                (value) =>
                  `<option value="${value}" ${String(value) === draft.parryMode ? "selected" : ""}>${value} Opponent${value === 1 ? "" : "s"}</option>`
              )
              .join("")}
          </select>
        </label>
      </div>
      <details class="combat-notes">
        <summary>Attack rules</summary>
        <div>Weapon Accuracy is added to Attack Bonus. Called shots: Head -30, arms/legs -15. STR Bonus affects enabled attack skills; ${escapeHtml(PARRY_SKILL_NAME)} is counted unless disabled.</div>
      </details>
      <div class="combat-action">
        <button type="button" class="success" data-action="perform-attack" ${attackDisabledAttr}>Attack</button>
      </div>
      </div>
    `,
    true,
  );
}

function renderEnglishNoTargetAttackBlock(token, data, tokenLocked) {
  if (!canViewAttackBlock(token)) return "";

  const targetCharacters = getCharacters().filter(
    (item) => item.id !== token.id && item.visible !== false,
  );
  const draft = getAttackDraft(token, data, targetCharacters);
  const skillOptions = buildSkillOptions(getAttackSkillEntries(data.avallon), draft.skill, data.avallon);
  const weaponOptions = buildWeaponOptions(getAttackSelectableWeapons(token), draft.weaponName);
  const disabledAttr = tokenLocked ? "disabled" : "";
  const weaponAccuracyDisplay = Number(draft.weaponAccuracy) || 0;

  return renderCollapsibleSection(
    "No Target Attack",
    `
      <div data-combat-layout="manual">
      <div class="combat-form-grid">
        <label class="field-stack">
          <span class="field-label">Attack Skill</span>
          <select data-manual-attack-field="skill" ${disabledAttr}>${skillOptions}</select>
        </label>
        <label class="field-stack">
          <span class="field-label">Weapon</span>
          <select data-manual-attack-field="weaponName" ${disabledAttr}>${weaponOptions}</select>
          <span class="od-range-readout cp-muted" data-range-modifier="manual"></span>
        </label>
        <label class="field-stack"><span class="field-label">Distance · metres</span><input type="number" min="0" step="0.1" value="${escapeHtml(draft.distanceMeters)}" data-manual-attack-field="distanceMeters" ${disabledAttr}></label>
        <label class="field-stack ${getWeaponByName(token, draft.weaponName).rangedIndex != null ? "hidden" : ""}">
          <span class="field-label">Weapon Damage</span>
          <input type="number" value="${getWeaponByName(token, draft.weaponName).rangedIndex != null ? 0 : draft.weaponDamage}" data-manual-attack-field="weaponDamage" ${disabledAttr} ${getWeaponByName(token, draft.weaponName).rangedIndex != null ? "disabled" : ""}>
        </label>
        ${renderAttackAmmunition(token, draft, true, disabledAttr)}
        <label class="field-stack">
          <span class="field-label">Weapon Accuracy</span>
          <div class="combat-value" data-weapon-accuracy-display>${weaponAccuracyDisplay >= 0 ? "+" : ""}${weaponAccuracyDisplay}</div>
        </label>
      </div>
      <div class="combat-modifiers">
        <label class="field-stack">
          <span class="field-label">Attack Bonus</span>
          <input type="number" value="${draft.manualAttackBonuses}" data-manual-attack-field="attackBonuses" ${disabledAttr}>
        </label>
        <label class="field-stack">
          <span class="field-label">Attack Penalty</span>
          <input type="number" value="${draft.manualAttackPenalties}" data-manual-attack-field="attackPenalties" ${disabledAttr}>
        </label>
        <label class="field-stack">
          <span class="field-label">Armor</span>
          <input type="number" min="0" max="999" value="${draft.manualArmor}" data-manual-attack-field="manualArmor" ${disabledAttr}>
        </label>
        <label class="field-stack">
          <span class="field-label">Parry</span>
          <input type="number" min="0" max="10" value="${draft.manualParry}" data-manual-attack-field="manualParry" ${disabledAttr}>
        </label>
      </div>
      <details class="combat-notes">
        <summary>Manual defense</summary>
        <div>Uses Armor and Parry entered here and does not change the saved map target. Weapon Accuracy is added to Attack Bonus.</div>
      </details>
      <div class="combat-action">
        <button type="button" class="success" data-action="perform-manual-attack" ${disabledAttr}>No Target Attack</button>
      </div>
      </div>
    `,
    false,
  );
}

function renderTokenTransferBlock(disabledAttr) {
  return renderCollapsibleSection(
    "Import / Export",
    `
      <div class="row row-gap">
        <button type="button" class="secondary" data-action="export-token-data" ${disabledAttr}>Export Token Data</button>
        <button type="button" class="secondary" data-action="open-token-import" ${disabledAttr}>Import Token Data</button>
      </div>
      <input type="file" accept=".json,.txt,.avallon-token.json" data-token-import-input hidden>
      <div class="muted">Exports and imports body parts, attributes, skills and weapons as JSON text.</div>
      <div class="muted">Current owner, saved target and roll history stay on the destination token.</div>
    `,
    false,
  );
}

function renderEnglishDiceBlock(token, data, tokenLocked) {
  if (!canViewDiceBlock(token)) return "";

  const attributeOptions = ATTRIBUTE_UI_FIELDS
    .map(
      ([key, label]) =>
        `<option value="${escapeHtml(key)}">${escapeHtml(label)} (${data.avallon.attributes[key] ?? 0})</option>`
    )
    .join("");
  const skillOptions = buildGroupedSkillOptions(data.avallon);
  const tokenLockedAttr = tokenLocked ? "disabled" : "";

  return renderCollapsibleSection(
    "Dice",
    `
      <div class="dice-rolls">
        <div class="dice-roll-row">
          <div class="dice-roll-fields dice-roll-fields-three">
            <label class="field-stack"><span class="field-label">Dice Sides</span><input type="number" min="2" value="20" data-roll-field="dice"></label>
            <label class="field-stack"><span class="field-label">Dice Count</span><input type="number" min="1" max="100" value="1" data-roll-field="count"></label>
            <label class="field-stack"><span class="field-label">Modifier</span><input type="number" value="0" data-roll-field="modifier"></label>
          </div>
          <button type="button" data-action="perform-roll-dice">Roll Dice</button>
        </div>
        <div class="dice-roll-row">
          <div class="dice-roll-fields">
            <label class="field-stack"><span class="field-label">Characteristic</span><select data-roll-char-field="attribute" ${tokenLockedAttr}>${attributeOptions}</select></label>
            <label class="field-stack"><span class="field-label">Bonus / Penalty</span><input type="number" value="0" data-roll-char-field="modifier" ${tokenLockedAttr}></label>
          </div>
          <button type="button" data-action="perform-roll-char" ${tokenLockedAttr}>Roll Characteristic</button>
        </div>
        <div class="dice-roll-row">
          <div class="dice-roll-fields">
            <label class="field-stack"><span class="field-label">Skill</span><select data-roll-skill-field="skill" ${tokenLockedAttr}>${skillOptions}</select></label>
            <label class="field-stack"><span class="field-label">Bonus / Penalty</span><input type="number" value="0" data-roll-skill-field="modifier" ${tokenLockedAttr}></label>
          </div>
          <button type="button" data-action="perform-roll-skill" ${tokenLockedAttr}>Roll Skill</button>
        </div>
      </div>
    `,
    false,
  );
}

function renderPrivateGmDiceBlock() {
  if (!isEditable()) return "";

  const privateLog = gmPrivateEntries.length
    ? gmPrivateEntries
        .map(
          (entry) => `
            <div class="debug-entry">
              <div class="debug-head">
                <div class="debug-title">${escapeHtml(entry.title)}</div>
                <div class="muted">${escapeHtml(entry.timestamp)}</div>
              </div>
              <pre class="console-output">${escapeHtml(entry.body)}</pre>
            </div>`
        )
        .join("")
    : '<div class="empty">Private GM rolls will stay visible only here.</div>';

  return renderCollapsibleSection(
    "GM Private Dice",
    `
      <div class="form-grid">
        <label class="field-stack">
          <span class="field-label">Dice sides</span>
          <input type="number" min="2" value="20" data-gm-roll-field="dice">
        </label>
        <label class="field-stack">
          <span class="field-label">Dice Count</span>
          <input type="number" min="1" max="100" value="1" data-gm-roll-field="count">
        </label>
        <label class="field-stack">
          <span class="field-label">Modifier</span>
          <input type="number" value="0" data-gm-roll-field="modifier">
        </label>
      </div>
      <div class="row row-gap">
        <button type="button" data-action="perform-gm-private-roll">GM Roll</button>
      </div>
      <div class="list private-roll-log">${privateLog}</div>
    `,
    false,
  );
}

function renderTokenHud(token, data) {
  const targets = getCharacters().filter(t => t.id !== token.id && t.visible !== false);
  const draft = getAttackDraft(token, data, targets);
  const target = targets.find(t => t.id === draft.targetTokenId);
  const targetData = target ? getTrackerData(target) : null;
  return compactHud({token,floating:HUD_MODE,tracker:data,target,targetData,draft,
    skills:buildSkillOptions(getAttackSkillEntries(data.avallon),draft.skill,data.avallon),
    weapons:buildWeaponOptions(getAttackSelectableWeapons(token),draft.weaponName),
    parts:getTargetableBodyParts(targetData,isEditable()).map(k=>[k,getBodyPartLabel(targetData,k)]),
    ammunition:renderAttackAmmunition(token,draft,false,""),
  });
}

function renderSelectedToken() {
  const panelState = captureSelectedPanelState();
  activeTokenId = resolveActiveTokenId();
  const token = getCharacterById(activeTokenId);

  if (!token) {
    ui.selectionHint.textContent = "No character token selected";
    delete ui.selectedTokenPanel.dataset.tokenId;
    ui.selectedTokenPanel.innerHTML =
      '<div class="empty">Add a character token to the map from Owlbear Rodeo Characters, then select it.</div>';
    return;
  }

  const tracked = isTrackedCharacter(token);
  const data = getTrackerData(token);
  const avallon = getAvallonData(token);
  const totals = getBodyTotals(data);
  const selected = selectionIds.includes(token.id);
  const tokenLocked = !canUseToken(token);
  const bodyFieldDisabled = !canEditTokenData(token) ? "disabled" : "";
  const gmOnlyDisabled = !isEditable() ? "disabled" : "";
  const showPartBlock = isEditable() || Boolean(playerId&&data.avallon.owner.playerId===playerId);
  const lastRollText = data.lastRoll
    ? escapeHtml(data.lastRoll.summary || "Last roll recorded")
    : "No rolls synced yet";

  ui.selectionHint.textContent = selected ? "Selected on map" : "Showing current focus";

  ui.selectedTokenPanel.dataset.tokenId = token.id;
  ui.selectedTokenPanel.innerHTML = `
    <div class="selected-card">
      ${HUD_MODE && canUseToken(token) ? renderTokenHud(token, data) : ""}
      <div class="selected-head">
        <div>
          <div class="token-name">${escapeHtml(getCharacterName(token))}</div>
          <div class="token-meta">${escapeHtml(token.id.slice(0, 8))} - ${
            tracked ? "Initialized" : "Auto-init on selection"
          } - ${tokenLocked ? "Read only" : "Controllable"}</div>
        </div>
        <div class="row row-gap">
          <button type="button" data-action="open-character-hud" class="secondary">Floating HUD</button>
          <button type="button" data-action="focus-token" class="secondary">Select On Map</button>
          <button type="button" data-action="reload-token-visuals" class="secondary" ${tokenLocked ? "disabled" : ""}>Reload Token</button>
        </div>
      </div>

      <div class="summary-strip">
        ${
          canViewBodyHpSummary(token)
            ? `
              <div class="stat-chip">
                <span class="chip-label">Body HP</span>
                <span class="chip-value">${totals.current}/${totals.max}</span>
              </div>
            `
            : ""
        }
        <div class="stat-chip">
          <span class="chip-label">Assigned Player</span>
          <span class="chip-value">${escapeHtml(avallon.owner.playerName || avallon.owner.playerId || "Unassigned")}</span>
        </div>
      </div>

      ${
        isEditable()
          ? `
            ${renderOwnerFields({ avallon }, gmOnlyDisabled)}
          `
          : ""
      }
      ${characterTools?characterTools.renderVehicle(token):''}
      ${isEditable()||token.visible!==false||canUseToken(token)?statusView(data.avallon,isEditable()):''}
      ${canUseToken(token) ? effectChips(avallon,isEditable()) : ""}
      ${canUseToken(token) ? renderCharacteristicsBlock({ avallon }) : ""}
      ${canUseToken(token) ? renderEnglishSkillsBlock({ avallon }, gmOnlyDisabled) : ""}
      ${canUseToken(token) && characterTools ? renderCollapsibleSection("Items", characterTools.renderInventory(data), false) : ""}



      ${renderEnglishAttackBlock(token, { avallon }, tokenLocked)}
      ${renderEnglishNoTargetAttackBlock(token, { avallon }, tokenLocked)}
      ${renderEnglishDiceBlock(token, { avallon }, tokenLocked)}
      ${
        SHOW_EMBEDDED_PUBLIC_LOG
          ? renderCollapsibleSection(
              "Last Roll",
              `<pre class="console-output">${lastRollText}</pre>`,
              false,
            )
          : ""
      }
      ${
        showPartBlock
          ? isEditable() ? renderCollapsibleSection(
              "Body Parts",
              `
                <div class="row row-gap">
                  <button type="button" class="secondary" data-action="heal-limbs" ${bodyFieldDisabled}>Heal</button>
                </div>
                <div class="body-table-wrap">
                  <table class="body-table body-table-compact">
                    <thead><tr><th>Part</th><th>HP</th><th>Max</th><th>Armor</th><th>Position</th><th>Other</th></tr></thead>
                    <tbody>${[SPECIAL_PART_NAME, ...getBodyPartNames(data)].map((partName) => {
                      const part = data.body[partName];
                      const fixedPart = partName === "Torso" || partName === SPECIAL_PART_NAME;
                      const penaltyDisabled = part.slot !== "other" ? "disabled" : bodyFieldDisabled;
                      const wounds=partWounds(data,partName),bodyCriticalMax=Math.max(0,part.max-(data.avallon.inventory.armorHp?.[partName]?.max||0));const woundButtons=['minor','serious','critical'].map(kind=>'<span class="od-wound-group"><button type="button" class="od-wound-button" data-action="adjust-part-wound" data-part="'+escapeHtml(partName)+'" data-wound="'+kind+'" data-delta="-1" title="Remove 1 '+kind+' wound" aria-label="Remove '+kind+' wound on '+escapeHtml(getBodyPartLabel(data,partName))+'" '+(bodyFieldDisabled||!wounds[kind]?'disabled':'')+'>−</button><span class="od-wound-count" title="'+kind+' wounds"><b>'+({minor:'M',serious:'S',critical:'C'}[kind])+'</b><small>'+wounds[kind]+'</small></span><button type="button" class="od-wound-button" data-action="adjust-part-wound" data-part="'+escapeHtml(partName)+'" data-wound="'+kind+'" data-delta="1" title="Add 1 '+kind+' wound'+(kind==='critical'?' to body · armor unchanged':'')+'" aria-label="Add '+kind+' wound on '+escapeHtml(getBodyPartLabel(data,partName))+'" '+(bodyFieldDisabled||(kind==='critical'&&wounds.critical>=bodyCriticalMax)?'disabled':'')+'>+</button></span>').join('');
                      return `<tr>
                        <td><div class="body-part-name-line">${fixedPart ? `<span class="body-part-eye-spacer" title="Always visible"></span>` : `<label class="check-label body-part-visible" title="Visible to players"><input type="checkbox" data-action="toggle-part-hidden" data-part="${escapeHtml(partName)}" ${part.hidden ? "" : "checked"} ${bodyFieldDisabled}><span></span></label>`}<input class="body-part-name-input" type="text" maxlength="40" value="${escapeHtml(getBodyPartLabel(data, partName))}" data-action="rename-body-part" data-part="${escapeHtml(partName)}" ${fixedPart ? "disabled" : bodyFieldDisabled}>${fixedPart ? "" : `<button type="button" class="body-part-remove" data-action="remove-body-part" data-part="${escapeHtml(partName)}" title="Remove body part" aria-label="Remove ${escapeHtml(partName)}" ${bodyFieldDisabled}>×</button>`}</div></td>
                        <td><div class="inline-stepper"><button type="button" data-action="change-part" data-part="${escapeHtml(partName)}" data-field="current" data-delta="-1" ${bodyFieldDisabled}>-</button><input type="text" inputmode="numeric" maxlength="3" value="${part.current}" data-action="set-field" data-part="${escapeHtml(partName)}" data-field="current" ${bodyFieldDisabled}><button type="button" data-action="change-part" data-part="${escapeHtml(partName)}" data-field="current" data-delta="1" ${bodyFieldDisabled}>+</button></div><div class="od-part-recovery">${woundButtons}</div></td>
                        <td><input class="compact-input" type="text" inputmode="numeric" maxlength="3" value="${part.max}" data-action="set-field" data-part="${escapeHtml(partName)}" data-field="max" ${bodyFieldDisabled}></td>
                        <td><input class="compact-input" type="text" inputmode="numeric" maxlength="3" value="${part.armor}" data-action="set-field" data-part="${escapeHtml(partName)}" data-field="armor" ${bodyFieldDisabled}></td>
                        <td>${partName === "Torso" ? "Main" : partName === SPECIAL_PART_NAME ? "Special" : `<select data-action="set-field" data-part="${escapeHtml(partName)}" data-field="slot" ${bodyFieldDisabled}>${BODY_PART_SLOTS.map((slot) => `<option value="${slot}" ${part.slot === slot ? "selected" : ""}>${BODY_PART_SLOT_LABELS[slot]}</option>`).join("")}</select>`}</td>
                        <td><input class="compact-input" type="text" inputmode="numeric" maxlength="3" value="${part.attackPenalty ?? 0}" data-action="set-field" data-part="${escapeHtml(partName)}" data-field="attackPenalty" ${penaltyDisabled}></td>
                      </tr>`;
                    }).join("")}</tbody>
                  </table>
                </div>
                ${bodyPartAddOpen ? `<div class="body-part-add">
                  <label class="field-stack"><span class="field-label">Part</span><input type="text" maxlength="40" data-body-field="new-name" placeholder="Extra arm" ${bodyFieldDisabled}></label>
                  <label class="field-stack"><span class="field-label">Position</span><select data-body-field="new-slot" ${bodyFieldDisabled}>${BODY_PART_SLOTS.map((slot) => `<option value="${slot}" ${slot === "other" ? "selected" : ""}>${BODY_PART_SLOT_LABELS[slot]}</option>`).join("")}</select></label>
                  <label class="field-stack"><span class="field-label">HP</span><input type="text" inputmode="numeric" maxlength="3" min="0" max="999" value="1" data-body-field="new-max" ${bodyFieldDisabled}></label>
                  <label class="field-stack"><span class="field-label">Armor</span><input type="text" inputmode="numeric" maxlength="3" min="0" max="999" value="0" data-body-field="new-armor" ${bodyFieldDisabled}></label>
                  <label class="field-stack"><span class="field-label">Other Penalty</span><input type="text" inputmode="numeric" maxlength="3" min="0" max="999" value="0" data-body-field="new-attack-penalty" ${bodyFieldDisabled}></label>
                  <label class="check-label body-part-visible" title="Visible to players"><input type="checkbox" data-body-field="new-visible" ${bodyFieldDisabled}><span></span></label>
                  <div class="body-part-add-actions"><button type="button" class="square-icon-button" data-action="add-body-part" title="Save body part" aria-label="Save body part" ${bodyFieldDisabled}>▣</button><button type="button" class="square-icon-button danger" data-action="close-body-part-add" title="Cancel" aria-label="Cancel" ${bodyFieldDisabled}>×</button></div>
                </div>` : ""}
                <div class="item-toolbar item-toolbar-bottom"><button type="button" class="square-icon-button" data-action="open-body-part-add" title="Add body part" aria-label="Add body part" ${bodyFieldDisabled}>+</button></div>
              `,
              true,
            )
          : renderCollapsibleSection("Body Parts",playerBodyPartsView(data,[SPECIAL_PART_NAME,...getBodyPartNames(data)]),true)
          : ""
      }
      ${
        canViewOverlayPreview(token)
          ? renderCollapsibleSection(
              "Overlay Preview",
              `<pre class="console-output">${escapeHtml(formatOverlayPreviewText(data))}</pre>`,
              false,
            )
          : ""
      }
    </div>`;

  if(characterTools?.isBusy())ui.selectedTokenPanel.querySelectorAll('[data-od-action]').forEach(e=>{if(e instanceof HTMLButtonElement)e.disabled=true;});
  characterTools?.syncPool();
  arrangeCombatPanels(ui.selectedTokenPanel);
  restoreSelectedPanelState(panelState);
  ui.selectedTokenPanel.querySelectorAll('[data-weapon-draft="type"]').forEach(toggleWeaponDraftFields);
  paintRangeAdjustments();
  refreshTargetDistance();
}

function renderTrackedList() {
  const trackedCharacters = getTrackedCharacters();
  ui.trackedCount.textContent = String(trackedCharacters.length);

  if (!trackedCharacters.length) {
    ui.trackedList.innerHTML =
      '<div class="empty">No initialized characters yet. Click a token on the map to initialize it automatically.</div>';
    return;
  }

  ui.trackedList.innerHTML = trackedCharacters
    .map((token) => {
      const data = getTrackerData(token);
      const totals = getBodyTotals(data);
      const controllable = canUseToken(token);
      return `
        <button type="button" class="list-item${
          token.id === activeTokenId ? " active" : ""
        }" data-action="select-character" data-token-id="${token.id}">
          <div class="list-item-head">
            <span>${escapeHtml(getCharacterName(token))}</span>
            <span class="pill hp">${totals.current}/${totals.max}</span>
          </div>
          <div class="list-item-sub">${controllable ? "Playable" : "Read only"}</div>
        </button>`;
    })
    .join("");
}

function renderAllCharacters() {
  const characters = getCharacters();
  ui.allCount.textContent = String(characters.length);

  if (!characters.length) {
    ui.allTokensList.innerHTML =
      '<div class="empty">No character tokens are on the scene yet.</div>';
    return;
  }

  ui.allTokensList.innerHTML = characters
    .map((token) => {
      const tracked = isTrackedCharacter(token);
      const controllable = canUseToken(token);
      return `
        <div class="token-row${token.id === activeTokenId ? " active" : ""}">
          <div>
            <div class="token-row-name">${escapeHtml(getCharacterName(token))}</div>
            <div class="token-row-sub">${escapeHtml(token.id.slice(0, 8))} - ${controllable ? "Playable" : "Read only"}</div>
          </div>
          <div class="row row-gap">
            <button type="button" class="secondary" data-action="select-character" data-token-id="${
              token.id
            }">Select</button>
            <span class="pill ${tracked ? "hp" : "armor"}">${
              tracked ? "Initialized" : "Ready"
            }</span>
          </div>
        </div>`;
    })
    .join("");
}

function render() {
  ui.roleBadge.textContent = playerRole === "GM" ? "GM" : "PLAYER";


  ui.clearDebugBtn?.classList.toggle("hidden", playerRole !== "GM");
  renderSelectedToken();
  renderDebugConsole();

}

async function syncState(showToast = false) {
  const [role, id, name, color, items, selection, players] = await Promise.all([
    OBR.player.getRole(),
    OBR.player.getId(),
    OBR.player.getName(),
    OBR.player.getColor(),
    OBR.scene.items.getItems(),
    OBR.player.getSelection(),
    OBR.party.getPlayers(),
  ]);

  playerRole = role;
  playerId = id;
  playerName = name;
  playerColor = color;
  setPartyPlayersState(players);
  setSceneItems(items);
  setSelectionState(selection);

  const selectedCharacterId = selectionIds.find((selectionId) =>
    charactersByIdCache.has(selectionId)
  );
  if (selectedCharacterId) {
    activeTokenId = selectedCharacterId;
    const initialized = await initializeCharacterToken(selectedCharacterId);
    if (initialized) {
      setSceneItems(await OBR.scene.items.getItems());
    }
  } else if (activeTokenId && !charactersByIdCache.has(activeTokenId)) {
    activeTokenId = resolveActiveTokenId();
  }

  await syncLocalOwnedHiddenTokenViews(sceneItems);
  scheduleRender();
  await syncTargetHighlight();

  if (showToast) {
    setStatus(
      `Loaded ${getCharacters().length} character token(s), ${getTrackedCharacters().length} tracked.`,
      "success"
    );
  }
}

async function selectCharacter(tokenId) {
  activeTokenId = tokenId;
  await OBR.player.select([tokenId], true);
  await initializeCharacterToken(tokenId);
  scheduleRender();
  await syncTargetHighlight();
}

async function reloadTokenVisuals() {
  const token = getCharacterById(activeTokenId);
  if (!token) {
    setStatus("Select a character first.", "error");
    return;
  }
  if (!canUseToken(token)) {
    setStatus("You cannot reload this token.", "error");
    return;
  }

  const currentItems = await OBR.scene.items.getItems();
  const liveToken = currentItems.find((item) => item.id === token.id) ?? token;
  if (liveToken.visible === false) {
    await syncLocalOwnedHiddenTokenViews(currentItems);
  } else {
    await removeOverlaysForToken(token.id, currentItems);
    await ensureOverlayForToken(token.id);
  }

  setSceneItems(await OBR.scene.items.getItems());
  await syncLocalOwnedHiddenTokenViews(sceneItems);
  scheduleRender();
  await syncTargetHighlight();
  setStatus(`${getCharacterName(token)} visuals reloaded.`, "success");
}

async function recoverPartWound(partName,kind,delta=-1){
 const token=getCharacterById(activeTokenId);if(!token||!isEditable()||!canEditTokenData(token))throw Error('Only the GM can edit wounds.');
 await updateTrackerData(token.id,current=>{if(!isEditable()||!canEditTokenData(getCharacterById(token.id)))throw Error('Only the GM can edit wounds.');const next=structuredClone(current);adjustPartWound(next,partName,kind,delta);return next;});
 await ensureOverlayForToken(token.id);setStatus(getBodyPartLabel(getTrackerData(getCharacterById(token.id)),partName)+' · '+kind+' wound '+(delta>0?'added':'removed'),'success');
}
async function healLimbs() {
  const token = getCharacterById(activeTokenId);
  if (!token) {
    setStatus("Select a character first.", "error");
    return;
  }
  if (!canEditTokenData(token)) {
    setStatus("Only the GM or assigned player can heal this token.", "error");
    return;
  }

  await updateTrackerData(token.id, (current) => {
    const next = structuredClone(current);
    for (const partName of getBodyPartNames(next)) {
      const part = next.body?.[partName];
      if (!part) continue;
      setCombinedPartHp(next,partName,part.max);
      part.minor = 0;
      part.serious = 0;
    }
    return next;
  });
  await ensureOverlayForToken(token.id);
  setStatus(`${getCharacterName(token)} healed.`, "success");
}

async function changeBodyField(partName, field, delta) {
  const token = getCharacterById(activeTokenId);
  if (!token) {
    setStatus("Select a character first.", "error");
    return;
  }
  if (!canEditTokenData(token)) {
    setStatus("Only the GM or assigned player can edit this token.", "error");
    return;
  }

  await updateTrackerData(token.id, (current) => {
    const next = structuredClone(current);
    const part = next.body[partName];
    if (!part) return next;

    if (field === "current") {
      setCombinedPartHp(next,partName,part.current+delta);
    } else if (field === "max") {
      setCombinedPartMax(next,partName,part.max+delta);
      part.current = clamp(part.current, 0, part.max);
    } else if (field === "armor") {
      part.armor = clamp(part.armor + delta, 0, 999);
    }

    return next;
  });
  await ensureOverlayForToken(token.id);
}

async function setBodyField(partName, field, value) {
  const token = getCharacterById(activeTokenId);
  if (!token) {
    setStatus("Select a character first.", "error");
    return;
  }
  if (!canEditTokenData(token)) {
    setStatus("Only the GM or assigned player can edit this token.", "error");
    return;
  }

  await updateTrackerData(token.id, (current) => {
    const next = structuredClone(current);
    const part = next.body[partName];
    if (!part) return next;

    const numericValue = clamp(Number(value) || 0, 0, 999);
    if (field === "current") {
      setCombinedPartHp(next,partName,numericValue);
    } else if (field === "max") {
      setCombinedPartMax(next,partName,numericValue);
      part.current = clamp(part.current, 0, part.max);
    } else if (field === "armor") {
      const inv=next.avallon.inventory;
      if(Object.hasOwn(inv.baseArmor||{},partName))inv.baseArmor[partName]=Math.max(0,numericValue-(part.armor-inv.baseArmor[partName]));
      part.armor = numericValue;
    } else if (field === "attackPenalty") {
      part.attackPenalty = numericValue;
    } else if (field === "slot" && BODY_PART_SLOTS.includes(value)) {
      part.slot = value;
      part.attackPenalty = getBodyPartAttackPenalty(next.body, partName);
    }

    return next;
  });
  await ensureOverlayForToken(token.id);
}

async function addBodyPart() {
  const token = getCharacterById(activeTokenId);
  if (!token) throw new Error("Select a character first.");
  if (!canEditTokenData(token)) throw new Error("Only the GM or assigned player can edit this token.");
  const name = getActionFieldValue('[data-body-field="new-name"]').trim();
  const slot = getActionFieldValue('[data-body-field="new-slot"]');
  const max = clamp(Number(getActionFieldValue('[data-body-field="new-max"]')) || 0, 0, 999);
  const armor = clamp(Number(getActionFieldValue('[data-body-field="new-armor"]')) || 0, 0, 999);
  const attackPenalty = clamp(Number(getActionFieldValue('[data-body-field="new-attack-penalty"]')) || 0, 0, 999);
  const hidden = document.querySelector('[data-body-field="new-visible"]')?.checked !== true;
  if (!name) throw new Error("Enter a body part name first.");
  if (!BODY_PART_SLOTS.includes(slot)) throw new Error("Choose a body part position first.");

  await updateTrackerData(token.id, (current) => {
    const next = structuredClone(current);
    if (next.body[name]) throw new Error("A body part with this name already exists.");
    next.body[name] = {
      current: max,
      max,
      armor,
      minor: 0,
      serious: 0,
      slot,
      attackPenalty,
      hidden,
      label: name,
    };
    return next;
  });
  await ensureOverlayForToken(token.id);
}

async function removeBodyPart(partName) {
  const token = getCharacterById(activeTokenId);
  if (!token) throw new Error("Select a character first.");
  if (!canEditTokenData(token)) throw new Error("Only the GM or assigned player can edit this token.");
  if (partName === "Torso") throw new Error("Torso cannot be removed.");
  await updateTrackerData(token.id, (current) => {
    const next = structuredClone(current);
    delete next.body[partName];
    return next;
  });
  await ensureOverlayForToken(token.id);
}

async function renameBodyPart(partName, value) {
  const token = getCharacterById(activeTokenId);
  if (!token) throw new Error("Select a character first.");
  if (!canEditTokenData(token)) throw new Error("Only the GM or assigned player can edit this token.");

  const nextName = String(value ?? "").trim().slice(0, 40);
  if (!nextName) throw new Error("Enter a body part name first.");

  await updateTrackerData(token.id, (current) => {
    const next = structuredClone(current);
    if (!next.body[partName] || nextName === partName) return next;
    next.body[partName].label = nextName;
    return next;
  });
  await ensureOverlayForToken(token.id);
}

async function toggleBodyPartHidden(partName, hidden) {
  const token = getCharacterById(activeTokenId);
  if (!token) throw new Error("Select a character first.");
  if (!canEditTokenData(token)) throw new Error("Only the GM or assigned player can edit this token.");

  await updateTrackerData(token.id, (current) => {
    const next = structuredClone(current);
    if (next.body[partName] && partName !== "Torso") next.body[partName].hidden = hidden;
    return next;
  });
  await ensureOverlayForToken(token.id);
}

async function setOwnerPlayer(ownerPlayerId) {
  if (!isEditable()) {
    setStatus("Only the GM can assign token owners.", "error");
    return;
  }

  const token = getCharacterById(activeTokenId);
  if (!token) {
    setStatus("Select a character first.", "error");
    return;
  }

  const selectedPlayer = getSortedPartyPlayers().find((player) => player.id === ownerPlayerId);

  await updateTrackerData(token.id, (current) => {
    const next = structuredClone(current);
    next.avallon ??= structuredClone(getTrackerData(token).avallon);
    next.avallon.owner ??= { playerId: "", playerName: "" };
    next.avallon.owner.playerId = selectedPlayer?.id ?? "";
    next.avallon.owner.playerName = selectedPlayer?.name ?? "";
    return next;
  });
  await ensureOverlayForToken(token.id);
}

async function setAvallonSkill(skill, value) {
  const token = getCharacterById(activeTokenId);
  if (!token) {
    setStatus("Select a character first.", "error");
    return;
  }
  if (!isEditable()) {
    setStatus("Only the GM can edit Avallon skills.", "error");
    return;
  }

  await updateTrackerData(token.id, (current) => {
    const next = structuredClone(current);
    next.avallon.skills[skill] = clamp(Number(value) || 0, 0, 10);
    return next;
  });
}

async function setAvallonSkillStrengthBonus(skill, enabled) {
  const token = getCharacterById(activeTokenId);
  if (!token) {
    setStatus("Select a character first.", "error");
    return;
  }
  if (!isEditable()) {
    setStatus("Only the GM can edit Avallon skills.", "error");
    return;
  }

  await updateTrackerData(token.id, (current) => {
    const next = structuredClone(current);
    next.avallon.skillStrengthBonuses ??= {};
    next.avallon.skillStrengthBonuses[skill] = Boolean(enabled);
    return next;
  });
}

async function renameAvallonSkill(skill, label) {
  const token = getCharacterById(activeTokenId);
  if (!token) throw new Error("Select a character first.");
  if (!isEditable()) throw new Error("Only the GM can edit Avallon skills.");
  const nextLabel = String(label ?? "").trim().slice(0, 40);
  if (!nextLabel) throw new Error("Enter a skill name first.");

  await updateTrackerData(token.id, (current) => {
    const next = structuredClone(current);
    if (!next.avallon.skills[skill] && next.avallon.skills[skill] !== 0) return next;
    next.avallon.skillLabels ??= {};
    next.avallon.skillLabels[skill] = nextLabel;
    return next;
  });
}

async function addAvallonSkillPerk(skill, perk) {
  const token = getCharacterById(activeTokenId);
  if (!token) throw new Error("Select a character first.");
  if (!isEditable()) throw new Error("Only the GM can edit skill perks.");
  const name = String(perk ?? "").trim().slice(0, 40);
  if (!name) throw new Error("Enter a perk name first.");

  await updateTrackerData(token.id, (current) => {
    const next = structuredClone(current);
    next.avallon.skillPerks ??= {};
    const perks = next.avallon.skillPerks[skill] ??= [];
    if (!perks.includes(name) && perks.length < 12) perks.push(name);
    return next;
  });
}

async function removeAvallonSkillPerk(skill, perkIndex) {
  const token = getCharacterById(activeTokenId);
  if (!token) throw new Error("Select a character first.");
  if (!isEditable()) throw new Error("Only the GM can edit skill perks.");

  await updateTrackerData(token.id, (current) => {
    const next = structuredClone(current);
    const perks = next.avallon.skillPerks?.[skill];
    if (Array.isArray(perks)) perks.splice(perkIndex, 1);
    return next;
  });
}

async function setAvallonAttribute(attribute, value) {
  const token = getCharacterById(activeTokenId);
  if (!token) {
    setStatus("Select a character first.", "error");
    return;
  }
  if (!isEditable()) {
    setStatus("Only the GM can edit characteristics.", "error");
    return;
  }

  await updateTrackerData(token.id, (current) => {
    const next = structuredClone(current);
    next.avallon.attributes[attribute] = clamp(Number(value) || 0, 0, attributeCap(attribute));
    return next;
  });
}

async function addWeapon() {
  const token = getCharacterById(activeTokenId);
  if (!token) {
    setStatus("Select a character first.", "error");
    return;
  }
  if (!isEditable()) {
    setStatus("Only the GM can edit weapons.", "error");
    return;
  }

  const name = getActionFieldValue('[data-weapon-field="new-name"]').trim() || "New Weapon";
  const damage = clamp(Number(getActionFieldValue('[data-weapon-field="new-damage"]')) || 0, -999, 999);
  const accuracy = clamp(Number(getActionFieldValue('[data-weapon-field="new-accuracy"]')) || 0, -999, 999);

  const rangedField = ui.selectedTokenPanel.querySelector(
    '[data-weapon-field="new-ranged"]',
  );

  const ranged =
    rangedField instanceof HTMLInputElement && rangedField.checked;

	await updateTrackerData(token.id, (current) => {
	  const next = structuredClone(current);

	  if (ranged) {
		next.avallon.weapons.ranged ??= [];

		next.avallon.weapons.ranged.push({
		  id: crypto.randomUUID(),
		  name,
		  damage: 0,
		  accuracy,
		  capacity: 0,
		  loaded: 0,
		  loadedAmmoId: "",
		  ammoIds: [],
		});
	  } else {
		next.avallon.weapons.melee ??= [];

		next.avallon.weapons.melee.push({
		  name,
		  damage,
		  accuracy,
		});
	  }

	  return next;
	});

	if (!ranged) {
	  syncAttackWeaponInputs(token.id, name, damage, accuracy);
	}
  setStatus(`Weapon "${name}" saved for ${getCharacterName(token)}.`, "success");
}

async function setWeaponDamage(index, value) {
  const token = getCharacterById(activeTokenId);
  if (!token) {
    setStatus("Select a character first.", "error");
    return;
  }
  if (!isEditable()) {
    setStatus("Only the GM can edit weapons.", "error");
    return;
  }

  const currentWeapon = getAvallonData(token).weapons?.melee?.[index] ?? { name: "Default", damage: 0, accuracy: 0 };
  const currentWeaponName = currentWeapon.name ?? "Default";
  const nextDamage = clamp(Number(value) || 0, -999, 999);

  await updateTrackerData(token.id, (current) => {
    const next = structuredClone(current);
    next.avallon.weapons.melee ??= [];
    if (!next.avallon.weapons.melee[index]) {
      next.avallon.weapons.melee[index] = { name: "Default", damage: 0, accuracy: 0 };
    }
    next.avallon.weapons.melee[index].damage = nextDamage;
    return next;
  });
  const currentDraft = attackFormDrafts.get(token.id) ?? {};
  if (currentDraft.weaponName === currentWeaponName) {
    syncAttackWeaponInputs(token.id, currentWeaponName, nextDamage, currentWeapon.accuracy ?? 0);
  }
}

async function setWeaponAccuracy(index, value) {
  const token = getCharacterById(activeTokenId);
  if (!token) {
    setStatus("Select a character first.", "error");
    return;
  }
  if (!isEditable()) {
    setStatus("Only the GM can edit weapons.", "error");
    return;
  }

  const currentWeapon = getAvallonData(token).weapons?.melee?.[index] ?? { name: "Default", damage: 0, accuracy: 0 };
  const currentWeaponName = currentWeapon.name ?? "Default";
  const nextAccuracy = clamp(Number(value) || 0, -999, 999);

  await updateTrackerData(token.id, (current) => {
    const next = structuredClone(current);
    next.avallon.weapons.melee ??= [];
    if (!next.avallon.weapons.melee[index]) {
      next.avallon.weapons.melee[index] = { name: "Default", damage: 0, accuracy: 0 };
    }
    next.avallon.weapons.melee[index].accuracy = nextAccuracy;
    return next;
  });
  const currentDraft = attackFormDrafts.get(token.id) ?? {};
  if (currentDraft.weaponName === currentWeaponName) {
    syncAttackWeaponInputs(token.id, currentWeaponName, currentWeapon.damage ?? 0, nextAccuracy);
  }
}

async function setWeaponName(index, value) {
  const token = getCharacterById(activeTokenId);
  if (!token) {
    setStatus("Select a character first.", "error");
    return;
  }
  if (!isEditable()) {
    setStatus("Only the GM can edit weapons.", "error");
    return;
  }

  const previousWeapon = getAvallonData(token).weapons?.melee?.[index] ?? { name: "Default", damage: 0, accuracy: 0 };
  const nextWeaponName = String(value || "").trim() || "Default";

  await updateTrackerData(token.id, (current) => {
    const next = structuredClone(current);
    next.avallon.weapons.melee ??= [];
    if (!next.avallon.weapons.melee[index]) {
      next.avallon.weapons.melee[index] = { name: "Default", damage: 0, accuracy: 0 };
    }
    next.avallon.weapons.melee[index].name = nextWeaponName;
    return next;
  });
  const currentDraft = attackFormDrafts.get(token.id) ?? {};
  if (currentDraft.weaponName === previousWeapon.name) {
    syncAttackWeaponInputs(token.id, nextWeaponName, previousWeapon.damage, previousWeapon.accuracy ?? 0);
  }
}

async function removeWeapon(type = "melee", index) {
  const token = getCharacterById(activeTokenId);
  if (!token) {
    setStatus("Select a character first.", "error");
    return;
  }
  if (!isEditable()) {
    setStatus("Only the GM can edit weapons.", "error");
    return;
  }

 const currentWeapons = getAvallonData(token).weapons?.[type] ?? [];
 const removedWeapon = currentWeapons[index];
  if (!removedWeapon) {
    setStatus("Weapon not found.", "error");
    return;
  }

  await updateTrackerData(token.id, (current) => {
    const next = structuredClone(current);
	const weapons = next.avallon.weapons[type] ?? [];
	const weapon = weapons[index];

	if (type === "ranged" && weapon?.loaded > 0) {
	  const ammo = next.avallon.ammunition.find(
		(item) => item.id === weapon.loadedAmmoId,
	  );

	  if (ammo) {
		ammo.quantity += weapon.loaded;
	  }
	}

	next.avallon.weapons[type] = weapons.filter(
	  (_weapon, weaponIndex) => weaponIndex !== index,
	);
    return next;
  });
  const refreshedToken = getCharacterById(token.id);
  const fallbackWeapon = refreshedToken
    ? getDefaultAttackWeapon(refreshedToken)
    : { name: UNARMED_WEAPON_NAME, damage: 0, accuracy: 0 };
  syncAttackWeaponInputs(token.id, fallbackWeapon.name, fallbackWeapon.damage, fallbackWeapon.accuracy ?? 0);
  setStatus(`Weapon "${removedWeapon.name}" removed.`, "success");
}

async function autosaveDraftField(draft) {
  const token = getCharacterById(draft.tokenId);
  if (!token) return;

  await updateTrackerData(token.id, (current) => {
    const next = structuredClone(current);

    if (draft.action === "set-avallon-skill") {
      if (!isEditable()) return next;
      next.avallon.skills[draft.skill] = clamp(Number(draft.value) || 0, 0, 10);
      return next;
    }

    if (draft.action === "set-avallon-attribute") {
      if (!isEditable()) return next;
      next.avallon.attributes[draft.attribute] = clamp(Number(draft.value) || 0, 0, attributeCap(draft.attribute));
      return next;
    }

    if (draft.action === "set-weapon-damage") {
      next.avallon.weapons.melee ??= [];
      if (!next.avallon.weapons.melee[draft.weaponIndex]) {
        next.avallon.weapons.melee[draft.weaponIndex] = { name: "Default", damage: 0, accuracy: 0 };
      }
      next.avallon.weapons.melee[draft.weaponIndex].damage = clamp(Number(draft.value) || 0, -999, 999);
      return next;
    }

    if (draft.action === "set-weapon-accuracy") {
      next.avallon.weapons.melee ??= [];
      if (!next.avallon.weapons.melee[draft.weaponIndex]) {
        next.avallon.weapons.melee[draft.weaponIndex] = { name: "Default", damage: 0, accuracy: 0 };
      }
      next.avallon.weapons.melee[draft.weaponIndex].accuracy = clamp(Number(draft.value) || 0, -999, 999);
      return next;
    }

    if (draft.action === "set-weapon-name") {
      next.avallon.weapons.melee ??= [];
      if (!next.avallon.weapons.melee[draft.weaponIndex]) {
        next.avallon.weapons.melee[draft.weaponIndex] = { name: "Default", damage: 0, accuracy: 0 };
      }
      next.avallon.weapons.melee[draft.weaponIndex].name = String(draft.value || "").trim() || "Default";
      return next;
    }

    if (draft.action === "set-field") {
      if (!canEditTokenData(token)) return next;
      const part = next.body[draft.partName];
      if (!part) return next;
      const numericValue = clamp(Number(draft.value) || 0, 0, 999);
      if (draft.field === "current") {
        setCombinedPartHp(next,draft.partName,numericValue);
      } else if (draft.field === "max") {
        setCombinedPartMax(next,draft.partName,numericValue);
        part.current = clamp(part.current, 0, part.max);
      } else if (draft.field === "armor") {
        part.armor = numericValue;
      }
      return next;
    }

    return next;
  });

  if (draft.action === "set-field") {
    await ensureOverlayForToken(token.id);
  }
}

function queueInputAutosave(draft) {
  const key = [
    draft.tokenId,
    draft.action,
    draft.field ?? "",
    draft.skill ?? "",
    draft.attribute ?? "",
    draft.weaponIndex ?? "",
    draft.partName ?? "",
  ].join("|");
  const fieldKey=draft.action==='set-field'?'part:'+draft.partName+':'+draft.field:draft.action==='set-avallon-attribute'?'attribute:'+draft.attribute:draft.action==='set-avallon-skill'?'skill:'+draft.skill:draft.action==='set-weapon-name'?'weapon-name:'+draft.weaponIndex:draft.action==='set-weapon-damage'?'weapon-damage:'+draft.weaponIndex:'weapon-accuracy:'+draft.weaponIndex;
  const pending=pendingFieldDrafts.set(draft.tokenId,fieldKey,draft.value);
  const existing = inputAutosaveTimers.get(key);
  if (existing) {
    clearTimeout(existing);
  }

  const timeoutId = setTimeout(() => {
    inputAutosaveTimers.delete(key);
    void autosaveDraftField(draft).then(()=>{pendingFieldDrafts.finish(draft.tokenId,fieldKey,pending);},error=>{console.warn('[Body HP] Autosave failed',error);setStatus('Unable to save field. Your input is retained; edit it to retry.','error');});
  }, 250);

  inputAutosaveTimers.set(key, timeoutId);
}

function getActionFieldValue(selector) {
  const tokenPanel = ui.selectedTokenPanel;
  const field = tokenPanel.querySelector(selector);
  if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) {
    return "";
  }
  return field.value;
}

function abilityUseBody(actor,used,summary){return (used.check?formatRollSkillDebug({tokenName:getCharacterName(actor),skillName:used.name,result:used.check})+'\n\n':'')+summary+'\nSpent: '+used.cost+' '+(used.currency||'mana');}
function itemUseBody(actor,result){return [result.summary,...result.stages.map((stage,index)=>'\nStage '+(index+1)+' · '+stage.name+'\n'+(stage.kind==='attribute'?formatRollCharDebug({tokenName:actor,attributeLabel:stage.name,result:stage.result}):formatRollSkillDebug({tokenName:actor,skillName:stage.name,result:stage.result})))].join('\n');}
function onceAbilityRoll(){let rolled;return(level,modifier)=>{if(rolled&&(rolled.baseSkill!==level||rolled.modifier!==modifier))throw Error('Ability level changed. Retry the check.');return rolled??=rollSkillCheck(level,modifier);};}
async function useCharacterAbility(tokenId,abilityId){
 const actor=getCharacterById(tokenId);if(!actor||!canUseToken(actor))throw Error('Character unavailable.');
 const initial=getTrackerData(actor),ability=initial.avallon.abilities.find(a=>a.id===abilityId);if(!ability)throw Error('Ability no longer exists.');
 if(ability.kind==='utility'&&ability.statusName)return useNarrativeStatus(tokenId,'',abilityId);
 let used;const rollSkill=onceAbilityRoll(),modifier=Number(document.querySelector('[data-profile-modifier="skill"]')?.value)||0;
 await updateTrackerData(tokenId,current=>{if(!canUseToken(actor))throw Error('Character unavailable.');const next=structuredClone(current);used={...activateAbility(next,abilityId,{rollSkill,modifier}),currency:'mana'};used.summary=used.name+' · '+used.check.totalPrimary+' vs '+used.check.totalSecondary+' ('+used.check.result+') · '+used.cost+' mana spent';next.lastRoll={eventId:0,actorName:getCharacterName(actor),summary:used.summary,outcome:used.check.outcome,total:used.check.totalPrimary,timestamp:new Date().toISOString(),source:'avallon-extension'};next.history=[next.lastRoll,...(next.history||[])].slice(0,12);return next;});
 await syncState();scheduleRender();try{await pushDebugEntry(getCharacterName(actor)+' uses '+used.name,abilityUseBody(actor,used,used.summary),used.success?'success':'error');}catch{used.summary+=' · public log unavailable';}return used;
}
async function useNarrativeStatus(sourceId,itemId,abilityId){
  const actor=getCharacterById(sourceId);if(!actor||!canUseToken(actor))throw Error('Character unavailable.');
  const initial=getTrackerData(actor),ability=itemId?checkItemAbilityCost(initial,itemId,abilityId).ability:initial.avallon.abilities.find(a=>a.id===abilityId);
  if(!ability||ability.kind!=='utility'||!ability.statusName)throw Error('Narrative status ability unavailable.');
  const expected=JSON.stringify([ability.kind,ability.cost,ability.level,ability.statusName,ability.statusDescription]);
  const choice=await formDialog('Apply status · '+ability.statusName,[{name:'target',label:'Target',value:'',options:[['','Self'],...characterListCache.filter(t=>t.id!==sourceId&&(isEditable()||t.visible!==false)).map(t=>[t.id,getCharacterName(t)])]}],{submitLabel:'Use ability',message:ability.statusDescription||ability.description||'Narrative reminder only.'});if(!choice)return null;
  const targetId=choice.target||sourceId,statusId=crypto.randomUUID(),rollSkill=onceAbilityRoll(),modifier=Number(document.querySelector('[data-profile-modifier="skill"]')?.value)||0;let result;
  await queueTrackerWrite(sourceId,()=>OBR.scene.items.updateItems([...new Set([sourceId,targetId])],items=>{
    const source=items.find(t=>t.id===sourceId),target=items.find(t=>t.id===targetId);if(!source||!target||!canUseToken(source)||!isEditable()&&target.id!==sourceId&&target.visible===false)throw Error('Character or target unavailable.');
    const sourceData=getTrackerData(source),targetData=source===target?sourceData:getTrackerData(target);
    result=applyNarrativeAbility({source:sourceData,target:targetData,itemId,abilityId,sourceTokenId:sourceId,sourceName:source.visible===false?'':getCharacterName(source),statusId,expected,rollSkill:itemId?undefined:rollSkill,modifier});
    result.summary=result.used.name+' → '+getCharacterName(target)+' · '+(result.status?result.status.name:'Check failed · status not applied')+(result.used.check?' · '+result.used.check.totalPrimary+' vs '+result.used.check.totalSecondary+' ('+result.used.check.result+')':'')+' · '+result.used.cost+' '+result.used.currency+' spent';
    result.source.lastRoll={eventId:0,actorName:getCharacterName(source),summary:result.summary,outcome:result.used.check?.outcome||'narrative-status',...(result.used.check?{total:result.used.check.totalPrimary}:{}),timestamp:new Date().toISOString(),source:'avallon-extension'};result.source.history=[result.source.lastRoll,...(result.source.history||[])].slice(0,12);
    source.metadata[META_KEY]=sanitizeTrackerData(result.source);if(source!==target&&result.success)target.metadata[META_KEY]=sanitizeTrackerData(result.target);
  }));await syncState();scheduleRender();
  try{await pushDebugEntry(getCharacterName(actor)+' · '+result.used.name,abilityUseBody(actor,result.used,result.summary),result.success?'success':'error');}catch{result.summary+=' · public log unavailable';}
  return result;
}
async function useItemAbility(tokenId,itemId,abilityId){
  const actor=getCharacterById(tokenId);if(!actor||!canUseToken(actor))throw Error('Character unavailable.');
  const tracker=getTrackerData(actor),source=checkItemAbilityCost(tracker,itemId,abilityId);if(source.ability.kind==='utility'&&source.ability.statusName)return useNarrativeStatus(tokenId,itemId,abilityId);let partName='';
  if(source.ability.kind==='heal'){const choice=await formDialog('Use '+source.ability.name,[{name:'part',label:'Body part',options:Object.entries(tracker.body).filter(([,p])=>isEditable()||!p.hidden).map(([key,p])=>[key,p.label||key])}],{submitLabel:'Use charges'});if(!choice)return null;partName=choice.part;}

        let used,rolled;const modifier=Number(document.querySelector('[data-profile-modifier="skill"]')?.value)||0;
        const rollOnce=(level,mod)=>{if(rolled&&(rolled.baseSkill!==level||rolled.modifier!==mod))throw Error('Ability level changed. Retry the check.');return rolled??=rollSkillCheck(level,mod);};
        await updateTrackerData(tokenId,current=>{const next=structuredClone(current);used=activateImplantAbility(next,itemId,abilityId,{rollSkill:rollOnce,modifier,partName});used.summary=used.name+(used.check?' · '+used.check.totalPrimary+' vs '+used.check.totalSecondary+' ('+used.check.result+')':'')+' · '+used.cost+' '+used.currency+' spent';next.lastRoll={eventId:0,actorName:playerName,summary:used.summary,outcome:used.check?.outcome||'ability-use',...(used.check?{total:used.check.totalPrimary}:{}),timestamp:new Date().toISOString(),source:'avallon-extension'};next.history=[next.lastRoll,...(next.history||[])].slice(0,12);return next;});await syncState();scheduleRender();
        try{await pushDebugEntry(getCharacterName(actor)+' · '+used.name,used.check?formatRollSkillDebug({tokenName:getCharacterName(actor),skillName:used.name,result:used.check})+'\nSpent: '+used.cost+' '+used.currency:used.summary,!used.check||['success','critical-success'].includes(used.check.outcome)?'success':'error');}catch{used.summary+=' · public log unavailable';}
        return used;
      }
function prepareItemAbilityAttack(id,key){const token=getCharacterById(id);if(!token||!canUseToken(token))throw Error("Character unavailable.");const weapon=implantAttacks(getAvallonData(token)).find(w=>w.selectionKey===key);if(!weapon)throw Error("Item ability unavailable.");syncAttackWeaponInputs(id,key,weapon.damage,weapon.accuracy);saveAttackDraftValue(id,"skill",key);scheduleRender();}
let attackPending = false;
async function performAttack(options = {}) {
  if (attackPending) return;
  attackPending = true;
  try {
    await performAttackOnce(options);
  } finally {
    attackPending = false;
  }
}

async function performAttackOnce({ manualDefense = false } = {}) {
  const attacker = getCharacterById(activeTokenId);
  if (!attacker) {
    setStatus("Select an attacker token first.", "error");
    return;
  }
  if (!canUseToken(attacker)) {
    setStatus("You cannot roll for this attacker token.", "error");
    return;
  }

  const savedTargetTokenId = getActionFieldValue('[data-attack-field="targetTokenId"]') || "";
  const targetTokenId = manualDefense ? "" : savedTargetTokenId;
  const target = targetTokenId ? getCharacterById(targetTokenId) : null;
  if (!manualDefense && !targetTokenId) {
    setStatus("Pick a target on the map first.", "error");
    return;
  }
  if (targetTokenId && !target) {
    setStatus("Choose a valid target token.", "error");
    return;
  }
  if (target?.visible === false) {
    setStatus("Hidden tokens cannot be targeted.", "error");
    return;
  }
  if (target && target.id === attacker.id) {
    setStatus("Attacker and target must be different tokens.", "error");
    return;
  }

  const attackerAvallon = getAvallonData(attacker);
  const targetData = target ? getTrackerData(target) : null;
  const targetAvallon = target ? getAvallonData(target) : null;
  let skillName =
    manualDefense
      ? getActionFieldValue('[data-manual-attack-field="skill"]') || getActionFieldValue('[data-attack-field="skill"]')
      : getActionFieldValue('[data-attack-field="skill"]');
  const weaponName = (skillName?.startsWith('magic:')||skillName?.startsWith('implant:'))?skillName:
    manualDefense
      ? getActionFieldValue('[data-manual-attack-field="weaponName"]') || getActionFieldValue('[data-attack-field="weaponName"]')
      : getActionFieldValue('[data-attack-field="weaponName"]');
  if(attackerAvallon.pilotMissing)throw Error('Vehicle driver is unavailable. Exit the vehicle or select another driver.');
  if(weaponName?.startsWith('implant:')&&!implantAttacks(attackerAvallon).some(w=>w.selectionKey===weaponName))throw Error('Item ability is no longer available. Select an attack.');
  if(weaponName?.startsWith('magic:')&&!abilityAttacks(attackerAvallon).some(w=>w.selectionKey===weaponName))throw Error('Ability is no longer available. Select an attack.');
  const selectedWeapon = getWeaponByName(attacker, weaponName);
  if(selectedWeapon.implantId)checkItemAbilityCost(getTrackerData(attacker),selectedWeapon.implantId,selectedWeapon.abilityId);
  else if(selectedWeapon.magicAbilityId&&manaStatus(getTrackerData(attacker).avallon).current<(selectedWeapon.cost||0))throw Error('Not enough mana.');
  if(selectedWeapon.implantId||selectedWeapon.magicAbilityId)skillName=selectedWeapon.selectionKey;
  const attackSkillValue=(selectedWeapon.implantId||selectedWeapon.magicAbilityId)?selectedWeapon.level||0:attackerAvallon.skills[skillName]||0;
  const shotPrefix = manualDefense ? "data-manual-attack-field" : "data-attack-field";
  const shot = selectedWeapon.rangedIndex == null ? null : getAmmoShot(
    attackerAvallon,
    selectedWeapon.rangedIndex,
    getActionFieldValue(`[${shotPrefix}="ammoId"]`),
    Number(getActionFieldValue(`[${shotPrefix}="rounds"]`)),
  );
  const requestedTargetPart = manualDefense ? "Torso" : getActionFieldValue('[data-attack-field="targetPart"]');
  const weaponDamage = Number(
    manualDefense
      ? getActionFieldValue('[data-manual-attack-field="weaponDamage"]') || getActionFieldValue('[data-attack-field="weaponDamage"]')
      : getActionFieldValue('[data-attack-field="weaponDamage"]')
  ) || 0;
  const manualAttackBonuses = Number(
    manualDefense
      ? getActionFieldValue('[data-manual-attack-field="attackBonuses"]') || getActionFieldValue('[data-attack-field="attackBonuses"]')
      : getActionFieldValue('[data-attack-field="attackBonuses"]')
  ) || 0;
  const weaponAccuracy = Number(selectedWeapon?.accuracy) || 0;
  const attackDistance=target&&targetDistance?await targetDistance.measure(attacker,target):null;
  const enteredDistance=manualDefense?getActionFieldValue('[data-manual-attack-field="distanceMeters"]'):null;
  const meters=manualDefense?(String(enteredDistance??'').trim()===''?null:Number(enteredDistance)):attackDistance?.meters;
  const range=rangeAdjustment(selectedWeapon,meters,attackerAvallon,skillName);
  if(range.required)throw new Error(manualDefense?'Enter distance in metres for this weapon.':'Set scene ruler units to metres or feet to calculate weapon range.');
  const attackBonuses = manualAttackBonuses + weaponAccuracy + Math.max(0,range.modifier);
  const manualAttackPenalties = Number(
    manualDefense
      ? getActionFieldValue('[data-manual-attack-field="attackPenalties"]') || getActionFieldValue('[data-attack-field="attackPenalties"]')
      : getActionFieldValue('[data-attack-field="attackPenalties"]')
  ) || 0;
  const availableTargetParts = getTargetableBodyParts(targetData, isEditable());
  const targetPart = manualDefense ? "Torso" : (availableTargetParts.includes(requestedTargetPart) ? requestedTargetPart : "Torso");
  const automaticTargetPenalty = manualDefense ? 0 : getBodyPartAttackPenalty(targetData, targetPart);
  const totalAttackPenalties = manualAttackPenalties + automaticTargetPenalty + Math.max(0,-range.modifier);
  const defenseBonuses = Number(getActionFieldValue('[data-attack-field="defenseBonuses"]')) || 0;
  const defensePenalties = Number(getActionFieldValue('[data-attack-field="defensePenalties"]')) || 0;
  const manualArmor = clamp(
    Number(
      manualDefense
        ? getActionFieldValue('[data-manual-attack-field="manualArmor"]') || getActionFieldValue('[data-attack-field="manualArmor"]')
        : getActionFieldValue('[data-attack-field="manualArmor"]')
    ) || 0,
    0,
    999,
  );
  const manualParry = clamp(
    Number(
      manualDefense
        ? getActionFieldValue('[data-manual-attack-field="manualParry"]') || getActionFieldValue('[data-attack-field="manualParry"]')
        : getActionFieldValue('[data-attack-field="manualParry"]')
    ) || 0,
    0,
    10,
  );
  const parryMode = getActionFieldValue('[data-attack-field="parryMode"]') || "off";
  const parryDivisor = getParryDivisor(parryMode);
  saveAttackDraftValue(attacker.id, "skill", skillName);
  saveAttackDraftValue(attacker.id, "weaponName", weaponName);
  if (!manualDefense) {
    saveAttackDraftValue(attacker.id, "targetTokenId", targetTokenId);
    saveAttackDraftValue(attacker.id, "targetTokenName", target ? getCharacterName(target) : "");
    await persistAttackTargetToken(attacker.id, targetTokenId);
  }
  saveAttackDraftValue(attacker.id, "targetPart", targetPart);
  saveAttackDraftValue(attacker.id, "weaponDamage", String(weaponDamage));
  saveAttackDraftValue(
    attacker.id,
    manualDefense ? "manualAttackBonuses" : "attackBonuses",
    manualDefense
      ? getActionFieldValue('[data-manual-attack-field="attackBonuses"]')
      : getActionFieldValue('[data-attack-field="attackBonuses"]'),
  );
  saveAttackDraftValue(
    attacker.id,
    manualDefense ? "manualAttackPenalties" : "attackPenalties",
    manualDefense
      ? getActionFieldValue('[data-manual-attack-field="attackPenalties"]')
      : getActionFieldValue('[data-attack-field="attackPenalties"]'),
  );
  saveAttackDraftValue(attacker.id, "defenseBonuses", getActionFieldValue('[data-attack-field="defenseBonuses"]'));
  saveAttackDraftValue(attacker.id, "defensePenalties", getActionFieldValue('[data-attack-field="defensePenalties"]'));
  saveAttackDraftValue(
    attacker.id,
    "manualArmor",
    manualDefense
      ? getActionFieldValue('[data-manual-attack-field="manualArmor"]')
      : getActionFieldValue('[data-attack-field="manualArmor"]'),
  );
  saveAttackDraftValue(
    attacker.id,
    "manualParry",
    manualDefense
      ? getActionFieldValue('[data-manual-attack-field="manualParry"]')
      : getActionFieldValue('[data-attack-field="manualParry"]'),
  );
  saveAttackDraftValue(attacker.id, "parryMode", parryMode);
  const specialPartState = targetData?.body?.[SPECIAL_PART_NAME] ?? null;
  const specialWasActive =
    Boolean(target) &&
    hasConfiguredSpecial(targetData) &&
    (Number(specialPartState?.max) || 0) > 0 &&
    (Number(specialPartState?.current) || 0) > 0;
  const baseTargetArmor = target
    ? (Number(targetData?.body?.[targetPart]?.armor) || 0) +
      (specialWasActive ? Number(specialPartState?.armor) || 0 : 0)
    : manualArmor;
  const targetArmor = effectiveArmor(baseTargetArmor, shot?.penetration ?? 0);
  const targetPartState = targetData?.body?.[targetPart] ?? { current: 0, max: 0, armor: 0, minor: 0, serious: 0 };
  const beforeHp = target ? (targetPartState.current ?? 0) : null;
  const beforeMinor = target ? (targetPartState.minor ?? 0) : null;
  const beforeSerious = target ? (targetPartState.serious ?? 0) : null;
  const specialBeforeHp = specialWasActive ? Number(specialPartState?.current) || 0 : null;
  const strengthBonus = !shot && !selectedWeapon.magicAbilityId && getSkillStrengthBonusFlag(attackerAvallon, skillName)
    ? Math.max((attackerAvallon.attributes.Strength ?? 0) - 10, 0)
    : 0;
  const finalWeaponDamage = shot ? shot.damage : ((selectedWeapon.implantId||selectedWeapon.magicAbilityId)?selectedWeapon.damage:weaponDamage) + strengthBonus;
  const baseTargetParry = target
    ? (targetAvallon?.skills?.[PARRY_SKILL_NAME] ?? 0)
    : manualParry;
  const targetParry =
    parryDivisor <= 0
      ? 0
      : Math.max(Math.floor(baseTargetParry / parryDivisor), 0);

  const result = resolveAttack({
    attackSkill: attackSkillValue,
    weaponDamage: finalWeaponDamage,
    defenseBonuses,
    defensePenalties,
    attackBonuses,
    attackPenalties: totalAttackPenalties,
    parry: targetParry,
    targetPart,
    targetArmor,
  });
  const specialResolution =
    target && result.hit && result.damage
      ? projectDamageWithSpecialProtection({
          specialPart: specialPartState,
          targetPart: targetPartState,
          damage: result.damage,
          targetPartName: targetPart,
        })
      : {
          specialProjectedState: specialPartState ? getNormalizedPartState(specialPartState) : null,
          projectedTargetState: {
            ...(target ? getNormalizedPartState(targetPartState) : {}),
            critApplied: 0,
          },
          specialActive: false,
          specialArmor: 0,
          damageAppliedLabel: "No Damage",
        };
  const projectedPartState = specialResolution.projectedTargetState;
  const equipmentCrit=projectedPartState.critApplied||0;
  if(target&&result.hit&&equipmentCrit) {
    const preview=getTrackerData(target),equipment=absorbEquipmentCritical(preview,result.targetPart,equipmentCrit);
    projectedPartState.current=Math.max(0,(targetPartState.current||0)-equipmentCrit);
  }
  const projectedSpecialState = specialResolution.specialProjectedState;
  const afterHp = target ? (projectedPartState.current ?? beforeHp) : null;
  const afterMinor = target ? (projectedPartState.minor ?? beforeMinor) : null;
  const afterSerious = target ? (projectedPartState.serious ?? beforeSerious) : null;
  const specialAfterHp = specialWasActive ? (projectedSpecialState?.current ?? specialBeforeHp) : null;
  const resolvedTargetName = target ? getCharacterName(target) : "Manual Defense";
  const damageSummary =
    specialResolution.specialActive &&
    result.hit &&
    specialResolution.damageAppliedLabel !== "No Damage"
      ? `${result.summary} Applied: ${specialResolution.damageAppliedLabel}.`
      : result.summary;
  const resolvedAttackSummary = shot
    ? `${damageSummary} ${shot.name} x${shot.count}; ammo damage ${shot.damage}; armor ${baseTargetArmor} -> ${targetArmor} (AP ${shot.penetration}).`
    : damageSummary;

  await updateTrackerData(attacker.id, (current) => {
    const next = structuredClone(current);
    if(attackerAvallon.pilot?.id&&next.avallon.vehicle?.pilotTokenId!==attackerAvallon.pilot.id)throw Error('Vehicle driver changed. Retry the attack.');
    if(selectedWeapon.implantId){const ability=implantAttacks(next.avallon).find(w=>w.id===selectedWeapon.id);if(!ability||ability.damage!==selectedWeapon.damage||ability.accuracy!==selectedWeapon.accuracy||ability.level!==selectedWeapon.level||ability.cost!==selectedWeapon.cost||ability.resourceType!==selectedWeapon.resourceType)throw Error('Item ability changed. Retry the attack.');}
    if(selectedWeapon.magicAbilityId){const ability=abilityAttacks(next.avallon).find(w=>w.id===selectedWeapon.id);if(!ability||ability.cost!==selectedWeapon.cost||ability.damage!==selectedWeapon.damage||ability.level!==selectedWeapon.level||ability.cost!==selectedWeapon.cost||ability.accuracy!==selectedWeapon.accuracy)throw Error('Ability changed. Retry.');spendMana(next.avallon,ability.cost);}
    if(selectedWeapon.implantId)spendItemAbilityCost(next,selectedWeapon.implantId,selectedWeapon.abilityId);
    if (shot) {
      if (next.avallon.weapons.ranged[selectedWeapon.rangedIndex]?.id !== selectedWeapon.id) throw new Error("Weapon changed. Please retry the attack.");
      consumeAmmo(next.avallon, selectedWeapon.rangedIndex, shot);
    }
    next.lastRoll = {
      eventId: 0,
      actorName: playerName || "Owlbear Player",
      summary: `${getCharacterName(attacker)} -> ${resolvedTargetName}: ${resolvedAttackSummary}`,
      outcome: result.outcome,
      total: result.attackTotal,
      targetPart: result.targetPart,
      timestamp: new Date().toISOString(),
      source: "owlbear-extension",
    };
    next.history = [next.lastRoll, ...(next.history ?? [])].slice(0, 12);
    return next;
  });

  if (target) {
    await updateTrackerData(target.id, (current) => {
      const next = structuredClone(current);
      if (specialResolution.specialActive && next.body[SPECIAL_PART_NAME]) {
        setCombinedPartHp(next,SPECIAL_PART_NAME,projectedSpecialState.current);
        next.body[SPECIAL_PART_NAME].minor = projectedSpecialState.minor;
        next.body[SPECIAL_PART_NAME].serious = projectedSpecialState.serious;
      }
      if (result.hit && next.body[result.targetPart]) {
        absorbEquipmentCritical(next,result.targetPart,equipmentCrit);
        next.body[result.targetPart].current = projectedPartState.current;
        next.body[result.targetPart].minor = projectedPartState.minor;
        next.body[result.targetPart].serious = projectedPartState.serious;
      }
      next.lastRoll = {
        eventId: 0,
        actorName: getCharacterName(attacker),
        summary: resolvedAttackSummary,
        outcome: result.outcome,
        total: result.attackTotal,
        targetPart: result.targetPart,
        timestamp: new Date().toISOString(),
        source: "owlbear-extension",
      };
      next.history = [next.lastRoll, ...(next.history ?? [])].slice(0, 12);
      return next;
    });
  }

  if (target) {
    await ensureOverlayForToken(target.id);
  }
  await pushDebugEntry(
    `${getAttackOutcomeIcon(result.outcome)} ${getCharacterName(attacker)} attacks ${resolvedTargetName}`,
    formatAttackDebug({
      distance: attackDistance||(Number.isFinite(meters)?{label:meters+' m (manual)'}:null),
      range,
      attackerName: getCharacterName(attacker),
      targetName: resolvedTargetName,
      targetPart,
      attackSkillName: (selectedWeapon.magicAbilityId||selectedWeapon.implantId)?selectedWeapon.name:skillName,
      attackSkillValue,
      weaponDamage: finalWeaponDamage,
      weaponAccuracy,
      strengthBonus,
      manualAttackBonuses,
      totalAttackBonuses: attackBonuses,
      manualAttackPenalties,
      automaticTargetPenalty,
      totalAttackPenalties,
      defenseBonuses,
      defensePenalties,
      baseTargetParry,
      targetParry,
      parryMode,
      targetArmor,
      specialArmor: specialResolution.specialArmor,
      specialActive: specialResolution.specialActive,
      result,
      beforeHp,
      afterHp,
      specialBeforeHp,
      specialAfterHp,
      beforeMinor,
      afterMinor,
      beforeSerious,
      afterSerious,
      critApplied: projectedPartState.critApplied ?? 0,
      damageAppliedLabel: specialResolution.damageAppliedLabel,
    }),
    result.hit ? "success" : "info",
  );
  setStatus(`${getCharacterName(attacker)} -> ${resolvedTargetName}: ${resolvedAttackSummary}`, result.hit ? "success" : "info");
}

async function performRollDice() {
  const token = getCharacterById(activeTokenId);
  if (!token) {
    setStatus("Select a character first.", "error");
    return;
  }
  if (!canUseToken(token)) {
    setStatus("You cannot roll for this token.", "error");
    return;
  }

  const dice = Number(getActionFieldValue('[data-roll-field="dice"]')) || 20;
  const count = Number(getActionFieldValue('[data-roll-field="count"]')) || 1;
  const modifier = Number(getActionFieldValue('[data-roll-field="modifier"]')) || 0;
  const result = rollDice(dice, modifier, count);
  const diceLabel = `${result.count}d${result.sides}`;
  const summary = buildDiceRollSummary(diceLabel, result);

  await updateTrackerData(token.id, (current) => {
    const next = structuredClone(current);
    next.lastRoll = {
      eventId: 0,
      actorName: playerName || "Owlbear Player",
      summary,
      outcome: "roll",
      total: result.total,
      targetPart: "",
      timestamp: new Date().toISOString(),
      source: "owlbear-extension",
    };
    next.history = [next.lastRoll, ...(next.history ?? [])].slice(0, 12);
    return next;
  });

  await pushDebugEntry(`${getCharacterName(token)} rolls dice`, formatDiceDebug({
    tokenName: getCharacterName(token),
    result,
  }), "success");
  setStatus(summary, "success");
}

async function addAvallonSkill() {
  if (!isEditable()) {
    setStatus("Only the GM can add skills.", "error");
    return;
  }

  const token = getCharacterById(activeTokenId);
  if (!token) {
    setStatus("Select a character first.", "error");
    return;
  }

  const name = getActionFieldValue('[data-skill-field="new-name"]').trim();
  const value = clamp(Number(getActionFieldValue('[data-skill-field="new-value"]')) || 0, 0, 10);
  const strengthBonusField = ui.selectedTokenPanel.querySelector(
    '[data-skill-field="new-strength-bonus"]',
  );
  const addStrengthBonus =
    strengthBonusField instanceof HTMLInputElement ? strengthBonusField.checked : false;
  if (!name) {
    setStatus("Enter a skill name first.", "error");
    return;
  }
  const category =
    name === MELEE_SKILL_NAME || name === PARRY_SKILL_NAME
      ? COMBAT_SKILL_CATEGORY
      : getActionFieldValue('[data-skill-field="new-category"]') === COMBAT_SKILL_CATEGORY
        ? COMBAT_SKILL_CATEGORY
        : getActionFieldValue('[data-skill-field="new-category"]') === ABILITIES_SKILL_CATEGORY
          ? ABILITIES_SKILL_CATEGORY
          : APPLIED_SKILL_CATEGORY;

  await updateTrackerData(token.id, (current) => {
    const next = structuredClone(current);
    next.avallon.skills[name] = value;
    next.avallon.skillCategories ??= {};
    next.avallon.skillStrengthBonuses ??= {};
    next.avallon.skillLabels ??= {};
    next.avallon.skillPerks ??= {};
    next.avallon.skillCategories[name] = category;
    next.avallon.skillStrengthBonuses[name] =
      name === MELEE_SKILL_NAME
        ? true
        : name === PARRY_SKILL_NAME
          ? false
          : Boolean(addStrengthBonus);
    next.avallon.skillLabels[name] = name;
    next.avallon.skillPerks[name] = [];
    return next;
  });
  setStatus(`Skill "${name}" saved for ${getCharacterName(token)}.`, "success");
}

async function removeAvallonSkill(skillName) {
  if (!isEditable()) {
    setStatus("Only the GM can remove skills.", "error");
    return;
  }
  if (CORE_COMBAT_SKILLS.includes(skillName)) {
    setStatus("Core combat skills cannot be removed.", "error");
    return;
  }

  const token = getCharacterById(activeTokenId);
  if (!token) {
    setStatus("Select a character first.", "error");
    return;
  }

  await updateTrackerData(token.id, (current) => {
    const next = structuredClone(current);
    delete next.avallon.skills[skillName];
    delete next.avallon.skillCategories?.[skillName];
    delete next.avallon.skillStrengthBonuses?.[skillName];
    delete next.avallon.skillLabels?.[skillName];
    delete next.avallon.skillPerks?.[skillName];
    return next;
  });
  setStatus(`Skill "${skillName}" removed.`, "success");
}

async function performRollCharOnce(options = {}) {
  const token = getCharacterById(activeTokenId);
  if (!token) {
    setStatus("Select a character first.", "error");
    return;
  }
  if (!canUseToken(token)) {
    setStatus("You cannot roll for this token.", "error");
    return;
  }

  const attribute = options.attribute ?? (getActionFieldValue('[data-roll-char-field="attribute"]') || "Strength");
  if (!ATTRIBUTE_UI_FIELDS.some(([key]) => key === attribute)) throw new Error("Unknown characteristic.");
  const modifier = options.modifier ?? (Number(getActionFieldValue('[data-roll-char-field="modifier"]')) || 0);
  const avallon = getAvallonData(token);
  if(avallon.pilotMissing)throw Error('Vehicle driver is unavailable.');
  const result = rollCharacterCheck(avallon.attributes[attribute] ?? 0, modifier);
  const attributeLabel =
    ATTRIBUTE_UI_FIELDS.find(([key]) => key === attribute)?.[1] ?? attribute;
  const summary = `${getResolvedCheckResultIcon(result.result)} Characteristic ${attributeLabel}: ${result.roll} vs ${result.finalAttribute} (${result.result})`;

  await updateTrackerData(token.id, (current) => {
    const next = structuredClone(current);
    next.lastRoll = {
      eventId: 0,
      actorName: getCharacterName(token),
      summary,
      outcome: "roll-char",
      total: result.roll,
      targetPart: "",
      timestamp: new Date().toISOString(),
      source: "owlbear-extension",
    };
    next.history = [next.lastRoll, ...(next.history ?? [])].slice(0, 12);
    return next;
  });

  await pushDebugEntry(
    `${getResolvedCheckResultIcon(result.result)} ${getCharacterName(token)} rolls characteristic`,
    formatRollCharDebug({
      tokenName: getCharacterName(token),
      attributeLabel,
      result,
    }),
    isResolvedCheckResultSuccess(result.result) ? "success" : result.result === "Critical Failure" ? "error" : "info",
  );
  setStatus(summary, isResolvedCheckResultSuccess(result.result) ? "success" : "error");
}

async function setVehicleState(vehicleId,enabled,pilotId=''){
 const fresh=(await OBR.scene.items.getItems()).filter(isCharacterToken);
 await queueTrackerWrite(vehicleId,()=>OBR.scene.items.updateItems([vehicleId],changed=>{
  const items=[...fresh.filter(t=>t.id!==vehicleId),...changed];const vehicle=changed.find(t=>t.id===vehicleId);if(!vehicle)throw Error('Vehicle is unavailable.');const data=getTrackerData(vehicle),current=data.avallon.vehicle;
  if(playerRole!=='GM'&&(!current?.enabled||!enabled))throw Error('Only the GM can configure vehicles.');
  if(current?.pilotTokenId&&pilotId&&current.pilotTokenId!==pilotId)throw Error('Vehicle already has a driver. Exit first.');
  if(!pilotId&&current?.pilotTokenId&&playerRole!=='GM'){const previous=items.find(t=>t.id===current.pilotTokenId);if(!previous||!canPlayerControlToken(playerRole,playerId,previous))throw Error('Only the driver or GM can exit this vehicle.');}
  if(pilotId){const pilot=items.find(t=>t.id===pilotId);if(!pilot||pilot.id===vehicle.id||getTrackerData(pilot).avallon.vehicle?.enabled||!canPlayerControlToken(playerRole,playerId,pilot))throw Error('Choose a character you control as driver.');if(items.some(t=>t.id!==vehicleId&&getTrackerData(t).avallon.vehicle?.pilotTokenId===pilotId))throw Error('This character is already driving another vehicle.');}
  if(enabled)data.avallon.vehicle={enabled:true,pilotTokenId:pilotId};else delete data.avallon.vehicle;
  vehicle.metadata[META_KEY]=sanitizeTrackerData(data);
 }));await syncState();scheduleRender();
}

async function useCharacterItem(sourceId,itemId,targetId,partName,attribute='') {
  const effectId=crypto.randomUUID();let result,actorName;
  await queueTrackerWrite(sourceId,()=>OBR.scene.items.updateItems([...new Set([sourceId,targetId])],items=>{
    const source=items.find(t=>t.id===sourceId),target=items.find(t=>t.id===targetId);
    if(!source||!target||!canUseToken(source))throw new Error('Character is unavailable.');
    if(playerRole!=='GM'&&(target.visible===false||getTrackerData(target).body[partName]?.hidden))throw new Error('Target is unavailable.');
    if(getAvallonData(source).pilotMissing)throw Error('Vehicle driver is unavailable.');
    const sourceData=getTrackerData(source),targetData=source===target?sourceData:getTrackerData(target);
    const item=sourceData.avallon.inventory.items.find(i=>i.id===itemId);
    if(playerRole!=='GM'&&item?.subtype==='repairkit'){const gear=targetData.avallon.inventory.items.find(i=>i.id===partName);if(gear?.equippedPart&&targetData.body[gear.equippedPart]?.hidden)throw new Error('Target is unavailable.');}
    result=applyCheckedItemUse({source:sourceData,target:targetData,itemId,selection:partName,attribute,effectId,actorAvallon:getAvallonData(source),rollCharacter:rollCharacterCheck,rollSkill:rollSkillCheck});
    actorName=getCharacterName(source);result.summary=itemUseSummary(result)+' → '+getCharacterName(target);
    if(result.mode!=='none'){
      const last=result.stages.at(-1)?.result;result.source.lastRoll={eventId:0,actorName,summary:result.summary,outcome:'item-use',total:last?.totalPrimary??last?.roll??0,targetPart:item?.subtype==='medkit'?partName:'',timestamp:new Date().toISOString(),source:'owlbear-extension'};
      result.source.history=[result.source.lastRoll,...(result.source.history||[])].slice(0,12);
    }
    source.metadata[META_KEY]=sanitizeTrackerData(result.source);
    if(source!==target&&result.success)target.metadata[META_KEY]=sanitizeTrackerData(result.target);
  }));
  await syncState();await Promise.all([...new Set([sourceId,targetId])].map(ensureOverlayForToken));scheduleRender();
  if(result.mode!=='none')try{await pushDebugEntry(actorName+' uses '+result.itemName,itemUseBody(actorName,result),result.success?'success':'error');}catch(error){console.warn('[Avallon] Item use was saved; public log failed',error);result.summary+=' · Public log unavailable; result saved on character.';}
  return {summary:result.summary,success:result.success};
}

async function performRollSkillOnce(options = {}) {
  const token = getCharacterById(activeTokenId);
  if (!token) {
    setStatus("Select a character first.", "error");
    return;
  }
  if (!canUseToken(token)) {
    setStatus("You cannot roll for this token.", "error");
    return;
  }

  const skillName = options.raw ? "Random d100" : options.skill ?? getActionFieldValue('[data-roll-skill-field="skill"]');
  if (!skillName) {
    setStatus("Choose a skill first.", "error");
    return;
  }

  const modifier = options.modifier ?? (Number(getActionFieldValue('[data-roll-skill-field="modifier"]')) || 0);
  const avallon = getAvallonData(token);
  if(avallon.pilotMissing)throw Error('Vehicle driver is unavailable.');
  if (!options.raw && !Object.hasOwn(avallon.skills, skillName)) throw new Error("Skill no longer exists.");
  const stealth=['stealth','скрытность'].includes(String(avallon.skillLabels[skillName]||skillName).toLowerCase());if(stealth&&avallon.stealthBlocked)throw Error('Heavy armor prevents stealth checks.');
  const result = rollSkillCheck(options.raw ? 0 : (avallon.skills[skillName] ?? 0), modifier-(stealth?avallon.stealthRollPenalty||0:0));
  const summary = `${getResolvedCheckResultIcon(result.result)} Skill ${skillName}: ${result.totalPrimary} vs ${result.totalSecondary} (${result.result})`;

  await updateTrackerData(token.id, (current) => {
    const next = structuredClone(current);
    next.lastRoll = {
      eventId: 0,
      actorName: getCharacterName(token),
      summary,
      outcome: "roll-skill",
      total: result.totalPrimary,
      targetPart: "",
      timestamp: new Date().toISOString(),
      source: "owlbear-extension",
    };
    next.history = [next.lastRoll, ...(next.history ?? [])].slice(0, 12);
    return next;
  });

  await pushDebugEntry(
    `${getResolvedCheckResultIcon(result.result)} ${getCharacterName(token)} checks skill`,
    formatRollSkillDebug({
      tokenName: getCharacterName(token),
      skillName,
      result,
    }),
    isResolvedCheckResultSuccess(result.result) ? "success" : result.result === "Critical Failure" ? "error" : "info",
  );
  setStatus(summary, isResolvedCheckResultSuccess(result.result) ? "success" : "error");
}

async function performRollChar(options) {
  if (profileRollPending) return;
  profileRollPending = true;
  try { await performRollCharOnce(options); } finally { profileRollPending = false; }
}
async function performRollSkill(options) {
  if (profileRollPending) return;
  profileRollPending = true;
  try { await performRollSkillOnce(options); } finally { profileRollPending = false; }
}

async function performPrivateGmRoll() {
  if (!isEditable()) {
    setStatus("Only the GM can use private rolls.", "error");
    return;
  }

  const dice = Number(getActionFieldValue('[data-gm-roll-field="dice"]')) || 20;
  const count = Number(getActionFieldValue('[data-gm-roll-field="count"]')) || 1;
  const modifier = Number(getActionFieldValue('[data-gm-roll-field="modifier"]')) || 0;
  const result = rollDice(dice, modifier, count);
  const diceLabel = `${result.count}d${result.sides}`;
  const summary = buildDiceRollSummary(diceLabel, result);

  pushPrivateGmEntry(
    `GM private ${diceLabel}`,
    formatDiceDebug({
      tokenName: "GM private roll",
      result,
    }),
  );
  scheduleRender();
  setStatus(`Private GM roll. ${summary}`, "success");
}

function bindUiEvents() {
  ui.refreshBtn.addEventListener("click", () => {
    void syncState(true).catch((error) => {
      setStatus(error?.message ?? "Refresh failed.", "error");
    });
  });

  ui.syncBtn.addEventListener("click", () => {
    if (!isEditable()) {
      setStatus("Only the GM can rebuild overlays.", "error");
      return;
    }

    void syncTrackedOverlays()
      .then(() => syncState())
      .then(() => {
        setStatus("Tracked overlays rebuilt.", "success");
      })
      .catch((error) => {
        setStatus(error?.message ?? "Overlay rebuild failed.", "error");
      });
  });

  document.addEventListener(
    "toggle",
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLDetailsElement)) return;
      if (!target.isConnected || !target.dataset.sectionKey) return;
      collapsibleSectionState.set(target.dataset.sectionKey, target.open);
    },
    true,
  );

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const actionNode = target.closest("[data-action]");
    if (!(actionNode instanceof HTMLElement)) return;

	const action = actionNode.dataset.action;
    if (actionNode.disabled) return;
    if (action === "close-character-hud") {
      void OBR.popover.close("com.avallon.system/character-hud").catch(error => setStatus(error.message,"error"));return;
    }
    if (action === "open-character-hud") {
      const id = "com.avallon.system/character-hud";
      void OBR.popover.close(id).catch(() => {}).then(() => OBR.popover.open({id,
        url:new URL("./index.html?hud=1",window.location.href).href,width:920,height:420,
        anchorReference:"POSITION",anchorPosition:{left:20,top:80},
        anchorOrigin:{horizontal:"LEFT",vertical:"TOP"},transformOrigin:{horizontal:"LEFT",vertical:"TOP"},disableClickAway:true,
      })).catch(error => setStatus(error.message,"error"));
      return;
    }
    if (action === "profile-roll-char" || action === "profile-roll-skill" || action === "profile-random-skill") {
      const kind = action === "profile-roll-char" ? "attribute" : "skill";
      const modifier = clamp(Number(ui.selectedTokenPanel.querySelector(`[data-profile-modifier="${kind}"]`)?.value) || 0, -999, 999);
      actionNode.disabled = true;
      const operation = kind === "attribute" ? performRollChar({attribute: actionNode.dataset.attribute, modifier}) : performRollSkill({skill: actionNode.dataset.skill, raw:action==="profile-random-skill", modifier});
      void operation.catch(error => setStatus(error.message, "error")).finally(() => { if (actionNode.isConnected) actionNode.disabled = false; });
      return;
    }

    if (action === "open-ammo-add") {
      ammunitionAddOpen = true;
      scheduleRender();
      return;
    }

    if (action === "close-ammo-add") {
      ammunitionAddOpen = false;
      scheduleRender();
      return;
    }

    if (action === "open-weapon-add") {
      weaponAddOpen = true;
      scheduleRender();
      return;
    }

    if (action === "close-weapon-add") {
      weaponAddOpen = false;
      scheduleRender();
      return;
    }

    if (action === "open-body-part-add") {
      bodyPartAddOpen = true;
      scheduleRender();
      return;
    }

    if (action === "close-body-part-add") {
      bodyPartAddOpen = false;
      scheduleRender();
      return;
    }

    if (action === "open-skill-add") {
      skillAddOpen = true;
      scheduleRender();
      return;
    }

    if (action === "close-skill-add") {
      skillAddOpen = false;
      scheduleRender();
      return;
    }

    if (action === "open-skill-perk") {
      skillPerkAddSkill = actionNode.dataset.skill ?? "";
      scheduleRender();
      return;
    }

    if (action === "cancel-skill-perk") {
      skillPerkAddSkill = "";
      scheduleRender();
      return;
    }

    if (action === "save-skill-perk") {
      const row = actionNode.closest(".skill-row");
      const field = row?.querySelector('[data-skill-perk-field="name"]');
      void addAvallonSkillPerk(actionNode.dataset.skill ?? "", field?.value ?? "").then(() => {
        skillPerkAddSkill = "";
        scheduleRender();
      }).catch((error) => setStatus(error.message, "error"));
      return;
    }

    if (action === "remove-skill-perk") {
      void removeAvallonSkillPerk(actionNode.dataset.skill ?? "", Number(actionNode.dataset.perkIndex ?? -1)).catch((error) => {
        setStatus(error.message, "error");
      });
      return;
    }

	if (action === "weapon-save") {
	  void saveWeapon(actionNode).then(() => {
        if (actionNode.dataset.weaponType == null) {
          weaponAddOpen = false;
          scheduleRender();
        }
	  }).catch((error) => {
		setStatus(error.message, "error");
	  });
	  return;
	}

	if (action === "ammo-save") {
	  void saveAmmunition(actionNode).then(() => {
        if (!actionNode.dataset.ammoId) {
          ammunitionAddOpen = false;
          scheduleRender();
        }
      }).catch((error) => {
		setStatus(error.message, "error");
	  });
	  return;
	}

	if (action === "weapon-remove") {
	  const type = actionNode.dataset.weaponType;
	  const weaponIndex = Number(actionNode.dataset.weaponIndex ?? -1);

	  if (weaponIndex < 0) return;

	  void removeWeapon(type, weaponIndex).catch((error) => {
		setStatus(error.message, "error");
	  });

	  return;
	}

    if (["ammo-remove", "ammo-reload", "ammo-unload"].includes(action)) {
      void editAmmunition(action, actionNode).catch((error) => {
        setStatus(error.message, "error");
        scheduleRender();
      });
      return;
    }
    const tokenId = actionNode.dataset.tokenId;
    const partName = actionNode.dataset.part;
    const field = actionNode.dataset.field;
    const delta = Number(actionNode.dataset.delta ?? 0);
    const skill = actionNode.dataset.skill;

    if (action === "select-character" && tokenId) {
      void selectCharacter(tokenId).catch((error) => {
        setStatus(error?.message ?? "Unable to select token.", "error");
      });
    }

    if (action === "focus-token" && activeTokenId) {
      void selectCharacter(activeTokenId).catch((error) => {
        setStatus(error?.message ?? "Unable to focus token.", "error");
      });
    }

    if (action === "reload-token-visuals") {
      void reloadTokenVisuals().catch((error) => {
        setStatus(error?.message ?? "Unable to reload token visuals.", "error");
      });
      return;
    }

    if(action==='adjust-part-wound'){void recoverPartWound(actionNode.dataset.part,actionNode.dataset.wound,Number(actionNode.dataset.delta)).catch(error=>setStatus(error.message,'error'));return;}
    if (action === "heal-limbs") {
      void healLimbs().catch((error) => {
        setStatus(error?.message ?? "Unable to heal limbs.", "error");
      });
      return;
    }

    if (action === "add-body-part") {
      void addBodyPart().then(() => {
        bodyPartAddOpen = false;
        scheduleRender();
      }).catch((error) => {
        setStatus(error.message, "error");
      });
      return;
    }

    if (action === "remove-body-part") {
      void removeBodyPart(actionNode.dataset.part ?? "").catch((error) => {
        setStatus(error.message, "error");
      });
      return;
    }

    if (action === "toggle-part-hidden" && actionNode instanceof HTMLInputElement) {
      void toggleBodyPartHidden(actionNode.dataset.part ?? "", !actionNode.checked).catch((error) => {
        setStatus(error.message, "error");
      });
      return;
    }

    if (action === "pick-attack-target") {
      void startTargetPick().catch((error) => {
        setStatus(error?.message ?? "Unable to start target picking.", "error");
      });
      return;
    }

    if (action === "clear-debug-console") {
      void clearDebugConsole().catch((error) => {
        setStatus(error?.message ?? "Unable to clear debug console.", "error");
      });
      return;
    }

    if (action === "change-part" && partName && field) {
      void changeBodyField(partName, field, delta).catch((error) => {
        setStatus(error?.message ?? "Unable to update body value.", "error");
      });
    }

    if (action === "perform-attack") {
      void performAttack().catch((error) => {
        setStatus(error?.message ?? "Unable to resolve attack.", "error");
      });
      return;
    }

    if (action === "perform-manual-attack") {
      void performAttack({ manualDefense: true }).catch((error) => {
        setStatus(error?.message ?? "Unable to resolve no target attack.", "error");
      });
      return;
    }

    if (action === "perform-roll-dice") {
      void performRollDice().catch((error) => {
        setStatus(error?.message ?? "Unable to roll dice.", "error");
      });
      return;
    }

    if (action === "perform-roll-char") {
      void performRollChar().catch((error) => {
        setStatus(error?.message ?? "Unable to resolve Roll_Char.", "error");
      });
      return;
    }

    if (action === "perform-roll-skill") {
      void performRollSkill().catch((error) => {
        setStatus(error?.message ?? "Unable to resolve Roll_Skill.", "error");
      });
      return;
    }

    if (action === "perform-gm-private-roll") {
      void performPrivateGmRoll().catch((error) => {
        setStatus(error?.message ?? "Unable to perform private GM roll.", "error");
      });
      return;
    }

    if (action === "add-skill") {
      void addAvallonSkill().then(() => {
        skillAddOpen = false;
        scheduleRender();
      }).catch((error) => {
        setStatus(error?.message ?? "Unable to add skill.", "error");
      });
      return;
    }

    if (action === "add-weapon") {
      void addWeapon().catch((error) => {
        setStatus(error?.message ?? "Unable to add weapon.", "error");
      });
      return;
    }

    if (action === "export-token-data") {
      void exportSelectedTokenData().catch((error) => {
        setStatus(error?.message ?? "Unable to export token data.", "error");
      });
      return;
    }

    if (action === "open-token-import") {
      openTokenImportPicker();
      return;
    }

    if (action === "remove-skill" && skill) {
      void removeAvallonSkill(skill).catch((error) => {
        setStatus(error?.message ?? "Unable to remove skill.", "error");
      });
      return;
    }

    if (action === "remove-weapon") {
      const weaponIndex = Number(actionNode.dataset.weaponIndex ?? -1);
      if (weaponIndex < 0) return;
      void removeWeapon(weaponIndex).catch((error) => {
        setStatus(error?.message ?? "Unable to remove weapon.", "error");
      });
    }
  });

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    if (target.dataset.attackField||target.dataset.manualAttackField||target.dataset.hudAttackField)queueMicrotask(paintRangeAdjustments);
    if (target.dataset.hudAttackField) {
      const field=target.dataset.hudAttackField;
      const original=ui.selectedTokenPanel.querySelector(`[data-attack-field="${field}"]`);
      if (original) { original.value=target.value; original.dispatchEvent(new Event("change",{bubbles:true})); }
      scheduleRender();return;
    }
    if (target.dataset.weaponDraft === "type") {
      toggleWeaponDraftFields(target);
      return;
    }
    if (target.dataset.rangedEdit) {
      void editAmmunition("ranged-edit", target).catch((error) => {
        setStatus(error.message, "error");
        scheduleRender();
      });
      return;
    }

    if(activeTokenId&&(target.dataset.attackField==='skill'||target.dataset.manualAttackField==='skill')){
      saveAttackDraftValue(activeTokenId,'skill',target.value);
      const token=getCharacterById(activeTokenId),ability=[...implantAttacks(getAvallonData(token)),...abilityAttacks(getAvallonData(token))].find(w=>w.selectionKey===target.value);
      if(ability)syncAttackWeaponInputs(activeTokenId,ability.selectionKey,ability.damage,ability.accuracy);
      else {const stored=attackFormDrafts.get(activeTokenId);if(stored?.weaponName?.startsWith('magic:')||stored?.weaponName?.startsWith('implant:')){const w=getDefaultAttackWeapon(token);syncAttackWeaponInputs(activeTokenId,w.name,w.damage,w.accuracy);}}
      scheduleRender();return;
    }
    if (target.dataset.attackField && activeTokenId) {
      if (target.dataset.attackField === "weaponName") {
        const token = getCharacterById(activeTokenId);
        const selectedWeapon = token ? getWeaponByName(token, target.value) : null;
        if (selectedWeapon) {
          syncAttackWeaponInputs(
            activeTokenId,
            selectedWeapon.selectionKey ?? selectedWeapon.name,
            selectedWeapon.damage,
            selectedWeapon.accuracy ?? 0,
          );
        }
        return;
      }
      saveAttackDraftValue(activeTokenId, target.dataset.attackField, target.value);
      if(target.dataset.attackField==='parryMode')void updateTrackerData(activeTokenId,current=>{const next=structuredClone(current);next.avallon.preferences.parryMode=target.value;return next;}).catch(e=>setStatus(e.message,'error'));
      if (target.dataset.attackField === "targetTokenId") {
        const selectedTarget = target.value ? getCharacterById(target.value) : null;
        saveAttackDraftValue(
          activeTokenId,
          "targetTokenName",
          selectedTarget ? getCharacterName(selectedTarget) : "",
        );
        void persistAttackTargetToken(activeTokenId, target.value).catch((error) => {
          console.warn("[Body HP] Unable to persist attack target", error);
        });
        void syncTargetHighlight().catch((error) => {
          console.warn("[Body HP] Unable to sync target highlight", error);
        });
      }
    }

    if (target.dataset.manualAttackField && activeTokenId) {
      if (target.dataset.manualAttackField === "weaponName") {
        const token = getCharacterById(activeTokenId);
        const selectedWeapon = token ? getWeaponByName(token, target.value) : null;
        if (selectedWeapon) {
          syncAttackWeaponInputs(
            activeTokenId,
            selectedWeapon.selectionKey ?? selectedWeapon.name,
            selectedWeapon.damage,
            selectedWeapon.accuracy ?? 0,
          );
        }
        return;
      }
      const draftField = getSharedAttackDraftField(target.dataset.manualAttackField);
      if (draftField) {
        saveAttackDraftValue(activeTokenId, draftField, target.value);
      }
    }

    if (target.dataset.action === "select-owner-player") {
      void setOwnerPlayer(target.value).catch((error) => {
        setStatus(error?.message ?? "Unable to save owner.", "error");
      });
      return;
    }

    if (target.dataset.action === "set-avallon-skill") {
      const skill = target.dataset.skill;
      if (!skill) return;
      void setAvallonSkill(skill, target.value).catch((error) => {
        setStatus(error?.message ?? "Unable to save skill.", "error");
      });
      return;
    }

    if (target.dataset.action === "rename-avallon-skill") {
      const skill = target.dataset.skill;
      if (!skill) return;
      void renameAvallonSkill(skill, target.value).catch((error) => {
        setStatus(error.message, "error");
        scheduleRender();
      });
      return;
    }

    if (target.dataset.action === "set-skill-strength-bonus") {
      const skill = target.dataset.skill;
      if (!skill || !(target instanceof HTMLInputElement)) return;
      void setAvallonSkillStrengthBonus(skill, target.checked).catch((error) => {
        setStatus(error?.message ?? "Unable to save strength bonus flag.", "error");
      });
      return;
    }

    if (target.dataset.action === "set-avallon-attribute") {
      if(getAvallonData(getCharacterById(activeTokenId)).pilot)return;
      const attribute = target.dataset.attribute;
      if (!attribute) return;
      void setAvallonAttribute(attribute, target.value).catch((error) => {
        setStatus(error?.message ?? "Unable to save attribute.", "error");
      });
      return;
    }

    if (target.dataset.action === "set-weapon-damage") {
      const index = Number(target.dataset.weaponIndex ?? 0);
      void setWeaponDamage(index, target.value).catch((error) => {
        setStatus(error?.message ?? "Unable to save weapon damage.", "error");
      });
      return;
    }

    if (target.dataset.action === "set-weapon-accuracy") {
      const index = Number(target.dataset.weaponIndex ?? 0);
      void setWeaponAccuracy(index, target.value).catch((error) => {
        setStatus(error?.message ?? "Unable to save weapon accuracy.", "error");
      });
      return;
    }

    if (target.dataset.action === "set-weapon-name") {
      const index = Number(target.dataset.weaponIndex ?? 0);
      void setWeaponName(index, target.value).catch((error) => {
        setStatus(error?.message ?? "Unable to save weapon name.", "error");
      });
      return;
    }

    if (target.dataset.tokenImportInput != null) {
      const [file] = target.files ?? [];
      target.value = "";
      void importSelectedTokenData(file).catch((error) => {
        setStatus(error?.message ?? "Unable to import token data.", "error");
      });
      return;
    }

    if (target.dataset.action === "rename-body-part") {
      const partName = target.dataset.part;
      if (!partName) return;
      void renameBodyPart(partName, target.value).catch((error) => {
        setStatus(error.message, "error");
        scheduleRender();
      });
      return;
    }

    if (target.dataset.action !== "set-field") return;

    const partName = target.dataset.part;
    const field = target.dataset.field;
    if (!partName || !field) return;

    void setBodyField(partName, field, target.value).catch((error) => {
      setStatus(error?.message ?? "Unable to save field.", "error");
    });
  });

  document.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!activeTokenId) return;

    if(target.dataset.attackField||target.dataset.manualAttackField||target.dataset.hudAttackField)queueMicrotask(paintRangeAdjustments);
    if (target.dataset.hudAttackField) {
      const field=target.dataset.hudAttackField;
      const original=ui.selectedTokenPanel.querySelector(`[data-attack-field="${field}"]`);
      if (original) original.value=target.value;
      saveAttackDraftValue(activeTokenId,field,target.value);
    }
    if (target.dataset.attackField) {
      saveAttackDraftValue(activeTokenId, target.dataset.attackField, target.value);
    }

    if (target.dataset.manualAttackField) {
      const draftField = getSharedAttackDraftField(target.dataset.manualAttackField);
      if (draftField) {
        saveAttackDraftValue(activeTokenId, draftField, target.value);
      }
    }

    if (target.dataset.action === "set-avallon-skill") {
      const skill = target.dataset.skill;
      if (!skill) return;
      queueInputAutosave({
        tokenId: activeTokenId,
        action: "set-avallon-skill",
        skill,
        value: target.value,
      });
      return;
    }

    if (target.dataset.action === "set-avallon-attribute") {
      const attribute = target.dataset.attribute;
      if (!attribute) return;
      queueInputAutosave({
        tokenId: activeTokenId,
        action: "set-avallon-attribute",
        attribute,
        value: target.value,
      });
      return;
    }

    if (target.dataset.action === "set-weapon-damage") {
      queueInputAutosave({
        tokenId: activeTokenId,
        action: "set-weapon-damage",
        weaponIndex: Number(target.dataset.weaponIndex ?? 0),
        value: target.value,
      });
      return;
    }

    if (target.dataset.action === "set-weapon-accuracy") {
      queueInputAutosave({
        tokenId: activeTokenId,
        action: "set-weapon-accuracy",
        weaponIndex: Number(target.dataset.weaponIndex ?? 0),
        value: target.value,
      });
      return;
    }

    if (target.dataset.action === "set-weapon-name") {
      queueInputAutosave({
        tokenId: activeTokenId,
        action: "set-weapon-name",
        weaponIndex: Number(target.dataset.weaponIndex ?? 0),
        value: target.value,
      });
      return;
    }

    if (target.dataset.action === "set-field") {
      const partName = target.dataset.part;
      const field = target.dataset.field;
      if (!partName || !field) return;
      queueInputAutosave({
        tokenId: activeTokenId,
        action: "set-field",
        partName,
        field,
        value: target.value,
      });
    }
  });
}

OBR.onReady(async () => {
  installCompactButtons();
  try {
    enableActionResize(document.querySelector("[data-action-resize]"), {
      storageKey: "com.avallon.system/action-size",
      defaultWidth: 560,
      defaultHeight: 860,
    });
    characterTools = installCharacterTools({OBR, sanitize:sanitizeTrackerData, tracker:getTrackerData,
      getPoolTokens:async()=>(await OBR.scene.items.getItems()).filter(isCharacterToken),getTokens:()=>characterListCache,getEffective:getAvallonData,activateAbility:useItemAbility, setVehicle:setVehicleState, selectImplantAttack:prepareItemAbilityAttack, useItem:useCharacterItem, getToken:id => getCharacterById(id ?? activeTokenId), getRole:() => playerRole,
      canControl:canUseToken, update:updateTrackerData, refreshOverlay:ensureOverlayForToken,
      render:scheduleRender, status:setStatus, download:downloadTextFile,
      resetDraft:id => { pendingFieldDrafts.clear(id);attackFormDrafts.delete(id); for (const [key,timer] of inputAutosaveTimers) { if (key.startsWith(id+"|")) {clearTimeout(timer);inputAutosaveTimers.delete(key);} } },
    });
    targetDistance=createTargetDistance({OBR,buildRuler,onRead:paintTargetDistance,context:HUD_MODE?'hud':'main'});
    OBR.scene.grid.onChange(()=>{targetDistance.invalidate();refreshTargetDistance();});
    window.addEventListener('beforeunload',()=>{void targetDistance.clear();});
    new MutationObserver(()=>paintAbilityAttackFields()).observe(ui.selectedTokenPanel,{childList:true,subtree:true});
    installStatusTools({getToken:()=>getCharacterById(activeTokenId),getRole:()=>playerRole,update:updateTrackerData,status:setStatus,render:scheduleRender});
    installArtifactTools({useAbility:useItemAbility,prepareAbility:prepareItemAbilityAttack,getToken:id=>getCharacterById(id??activeTokenId),getRole:()=>playerRole,canControl:canUseToken,tracker:getTrackerData,update:updateTrackerData,render:scheduleRender,status:setStatus});
    installMagicTools({useAbility:useCharacterAbility,useNarrative:(id,abilityId)=>useNarrativeStatus(id,'',abilityId),getToken:()=>getCharacterById(activeTokenId),getRole:()=>playerRole,canControl:canUseToken,tracker:getTrackerData,effective:getAvallonData,update:updateTrackerData,render:scheduleRender,status:setStatus,log:pushDebugEntry,prepare:(id,key)=>{const t=getCharacterById(id),w=getWeaponByName(t,key);syncAttackWeaponInputs(id,key,w.damage,w.accuracy);scheduleRender();}});
    bindUiEvents();
    await removeAttackTargetContextMenu();
    await Promise.all([
      loadSharedDebugConsole(),
      OBR.scene.local.getItems().then((items) => {
        setLocalSceneItems(items);
      }),
    ]);
    await syncState(true);
    startSelectionPolling();
    setStatus(
      "Ready. Select a character token on the map to edit it here.",
      "info"
    );

    OBR.scene.items.onChange((items) => {
      setSceneItems(items);
      scheduleRender();
      scheduleSceneSideEffects(items);
    });

    OBR.scene.local.onChange((items) => {
      setLocalSceneItems(items);
    });

    OBR.player.onChange((player) => {
      playerRole = player.role;
      playerId = player.id ?? playerId;
      playerName = player.name ?? playerName;
      playerColor = player.color ?? playerColor;
      void handleSelectionChange(player.selection ?? []).then(() => {
        scheduleRender();
        return syncLocalOwnedHiddenTokenViews(sceneItems);
      }).catch((error) => {
        console.warn("[Body HP] Player state sync failed", error);
        scheduleRender();
      });
    });

    OBR.party.onChange((players) => {
      setPartyPlayersState(players);
      scheduleRender();
    });

    OBR.broadcast.onMessage(DEBUG_BROADCAST_CHANNEL, (event) => {
      const payload = event?.data;
      if (!payload || typeof payload !== "object") return;

      if (payload.type === "debug-clear") {
        if (pendingLocalDebugClear) {
          pendingLocalDebugClear = false;
          return;
        }
        debugEntries = [];
        renderDebugConsole();
        return;
      }

      if (payload.type !== "debug-entry") return;
      if (pendingLocalDebugEntryIds.has(payload.entry?.id)) {
        pendingLocalDebugEntryIds.delete(payload.entry.id);
        return;
      }

      const nextEntries = mergeDebugEntries([payload.entry], debugEntries);
      debugEntries = nextEntries;
      renderDebugConsole();

      if (playerRole === "GM") {
        void persistLogEntries(OBR,[payload.entry]).catch((error) => {
          console.warn("[Body HP] Unable to persist broadcast debug entry", error);
        });
      }
    });

    OBR.room.onMetadataChange((metadata) => {
      debugEntries = sanitizeDebugEntries(metadata?.[DEBUG_LOG_KEY]);
      renderDebugConsole();
    });
  } catch (error) {
    setStatus(error?.message ?? "Extension failed to initialize.", "error");
  }
});
