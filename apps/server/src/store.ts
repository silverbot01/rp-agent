import type { DatabaseSync } from "node:sqlite";
import {
  BLOCK_IDS,
  CHARACTER_PIN_FIELDS,
  CONNECTION_KINDS,
  DEFAULT_CHARACTER_TEMPLATE,
  DEFAULT_MAIN_PROMPT,
  DEFAULT_POST_HISTORY,
  DEFAULT_PRE_HISTORY,
  DEFAULT_STATE_INSTRUCTIONS,
  DEFAULT_WORLD_TEMPLATE,
  WORLD_PIN_FIELDS,
  cloneSheets,
  defaultSampler,
  defaultStateSampler,
  diffSheets,
  emptySheets,
  emptyWorldDynamic,
  normalizeCharacterDynamic,
  normalizeDisabled,
  normalizeLore,
  normalizeOrder,
  normalizePins,
  normalizeSampler,
  normalizeWorldDynamic,
  type BlockId,
  type CharacterDynamic,
  type ChatSheets,
  type ConnectionKind,
  type DiffEntry,
  type LoreEntry,
  type SamplerPreset,
  type WorldDynamic,
} from "@rp/shared";
import { HttpError } from "./errors.ts";

export type ConnectionPublic = {
  id: string;
  name: string;
  kind: ConnectionKind;
  base_url: string;
  model: string;
  extra_samplers: boolean;
  has_key: boolean;
};

export type ConnectionSecret = ConnectionPublic & { api_key: string | null };

export type CharacterPublic = {
  id: string;
  name: string;
  description: string;
  personality: string;
  scenario: string;
  example_dialogue: string;
  greeting: string;
  tags: string;
  dynamic_template: string;
  initial_dynamic: CharacterDynamic;
  created_at: string;
  updated_at: string;
};

export type WorldPublic = {
  id: string;
  name: string;
  description: string;
  lore: LoreEntry[];
  dynamic_template: string;
  initial_dynamic: WorldDynamic;
  created_at: string;
  updated_at: string;
};

export type PresetPublic = {
  id: string;
  name: string;
  purpose: "prose" | "state";
  sampler: SamplerPreset;
  created_at: string;
};

export type MessagePublic = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type RevisionPublic = {
  id: string;
  chat_id: string;
  source: "model" | "user" | "undo";
  status: "applied" | "pending" | "discarded" | "undone";
  diff: DiffEntry[];
  notices: string[];
  error: string | null;
  created_at: string;
  before: ChatSheets;
  after: ChatSheets;
};

export type ChatPublic = {
  id: string;
  title: string;
  world_id: string | null;
  connection_id: string | null;
  model: string;
  state_connection_id: string | null;
  state_model: string;
  sampler: SamplerPreset;
  state_sampler: SamplerPreset;
  persona_name: string;
  persona_description: string;
  main_prompt: string;
  pre_history: string;
  post_history: string;
  state_instructions: string;
  block_order: BlockId[];
  disabled_blocks: BlockId[];
  context_tokens: number;
  rag_enabled: boolean;
  memory_budget_tokens: number;
  hold_state_updates: boolean;
  cast: string[];
  sheets: ChatSheets;
  last_retrieval: { id: string; text: string }[];
  last_prompt_tokens: number | null;
  last_state_error: string | null;
  created_at: string;
  updated_at: string;
};

export type ChatDetail = ChatPublic & {
  messages: MessagePublic[];
  revisions: RevisionPublic[];
};

export type EmbedderPublic = {
  connection_id: string | null;
  model: string;
  dimensions: number | null;
  status: "idle" | "rebuilding" | "ready" | "error";
  progress_done: number;
  progress_total: number;
  error: string | null;
};

export type ChunkRecord = {
  id: string;
  scope: "chat" | "world";
  scope_id: string;
  source: "message" | "memory" | "lore";
  source_id: string;
  text: string;
  tags: string[];
  embedding: Uint8Array | null;
  embedder_model: string | null;
  stale: boolean;
};

type ChatPatch = {
  title?: string;
  world_id?: string | null;
  connection_id?: string | null;
  model?: string;
  state_connection_id?: string | null;
  state_model?: string;
  sampler?: unknown;
  state_sampler?: unknown;
  persona_name?: string;
  persona_description?: string;
  main_prompt?: string;
  pre_history?: string;
  post_history?: string;
  state_instructions?: string;
  block_order?: unknown;
  disabled_blocks?: unknown;
  context_tokens?: number;
  rag_enabled?: boolean;
  memory_budget_tokens?: number;
  hold_state_updates?: boolean;
  cast?: string[];
  sheets?: ChatSheets;
  last_retrieval?: { id: string; text: string }[];
  last_prompt_tokens?: number | null;
  last_state_error?: string | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function asKind(value: string): ConnectionKind {
  if ((CONNECTION_KINDS as readonly string[]).includes(value)) return value as ConnectionKind;
  throw new HttpError(400, "Unknown connection kind.");
}

function optionalId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, 80);
  if (!trimmed || !/^[\w.-]+$/.test(trimmed)) return null;
  return trimmed;
}

function rowExists(db: DatabaseSync, table: "characters" | "worlds" | "chats" | "connections", id: string): boolean {
  const sql = {
    characters: "SELECT id FROM characters WHERE id = :id",
    worlds: "SELECT id FROM worlds WHERE id = :id",
    chats: "SELECT id FROM chats WHERE id = :id",
    connections: "SELECT id FROM connections WHERE id = :id",
  }[table];
  return Boolean(db.prepare(sql).get({ id }));
}

function envKey(kind: ConnectionKind): string | null {
  if (kind === "spacexai" && process.env.XAI_API_KEY?.trim()) return process.env.XAI_API_KEY.trim();
  return null;
}

function publicConnection(row: Record<string, unknown>): ConnectionPublic {
  const kind = asKind(String(row.kind));
  return {
    id: String(row.id),
    name: String(row.name),
    kind,
    base_url: String(row.base_url),
    model: String(row.model ?? ""),
    extra_samplers: Boolean(row.extra_samplers),
    has_key: Boolean(row.api_key) || Boolean(envKey(kind)),
  };
}

