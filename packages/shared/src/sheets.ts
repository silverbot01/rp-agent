import { z } from "zod";
import { LIMITS } from "./defaults.ts";

export const CHARACTER_STRING_FIELDS = [
  "clothing",
  "emotion",
  "posture",
  "location",
  "injuries",
  "goals",
  "note",
] as const;

export const WORLD_STRING_FIELDS = [
  "time",
  "weather",
  "place",
  "atmosphere",
  "ongoing",
  "chronicle",
] as const;

export type CharacterStringField = (typeof CHARACTER_STRING_FIELDS)[number];
export type WorldStringField = (typeof WORLD_STRING_FIELDS)[number];

export type CharacterDynamic = {
  clothing: string;
  emotion: string;
  posture: string;
  location: string;
  inventory: string[];
  injuries: string;
  goals: string;
  note: string;
  custom: Record<string, string>;
};

export type WorldDynamic = {
  time: string;
  weather: string;
  place: string;
  atmosphere: string;
  ongoing: string;
  chronicle: string;
  custom: Record<string, string>;
};

export type CharacterState = {
  dynamic: CharacterDynamic;
  pins: string[];
};

export type WorldState = {
  dynamic: WorldDynamic;
  pins: string[];
};

export type ChatSheets = {
  characters: Record<string, CharacterState>;
  world: WorldState;
};

export type LoreMode = "always" | "keyword" | "rag";

export type LoreEntry = {
  id: string;
  text: string;
  mode: LoreMode;
  keywords: string[];
};

export function normalizeLore(input: unknown): LoreEntry[] {
  if (!Array.isArray(input)) return [];
  const out: LoreEntry[] = [];
  for (const item of input) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text.trim().slice(0, 8000) : "";
    if (!text) continue;
    const mode: LoreMode = record.mode === "keyword" || record.mode === "rag" || record.mode === "always" ? record.mode : "always";
    const keywords = Array.isArray(record.keywords)
      ? record.keywords
          .filter((keyword): keyword is string => typeof keyword === "string")
          .map((keyword) => keyword.trim())
          .filter(Boolean)
          .slice(0, 32)
      : [];
    const id = typeof record.id === "string" && record.id.trim() ? record.id.trim().slice(0, 80) : crypto.randomUUID();
    out.push({ id, text, mode, keywords });
  }
  return out;
}

export function emptyCharacterDynamic(): CharacterDynamic {
  return {
    clothing: "",
    emotion: "",
    posture: "",
    location: "",
    inventory: [],
    injuries: "",
    goals: "",
    note: "",
    custom: {},
  };
}

export function emptyWorldDynamic(): WorldDynamic {
  return {
    time: "",
    weather: "",
    place: "",
    atmosphere: "",
    ongoing: "",
    chronicle: "",
    custom: {},
  };
}

export function emptySheets(): ChatSheets {
  return {
    characters: {},
    world: { dynamic: emptyWorldDynamic(), pins: [] },
  };
}

function cap(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function stringMap(input: unknown, maxKeys: number): Record<string, string> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (Object.keys(out).length >= maxKeys) break;
    if (typeof value !== "string") continue;
    const safeKey = cap(key, LIMITS.customKey);
    if (!safeKey) continue;
    out[safeKey] = cap(value, LIMITS.customValue);
  }
  return out;
}

export function normalizeCharacterDynamic(input: unknown): CharacterDynamic {
  const base = emptyCharacterDynamic();
  if (typeof input !== "object" || input === null) return base;
  const record = input as Record<string, unknown>;
  for (const field of CHARACTER_STRING_FIELDS) {
    if (typeof record[field] === "string") base[field] = cap(record[field], LIMITS.field);
  }
  if (Array.isArray(record.inventory)) {
    const items: string[] = [];
    for (const item of record.inventory) {
      if (typeof item !== "string") continue;
      const safe = cap(item, LIMITS.inventoryItem);
      if (!safe || items.includes(safe)) continue;
      items.push(safe);
      if (items.length >= LIMITS.inventory) break;
    }
    base.inventory = items;
  }
  base.custom = stringMap(record.custom, LIMITS.customKeys);
  return base;
}

export function normalizeWorldDynamic(input: unknown): WorldDynamic {
  const base = emptyWorldDynamic();
  if (typeof input !== "object" || input === null) return base;
  const record = input as Record<string, unknown>;
  for (const field of WORLD_STRING_FIELDS) {
    if (typeof record[field] === "string") base[field] = cap(record[field], LIMITS.field);
  }
  base.custom = stringMap(record.custom, LIMITS.customKeys);
  return base;
}

