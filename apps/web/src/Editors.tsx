import {
  CHARACTER_STRING_FIELDS,
  CONNECTION_KINDS,
  DEFAULT_CHARACTER_TEMPLATE,
  DEFAULT_WORLD_TEMPLATE,
  WORLD_STRING_FIELDS,
  emptyCharacterDynamic,
  emptyWorldDynamic,
  type ConnectionKind,
  type LoreEntry,
} from "@rp/shared";
import { useEffect, useState } from "react";
import { api } from "./api.ts";
import type { Bootstrap, Character, Connection, Preset, World } from "./types.ts";

function preferred<T extends { id: string }>(items: T[], id: string): T | undefined {
  return items.find((item) => item.id === id) ?? items[0];
}

const KIND_LABEL: Record<ConnectionKind, string> = {
  spacexai: "SpaceXAI",
  openai: "OpenAI-compatible",
  openai_extra: "OpenAI-compatible, extra samplers",
  ollama: "Ollama",
  kobold: "KoboldCPP",
  mock: "Mock (offline)",
};

const DEFAULT_URL: Record<ConnectionKind, string> = {
  spacexai: "https://api.x.ai/v1",
  openai: "http://127.0.0.1:8080/v1",
  openai_extra: "http://127.0.0.1:8080/v1",
  ollama: "http://127.0.0.1:11434",
  kobold: "http://127.0.0.1:5001",
  mock: "http://mock",
};

function customToText(custom: Record<string, string>): string {
  return Object.entries(custom).map(([key, value]) => `${key}=${value}`).join("\n");
}

function customFromLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (!key || !value) continue;
    out[key] = value;
  }
  return out;
}

function splitList(text: string): string[] {
  return text.split(",").map((item) => item.trim()).filter(Boolean);
}

function keywordList(text: string): string[] {
  const parts = text.split(",").map((item) => item.trim()).filter(Boolean);
  if (text.trimEnd().endsWith(",")) parts.push("");
  return parts;
}

function keywordText(keywords: string[]): string {
  const filled = keywords.filter(Boolean);
  return filled.join(", ") + (keywords.at(-1) === "" ? ", " : "");
}

function blankCharacter(): Character {
  return {
    id: "",
    name: "",
    description: "",
    personality: "",
    scenario: "",
    example_dialogue: "",
    greeting: "",
    tags: "",
    dynamic_template: DEFAULT_CHARACTER_TEMPLATE,
    initial_dynamic: emptyCharacterDynamic(),
  };
}

function blankWorld(): World {
  return {
    id: "",
    name: "",
    description: "",
    lore: [],
    dynamic_template: DEFAULT_WORLD_TEMPLATE,
    initial_dynamic: emptyWorldDynamic(),
  };
}