function sheetsFromParts(characterJson: string, worldJson: string): ChatSheets {
  let characterRaw: unknown = {};
  let worldRaw: unknown = {};
  try {
    characterRaw = JSON.parse(characterJson);
  } catch {
    characterRaw = {};
  }
  try {
    worldRaw = JSON.parse(worldJson);
  } catch {
    worldRaw = {};
  }
  const characters: ChatSheets["characters"] = {};
  if (typeof characterRaw === "object" && characterRaw) {
    for (const [id, value] of Object.entries(characterRaw as Record<string, unknown>)) {
      const record = (value ?? {}) as Record<string, unknown>;
      characters[id] = {
        dynamic: normalizeCharacterDynamic(record.dynamic),
        pins: normalizePins(record.pins, CHARACTER_PIN_FIELDS),
      };
    }
  }
  const worldRecord = (worldRaw ?? {}) as Record<string, unknown>;
  return {
    characters,
    world: {
      dynamic: normalizeWorldDynamic(worldRecord.dynamic ?? worldRaw),
      pins: normalizePins(worldRecord.pins, WORLD_PIN_FIELDS),
    },
  };
}

function chatFromRow(row: Record<string, unknown>): ChatPublic {
  let sampler = defaultSampler();
  let stateSampler = defaultStateSampler();
  try {
    sampler = normalizeSampler(JSON.parse(String(row.sampler_json)));
  } catch {
    sampler = defaultSampler();
  }
  try {
    stateSampler = normalizeSampler(JSON.parse(String(row.state_sampler_json)));
  } catch {
    stateSampler = defaultStateSampler();
  }
  let cast: string[] = [];
  let retrieval: { id: string; text: string }[] = [];
  try {
    const parsed = JSON.parse(String(row.cast_json));
    if (Array.isArray(parsed)) cast = parsed.filter((id): id is string => typeof id === "string");
  } catch {
    cast = [];
  }
  try {
    const parsed = JSON.parse(String(row.last_retrieval_json ?? "[]"));
    if (Array.isArray(parsed)) {
      retrieval = parsed
        .filter((item): item is { id: string; text: string } => typeof item?.id === "string" && typeof item?.text === "string")
        .map((item) => ({ id: item.id, text: item.text }));
    }
  } catch {
    retrieval = [];
  }
  return {
    id: String(row.id),
    title: String(row.title),
    world_id: row.world_id ? String(row.world_id) : null,
    connection_id: row.connection_id ? String(row.connection_id) : null,
    model: String(row.model ?? ""),
    state_connection_id: row.state_connection_id ? String(row.state_connection_id) : null,
    state_model: String(row.state_model ?? ""),
    sampler,
    state_sampler: stateSampler,
    persona_name: String(row.persona_name ?? "You"),
    persona_description: String(row.persona_description ?? ""),
    main_prompt: String(row.main_prompt ?? ""),
    pre_history: String(row.pre_history ?? ""),
    post_history: String(row.post_history ?? ""),
    state_instructions: String(row.state_instructions ?? ""),
    block_order: normalizeOrder(JSON.parse(String(row.block_order_json ?? "[]"))),
    disabled_blocks: normalizeDisabled(JSON.parse(String(row.disabled_blocks_json ?? "[]"))),
    context_tokens: Number(row.context_tokens ?? 8192),
    rag_enabled: Boolean(row.rag_enabled),
    memory_budget_tokens: Number(row.memory_budget_tokens ?? 800),
    hold_state_updates: Boolean(row.hold_state_updates),
    cast,
    sheets: sheetsFromParts(String(row.character_state_json ?? "{}"), String(row.world_state_json ?? "{}")),
    last_retrieval: retrieval,
    last_prompt_tokens: row.last_prompt_tokens == null ? null : Number(row.last_prompt_tokens),
    last_state_error: row.last_state_error ? String(row.last_state_error) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function characterFromRow(row: Record<string, unknown>): CharacterPublic {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ""),
    personality: String(row.personality ?? ""),
    scenario: String(row.scenario ?? ""),
    example_dialogue: String(row.example_dialogue ?? ""),
    greeting: String(row.greeting ?? ""),
    tags: String(row.tags ?? ""),
    dynamic_template: String(row.dynamic_template ?? DEFAULT_CHARACTER_TEMPLATE),
    initial_dynamic: normalizeCharacterDynamic(JSON.parse(String(row.initial_dynamic_json ?? "{}"))),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function worldFromRow(row: Record<string, unknown>): WorldPublic {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ""),
    lore: normalizeLore(JSON.parse(String(row.lore_json ?? "[]"))),
    dynamic_template: String(row.dynamic_template ?? DEFAULT_WORLD_TEMPLATE),
    initial_dynamic: normalizeWorldDynamic(JSON.parse(String(row.initial_dynamic_json ?? "{}"))),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function requireRow(db: DatabaseSync, sql: string, params: Record<string, string | number | null>, message: string): Record<string, unknown> {
  const row = db.prepare(sql).get(params) as Record<string, unknown> | undefined;
  if (!row) throw new HttpError(404, message);
  return row;
}

export function listConnections(db: DatabaseSync): ConnectionPublic[] {
  const rows = db.prepare("SELECT * FROM connections ORDER BY created_at").all() as Record<string, unknown>[];
  return rows.map(publicConnection);
}

export function getConnection(db: DatabaseSync, id: string): ConnectionSecret {
  const row = requireRow(db, "SELECT * FROM connections WHERE id = :id", { id }, "Connection not found.");
  const pub = publicConnection(row);
  const stored = row.api_key ? String(row.api_key) : null;
  return { ...pub, api_key: stored || envKey(pub.kind) };
}

export function createConnection(db: DatabaseSync, input: Record<string, unknown>): ConnectionPublic {
  const name = String(input.name ?? "").trim();
  if (!name) throw new HttpError(400, "Connection name is required.");
  const kind = asKind(String(input.kind ?? "openai"));
  const id = crypto.randomUUID();
  const now = nowIso();
  db.prepare(
    `INSERT INTO connections (id, name, kind, base_url, api_key, model, extra_samplers, created_at)
     VALUES (:id, :name, :kind, :base_url, :api_key, :model, :extra_samplers, :created_at)`,
  ).run({
    id,
    name,
    kind,
    base_url: String(input.base_url ?? "").trim() || defaultBaseUrl(kind),
    api_key: typeof input.api_key === "string" && input.api_key.trim() ? input.api_key.trim() : null,
    model: String(input.model ?? ""),
    extra_samplers: kind === "openai_extra" ? 1 : input.extra_samplers ? 1 : 0,
    created_at: now,
  });
  return publicConnection(requireRow(db, "SELECT * FROM connections WHERE id = :id", { id }, "Connection not found."));
}

export function defaultBaseUrl(kind: ConnectionKind): string {
  if (kind === "spacexai") return "https://api.x.ai/v1";
  if (kind === "ollama") return "http://127.0.0.1:11434";
  if (kind === "kobold") return "http://127.0.0.1:5001";
  if (kind === "mock") return "http://mock";
  return "http://127.0.0.1:8080/v1";
}

export function updateConnection(db: DatabaseSync, id: string, input: Record<string, unknown>): ConnectionPublic {
  const current = requireRow(db, "SELECT * FROM connections WHERE id = :id", { id }, "Connection not found.");
  const kind = input.kind === undefined ? asKind(String(current.kind)) : asKind(String(input.kind));
  let apiKey: string | null = typeof current.api_key === "string" ? current.api_key : null;
  if ("api_key" in input) {
    apiKey = typeof input.api_key === "string" && input.api_key.trim() ? input.api_key.trim() : null;
  }
  const name = input.name === undefined ? String(current.name) : String(input.name).trim() || String(current.name);
  const baseUrl = input.base_url === undefined ? String(current.base_url) : String(input.base_url).trim() || String(current.base_url);
  const model = input.model === undefined ? String(current.model ?? "") : String(input.model);
  const extra = input.extra_samplers === undefined ? Number(current.extra_samplers) : input.extra_samplers ? 1 : 0;
  db.prepare(
    `UPDATE connections SET name=:name, kind=:kind, base_url=:base_url, api_key=:api_key, model=:model, extra_samplers=:extra_samplers WHERE id=:id`,
  ).run({
    id,
    name,
    kind,
    base_url: baseUrl,
    api_key: apiKey,
    model,
    extra_samplers: extra,
  });
  return publicConnection(requireRow(db, "SELECT * FROM connections WHERE id = :id", { id }, "Connection not found."));
}

export function deleteConnection(db: DatabaseSync, id: string) {
  const result = db.prepare("DELETE FROM connections WHERE id = :id").run({ id });
  if (Number(result.changes) === 0) throw new HttpError(404, "Connection not found.");
}

export function listPresets(db: DatabaseSync): PresetPublic[] {
  const rows = db.prepare("SELECT * FROM presets ORDER BY created_at").all() as Record<string, unknown>[];
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    purpose: row.purpose === "state" ? "state" : "prose",
    sampler: safeSampler(String(row.sampler_json), row.purpose === "state"),
    created_at: String(row.created_at),
  }));
}

