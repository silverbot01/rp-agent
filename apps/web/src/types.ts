import type {
  BlockId,
  CharacterDynamic,
  ChatSheets,
  ConnectionKind,
  DiffEntry,
  LoreEntry,
  SamplerPreset,
  WorldDynamic,
} from "@rp/shared";

export type Connection = {
  id: string;
  name: string;
  kind: ConnectionKind;
  base_url: string;
  model: string;
  extra_samplers: boolean;
  has_key: boolean;
};

export type Character = {
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
};

export type World = {
  id: string;
  name: string;
  description: string;
  lore: LoreEntry[];
  dynamic_template: string;
  initial_dynamic: WorldDynamic;
};

export type Preset = {
  id: string;
  name: string;
  purpose: "prose" | "state";
  sampler: SamplerPreset;
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type Revision = {
  id: string;
  source: string;
  status: "applied" | "pending" | "discarded" | "undone";
  diff: DiffEntry[];
  notices: string[];
  error: string | null;
  created_at: string;
};

export type Chat = {
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
  narrator_enabled: boolean;
  player_character_id: string | null;
  cast: string[];
  sheets: ChatSheets;
  last_retrieval: { id: string; text: string }[];
  last_prompt_tokens: number | null;
  last_state_error: string | null;
  updated_at: string;
  messages: Message[];
  revisions: Revision[];
};

export type Embedder = {
  connection_id: string | null;
  model: string;
  dimensions: number | null;
  status: "idle" | "rebuilding" | "ready" | "error";
  progress_done: number;
  progress_total: number;
  error: string | null;
};

export type Bootstrap = {
  connections: Connection[];
  presets: Preset[];
  characters: Character[];
  worlds: World[];
  chats: Omit<Chat, "messages" | "revisions">[];
  embedder: Embedder;
};

export type TurnEvent = {
  type: "token" | "done" | "state" | "state_error" | "error";
  text?: string;
  error?: string;
  notices?: string[];
  estimated_tokens?: number;
  prompt_tokens?: number | null;
  dropped_messages?: number;
  stream_fallback?: boolean;
};