export function CharactersPage(props: { boot: Bootstrap; refresh: () => Promise<void>; onError: (text: string | null) => void }) {
  const opening = preferred(props.boot.characters, "char-mara");
  const [selected, setSelected] = useState<string | null>(opening?.id ?? null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Character | null>(opening ?? null);
  const [inventory, setInventory] = useState(opening?.initial_dynamic.inventory.join(", ") ?? "");
  const [customText, setCustomText] = useState(customToText(opening?.initial_dynamic.custom ?? {}));

  useEffect(() => {
    if (creating) return;
    const next = props.boot.characters.find((character) => character.id === selected) ?? props.boot.characters[0] ?? null;
    setSelected(next?.id ?? null);
    setDraft(next ? structuredClone(next) : null);
    setInventory(next?.initial_dynamic.inventory.join(", ") ?? "");
    setCustomText(customToText(next?.initial_dynamic.custom ?? {}));
  }, [selected, creating, props.boot]);

  async function save() {
    if (!draft) return;
    props.onError(null);
    const body = {
      ...draft,
      id: draft.id || undefined,
      initial_dynamic: {
        ...draft.initial_dynamic,
        inventory: splitList(inventory),
        custom: customFromLines(customText),
      },
    };
    const saved = draft.id
      ? await api<Character>(`/api/characters/${draft.id}`, { method: "PUT", body: JSON.stringify(body) })
      : await api<Character>("/api/characters", { method: "POST", body: JSON.stringify(body) });
    setCreating(false);
    setSelected(saved.id);
    await props.refresh();
  }

  async function remove() {
    if (!draft?.id) return;
    if (!window.confirm(`Delete ${draft.name}? Open chats keep the sheet they already copied.`)) return;
    props.onError(null);
    await api(`/api/characters/${draft.id}`, { method: "DELETE" });
    setSelected(null);
    await props.refresh();
  }

  return (
    <div className="page">
      <div className="split">
        <div className="list">
          <button className="ghost" type="button" onClick={() => { setCreating(true); setSelected(null); setDraft(blankCharacter()); setInventory(""); setCustomText(""); }}>
            New character
          </button>
          {props.boot.characters.map((character) => (
            <button key={character.id} className={!creating && selected === character.id ? "active" : ""} type="button" onClick={() => { setCreating(false); setSelected(character.id); }}>
              {character.name}
            </button>
          ))}
        </div>
        {draft ? (
          <form className="panel" onSubmit={(event) => { event.preventDefault(); void save().catch((error: unknown) => props.onError(error instanceof Error ? error.message : "Save failed.")); }}>
            <h2>{draft.id ? draft.name || "Character" : "New character"}</h2>
            <p className="badge">Initial clothing, emotion, and the other dynamic fields are copied when a chat adds this character. Editing them here leaves chats that already copied the card alone.</p>
            <label className="field">Name<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
            <label className="field">Description<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
            <label className="field">Personality<textarea value={draft.personality} onChange={(event) => setDraft({ ...draft, personality: event.target.value })} /></label>
            <label className="field">Scenario<textarea value={draft.scenario} onChange={(event) => setDraft({ ...draft, scenario: event.target.value })} /></label>
            <label className="field">Example dialogue<textarea value={draft.example_dialogue} onChange={(event) => setDraft({ ...draft, example_dialogue: event.target.value })} /></label>
            <label className="field">Greeting<textarea value={draft.greeting} onChange={(event) => setDraft({ ...draft, greeting: event.target.value })} /></label>
            <label className="field">Tags<input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} /></label>
            <label className="field">
              Dynamic template
              <textarea value={draft.dynamic_template} onChange={(event) => setDraft({ ...draft, dynamic_template: event.target.value })} />
            </label>
            <p className="badge">{"Supports {{field}} and {{#if field}}...{{/if}}. Fields: clothing, emotion, posture, location, inventory, injuries, goals, note, custom."}</p>
            {CHARACTER_STRING_FIELDS.map((field) => (
              <label className="field" key={field}>
                Initial {field}
                <input value={draft.initial_dynamic[field]} onChange={(event) => setDraft({ ...draft, initial_dynamic: { ...draft.initial_dynamic, [field]: event.target.value } })} />
              </label>
            ))}
            <label className="field">Initial inventory<input value={inventory} placeholder="comma separated" onChange={(event) => setInventory(event.target.value)} /></label>
            <label className="field">Initial custom<textarea value={customText} placeholder={"key=value"} onChange={(event) => setCustomText(event.target.value)} /></label>
            <div className="actions">
              <button className="primary" type="submit">Save character</button>
              {draft.id ? <button className="ghost" type="button" onClick={() => void remove().catch((error: unknown) => props.onError(error instanceof Error ? error.message : "Delete failed."))}>Delete</button> : null}
            </div>
          </form>
        ) : <p className="empty">Add a character to put them in a chat.</p>}
      </div>
    </div>
  );
}