function safeSampler(json: string, state: boolean): SamplerPreset {
  try {
    return normalizeSampler(JSON.parse(json));
  } catch {
    return state ? defaultStateSampler() : defaultSampler();
  }
}

export function createPreset(db: DatabaseSync, input: Record<string, unknown>): PresetPublic {
  const name = String(input.name ?? "").trim();
  if (!name) throw new HttpError(400, "Preset name is required.");
  const purpose = input.purpose === "state" ? "state" : "prose";
  let sampler: SamplerPreset;
  try {
    sampler = normalizeSampler(input.sampler ?? (purpose === "state" ? defaultStateSampler() : defaultSampler()));
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid sampler.");
  }
  const id = crypto.randomUUID();
  const created_at = nowIso();
  db.prepare(`INSERT INTO presets (id, name, purpose, sampler_json, created_at) VALUES (:id, :name, :purpose, :sampler_json, :created_at)`).run({
    id,
    name,
    purpose,
    sampler_json: JSON.stringify(sampler),
    created_at,
  });
  return { id, name, purpose, sampler, created_at };
}

export function updatePreset(db: DatabaseSync, id: string, input: Record<string, unknown>): PresetPublic {
  const current = listPresets(db).find((preset) => preset.id === id);
  if (!current) throw new HttpError(404, "Preset not found.");
  const name = input.name === undefined ? current.name : String(input.name).trim() || current.name;
  const purpose = input.purpose === "state" || input.purpose === "prose" ? input.purpose : current.purpose;
  let sampler = current.sampler;
  if (input.sampler !== undefined) {
    try {
      sampler = normalizeSampler(input.sampler);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : "Invalid sampler.");
    }
  }
  db.prepare(`UPDATE presets SET name=:name, purpose=:purpose, sampler_json=:sampler_json WHERE id=:id`).run({
    id,
    name,
    purpose,
    sampler_json: JSON.stringify(sampler),
  });
  return { ...current, name, purpose, sampler };
}

export function deletePreset(db: DatabaseSync, id: string) {
  const result = db.prepare("DELETE FROM presets WHERE id = :id").run({ id });
  if (Number(result.changes) === 0) throw new HttpError(404, "Preset not found.");
}

function cleanTemplate(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value : fallback;
  return text.slice(0, 20000);
}

export function listCharacters(db: DatabaseSync): CharacterPublic[] {
  return (db.prepare("SELECT * FROM characters ORDER BY name").all() as Record<string, unknown>[]).map(characterFromRow);
}

export function getCharacter(db: DatabaseSync, id: string): CharacterPublic {
  return characterFromRow(requireRow(db, "SELECT * FROM characters WHERE id = :id", { id }, "Character not found."));
}

export function saveCharacter(db: DatabaseSync, id: string | null, input: Record<string, unknown>): CharacterPublic {
  const name = String(input.name ?? "").trim();
  if (!name) throw new HttpError(400, "Character name is required.");
  const now = nowIso();
  const record = {
    name,
    description: String(input.description ?? ""),
    personality: String(input.personality ?? ""),
    scenario: String(input.scenario ?? ""),
    example_dialogue: String(input.example_dialogue ?? ""),
    greeting: String(input.greeting ?? ""),
    tags: String(input.tags ?? ""),
    dynamic_template: cleanTemplate(input.dynamic_template, DEFAULT_CHARACTER_TEMPLATE),
    initial_dynamic_json: JSON.stringify(normalizeCharacterDynamic(input.initial_dynamic)),
    updated_at: now,
  };
  const explicit = id ?? optionalId(input.id);
  const characterId = explicit ?? crypto.randomUUID();
  const exists = explicit ? rowExists(db, "characters", characterId) : false;
  if (id && !exists) throw new HttpError(404, "Character not found.");
  if (exists) {
    db.prepare(
      `UPDATE characters SET name=:name, description=:description, personality=:personality, scenario=:scenario,
       example_dialogue=:example_dialogue, greeting=:greeting, tags=:tags, dynamic_template=:dynamic_template,
       initial_dynamic_json=:initial_dynamic_json, updated_at=:updated_at WHERE id=:id`,
    ).run({ ...record, id: characterId });
  } else {
    db.prepare(
      `INSERT INTO characters (
        id, name, description, personality, scenario, example_dialogue, greeting, tags,
        dynamic_template, initial_dynamic_json, created_at, updated_at
      ) VALUES (
        :id, :name, :description, :personality, :scenario, :example_dialogue, :greeting, :tags,
        :dynamic_template, :initial_dynamic_json, :created_at, :updated_at
      )`,
    ).run({ ...record, id: characterId, created_at: now });
  }
  return getCharacter(db, characterId);
}