export function normalizePins(input: unknown, allowed: readonly string[]): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const item of input) {
    if (typeof item !== "string" || !allowed.includes(item)) continue;
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

const characterPatchSchema = z.object({
  set: z
    .object({
      clothing: z.string().optional(),
      emotion: z.string().optional(),
      posture: z.string().optional(),
      location: z.string().optional(),
      injuries: z.string().optional(),
      goals: z.string().optional(),
      note: z.string().optional(),
    })
    .optional(),
  custom: z.record(z.string(), z.string()).optional(),
  inventory_add: z.array(z.string()).optional(),
  inventory_remove: z.array(z.string()).optional(),
});

export const statePatchSchema = z.object({
  characters: z.record(z.string(), characterPatchSchema).optional(),
  world: z
    .object({
      set: z
        .object({
          time: z.string().optional(),
          weather: z.string().optional(),
          place: z.string().optional(),
          atmosphere: z.string().optional(),
          ongoing: z.string().optional(),
          chronicle: z.string().optional(),
        })
        .optional(),
      custom: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
  memories: z
    .array(
      z.object({
        text: z.string(),
        tags: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});

export type StatePatch = z.infer<typeof statePatchSchema>;

export type DiffEntry = {
  path: string;
  label: string;
  before: string;
  after: string;
};

export type ReduceOk = {
  ok: true;
  sheets: ChatSheets;
  diff: DiffEntry[];
  memories: { text: string; tags: string[] }[];
  notices: string[];
};

export type ReduceResult = ReduceOk | { ok: false; error: string };

export function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function parseStatePatch(text: string): { ok: true; patch: StatePatch } | { ok: false; error: string } {
  const json = extractJsonObject(text);
  if (!json) return { ok: false, error: "The state model reply had no JSON object." };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: "The state model reply was not valid JSON." };
  }
  const parsed = statePatchSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 4)
      .map((issue) => `${issue.path.join(".") || "patch"}: ${issue.message}`)
      .join("; ");
    return { ok: false, error: detail || "The state patch did not match the schema." };
  }
  return { ok: true, patch: parsed.data };
}

function pushDiff(diff: DiffEntry[], path: string, label: string, before: string, after: string) {
  if (before === after) return;
  diff.push({ path, label, before, after });
}

function applyCustom(
  custom: Record<string, string>,
  patch: Record<string, string> | undefined,
  prefix: string,
  labelPrefix: string,
  diff: DiffEntry[],
  notices: string[],
): Record<string, string> {
  if (!patch) return custom;
  const next = { ...custom };
  for (const [rawKey, rawValue] of Object.entries(patch)) {
    if (Object.keys(next).length >= LIMITS.customKeys && !(cap(rawKey, LIMITS.customKey) in next)) {
      notices.push(`Custom field cap reached. Left out ${rawKey}.`);
      continue;
    }
    const key = cap(rawKey, LIMITS.customKey);
    if (!key) continue;
    const value = cap(rawValue, LIMITS.customValue);
    const before = next[key] ?? "";
    if (!value) delete next[key];
    else next[key] = value;
    pushDiff(diff, `${prefix}:custom:${key}`, `${labelPrefix} · ${key}`, before, value);
  }
  return next;
}

export function applyPatch(sheets: ChatSheets, patch: StatePatch, names: Record<string, string>): ReduceOk {
  const next: ChatSheets = {
    characters: Object.fromEntries(
      Object.entries(sheets.characters).map(([id, state]) => [
        id,
        { dynamic: { ...state.dynamic, inventory: [...state.dynamic.inventory], custom: { ...state.dynamic.custom } }, pins: [...state.pins] },
      ]),
    ),
    world: {
      dynamic: { ...sheets.world.dynamic, custom: { ...sheets.world.dynamic.custom } },
      pins: [...sheets.world.pins],
    },
  };
  const diff: DiffEntry[] = [];
  const notices: string[] = [];

  for (const [id, characterPatch] of Object.entries(patch.characters ?? {})) {
    const state = next.characters[id];
    if (!state) {
      notices.push(`Ignored unknown character ${id}.`);
      continue;
    }
    const name = names[id] || id;
    const pinned = new Set(state.pins);
    for (const field of CHARACTER_STRING_FIELDS) {
      const value = characterPatch.set?.[field];
      if (value === undefined) continue;
      if (pinned.has(field)) {
        notices.push(`${name} · ${field} is pinned.`);
        continue;
      }
      const capped = cap(value, LIMITS.field);
      pushDiff(diff, `character:${id}:${field}`, `${name} · ${field}`, state.dynamic[field], capped);
      state.dynamic[field] = capped;
    }
    if (characterPatch.inventory_add || characterPatch.inventory_remove) {
      const before = state.dynamic.inventory.join(", ");
      if (!pinned.has("inventory")) {
        const items = [...state.dynamic.inventory];
        for (const raw of characterPatch.inventory_add ?? []) {
          const item = cap(raw, LIMITS.inventoryItem);
          if (!item || items.includes(item)) continue;
          if (items.length >= LIMITS.inventory) break;
          items.push(item);
        }
        for (const raw of characterPatch.inventory_remove ?? []) {
          const item = cap(raw, LIMITS.inventoryItem);
          const index = items.indexOf(item);
          if (index >= 0) items.splice(index, 1);
        }
        state.dynamic.inventory = items;
        pushDiff(diff, `character:${id}:inventory`, `${name} · inventory`, before, items.join(", "));
      } else {
        notices.push(`${name} · inventory is pinned.`);
      }
    }
    if (pinned.has("custom")) {
      if (characterPatch.custom && Object.keys(characterPatch.custom).length > 0) {
        notices.push(`${name} · custom is pinned.`);
      }
    } else {
      state.dynamic.custom = applyCustom(state.dynamic.custom, characterPatch.custom, `character:${id}`, name, diff, notices);
    }
  }

  if (patch.world) {
    const pinned = new Set(next.world.pins);
    for (const field of WORLD_STRING_FIELDS) {
      const value = patch.world.set?.[field];
      if (value === undefined) continue;
      if (pinned.has(field)) {
        notices.push(`World · ${field} is pinned.`);
        continue;
      }
      const capped = cap(value, LIMITS.field);
      pushDiff(diff, `world:${field}`, `World · ${field}`, next.world.dynamic[field], capped);
      next.world.dynamic[field] = capped;
    }
    if (pinned.has("custom")) {
      if (patch.world.custom && Object.keys(patch.world.custom).length > 0) notices.push("World · custom is pinned.");
    } else {
      next.world.dynamic.custom = applyCustom(next.world.dynamic.custom, patch.world.custom, "world", "World", diff, notices);
    }
  }

  const memories = (patch.memories ?? [])
    .map((memory) => ({
      text: cap(memory.text, LIMITS.memory),
      tags: (memory.tags ?? []).map((tag) => cap(tag, 40)).filter(Boolean).slice(0, 8),
    }))
    .filter((memory) => memory.text)
    .slice(0, LIMITS.memories);

  return { ok: true, sheets: next, diff, memories, notices };
}

export function reduceState(sheets: ChatSheets, text: string, names: Record<string, string>): ReduceResult {
  const parsed = parseStatePatch(text);
  if (!parsed.ok) return parsed;
  return applyPatch(sheets, parsed.patch, names);
}

export function cloneSheets(sheets: ChatSheets): ChatSheets {
  return {
    characters: Object.fromEntries(
      Object.entries(sheets.characters).map(([id, state]) => [
        id,
        {
          dynamic: normalizeCharacterDynamic(state.dynamic),
          pins: normalizePins(state.pins, [...CHARACTER_STRING_FIELDS, "inventory", "custom"]),
        },
      ]),
    ),
    world: {
      dynamic: normalizeWorldDynamic(sheets.world.dynamic),
      pins: normalizePins(sheets.world.pins, [...WORLD_STRING_FIELDS, "custom"]),
    },
  };
}

export const CHARACTER_PIN_FIELDS = [...CHARACTER_STRING_FIELDS, "inventory", "custom"] as const;
export const WORLD_PIN_FIELDS = [...WORLD_STRING_FIELDS, "custom"] as const;

export function mockStatePatch(sheets: ChatSheets): StatePatch {
  const characters: NonNullable<StatePatch["characters"]> = {};
  for (const id of Object.keys(sheets.characters)) {
    characters[id] = {
      set: { emotion: "wary", clothing: "a wet wool cloak" },
    };
  }
  return {
    characters,
    world: { set: { weather: "cold rain", time: "just after dusk" } },
    memories: [{ text: "The rain started as they left the gate.", tags: ["weather"] }],
  };
}

export function sheetsEqual(a: ChatSheets, b: ChatSheets): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function diffSheets(before: ChatSheets, after: ChatSheets, names: Record<string, string>): DiffEntry[] {
  const diff: DiffEntry[] = [];
  const ids = new Set([...Object.keys(before.characters), ...Object.keys(after.characters)]);
  for (const id of ids) {
    const name = names[id] || id;
    const left = before.characters[id]?.dynamic ?? emptyCharacterDynamic();
    const right = after.characters[id]?.dynamic ?? emptyCharacterDynamic();
    for (const field of CHARACTER_STRING_FIELDS) {
      pushDiff(diff, `character:${id}:${field}`, `${name} · ${field}`, left[field], right[field]);
    }
    pushDiff(diff, `character:${id}:inventory`, `${name} · inventory`, left.inventory.join(", "), right.inventory.join(", "));
    const customKeys = new Set([...Object.keys(left.custom), ...Object.keys(right.custom)]);
    for (const key of customKeys) {
      pushDiff(diff, `character:${id}:custom:${key}`, `${name} · ${key}`, left.custom[key] ?? "", right.custom[key] ?? "");
    }
  }
  for (const field of WORLD_STRING_FIELDS) {
    pushDiff(diff, `world:${field}`, `World · ${field}`, before.world.dynamic[field], after.world.dynamic[field]);
  }
  const worldCustom = new Set([...Object.keys(before.world.dynamic.custom), ...Object.keys(after.world.dynamic.custom)]);
  for (const key of worldCustom) {
    pushDiff(diff, `world:custom:${key}`, `World · ${key}`, before.world.dynamic.custom[key] ?? "", after.world.dynamic.custom[key] ?? "");
  }
  return diff;
}
