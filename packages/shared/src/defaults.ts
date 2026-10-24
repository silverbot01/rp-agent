export const LIMITS = {
  field: 2000,
  customKey: 64,
  customValue: 500,
  customKeys: 24,
  inventoryItem: 200,
  inventory: 50,
  memory: 1000,
  memories: 8,
  template: 20000,
  prompt: 50000,
} as const;

export const BLOCK_IDS = [
  "main",
  "pre_history",
  "world_static",
  "world_dynamic",
  "characters",
  "lore",
  "memories",
  "history",
  "post_history",
] as const;

export type BlockId = (typeof BLOCK_IDS)[number];

export const BLOCK_LABELS: Record<BlockId, string> = {
  main: "Main",
  pre_history: "Pre-history",
  world_static: "World",
  world_dynamic: "World (dynamic)",
  characters: "Characters",
  lore: "Lore",
  memories: "Memories",
  history: "History",
  post_history: "Post-history",
};

export const DEFAULT_MAIN_PROMPT = `You are the narrator of a roleplay. Write the next beat in prose, in the voice of the scene.
Stay consistent with the character sheets and the world state. Those sheets describe what is true right now.
Do not write the user's actions or dialogue. Leave room for them to act.`;

export const DEFAULT_PRE_HISTORY = "";

export const DEFAULT_POST_HISTORY = "";

export const DEFAULT_STATE_INSTRUCTIONS = `Update the sheets so they match what just happened in the scene.
Change clothing, emotion, posture, location, inventory, injuries, goals, time, weather, place, atmosphere, and ongoing events when the scene gives you a reason.
Rewrite the short note and the world chronicle so they still fit.
Leave a field out of the patch when it did not change.
Use character ids exactly as given.`;

export const DEFAULT_CHARACTER_TEMPLATE = `{{name}}'s current state:
{{#if clothing}}Clothing: {{clothing}}
{{/if}}{{#if emotion}}Emotion: {{emotion}}
{{/if}}{{#if posture}}Posture: {{posture}}
{{/if}}{{#if location}}Location: {{location}}
{{/if}}{{#if inventory}}Inventory: {{inventory}}
{{/if}}{{#if injuries}}Injuries: {{injuries}}
{{/if}}{{#if goals}}Goals: {{goals}}
{{/if}}{{#if note}}Note: {{note}}
{{/if}}{{#if custom}}{{custom}}
{{/if}}`;

export const DEFAULT_WORLD_TEMPLATE = `World state:
{{#if time}}Time: {{time}}
{{/if}}{{#if weather}}Weather: {{weather}}
{{/if}}{{#if place}}Place: {{place}}
{{/if}}{{#if atmosphere}}Atmosphere: {{atmosphere}}
{{/if}}{{#if ongoing}}Ongoing: {{ongoing}}
{{/if}}{{#if chronicle}}Chronicle: {{chronicle}}
{{/if}}{{#if custom}}{{custom}}
{{/if}}`;

export const SPACEXAI_BASE_URL = "https://api.x.ai/v1";
export const SPACEXAI_MODEL = "grok-4.7";

export function normalizeOrder(order: unknown): BlockId[] {
  const seen = new Set<BlockId>();
  const result: BlockId[] = [];
  if (Array.isArray(order)) {
    for (const item of order) {
      if (typeof item !== "string") continue;
      if (!(BLOCK_IDS as readonly string[]).includes(item)) continue;
      const id = item as BlockId;
      if (seen.has(id)) continue;
      seen.add(id);
      result.push(id);
    }
  }
  for (const id of BLOCK_IDS) {
    if (!seen.has(id)) result.push(id);
  }
  return result;
}

export function normalizeDisabled(disabled: unknown): BlockId[] {
  if (!Array.isArray(disabled)) return [];
  const out: BlockId[] = [];
  for (const item of disabled) {
    if (typeof item !== "string") continue;
    if (!(BLOCK_IDS as readonly string[]).includes(item)) continue;
    const id = item as BlockId;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}