export function deleteCharacter(db: DatabaseSync, id: string) {
  getCharacter(db, id);
  db.exec("BEGIN");
  try {
    for (const chat of listChats(db)) {
      if (!chat.cast.includes(id)) continue;
      const cast = chat.cast.filter((characterId) => characterId !== id);
      db.prepare("UPDATE chats SET cast_json = :cast, updated_at = :updated_at WHERE id = :id").run({
        id: chat.id,
        cast: JSON.stringify(cast),
        updated_at: nowIso(),
      });
    }
    db.prepare("DELETE FROM characters WHERE id = :id").run({ id });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listWorlds(db: DatabaseSync): WorldPublic[] {
  return (db.prepare("SELECT * FROM worlds ORDER BY name").all() as Record<string, unknown>[]).map(worldFromRow);
}

export function getWorld(db: DatabaseSync, id: string): WorldPublic {
  return worldFromRow(requireRow(db, "SELECT * FROM worlds WHERE id = :id", { id }, "World not found."));
}

export function saveWorld(db: DatabaseSync, id: string | null, input: Record<string, unknown>): WorldPublic {
  const name = String(input.name ?? "").trim();
  if (!name) throw new HttpError(400, "World name is required.");
  const now = nowIso();
  const lore = normalizeLore(input.lore);
  const record = {
    name,
    description: String(input.description ?? ""),
    lore_json: JSON.stringify(lore),
    dynamic_template: cleanTemplate(input.dynamic_template, DEFAULT_WORLD_TEMPLATE),
    initial_dynamic_json: JSON.stringify(normalizeWorldDynamic(input.initial_dynamic)),
    updated_at: now,
  };
  const explicit = id ?? optionalId(input.id);
  const worldId = explicit ?? crypto.randomUUID();
  const exists = explicit ? rowExists(db, "worlds", worldId) : false;
  if (id && !exists) throw new HttpError(404, "World not found.");
  if (exists) {
    db.prepare(
      `UPDATE worlds SET name=:name, description=:description, lore_json=:lore_json, dynamic_template=:dynamic_template,
       initial_dynamic_json=:initial_dynamic_json, updated_at=:updated_at WHERE id=:id`,
    ).run({ ...record, id: worldId });
  } else {
    db.prepare(
      `INSERT INTO worlds (id, name, description, lore_json, dynamic_template, initial_dynamic_json, created_at, updated_at)
       VALUES (:id, :name, :description, :lore_json, :dynamic_template, :initial_dynamic_json, :created_at, :updated_at)`,
    ).run({ ...record, id: worldId, created_at: now });
  }
  syncLoreChunks(db, worldId, lore);
  return getWorld(db, worldId);
}

export function deleteWorld(db: DatabaseSync, id: string) {
  getWorld(db, id);
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE chats SET world_id = NULL, updated_at = :updated_at WHERE world_id = :id").run({ id, updated_at: nowIso() });
    db.prepare("DELETE FROM chunks WHERE scope = 'world' AND scope_id = :id").run({ id });
    db.prepare("DELETE FROM worlds WHERE id = :id").run({ id });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listChats(db: DatabaseSync): ChatPublic[] {
  return (db.prepare("SELECT * FROM chats ORDER BY updated_at DESC").all() as Record<string, unknown>[]).map(chatFromRow);
}

export function getChatRow(db: DatabaseSync, id: string): ChatPublic {
  return chatFromRow(requireRow(db, "SELECT * FROM chats WHERE id = :id", { id }, "Chat not found."));
}

export function listMessages(db: DatabaseSync, chatId: string): MessagePublic[] {
  const rows = db.prepare("SELECT * FROM messages WHERE chat_id = :id ORDER BY created_at ASC, rowid ASC").all({ id: chatId }) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: String(row.id),
    role: row.role === "assistant" ? "assistant" : "user",
    content: String(row.content),
    created_at: String(row.created_at),
  }));
}

export function listRevisions(db: DatabaseSync, chatId: string): RevisionPublic[] {
  const rows = db.prepare("SELECT * FROM revisions WHERE chat_id = :id ORDER BY created_at DESC, rowid DESC LIMIT 40").all({ id: chatId }) as Record<string, unknown>[];
  return rows.map(revisionFromRow);
}

function revisionFromRow(row: Record<string, unknown>): RevisionPublic {
  const before = sheetsFromParts(JSON.stringify(JSON.parse(String(row.before_json)).characters ? {} : {}), "{}");
  const parsedBefore = JSON.parse(String(row.before_json)) as ChatSheets;
  const parsedAfter = JSON.parse(String(row.after_json)) as ChatSheets;
  void before;
  return {
    id: String(row.id),
    chat_id: String(row.chat_id),
    source: row.source === "user" || row.source === "undo" ? row.source : "model",
    status: (["applied", "pending", "discarded", "undone"].includes(String(row.status)) ? String(row.status) : "applied") as RevisionPublic["status"],
    diff: Array.isArray(JSON.parse(String(row.diff_json))) ? (JSON.parse(String(row.diff_json)) as DiffEntry[]) : [],
    notices: Array.isArray(JSON.parse(String(row.notices_json ?? "[]"))) ? (JSON.parse(String(row.notices_json ?? "[]")) as string[]) : [],
    error: row.error ? String(row.error) : null,
    created_at: String(row.created_at),
    before: cloneSheets(parsedBefore),
    after: cloneSheets(parsedAfter),
  };
}

export function getChat(db: DatabaseSync, id: string): ChatDetail {
  return { ...getChatRow(db, id), messages: listMessages(db, id), revisions: listRevisions(db, id) };
}

