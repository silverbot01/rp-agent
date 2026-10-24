import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  DEFAULT_CHARACTER_TEMPLATE,
  DEFAULT_MAIN_PROMPT,
  DEFAULT_WORLD_TEMPLATE,
  PREVIOUS_DEFAULT_MAIN_PROMPT,
  SPACEXAI_BASE_URL,
  SPACEXAI_MODEL,
  defaultSampler,
  defaultStateSampler,
} from "@rp/shared";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT,
  model TEXT NOT NULL DEFAULT '',
  extra_samplers INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  sampler_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  personality TEXT NOT NULL DEFAULT '',
  scenario TEXT NOT NULL DEFAULT '',
  example_dialogue TEXT NOT NULL DEFAULT '',
  greeting TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  dynamic_template TEXT NOT NULL,
  initial_dynamic_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS worlds (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  lore_json TEXT NOT NULL DEFAULT '[]',
  dynamic_template TEXT NOT NULL,
  initial_dynamic_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  world_id TEXT,
  connection_id TEXT,
  model TEXT NOT NULL DEFAULT '',
  state_connection_id TEXT,
  state_model TEXT NOT NULL DEFAULT '',
  sampler_json TEXT NOT NULL,
  state_sampler_json TEXT NOT NULL,
  persona_name TEXT NOT NULL DEFAULT 'You',
  persona_description TEXT NOT NULL DEFAULT '',
  main_prompt TEXT NOT NULL,
  pre_history TEXT NOT NULL DEFAULT '',
  post_history TEXT NOT NULL DEFAULT '',
  state_instructions TEXT NOT NULL,
  block_order_json TEXT NOT NULL,
  disabled_blocks_json TEXT NOT NULL DEFAULT '[]',
  context_tokens INTEGER NOT NULL DEFAULT 8192,
  rag_enabled INTEGER NOT NULL DEFAULT 0,
  memory_budget_tokens INTEGER NOT NULL DEFAULT 800,
  hold_state_updates INTEGER NOT NULL DEFAULT 0,
  narrator_enabled INTEGER NOT NULL DEFAULT 0,
  player_character_id TEXT,
  cast_json TEXT NOT NULL DEFAULT '[]',
  character_state_json TEXT NOT NULL DEFAULT '{}',
  world_state_json TEXT NOT NULL,
  last_retrieval_json TEXT NOT NULL DEFAULT '[]',
  last_prompt_tokens INTEGER,
  last_state_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS revisions (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  patch_json TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  diff_json TEXT NOT NULL,
  notices_json TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS embedder (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  connection_id TEXT,
  model TEXT NOT NULL DEFAULT '',
  dimensions INTEGER,
  status TEXT NOT NULL DEFAULT 'idle',
  progress_done INTEGER NOT NULL DEFAULT 0,
  progress_total INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  text TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  embedding BLOB,
  embedder_model TEXT,
  stale INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_revisions_chat ON revisions(chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chunks_scope ON chunks(scope, scope_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chunks_source ON chunks(scope, scope_id, source, source_id);
`;

export function openDatabase(dbPath: string): DatabaseSync {
  if (dbPath !== ":memory:") mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  migrate(db);
  const embedder = db.prepare("SELECT id FROM embedder WHERE id = 1").get();
  if (!embedder) db.prepare("INSERT INTO embedder (id, status) VALUES (1, 'idle')").run();
  seed(db);
  return db;
}

function migrate(db: DatabaseSync) {
  const columns = db.prepare("PRAGMA table_info(chats)").all() as { name: string }[];
  const names = new Set(columns.map((column) => column.name));
  if (!names.has("narrator_enabled")) db.exec("ALTER TABLE chats ADD COLUMN narrator_enabled INTEGER NOT NULL DEFAULT 0");
  if (!names.has("player_character_id")) db.exec("ALTER TABLE chats ADD COLUMN player_character_id TEXT");
  db.prepare("UPDATE chats SET main_prompt = :next WHERE main_prompt = :old").run({
    old: PREVIOUS_DEFAULT_MAIN_PROMPT,
    next: DEFAULT_MAIN_PROMPT,
  });
}

function seed(db: DatabaseSync) {
  const now = new Date().toISOString();
  const connections = db.prepare("SELECT COUNT(*) AS n FROM connections").get() as { n: number };
  if (connections.n === 0) {
    const insert = db.prepare(
      `INSERT INTO connections (id, name, kind, base_url, api_key, model, extra_samplers, created_at)
       VALUES (:id, :name, :kind, :base_url, NULL, :model, :extra_samplers, :created_at)`,
    );
    insert.run({ id: "conn-spacexai", name: "SpaceXAI", kind: "spacexai", base_url: SPACEXAI_BASE_URL, model: SPACEXAI_MODEL, extra_samplers: 0, created_at: now });
    insert.run({ id: "conn-ollama", name: "Ollama", kind: "ollama", base_url: "http://127.0.0.1:11434", model: "", extra_samplers: 0, created_at: now });
    insert.run({ id: "conn-kobold", name: "KoboldCPP", kind: "kobold", base_url: "http://127.0.0.1:5001", model: "", extra_samplers: 0, created_at: now });
    insert.run({ id: "conn-mock", name: "Mock (offline)", kind: "mock", base_url: "http://mock", model: "mock", extra_samplers: 0, created_at: now });
  }
  const presets = db.prepare("SELECT COUNT(*) AS n FROM presets").get() as { n: number };
  if (presets.n === 0) {
    const insert = db.prepare(
      `INSERT INTO presets (id, name, purpose, sampler_json, created_at) VALUES (:id, :name, :purpose, :sampler_json, :created_at)`,
    );
    insert.run({ id: "preset-story", name: "Story", purpose: "prose", sampler_json: JSON.stringify(defaultSampler()), created_at: now });
    insert.run({ id: "preset-state", name: "State", purpose: "state", sampler_json: JSON.stringify(defaultStateSampler()), created_at: now });
  }
  const characters = db.prepare("SELECT COUNT(*) AS n FROM characters").get() as { n: number };
  if (characters.n === 0) {
    db.prepare(
      `INSERT INTO characters (
        id, name, description, personality, scenario, example_dialogue, greeting, tags,
        dynamic_template, initial_dynamic_json, created_at, updated_at
      ) VALUES (
        'char-mara', 'Mara',
        'Gate warden at the north road. Broad-shouldered, ink on her fingers from the ledger.',
        'Dry humor. Wary of strangers. Keeps a promise once she makes it.',
        'The north gate at the end of a watch.',
        '',
        'You''re late. The road has been too quiet.',
        'warden',
        :template, :dynamic, :now, :now
      )`,
    ).run({
      template: DEFAULT_CHARACTER_TEMPLATE,
      dynamic: JSON.stringify({
        clothing: "oilskin cloak",
        emotion: "calm",
        posture: "leaning on the gate",
        location: "the north gate",
        inventory: ["ledger", "iron key"],
        injuries: "",
        goals: "close the gate at full dark",
        note: "",
        custom: {},
      }),
      now,
    });
  }
  const worlds = db.prepare("SELECT COUNT(*) AS n FROM worlds").get() as { n: number };
  if (worlds.n === 0) {
    db.prepare(
      `INSERT INTO worlds (
        id, name, description, lore_json, dynamic_template, initial_dynamic_json, created_at, updated_at
      ) VALUES ('world-gate', 'The Gate Road', :description, :lore, :template, :dynamic, :now, :now)`,
    ).run({
      description: "A packed-dirt road between low hills, ending at a timber gate.",
      lore: JSON.stringify([
        { id: "lore-gate", text: "The gate is iron-banded timber and closes at full dark.", mode: "always", keywords: [] },
        { id: "lore-rain", text: "Rain turns the road to clay within an hour.", mode: "keyword", keywords: ["rain"] },
        { id: "lore-marker", text: "An old mile-marker west of the gate is carved with a faded sun.", mode: "rag", keywords: [] },
      ]),
      template: DEFAULT_WORLD_TEMPLATE,
      dynamic: JSON.stringify({
        time: "late afternoon",
        weather: "clear",
        place: "the north gate",
        atmosphere: "still",
        ongoing: "the watch is ending",
        chronicle: "",
        custom: {},
      }),
      now,
    });
  }
}