export function WorldsPage(props: { boot: Bootstrap; refresh: () => Promise<void>; onError: (text: string | null) => void }) {
  const opening = preferred(props.boot.worlds, "world-gate");
  const [selected, setSelected] = useState<string | null>(opening?.id ?? null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<World | null>(opening ?? null);
  const [customText, setCustomText] = useState(customToText(opening?.initial_dynamic.custom ?? {}));

  useEffect(() => {
    if (creating) return;
    const next = props.boot.worlds.find((world) => world.id === selected) ?? props.boot.worlds[0] ?? null;
    setSelected(next?.id ?? null);
    setDraft(next ? structuredClone(next) : null);
    setCustomText(customToText(next?.initial_dynamic.custom ?? {}));
  }, [selected, creating, props.boot]);

  function updateLore(index: number, patch: Partial<LoreEntry>) {
    if (!draft) return;
    const lore = draft.lore.map((entry, entryIndex) => (entryIndex === index ? { ...entry, ...patch } : entry));
    setDraft({ ...draft, lore });
  }

  async function save() {
    if (!draft) return;
    props.onError(null);
    const body = {
      ...draft,
      id: draft.id || undefined,
      lore: draft.lore.map((entry) => ({ ...entry, keywords: entry.keywords.map((keyword) => keyword.trim()).filter(Boolean) })),
      initial_dynamic: { ...draft.initial_dynamic, custom: customFromLines(customText) },
    };
    const saved = draft.id
      ? await api<World>(`/api/worlds/${draft.id}`, { method: "PUT", body: JSON.stringify(body) })
      : await api<World>("/api/worlds", { method: "POST", body: JSON.stringify(body) });
    setCreating(false);
    setSelected(saved.id);
    await props.refresh();
  }

  async function remove() {
    if (!draft?.id) return;
    if (!window.confirm(`Delete ${draft.name}? Chats that use it keep their messages and lose the world link.`)) return;
    props.onError(null);
    await api(`/api/worlds/${draft.id}`, { method: "DELETE" });
    setSelected(null);
    await props.refresh();
  }

  return (
    <div className="page">
      <div className="split">
        <div className="list">
          <button className="ghost" type="button" onClick={() => { setCreating(true); setSelected(null); setDraft(blankWorld()); setCustomText(""); }}>New world</button>
          {props.boot.worlds.map((world) => (
            <button key={world.id} className={!creating && selected === world.id ? "active" : ""} type="button" onClick={() => { setCreating(false); setSelected(world.id); }}>
              {world.name}
            </button>
          ))}
        </div>
        {draft ? (
          <form className="panel" onSubmit={(event) => { event.preventDefault(); void save().catch((error: unknown) => props.onError(error instanceof Error ? error.message : "Save failed.")); }}>
            <h2>{draft.id ? draft.name || "World" : "New world"}</h2>
            <p className="badge">Switching a chat to this world resets that chat’s dynamic world fields from the initial values below. Pins that still match are kept.</p>
            <label className="field">Name<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
            <label className="field">Description<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
            <label className="field">
              Dynamic template
              <textarea value={draft.dynamic_template} onChange={(event) => setDraft({ ...draft, dynamic_template: event.target.value })} />
            </label>
            <p className="badge">{"Supports {{field}} and {{#if field}}...{{/if}}. Fields: time, weather, place, atmosphere, ongoing, chronicle, custom."}</p>
            {WORLD_STRING_FIELDS.map((field) => (
              <label className="field" key={field}>
                Initial {field}
                <textarea value={draft.initial_dynamic[field]} onChange={(event) => setDraft({ ...draft, initial_dynamic: { ...draft.initial_dynamic, [field]: event.target.value } })} />
              </label>
            ))}
            <label className="field">Initial custom<textarea value={customText} placeholder={"key=value"} onChange={(event) => setCustomText(event.target.value)} /></label>
            <div className="row">
              <strong>Lore</strong>
              <button className="ghost" type="button" onClick={() => setDraft({ ...draft, lore: [...draft.lore, { id: crypto.randomUUID(), text: "", mode: "always", keywords: [] }] })}>Add entry</button>
            </div>
            {draft.lore.map((entry, index) => (
              <div className="card" key={entry.id || index}>
                <label className="field">Text<textarea value={entry.text} onChange={(event) => updateLore(index, { text: event.target.value })} /></label>
                <label className="field">
                  Mode
                  <select value={entry.mode} onChange={(event) => updateLore(index, { mode: event.target.value as LoreEntry["mode"] })}>
                    <option value="always">Always in the prompt</option>
                    <option value="keyword">When a keyword is in the recent turn</option>
                    <option value="rag">Retrieved when memory search is on</option>
                  </select>
                </label>
                <label className="field">Keywords<input value={keywordText(entry.keywords)} placeholder="rain, gate" onChange={(event) => updateLore(index, { keywords: keywordList(event.target.value) })} /></label>
                <button className="ghost" type="button" onClick={() => setDraft({ ...draft, lore: draft.lore.filter((_, entryIndex) => entryIndex !== index) })}>Remove entry</button>
              </div>
            ))}
            <div className="actions">
              <button className="primary" type="submit">Save world</button>
              {draft.id ? <button className="ghost" type="button" onClick={() => void remove().catch((error: unknown) => props.onError(error instanceof Error ? error.message : "Delete failed."))}>Delete</button> : null}
            </div>
          </form>
        ) : <p className="empty">Add a world to give a chat a place.</p>}
      </div>
    </div>
  );
}

export function ChatsPage(props: { boot: Bootstrap; refresh: () => Promise<void>; onError: (text: string | null) => void; onOpen: (id: string) => void }) {
  const mock = props.boot.connections.find((connection) => connection.kind === "mock");
  const [title, setTitle] = useState("North gate");
  const [worldId, setWorldId] = useState(props.boot.worlds.find((world) => world.id === "world-gate")?.id ?? props.boot.worlds[0]?.id ?? "");
  const [connectionId, setConnectionId] = useState(mock?.id ?? "");
  const [persona, setPersona] = useState("You");
  const [cast, setCast] = useState<string[]>(props.boot.characters.some((character) => character.id === "char-mara") ? ["char-mara"] : []);
  const [narrator, setNarrator] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);

  async function create() {
    props.onError(null);
    const chat = await api<{ id: string }>("/api/chats", {
      method: "POST",
      body: JSON.stringify({
        title,
        world_id: worldId || null,
        connection_id: connectionId || null,
        persona_name: persona,
        cast,
        narrator_enabled: narrator,
        player_character_id: playerId && cast.includes(playerId) ? playerId : null,
      }),
    });
    await props.refresh();
    props.onOpen(chat.id);
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`Delete the chat “${name}”? The transcript and its sheet history go with it.`)) return;
    props.onError(null);
    await api(`/api/chats/${id}`, { method: "DELETE" });
    await props.refresh();
  }

  return (
    <div className="page">
      <h2>Chats</h2>
      <div className="split">
        <div className="list">
          {props.boot.chats.length === 0 ? <p className="badge">No chats yet.</p> : null}
          {props.boot.chats.map((chat) => (
            <div className="card" key={chat.id}>
              <strong>{chat.title}</strong>
              <div className="actions">
                <button className="primary" type="button" onClick={() => props.onOpen(chat.id)}>Open</button>
                <button className="ghost" type="button" onClick={() => void remove(chat.id, chat.title).catch((error: unknown) => props.onError(error instanceof Error ? error.message : "Delete failed."))}>Delete</button>
              </div>
            </div>
          ))}
        </div>
        <form className="panel" onSubmit={(event) => { event.preventDefault(); void create().catch((error: unknown) => props.onError(error instanceof Error ? error.message : "Could not create the chat.")); }}>
          <h2>New chat</h2>
          <label className="field">Title<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label className="field">Your name<input value={persona} onChange={(event) => setPersona(event.target.value)} /></label>
          <label className="field">
            World
            <select value={worldId} onChange={(event) => setWorldId(event.target.value)}>
              <option value="">None</option>
              {props.boot.worlds.map((world) => <option key={world.id} value={world.id}>{world.name}</option>)}
            </select>
          </label>
          <label className="field">
            Connection
            <select value={connectionId} onChange={(event) => setConnectionId(event.target.value)}>
              <option value="">None</option>
              {props.boot.connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}
            </select>
          </label>
          <div className="field">
            <span className="group-title">You are playing as</span>
            <label className="check">
              <input type="radio" name="new-chat-player" checked={playerId === null} onChange={() => setPlayerId(null)} />
              Yourself ({persona.trim() || "You"})
            </label>
            {props.boot.characters.filter((character) => cast.includes(character.id)).map((character) => (
              <label className="check" key={character.id}>
                <input type="radio" name="new-chat-player" checked={playerId === character.id} onChange={() => setPlayerId(character.id)} />
                {character.name}
              </label>
            ))}
          </div>
          <div className="field">
            <span className="group-title">In the scene</span>
            <label className="check">
              <input type="checkbox" checked={narrator} onChange={(event) => setNarrator(event.target.checked)} />
              Narrator
            </label>
            {props.boot.characters.map((character) => (
              <label className="check" key={character.id}>
                <input
                  type="checkbox"
                  checked={cast.includes(character.id)}
                  onChange={(event) => {
                    const next = event.target.checked ? [...cast, character.id] : cast.filter((id) => id !== character.id);
                    setCast(next);
                    if (!event.target.checked && playerId === character.id) setPlayerId(null);
                  }}
                />
                {character.name}
              </label>
            ))}
          </div>
          <button className="primary" type="submit">Create chat</button>
        </form>
      </div>
    </div>
  );
}