export function createChat(db: DatabaseSync, input: Record<string, unknown>): ChatDetail {
  const title = String(input.title ?? "").trim();
  if (!title) throw new HttpError(400, "Chat title is required.");
  const worldId = input.world_id ? String(input.world_id) : null;
  const world = worldId ? getWorld(db, worldId) : null;
  const cast = Array.isArray(input.cast) ? input.cast.filter((id): id is string => typeof id === "string") : [];
  const sheets = emptySheets();
  if (world) sheets.world.dynamic = normalizeWorldDynamic(world.initial_dynamic);
  let greeting = "";
  for (const characterId of cast) {
    const character = getCharacter(db, characterId);
    sheets.characters[characterId] = { dynamic: normalizeCharacterDynamic(character.initial_dynamic), pins: [] };
    if (!greeting && character.greeting.trim()) greeting = character.greeting.trim();
  }
  const connectionId = input.connection_id === undefined ? "conn-mock" : input.connection_id ? String(input.connection_id) : null;
  if (connectionId) getConnection(db, connectionId);
  const connection = connectionId ? getConnection(db, connectionId) : null;
  const requested = optionalId(input.id);
  if (requested && rowExists(db, "chats", requested)) throw new HttpError(409, "A chat with that id already exists.");
  const id = requested ?? crypto.randomUUID();
  const now = nowIso();
  db.prepare(
    `INSERT INTO chats (
      id, title, world_id, connection_id, model, state_connection_id, state_model, sampler_json, state_sampler_json,
      persona_name, persona_description, main_prompt, pre_history, post_history, state_instructions, block_order_json,
      disabled_blocks_json, context_tokens, rag_enabled, memory_budget_tokens, hold_state_updates, cast_json,
      character_state_json, world_state_json, last_retrieval_json, last_prompt_tokens, last_state_error, created_at, updated_at
    ) VALUES (
      :id, :title, :world_id, :connection_id, :model, NULL, '', :sampler_json, :state_sampler_json,
      :persona_name, '', :main_prompt, :pre_history, :post_history, :state_instructions, :block_order_json,
      '[]', :context_tokens, 0, 800, 0, :cast_json,
      :character_state_json, :world_state_json, '[]', NULL, NULL, :created_at, :updated_at
    )`,
  ).run({
    id,
    title,
    world_id: worldId,
    connection_id: connectionId,
    model: connection?.model ?? "",
    sampler_json: JSON.stringify(defaultSampler()),
    state_sampler_json: JSON.stringify(defaultStateSampler()),
    persona_name: String(input.persona_name ?? "You"),
    main_prompt: DEFAULT_MAIN_PROMPT,
    pre_history: DEFAULT_PRE_HISTORY,
    post_history: DEFAULT_POST_HISTORY,
    state_instructions: DEFAULT_STATE_INSTRUCTIONS,
    block_order_json: JSON.stringify(normalizeOrder(undefined)),
    context_tokens: defaultSampler().num_ctx,
    cast_json: JSON.stringify(cast),
    character_state_json: JSON.stringify(sheets.characters),
    world_state_json: JSON.stringify(sheets.world),
    created_at: now,
    updated_at: now,
  });
  if (greeting) addMessage(db, id, "assistant", greeting);
  return getChat(db, id);
}

export function updateChat(db: DatabaseSync, id: string, raw: Record<string, unknown> | ChatPatch): ChatDetail {
  const patch = raw as ChatPatch;
  const current = getChatRow(db, id);
  const names = Object.fromEntries(listCharacters(db).map((character) => [character.id, character.name]));
  let sheets = cloneSheets(patch.sheets ? cloneSheets(patch.sheets) : current.sheets);
  let worldId = patch.world_id === undefined ? current.world_id : patch.world_id;
  if (worldId) getWorld(db, worldId);
  if (patch.world_id !== undefined && patch.world_id !== current.world_id) {
    const world = patch.world_id ? getWorld(db, patch.world_id) : null;
    sheets = cloneSheets(sheets);
    sheets.world = {
      dynamic: world ? normalizeWorldDynamic(world.initial_dynamic) : emptyWorldDynamic(),
      pins: normalizePins(current.sheets.world.pins, WORLD_PIN_FIELDS),
    };
  }
  let cast = patch.cast ?? current.cast;
  cast = cast.filter((characterId, index) => cast.indexOf(characterId) === index);
  for (const characterId of cast) {
    const character = getCharacter(db, characterId);
    if (!sheets.characters[characterId]) {
      sheets.characters[characterId] = { dynamic: normalizeCharacterDynamic(character.initial_dynamic), pins: [] };
    }
  }
  let sampler = current.sampler;
  let stateSampler = current.state_sampler;
  if (patch.sampler !== undefined) {
    try {
      sampler = normalizeSampler(patch.sampler);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : "Invalid sampler.");
    }
  }
  if (patch.state_sampler !== undefined) {
    try {
      stateSampler = normalizeSampler(patch.state_sampler);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : "Invalid state sampler.");
    }
  }
  const connectionId = patch.connection_id === undefined ? current.connection_id : patch.connection_id;
  if (connectionId) getConnection(db, connectionId);
  const stateConnectionId = patch.state_connection_id === undefined ? current.state_connection_id : patch.state_connection_id;
  if (stateConnectionId) getConnection(db, stateConnectionId);
  const contextTokens = patch.context_tokens === undefined ? current.context_tokens : Math.max(256, Math.floor(patch.context_tokens));
  db.prepare(
    `UPDATE chats SET
      title=:title, world_id=:world_id, connection_id=:connection_id, model=:model,
      state_connection_id=:state_connection_id, state_model=:state_model, sampler_json=:sampler_json,
      state_sampler_json=:state_sampler_json, persona_name=:persona_name, persona_description=:persona_description,
      main_prompt=:main_prompt, pre_history=:pre_history, post_history=:post_history, state_instructions=:state_instructions,
      block_order_json=:block_order_json, disabled_blocks_json=:disabled_blocks_json, context_tokens=:context_tokens,
      rag_enabled=:rag_enabled, memory_budget_tokens=:memory_budget_tokens, hold_state_updates=:hold_state_updates,
      cast_json=:cast_json, character_state_json=:character_state_json, world_state_json=:world_state_json,
      last_retrieval_json=:last_retrieval_json, last_prompt_tokens=:last_prompt_tokens, last_state_error=:last_state_error,
      updated_at=:updated_at
     WHERE id=:id`,
  ).run({
    id,
    title: (patch.title ?? current.title).trim() || current.title,
    world_id: worldId,
    connection_id: connectionId,
    model: patch.model === undefined ? current.model : patch.model,
    state_connection_id: stateConnectionId,
    state_model: patch.state_model === undefined ? current.state_model : patch.state_model,
    sampler_json: JSON.stringify(sampler),
    state_sampler_json: JSON.stringify(stateSampler),
    persona_name: patch.persona_name === undefined ? current.persona_name : patch.persona_name.trim() || "You",
    persona_description: patch.persona_description === undefined ? current.persona_description : patch.persona_description,
    main_prompt: patch.main_prompt === undefined ? current.main_prompt : patch.main_prompt,
    pre_history: patch.pre_history === undefined ? current.pre_history : patch.pre_history,
    post_history: patch.post_history === undefined ? current.post_history : patch.post_history,
    state_instructions: patch.state_instructions === undefined ? current.state_instructions : patch.state_instructions,
    block_order_json: JSON.stringify(normalizeOrder(patch.block_order === undefined ? current.block_order : patch.block_order)),
    disabled_blocks_json: JSON.stringify(normalizeDisabled(patch.disabled_blocks === undefined ? current.disabled_blocks : patch.disabled_blocks)),
    context_tokens: contextTokens,
    rag_enabled: patch.rag_enabled === undefined ? (current.rag_enabled ? 1 : 0) : patch.rag_enabled ? 1 : 0,
    memory_budget_tokens: patch.memory_budget_tokens === undefined ? current.memory_budget_tokens : Math.max(0, Math.floor(patch.memory_budget_tokens)),
    hold_state_updates: patch.hold_state_updates === undefined ? (current.hold_state_updates ? 1 : 0) : patch.hold_state_updates ? 1 : 0,
    cast_json: JSON.stringify(cast),
    character_state_json: JSON.stringify(sheets.characters),
    world_state_json: JSON.stringify(sheets.world),
    last_retrieval_json: JSON.stringify(patch.last_retrieval === undefined ? current.last_retrieval : patch.last_retrieval),
    last_prompt_tokens: patch.last_prompt_tokens === undefined ? current.last_prompt_tokens : patch.last_prompt_tokens,
    last_state_error: patch.last_state_error === undefined ? current.last_state_error : patch.last_state_error,
    updated_at: nowIso(),
  });
  if (!sheetsEqualSafe(current.sheets, sheets) && patch.sheets) {
    recordRevision(db, id, {
      source: "user",
      status: "applied",
      patch: { manual: true },
      before: current.sheets,
      after: sheets,
      diff: diffSheets(current.sheets, sheets, names),
      notices: [],
      error: null,
    });
  } else if (patch.world_id !== undefined && patch.world_id !== current.world_id) {
    recordRevision(db, id, {
      source: "user",
      status: "applied",
      patch: { world_id: patch.world_id },
      before: current.sheets,
      after: sheets,
      diff: diffSheets(current.sheets, sheets, names),
      notices: ["World changed. Dynamic world fields were reset from the world card."],
      error: null,
    });
  }
  return getChat(db, id);
}

function sheetsEqualSafe(a: ChatSheets, b: ChatSheets): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function deleteChat(db: DatabaseSync, id: string) {
  getChatRow(db, id);
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM messages WHERE chat_id = :id").run({ id });
    db.prepare("DELETE FROM revisions WHERE chat_id = :id").run({ id });
    db.prepare("DELETE FROM chunks WHERE scope = 'chat' AND scope_id = :id").run({ id });
    db.prepare("DELETE FROM chats WHERE id = :id").run({ id });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function addMessage(db: DatabaseSync, chatId: string, role: "user" | "assistant", content: string): MessagePublic {
  const id = crypto.randomUUID();
  const created_at = nowIso();
  db.prepare("INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (:id, :chat_id, :role, :content, :created_at)").run({
    id,
    chat_id: chatId,
    role,
    content,
    created_at,
  });
  db.prepare("UPDATE chats SET updated_at = :updated_at WHERE id = :id").run({ id: chatId, updated_at: created_at });
  return { id, role, content, created_at };
}

export function deleteMessage(db: DatabaseSync, chatId: string, messageId: string) {
  db.prepare("DELETE FROM messages WHERE id = :id AND chat_id = :chat_id").run({ id: messageId, chat_id: chatId });
  db.prepare("DELETE FROM chunks WHERE scope = 'chat' AND scope_id = :chat_id AND source = 'message' AND source_id = :id").run({
    chat_id: chatId,
    id: messageId,
  });
}

export function recordRevision(
  db: DatabaseSync,
  chatId: string,
  input: {
    source: "model" | "user" | "undo";
    status: RevisionPublic["status"];
    patch: unknown;
    before: ChatSheets;
    after: ChatSheets;
    diff: DiffEntry[];
    notices: string[];
    error: string | null;
  },
): RevisionPublic {
  const id = crypto.randomUUID();
  const created_at = nowIso();
  db.prepare(
    `INSERT INTO revisions (id, chat_id, source, status, patch_json, before_json, after_json, diff_json, notices_json, error, created_at)
     VALUES (:id, :chat_id, :source, :status, :patch_json, :before_json, :after_json, :diff_json, :notices_json, :error, :created_at)`,
  ).run({
    id,
    chat_id: chatId,
    source: input.source,
    status: input.status,
    patch_json: JSON.stringify(input.patch ?? {}),
    before_json: JSON.stringify(input.before),
    after_json: JSON.stringify(input.after),
    diff_json: JSON.stringify(input.diff),
    notices_json: JSON.stringify(input.notices),
    error: input.error,
    created_at,
  });
  return listRevisions(db, chatId).find((revision) => revision.id === id) as RevisionPublic;
}

export function revisionMemories(db: DatabaseSync, revisionId: string): { text: string; tags: string[] }[] {
  const row = db.prepare("SELECT patch_json FROM revisions WHERE id = :id").get({ id: revisionId }) as { patch_json: string } | undefined;
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.patch_json) as { memories?: { text?: string; tags?: string[] }[] };
    return (parsed.memories ?? [])
      .filter((memory) => typeof memory.text === "string" && memory.text.trim())
      .map((memory) => ({ text: memory.text!.trim(), tags: Array.isArray(memory.tags) ? memory.tags.filter((tag) => typeof tag === "string") : [] }));
  } catch {
    return [];
  }
}

export function getRevision(db: DatabaseSync, chatId: string, revisionId: string): RevisionPublic {
  const row = db.prepare("SELECT * FROM revisions WHERE id = :id AND chat_id = :chat_id").get({ id: revisionId, chat_id: chatId }) as Record<string, unknown> | undefined;
  if (!row) throw new HttpError(404, "Revision not found.");
  return revisionFromRow(row);
}

export function setRevisionStatus(db: DatabaseSync, revisionId: string, status: RevisionPublic["status"]) {
  db.prepare("UPDATE revisions SET status = :status WHERE id = :id").run({ id: revisionId, status });
}

export function writeSheets(db: DatabaseSync, chatId: string, sheets: ChatSheets) {
  const normalized = cloneSheets(sheets);
  db.prepare("UPDATE chats SET character_state_json = :characters, world_state_json = :world, updated_at = :updated_at WHERE id = :id").run({
    id: chatId,
    characters: JSON.stringify(normalized.characters),
    world: JSON.stringify(normalized.world),
    updated_at: nowIso(),
  });
}