type ConnectionDraft = {
  id: string;
  name: string;
  kind: ConnectionKind;
  base_url: string;
  model: string;
  extra_samplers: boolean;
  api_key: string;
  clear_key: boolean;
  has_key: boolean;
};

function blankConnection(): ConnectionDraft {
  return {
    id: "",
    name: "",
    kind: "openai",
    base_url: DEFAULT_URL.openai,
    model: "",
    extra_samplers: false,
    api_key: "",
    clear_key: false,
    has_key: false,
  };
}

function fromConnection(connection: Connection): ConnectionDraft {
  return {
    id: connection.id,
    name: connection.name,
    kind: connection.kind,
    base_url: connection.base_url,
    model: connection.model,
    extra_samplers: connection.extra_samplers,
    api_key: "",
    clear_key: false,
    has_key: connection.has_key,
  };
}

export function ConnectionsPage(props: { boot: Bootstrap; refresh: () => Promise<void>; onError: (text: string | null) => void }) {
  const [selected, setSelected] = useState<string | null>(props.boot.connections[0]?.id ?? null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<ConnectionDraft | null>(props.boot.connections[0] ? fromConnection(props.boot.connections[0]) : null);
  const [models, setModels] = useState<string[]>([]);

  useEffect(() => {
    if (creating) return;
    const next = props.boot.connections.find((connection) => connection.id === selected) ?? props.boot.connections[0] ?? null;
    setSelected(next?.id ?? null);
    setDraft(next ? fromConnection(next) : null);
    setModels([]);
  }, [selected, creating, props.boot]);

  function setKind(kind: ConnectionKind) {
    if (!draft) return;
    const known = Object.values(DEFAULT_URL);
    const base_url = !draft.base_url || known.includes(draft.base_url) ? DEFAULT_URL[kind] : draft.base_url;
    const model = kind === "spacexai" && !draft.model ? "grok-4.7" : draft.model;
    const extra_samplers = kind === "openai_extra" ? true : draft.extra_samplers;
    setDraft({ ...draft, kind, base_url, model, extra_samplers });
  }

  async function save() {
    if (!draft?.name.trim()) {
      props.onError("Connection name is required.");
      return;
    }
    props.onError(null);
    const body: Record<string, unknown> = {
      name: draft.name,
      kind: draft.kind,
      base_url: draft.base_url,
      model: draft.model,
      extra_samplers: draft.extra_samplers,
    };
    if (draft.clear_key) body.api_key = "";
    else if (draft.api_key.trim()) body.api_key = draft.api_key.trim();
    const saved = draft.id
      ? await api<Connection>(`/api/connections/${draft.id}`, { method: "PUT", body: JSON.stringify(body) })
      : await api<Connection>("/api/connections", { method: "POST", body: JSON.stringify(body) });
    setCreating(false);
    setSelected(saved.id);
    await props.refresh();
  }

  async function remove() {
    if (!draft?.id) return;
    if (!window.confirm(`Delete the connection “${draft.name}”?`)) return;
    props.onError(null);
    await api(`/api/connections/${draft.id}`, { method: "DELETE" });
    setSelected(null);
    await props.refresh();
  }

  async function loadModels() {
    if (!draft?.id) return;
    props.onError(null);
    const result = await api<{ models: string[] }>(`/api/connections/${draft.id}/models`, { method: "POST", body: "{}" });
    setModels(result.models);
  }

  return (
    <div className="page">
      <div className="split">
        <div className="list">
          <button className="ghost" type="button" onClick={() => { setCreating(true); setSelected(null); setDraft(blankConnection()); setModels([]); }}>New connection</button>
          {props.boot.connections.map((connection) => (
            <button key={connection.id} className={!creating && selected === connection.id ? "active" : ""} type="button" onClick={() => { setCreating(false); setSelected(connection.id); }}>
              {connection.name}
            </button>
          ))}
        </div>
        {draft ? (
          <form className="panel" onSubmit={(event) => { event.preventDefault(); void save().catch((error: unknown) => props.onError(error instanceof Error ? error.message : "Save failed.")); }}>
            <h2>{draft.id ? draft.name || "Connection" : "New connection"}</h2>
            <label className="field">Name<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
            <label className="field">
              Kind
              <select value={draft.kind} onChange={(event) => setKind(event.target.value as ConnectionKind)}>
                {CONNECTION_KINDS.map((kind) => <option key={kind} value={kind}>{KIND_LABEL[kind]}</option>)}
              </select>
            </label>
            <label className="field">Base URL<input value={draft.base_url} onChange={(event) => setDraft({ ...draft, base_url: event.target.value })} /></label>
            <label className="field">Model<input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} /></label>
            <label className="check">
              <input type="checkbox" checked={draft.extra_samplers} onChange={(event) => setDraft({ ...draft, extra_samplers: event.target.checked })} />
              Send extra samplers
            </label>
            <p className="badge">OpenAI-compatible chats send top_k, DRY, and the other form-only fields only when this is on. SpaceXAI also drops custom JSON until it is on. Ollama sends its own options. KoboldCPP has native DRY. A DRY multiplier of 0 turns DRY off.</p>
            <label className="field">
              API key
              <input type="password" value={draft.api_key} placeholder={draft.has_key ? "Stored key stays unless you replace it" : "Optional"} autoComplete="off" onChange={(event) => setDraft({ ...draft, api_key: event.target.value, clear_key: false })} />
            </label>
            <p className="badge">{draft.has_key ? "A key is available for this connection." : "No key is stored."} SpaceXAI uses a stored key when there is one, and otherwise XAI_API_KEY. The browser never receives the key.</p>
            {draft.id ? (
              <label className="check">
                <input type="checkbox" checked={draft.clear_key} onChange={(event) => setDraft({ ...draft, clear_key: event.target.checked, api_key: event.target.checked ? "" : draft.api_key })} />
                Clear stored key
              </label>
            ) : null}
            <div className="actions">
              <button className="primary" type="submit">Save connection</button>
              {draft.id ? <button className="ghost" type="button" onClick={() => void loadModels().catch((error: unknown) => props.onError(error instanceof Error ? error.message : "Could not list models."))}>Load models</button> : null}
              {draft.id ? <button className="ghost" type="button" onClick={() => void remove().catch((error: unknown) => props.onError(error instanceof Error ? error.message : "Delete failed."))}>Delete</button> : null}
            </div>
            {models.length ? (
              <div className="list">
                {models.map((model) => (
                  <button key={model} type="button" onClick={() => setDraft({ ...draft, model })}>{model}</button>
                ))}
              </div>
            ) : null}
          </form>
        ) : null}
      </div>
      <h2>Sampler presets</h2>
      <p className="badge">Save a preset from the Model tab in a chat. Loading one copies its values into that chat; it does not change other chats.</p>
      {props.boot.presets.map((preset) => (
        <PresetRow key={preset.id} preset={preset} refresh={props.refresh} onError={props.onError} />
      ))}
    </div>
  );
}

function PresetRow(props: { preset: Preset; refresh: () => Promise<void>; onError: (text: string | null) => void }) {
  const [name, setName] = useState(props.preset.name);
  useEffect(() => setName(props.preset.name), [props.preset.name]);
  return (
    <div className="row card">
      <label className="field">
        {props.preset.purpose === "state" ? "State" : "Prose"}
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <div className="actions">
        <button
          className="ghost"
          type="button"
          onClick={() => void api(`/api/presets/${props.preset.id}`, { method: "PUT", body: JSON.stringify({ name }) }).then(() => props.refresh()).catch((error: unknown) => props.onError(error instanceof Error ? error.message : "Rename failed."))}
        >
          Rename
        </button>
        <button
          className="ghost"
          type="button"
          onClick={() => {
            if (!window.confirm(`Delete the preset “${props.preset.name}”?`)) return;
            void api(`/api/presets/${props.preset.id}`, { method: "DELETE" }).then(() => props.refresh()).catch((error: unknown) => props.onError(error instanceof Error ? error.message : "Delete failed."));
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