export function discardPending(db: DatabaseSync, chatId: string) {
  db.prepare("UPDATE revisions SET status = 'discarded' WHERE chat_id = :id AND status = 'pending'").run({ id: chatId });
}

export function getEmbedder(db: DatabaseSync): EmbedderPublic {
  const row = db.prepare("SELECT * FROM embedder WHERE id = 1").get() as Record<string, unknown>;
  return {
    connection_id: row.connection_id ? String(row.connection_id) : null,
    model: String(row.model ?? ""),
    dimensions: row.dimensions == null ? null : Number(row.dimensions),
    status: (["idle", "rebuilding", "ready", "error"].includes(String(row.status)) ? String(row.status) : "idle") as EmbedderPublic["status"],
    progress_done: Number(row.progress_done ?? 0),
    progress_total: Number(row.progress_total ?? 0),
    error: row.error ? String(row.error) : null,
  };
}

export function setEmbedder(db: DatabaseSync, connectionId: string | null, model: string) {
  if (connectionId) getConnection(db, connectionId);
  db.prepare(
    `UPDATE embedder SET connection_id=:connection_id, model=:model, dimensions=NULL, status='idle', progress_done=0, progress_total=0, error=NULL WHERE id=1`,
  ).run({ connection_id: connectionId, model });
  db.prepare("UPDATE chunks SET stale = 1").run();
}

export function setEmbedderProgress(db: DatabaseSync, patch: Partial<EmbedderPublic> & { dimensions?: number | null }) {
  const current = getEmbedder(db);
  db.prepare(
    `UPDATE embedder SET status=:status, progress_done=:progress_done, progress_total=:progress_total, error=:error, dimensions=:dimensions WHERE id=1`,
  ).run({
    status: patch.status ?? current.status,
    progress_done: patch.progress_done ?? current.progress_done,
    progress_total: patch.progress_total ?? current.progress_total,
    error: patch.error === undefined ? current.error : patch.error,
    dimensions: patch.dimensions === undefined ? current.dimensions : patch.dimensions,
  });
}

export function syncLoreChunks(db: DatabaseSync, worldId: string, lore: LoreEntry[]) {
  const rag = lore.filter((entry) => entry.mode === "rag");
  const keep = new Set(rag.map((entry) => entry.id));
  const existing = db
    .prepare("SELECT id, source_id, text FROM chunks WHERE scope = 'world' AND scope_id = :id AND source = 'lore'")
    .all({ id: worldId }) as { id: string; source_id: string; text: string }[];
  for (const row of existing) {
    if (!keep.has(row.source_id)) db.prepare("DELETE FROM chunks WHERE id = :id").run({ id: row.id });
  }
  for (const entry of rag) {
    const found = existing.find((row) => row.source_id === entry.id);
    if (!found) {
      insertChunk(db, { scope: "world", scope_id: worldId, source: "lore", source_id: entry.id, text: entry.text, tags: [] });
    } else if (found.text !== entry.text) {
      db.prepare("UPDATE chunks SET text = :text, stale = 1, embedding = NULL WHERE id = :id").run({ id: found.id, text: entry.text });
    }
  }
}

export function upsertMessageChunk(db: DatabaseSync, chatId: string, messageId: string, text: string) {
  const existing = db
    .prepare("SELECT id, text FROM chunks WHERE scope = 'chat' AND scope_id = :scope_id AND source = 'message' AND source_id = :source_id")
    .get({ scope_id: chatId, source_id: messageId }) as { id: string; text: string } | undefined;
  if (!existing) {
    insertChunk(db, { scope: "chat", scope_id: chatId, source: "message", source_id: messageId, text, tags: [] });
    return;
  }
  if (existing.text !== text) {
    db.prepare("UPDATE chunks SET text = :text, stale = 1, embedding = NULL WHERE id = :id").run({ id: existing.id, text });
  }
}

export function insertMemoryChunk(db: DatabaseSync, chatId: string, sourceId: string, text: string, tags: string[]) {
  const duplicate = db
    .prepare("SELECT id FROM chunks WHERE scope = 'chat' AND scope_id = :scope_id AND source = 'memory' AND text = :text")
    .get({ scope_id: chatId, text }) as { id: string } | undefined;
  if (duplicate) return;
  insertChunk(db, { scope: "chat", scope_id: chatId, source: "memory", source_id: sourceId, text, tags });
}

function insertChunk(
  db: DatabaseSync,
  input: { scope: "chat" | "world"; scope_id: string; source: ChunkRecord["source"]; source_id: string; text: string; tags: string[] },
) {
  db.prepare(
    `INSERT INTO chunks (id, scope, scope_id, source, source_id, text, tags_json, embedding, embedder_model, stale, created_at)
     VALUES (:id, :scope, :scope_id, :source, :source_id, :text, :tags_json, NULL, NULL, 1, :created_at)`,
  ).run({
    id: crypto.randomUUID(),
    scope: input.scope,
    scope_id: input.scope_id,
    source: input.source,
    source_id: input.source_id,
    text: input.text,
    tags_json: JSON.stringify(input.tags),
    created_at: nowIso(),
  });
}

export function listChunks(db: DatabaseSync): ChunkRecord[] {
  const rows = db.prepare("SELECT * FROM chunks").all() as Record<string, unknown>[];
  return rows.map(chunkFromRow);
}

export function listReadyChunks(db: DatabaseSync, chatId: string, worldId: string | null, model: string): ChunkRecord[] {
  return listChunks(db).filter((chunk) => {
    if (chunk.stale || !chunk.embedding || chunk.embedder_model !== model) return false;
    if (chunk.scope === "chat" && chunk.scope_id === chatId) return true;
    if (worldId && chunk.scope === "world" && chunk.scope_id === worldId) return true;
    return false;
  });
}

function chunkFromRow(row: Record<string, unknown>): ChunkRecord {
  return {
    id: String(row.id),
    scope: row.scope === "world" ? "world" : "chat",
    scope_id: String(row.scope_id),
    source: row.source === "lore" || row.source === "memory" ? row.source : "message",
    source_id: String(row.source_id),
    text: String(row.text),
    tags: Array.isArray(JSON.parse(String(row.tags_json ?? "[]"))) ? (JSON.parse(String(row.tags_json ?? "[]")) as string[]) : [],
    embedding: row.embedding ? (row.embedding as Uint8Array) : null,
    embedder_model: row.embedder_model ? String(row.embedder_model) : null,
    stale: Boolean(row.stale),
  };
}

export function saveEmbedding(db: DatabaseSync, chunkId: string, embedding: Uint8Array, model: string, dimensions: number) {
  db.prepare("UPDATE chunks SET embedding = :embedding, embedder_model = :model, stale = 0 WHERE id = :id").run({
    id: chunkId,
    embedding,
    model,
  });
  db.prepare("UPDATE embedder SET dimensions = :dimensions WHERE id = 1 AND (dimensions IS NULL OR dimensions = :dimensions)").run({ dimensions });
}

export function ensureMessageChunks(db: DatabaseSync, chatId: string) {
  for (const message of listMessages(db, chatId)) upsertMessageChunk(db, chatId, message.id, message.content);
}

export function exportLibrary(db: DatabaseSync) {
  return {
    characters: listCharacters(db),
    worlds: listWorlds(db),
    chats: listChats(db).map((chat) => ({ ...getChat(db, chat.id), sampler: chat.sampler, state_sampler: chat.state_sampler })),
    presets: listPresets(db),
  };
}

export function importLibrary(db: DatabaseSync, input: Record<string, unknown>) {
  const characters = Array.isArray(input.characters) ? input.characters : [];
  const worlds = Array.isArray(input.worlds) ? input.worlds : [];
  const presets = Array.isArray(input.presets) ? input.presets : [];
  const chats = Array.isArray(input.chats) ? input.chats : [];
  db.exec("BEGIN");
  try {
    for (const character of characters) {
      if (typeof character !== "object" || character === null) continue;
      saveCharacter(db, null, character as Record<string, unknown>);
    }
    for (const world of worlds) {
      if (typeof world !== "object" || world === null) continue;
      saveWorld(db, null, world as Record<string, unknown>);
    }
    for (const preset of presets) {
      if (typeof preset !== "object" || preset === null) continue;
      const record = preset as Record<string, unknown>;
      const id = optionalId(record.id);
      if (id && listPresets(db).some((item) => item.id === id)) updatePreset(db, id, record);
      else createPreset(db, record);
    }
    for (const chat of chats) {
      if (typeof chat !== "object" || chat === null) continue;
      importChat(db, chat as Record<string, unknown>);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function importChat(db: DatabaseSync, record: Record<string, unknown>) {
  const title = String(record.title ?? "").trim();
  if (!title) return;
  const rawId = optionalId(record.id) ?? "";
  const worldId = typeof record.world_id === "string" && rowExists(db, "worlds", record.world_id) ? record.world_id : null;
  const cast = Array.isArray(record.cast)
    ? record.cast.filter((id): id is string => typeof id === "string" && rowExists(db, "characters", id))
    : [];
  const connectionId = typeof record.connection_id === "string" && rowExists(db, "connections", record.connection_id) ? record.connection_id : null;
  const stateConnectionId =
    typeof record.state_connection_id === "string" && rowExists(db, "connections", record.state_connection_id) ? record.state_connection_id : null;
  const exists = rawId ? rowExists(db, "chats", rawId) : false;
  const chatId = exists
    ? rawId
    : createChat(db, {
        id: rawId || undefined,
        title,
        world_id: worldId,
        cast,
        connection_id: connectionId,
        persona_name: typeof record.persona_name === "string" ? record.persona_name : "You",
      }).id;
  const patch: ChatPatch = {
    title,
    world_id: worldId,
    cast,
    connection_id: connectionId,
    state_connection_id: stateConnectionId,
  };
  if (typeof record.model === "string") patch.model = record.model;
  if (typeof record.state_model === "string") patch.state_model = record.state_model;
  if (record.sampler !== undefined) patch.sampler = record.sampler;
  if (record.state_sampler !== undefined) patch.state_sampler = record.state_sampler;
  if (typeof record.persona_name === "string") patch.persona_name = record.persona_name;
  if (typeof record.persona_description === "string") patch.persona_description = record.persona_description;
  if (typeof record.main_prompt === "string") patch.main_prompt = record.main_prompt;
  if (typeof record.pre_history === "string") patch.pre_history = record.pre_history;
  if (typeof record.post_history === "string") patch.post_history = record.post_history;
  if (typeof record.state_instructions === "string") patch.state_instructions = record.state_instructions;
  if (record.block_order !== undefined) patch.block_order = record.block_order;
  if (record.disabled_blocks !== undefined) patch.disabled_blocks = record.disabled_blocks;
  if (typeof record.context_tokens === "number") patch.context_tokens = record.context_tokens;
  if (typeof record.rag_enabled === "boolean") patch.rag_enabled = record.rag_enabled;
  if (typeof record.memory_budget_tokens === "number") patch.memory_budget_tokens = record.memory_budget_tokens;
  if (typeof record.hold_state_updates === "boolean") patch.hold_state_updates = record.hold_state_updates;
  updateChat(db, chatId, patch);
  const sheets = importedSheets(record.sheets);
  if (sheets) updateChat(db, chatId, { cast, sheets });
  if (Array.isArray(record.messages)) replaceMessages(db, chatId, record.messages);
}

function importedSheets(value: unknown): ChatSheets | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as { characters?: unknown; world?: unknown };
  if (typeof record.characters !== "object" || record.characters === null || Array.isArray(record.characters)) return undefined;
  if (typeof record.world !== "object" || record.world === null) return undefined;
  try {
    return cloneSheets(value as ChatSheets);
  } catch {
    return undefined;
  }
}

function replaceMessages(db: DatabaseSync, chatId: string, messages: unknown[]) {
  db.prepare("DELETE FROM messages WHERE chat_id = :id").run({ id: chatId });
  db.prepare("DELETE FROM chunks WHERE scope = 'chat' AND scope_id = :id AND source = 'message'").run({ id: chatId });
  for (const item of messages) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.content !== "string" || record.content.length === 0) continue;
    let messageId = optionalId(record.id) ?? crypto.randomUUID();
    const owner = db.prepare("SELECT chat_id FROM messages WHERE id = :id").get({ id: messageId }) as { chat_id: string } | undefined;
    if (owner) messageId = crypto.randomUUID();
    const created_at = typeof record.created_at === "string" && record.created_at.trim() ? record.created_at : nowIso();
    db.prepare("INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (:id, :chat_id, :role, :content, :created_at)").run({
      id: messageId,
      chat_id: chatId,
      role: record.role === "assistant" ? "assistant" : "user",
      content: record.content,
      created_at,
    });
    upsertMessageChunk(db, chatId, messageId, record.content);
  }
}

export { BLOCK_IDS };
