import {
  BLOCK_LABELS,
  BLOCK_IDS,
  CHARACTER_STRING_FIELDS,
  WORLD_STRING_FIELDS,
  castRoles,
  type BlockId,
  type CharacterDynamic,
  type ChatSheets,
  type SamplerPreset,
  type WorldDynamic,
} from "@rp/shared";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { flushSync } from "react-dom";
import { api, readNdjson } from "./api.ts";
import { SamplerForm, customFromText, validateCustom } from "./SamplerForm.tsx";
import type { Bootstrap, Chat, Preset, TurnEvent } from "./types.ts";

type Tab = "sheets" | "world" | "prompts" | "memory" | "model";

export function Play(props: { chatId: string; boot: Bootstrap; refreshBoot: () => Promise<void> }) {
  const [chat, setChat] = useState<Chat | null>(null);
  const [tab, setTab] = useState<Tab>("sheets");
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [live, setLive] = useState("");
  const [sending, setSending] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [replyOpen, setReplyOpen] = useState(false);
  const bottom = useRef<HTMLDivElement | null>(null);
  const abort = useRef<AbortController | null>(null);
  const loadGen = useRef(0);
  const chatIdRef = useRef(props.chatId);
  chatIdRef.current = props.chatId;

  async function load() {
    const id = props.chatId;
    const gen = ++loadGen.current;
    const next = await api<Chat>(`/api/chats/${id}`);
    if (gen !== loadGen.current || chatIdRef.current !== id) return next;
    setChat(next);
    return next;
  }

  function replaceChat(update: (chat: Chat) => Chat) {
    const id = chatIdRef.current;
    loadGen.current += 1;
    setChat((current) => (current && current.id === id ? update(current) : current));
  }

  useEffect(() => {
    setBanner(null);
    setNotices([]);
    setEditingId(null);
    void load().catch((error: unknown) => setBanner(error instanceof Error ? error.message : "Could not load the chat."));
  }, [props.chatId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [chat?.messages.length, live]);

  if (!chat) return <div className="empty">Loading chat…</div>;
  const current = chat;
  const connection = props.boot.connections.find((item) => item.id === current.connection_id) ?? null;

  async function send(regenerate = false) {
    const content = draft.trim();
    if (!regenerate && !content) return;
    const controller = new AbortController();
    abort.current = controller;
    flushSync(() => {
      setSending(true);
      setBanner(null);
      setNotices([]);
      setLive("");
      setReplyOpen(true);
      if (!regenerate) {
        setDraft("");
        replaceChat((currentChat) => ({
          ...currentChat,
          messages: [
            ...currentChat.messages,
            { id: `pending-${crypto.randomUUID()}`, role: "user", content, created_at: new Date().toISOString() },
          ],
        }));
      } else {
        replaceChat((currentChat) => {
          const messages = currentChat.messages.slice();
          if (messages.at(-1)?.role === "assistant") messages.pop();
          return { ...currentChat, messages };
        });
      }
    });
    try {
      const response = await fetch(regenerate ? `/api/chats/${current.id}/regenerate` : `/api/chats/${current.id}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: regenerate ? "{}" : JSON.stringify({ content }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error || response.statusText);
      }
      await readNdjson(response, async (raw) => {
        const event = raw as TurnEvent;
        if (event.type === "token" && event.text) {
          const text = event.text;
          flushSync(() => setLive((currentText) => currentText + text));
        }
        if (event.type === "done") {
          const message = event.message;
          flushSync(() => {
            setLive("");
            setReplyOpen(false);
            if (message) {
              replaceChat((currentChat) => (
                currentChat.messages.some((item) => item.id === message.id)
                  ? currentChat
                  : { ...currentChat, messages: [...currentChat.messages, message] }
              ));
            }
            if (event.notices?.length) setNotices(event.notices);
            if (event.stream_fallback) setNotices((currentNotices) => [...currentNotices, "This KoboldCPP build returned the reply in one piece."]);
          });
        }
        if (event.type === "state" && event.revision?.id) {
          const revision = event.revision;
          flushSync(() => {
            replaceChat((currentChat) => ({
              ...currentChat,
              sheets: revision.status === "applied" && revision.after ? revision.after : currentChat.sheets,
              revisions: [
                {
                  id: revision.id,
                  source: revision.source,
                  status: revision.status,
                  diff: revision.diff ?? [],
                  notices: revision.notices ?? [],
                  error: revision.error ?? null,
                  created_at: revision.created_at ?? new Date().toISOString(),
                },
                ...currentChat.revisions.filter((item) => item.id !== revision.id),
              ].slice(0, 40),
            }));
            if (event.notices?.length) setNotices((currentNotices) => [...currentNotices, ...event.notices!]);
          });
        }
        if (event.type === "state_error" && event.error) setBanner(event.error);
        if (event.type === "error" && event.error) setBanner(event.error);
      });
      await load();
      setLive("");
      setReplyOpen(false);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setBanner(error instanceof Error ? error.message : "The turn failed.");
      }
      await load().catch(() => undefined);
      setLive("");
      setReplyOpen(false);
    } finally {
      setSending(false);
      abort.current = null;
    }
  }

  async function stop() {
    abort.current?.abort();
    await api(`/api/chats/${current.id}/stop`, { method: "POST", body: "{}" }).catch(() => undefined);
  }

  async function saveEdit(messageId: string) {
    const content = editingText.trim();
    if (!content) {
      setBanner("Message text is required.");
      return;
    }
    setBanner(null);
    const next = await api<Chat>(`/api/chats/${current.id}/messages/${messageId}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    });
    setChat(next);
    setEditingId(null);
  }

  async function removeMessage(messageId: string) {
    if (!window.confirm("Delete this message? The sheets stay as they are.")) return;
    setBanner(null);
    const next = await api<Chat>(`/api/chats/${current.id}/messages/${messageId}`, { method: "DELETE" });
    if (editingId === messageId) setEditingId(null);
    setChat(next);
  }

  async function restart() {
    if (!window.confirm("Start this scene over? The transcript is cleared, sheets return to the character and world cards, and play memories are removed. Prompts, cast, pins, and model settings stay.")) return;
    setBanner(null);
    setNotices([]);
    setLive("");
    setEditingId(null);
    const next = await api<Chat>(`/api/chats/${current.id}/restart`, { method: "POST", body: "{}" });
    setChat(next);
    await props.refreshBoot();
  }

  async function save(patch: Record<string, unknown>) {
    const next = await api<Chat>(`/api/chats/${current.id}`, { method: "PUT", body: JSON.stringify(patch) });
    setChat(next);
    await props.refreshBoot();
    return next;
  }

  const roles = castRoles({
    cast: current.cast.map((id) => ({
      id,
      name: props.boot.characters.find((character) => character.id === id)?.name || "Character",
    })),
    playerCharacterId: current.player_character_id,
    personaName: current.persona_name,
    narratorEnabled: current.narrator_enabled,
  });
  return (
    <div className="workspace">
      <section className="transcript">
        <div className="scroll">
          {chat.messages.map((message) => (
            <article className={`bubble ${message.role}`} key={message.id}>
              <div className="who-row">
                <div className="who">{message.role === "user" ? roles.playerName : roles.replyName}</div>
                {editingId === message.id ? null : (
                  <div className="bubble-actions">
                    <button
                      type="button"
                      disabled={sending}
                      onClick={() => {
                        setEditingId(message.id);
                        setEditingText(message.content);
                        setBanner(null);
                      }}
                    >
                      Edit
                    </button>
                    <button type="button" disabled={sending} onClick={() => void removeMessage(message.id).catch((error: unknown) => setBanner(error instanceof Error ? error.message : "Could not delete the message."))}>
                      Delete
                    </button>
                  </div>
                )}
              </div>
              {editingId === message.id ? (
                <div className="edit-message">
                  <textarea
                    value={editingText}
                    aria-label={`Edit message from ${message.role === "user" ? roles.playerName : roles.replyName}`}
                    onChange={(event) => setEditingText(event.target.value)}
                  />
                  <div className="bubble-actions">
                    <button className="primary" type="button" disabled={!editingText.trim()} onClick={() => void saveEdit(message.id).catch((error: unknown) => setBanner(error instanceof Error ? error.message : "Could not save the message."))}>
                      Save
                    </button>
                    <button className="ghost" type="button" onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="body">{message.content}</div>
              )}
            </article>
          ))}
          {live || (sending && replyOpen) ? (
            <article className="bubble assistant">
              <div className="who">{roles.replyName}</div>
              <div className="body">{live || "…"}</div>
            </article>
          ) : null}
          <div ref={bottom} />
        </div>
        {banner ? <div className="banner">{banner}</div> : null}
        {notices.length ? <div className="banner ok">{notices.join(" ")}</div> : null}
        <div className="meta">
          Context budget {chat.context_tokens}
          {chat.last_prompt_tokens != null ? ` · last prompt ${chat.last_prompt_tokens} tokens` : ""}
          {connection ? ` · ${connection.name}` : " · no connection"}
          {chat.model ? ` · ${chat.model}` : ""}
        </div>
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send(false);
          }}
        >
          <textarea
            value={draft}
            placeholder={`Write as ${roles.playerName}. Enter sends, Shift+Enter adds a line.`}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(false);
              }
            }}
          />
          <div className="composer-actions">
            <button className="primary" type="submit" disabled={sending || !draft.trim()}>Send</button>
            <button className="ghost" type="button" disabled={!sending} onClick={() => void stop()}>Stop</button>
            <button className="ghost" type="button" disabled={sending} onClick={() => void send(true)}>Regenerate</button>
            <button className="ghost" type="button" disabled={sending} onClick={() => void restart().catch((error: unknown) => setBanner(error instanceof Error ? error.message : "Could not restart the scene."))}>Restart</button>
          </div>
        </form>
      </section>
      <aside className="side">
        <div className="tabs">
          {(["sheets", "world", "prompts", "memory", "model"] as Tab[]).map((item) => (
            <button key={item} className={tab === item ? "active" : ""} type="button" onClick={() => setTab(item)}>
              {item[0]?.toUpperCase()}
              {item.slice(1)}
            </button>
          ))}
        </div>
        {tab === "sheets" ? <Sheets chat={chat} boot={props.boot} save={save} onBanner={setBanner} /> : null}
        {tab === "world" ? <WorldPanel chat={chat} boot={props.boot} save={save} onBanner={setBanner} /> : null}
        {tab === "prompts" ? <Prompts chat={chat} save={save} onBanner={setBanner} /> : null}
        {tab === "memory" ? <Memory chat={chat} boot={props.boot} save={save} refreshBoot={props.refreshBoot} onBanner={setBanner} /> : null}
        <div hidden={tab !== "model"}>
          <Model chat={chat} boot={props.boot} save={save} refreshBoot={props.refreshBoot} onBanner={setBanner} />
        </div>
      </aside>
    </div>
  );
}

function useSyncedSheets(incoming: ChatSheets): [ChatSheets, Dispatch<SetStateAction<ChatSheets>>] {
  const signature = JSON.stringify(incoming);
  const [sheets, setSheets] = useState(() => structuredClone(incoming));
  const [seen, setSeen] = useState(signature);
  if (seen !== signature) {
    setSeen(signature);
    setSheets(structuredClone(incoming));
  }
  return [sheets, setSheets];
}

function Sheets(props: { chat: Chat; boot: Bootstrap; save: (patch: Record<string, unknown>) => Promise<Chat>; onBanner: (text: string | null) => void }) {
  const [sheets, setSheets] = useSyncedSheets(props.chat.sheets);
  const latest = props.chat.revisions[0];
  return (
    <div className="panel">
      <label className="field">
        Title
        <input value={props.chat.title} onChange={(event) => void props.save({ title: event.target.value })} />
      </label>
      <div className="field">
        <span className="group-title">You are playing as</span>
        <label className="check">
          <input
            type="radio"
            name={`player-${props.chat.id}`}
            checked={!props.chat.player_character_id}
            onChange={() => void props.save({ player_character_id: null })}
          />
          Yourself ({props.chat.persona_name.trim() || "You"})
        </label>
        {props.chat.cast.map((id) => {
          const character = props.boot.characters.find((item) => item.id === id);
          if (!character) return null;
          return (
            <label className="check" key={id}>
              <input
                type="radio"
                name={`player-${props.chat.id}`}
                checked={props.chat.player_character_id === id}
                onChange={() => void props.save({ player_character_id: id })}
              />
              {character.name}
            </label>
          );
        })}
      </div>
      <div className="field">
        <span className="group-title">In the scene</span>
        <label className="check">
          <input
            type="checkbox"
            checked={props.chat.narrator_enabled}
            onChange={(event) => void props.save({ narrator_enabled: event.target.checked })}
          />
          Narrator
        </label>
        {props.boot.characters.map((character) => (
          <label className="check" key={character.id}>
            <input
              type="checkbox"
              checked={props.chat.cast.includes(character.id)}
              onChange={(event) => {
                const cast = event.target.checked
                  ? [...props.chat.cast, character.id]
                  : props.chat.cast.filter((id) => id !== character.id);
                const patch: Record<string, unknown> = { cast };
                if (!event.target.checked && props.chat.player_character_id === character.id) patch.player_character_id = null;
                void props.save(patch);
              }}
            />
            {character.name}
          </label>
        ))}
        <p className="badge">The narrator stays off until you check it. Replies come from the other people in the scene. The model does not write the one you play.</p>
      </div>
      {props.chat.last_state_error ? (
        <div className="banner">
          <div>{props.chat.last_state_error} The sheet was left unchanged.</div>
          <button
            className="ghost"
            type="button"
            onClick={() => {
              void api<{ ok?: boolean; error?: string }>(`/api/chats/${props.chat.id}/state/retry`, { method: "POST", body: "{}" })
                .then(async (result) => {
                  if (result.ok === false && result.error) props.onBanner(result.error);
                  else props.onBanner(null);
                  await props.save({});
                })
                .catch((error: unknown) => props.onBanner(error instanceof Error ? error.message : "Retry failed."));
            }}
          >
            Retry state
          </button>
        </div>
      ) : null}
      {props.chat.cast.map((id) => {
        const card = props.boot.characters.find((character) => character.id === id);
        const state = sheets.characters[id];
        if (!card || !state) return null;
        return (
          <div className="card" key={id}>
            <strong>{card.name}</strong>
            <p className="badge">{card.description}</p>
            <DynamicFields
              fields={CHARACTER_STRING_FIELDS}
              values={state.dynamic}
              pins={state.pins}
              onValue={(key, value) => {
                const dynamic = { ...state.dynamic, [key]: value } as CharacterDynamic;
                setSheets({ ...sheets, characters: { ...sheets.characters, [id]: { ...state, dynamic } } });
              }}
              onPin={(key, pinned) => {
                const pins = pinned ? [...state.pins, key] : state.pins.filter((item) => item !== key);
                setSheets({ ...sheets, characters: { ...sheets.characters, [id]: { ...state, pins } } });
              }}
            />
            <label className="field">
              Inventory
              <input
                value={state.dynamic.inventory.join(", ")}
                onChange={(event) => {
                  const inventory = event.target.value.split(",").map((item) => item.trim()).filter(Boolean);
                  setSheets({
                    ...sheets,
                    characters: { ...sheets.characters, [id]: { ...state, dynamic: { ...state.dynamic, inventory } } },
                  });
                }}
              />
            </label>
            <label className="pin">
              <input
                type="checkbox"
                checked={state.pins.includes("inventory")}
                onChange={(event) => {
                  const pins = event.target.checked ? [...state.pins, "inventory"] : state.pins.filter((item) => item !== "inventory");
                  setSheets({ ...sheets, characters: { ...sheets.characters, [id]: { ...state, pins } } });
                }}
              />
              Pin inventory
            </label>
          </div>
        );
      })}
      <button className="primary" type="button" onClick={() => void props.save({ sheets }).catch((error: unknown) => props.onBanner(error instanceof Error ? error.message : "Save failed."))}>
        Save sheets
      </button>
      <RevisionBar chat={props.chat} save={props.save} onBanner={props.onBanner} />
      {latest ? (
        <div className="diff">
          <div className="badge">{latest.status} · {latest.source}</div>
          {latest.diff.length ? latest.diff.map((entry) => (
            <div key={entry.path}><s>{entry.before || "empty"}</s> → {entry.label}: {entry.after || "empty"}</div>
          )) : <div className="badge">No field changes in the latest revision.</div>}
          {latest.notices.map((notice) => <div key={notice} className="badge">{notice}</div>)}
        </div>
      ) : null}
    </div>
  );
}

function WorldPanel(props: { chat: Chat; boot: Bootstrap; save: (patch: Record<string, unknown>) => Promise<Chat>; onBanner: (text: string | null) => void }) {
  const [sheets, setSheets] = useSyncedSheets(props.chat.sheets);
  const world = props.boot.worlds.find((item) => item.id === props.chat.world_id);
  const state = sheets.world;
  return (
    <div className="panel">
      <label className="field">
        World
        <select
          value={props.chat.world_id ?? ""}
          onChange={(event) => void props.save({ world_id: event.target.value || null })}
        >
          <option value="">None</option>
          {props.boot.worlds.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      {world ? <p className="badge">{world.description}</p> : null}
      <DynamicFields
        fields={WORLD_STRING_FIELDS}
        values={state.dynamic}
        pins={state.pins}
        onValue={(key, value) => setSheets({ ...sheets, world: { ...state, dynamic: { ...state.dynamic, [key]: value } as WorldDynamic } })}
        onPin={(key, pinned) => {
          const pins = pinned ? [...state.pins, key] : state.pins.filter((item) => item !== key);
          setSheets({ ...sheets, world: { ...state, pins } });
        }}
      />
      <button className="primary" type="button" onClick={() => void props.save({ sheets }).catch((error: unknown) => props.onBanner(error instanceof Error ? error.message : "Save failed."))}>
        Save world state
      </button>
      <RevisionBar chat={props.chat} save={props.save} onBanner={props.onBanner} />
    </div>
  );
}

function DynamicFields(props: {
  fields: readonly string[];
  values: object;
  pins: string[];
  onValue: (key: string, value: string) => void;
  onPin: (key: string, pinned: boolean) => void;
}) {
  const values = props.values as Record<string, unknown>;
  return (
    <>
      {props.fields.map((field) => {
        const raw = values[field];
        const text = typeof raw === "string" ? raw : "";
        return (
          <label className="field" key={field}>
            <span className="row">
              {field}
              <span className="pin">
                <input type="checkbox" checked={props.pins.includes(field)} onChange={(event) => props.onPin(field, event.target.checked)} />
                pin
              </span>
            </span>
            <input value={text} onChange={(event) => props.onValue(field, event.target.value)} />
          </label>
        );
      })}
    </>
  );
}

function RevisionBar(props: { chat: Chat; save: (patch: Record<string, unknown>) => Promise<Chat>; onBanner: (text: string | null) => void }) {
  const pending = props.chat.revisions.find((revision) => revision.status === "pending");
  async function act(path: string) {
    try {
      const next = await api<Chat>(path, { method: "POST", body: "{}" });
      await props.save({});
      void next;
    } catch (error) {
      props.onBanner(error instanceof Error ? error.message : "Could not update sheets.");
    }
  }
  return (
    <div className="row">
      <button className="ghost" type="button" onClick={() => void act(`/api/chats/${props.chat.id}/undo`)}>Undo</button>
      <button className="ghost" type="button" onClick={() => void api(`/api/chats/${props.chat.id}/state/retry`, { method: "POST", body: "{}" }).then(() => props.save({})).catch((error: unknown) => props.onBanner(error instanceof Error ? error.message : "Retry failed."))}>
        Retry state
      </button>
      {pending ? (
        <>
          <button className="primary" type="button" onClick={() => void act(`/api/chats/${props.chat.id}/revisions/${pending.id}/apply`)}>Apply</button>
          <button className="ghost" type="button" onClick={() => void act(`/api/chats/${props.chat.id}/revisions/${pending.id}/discard`)}>Discard</button>
        </>
      ) : null}
    </div>
  );
}

function Prompts(props: { chat: Chat; save: (patch: Record<string, unknown>) => Promise<Chat>; onBanner: (text: string | null) => void }) {
  const [order, setOrder] = useState<BlockId[]>(props.chat.block_order);
  const [disabled, setDisabled] = useState<BlockId[]>(props.chat.disabled_blocks);
  const [main, setMain] = useState(props.chat.main_prompt);
  const [pre, setPre] = useState(props.chat.pre_history);
  const [post, setPost] = useState(props.chat.post_history);
  const [instructions, setInstructions] = useState(props.chat.state_instructions);
  const [persona, setPersona] = useState(props.chat.persona_name);
  const [personaDescription, setPersonaDescription] = useState(props.chat.persona_description);
  const [preview, setPreview] = useState("");
  useEffect(() => {
    setOrder(props.chat.block_order);
    setDisabled(props.chat.disabled_blocks);
    setMain(props.chat.main_prompt);
    setPre(props.chat.pre_history);
    setPost(props.chat.post_history);
    setInstructions(props.chat.state_instructions);
    setPersona(props.chat.persona_name);
    setPersonaDescription(props.chat.persona_description);
  }, [props.chat.id]);

  function move(index: number, direction: -1 | 1) {
    const next = order.slice();
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(target, 0, item);
    setOrder(next);
  }

  async function savePrompts() {
    try {
      await props.save({
        block_order: order.length ? order : [...BLOCK_IDS],
        disabled_blocks: disabled,
        main_prompt: main,
        pre_history: pre,
        post_history: post,
        state_instructions: instructions,
        persona_name: persona,
        persona_description: personaDescription,
      });
    } catch (error) {
      props.onBanner(error instanceof Error ? error.message : "Could not save prompts.");
    }
  }

  return (
    <div className="panel">
      <p className="badge">Your name and persona apply when you are not playing a cast member. Choose who you play on the Sheets tab.</p>
      <label className="field">Your name<input value={persona} onChange={(event) => setPersona(event.target.value)} /></label>
      <label className="field">Persona<textarea value={personaDescription} onChange={(event) => setPersonaDescription(event.target.value)} /></label>
      <label className="field">Main<textarea value={main} onChange={(event) => setMain(event.target.value)} /></label>
      <label className="field">Pre-history<textarea value={pre} onChange={(event) => setPre(event.target.value)} /></label>
      <label className="field">Post-history<textarea value={post} onChange={(event) => setPost(event.target.value)} /></label>
      <label className="field">State instructions<textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label>
      {order.map((id, index) => (
        <div className="row" key={id}>
          <label className="check">
            <input
              type="checkbox"
              checked={!disabled.includes(id)}
              onChange={(event) => setDisabled(event.target.checked ? disabled.filter((item) => item !== id) : [...disabled, id])}
            />
            {BLOCK_LABELS[id]}
          </label>
          <span>
            <button className="ghost" type="button" onClick={() => move(index, -1)}>Up</button>
            <button className="ghost" type="button" onClick={() => move(index, 1)}>Down</button>
          </span>
        </div>
      ))}
      <button className="primary" type="button" onClick={() => void savePrompts()}>Save prompts</button>
      <button
        className="ghost"
        type="button"
        onClick={() => {
          void api<{ estimated_tokens: number; dropped_messages: number; system: string; notices: string[] }>(`/api/chats/${props.chat.id}/preview`, { method: "POST", body: "{}" })
            .then((result) => setPreview(`About ${result.estimated_tokens} tokens. ${result.dropped_messages} older messages left out.\n${result.notices.join(" ")}\n\n${result.system}`))
            .catch((error: unknown) => props.onBanner(error instanceof Error ? error.message : "Preview failed."));
        }}
      >
        Preview prompt
      </button>
      {preview ? <pre className="preview">{preview}</pre> : null}
    </div>
  );
}

function Memory(props: {
  chat: Chat;
  boot: Bootstrap;
  save: (patch: Record<string, unknown>) => Promise<Chat>;
  refreshBoot: () => Promise<void>;
  onBanner: (text: string | null) => void;
}) {
  const embedder = props.boot.embedder;
  return (
    <div className="panel">
      <label className="check">
        <input type="checkbox" checked={props.chat.rag_enabled} onChange={(event) => void props.save({ rag_enabled: event.target.checked })} />
        Use retrieval when the context window is tight
      </label>
      <label className="field">
        Memory budget
        <input
          type="number"
          value={props.chat.memory_budget_tokens}
          onChange={(event) => void props.save({ memory_budget_tokens: Number(event.target.value) })}
        />
      </label>
      <label className="field">
        Embedder connection
        <select
          value={embedder.connection_id ?? ""}
          onChange={(event) => {
            const connection = props.boot.connections.find((item) => item.id === event.target.value);
            void api("/api/embedder", {
              method: "PUT",
              body: JSON.stringify({ connection_id: event.target.value || null, model: connection?.model || embedder.model }),
            }).then(() => props.refreshBoot());
          }}
        >
          <option value="">None</option>
          {props.boot.connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}
        </select>
      </label>
      <label className="field">
        Embedder model
        <input
          value={embedder.model}
          onChange={(event) => {
            void api("/api/embedder", {
              method: "PUT",
              body: JSON.stringify({ connection_id: embedder.connection_id, model: event.target.value }),
            }).then(() => props.refreshBoot());
          }}
        />
      </label>
      <div className="badge">
        Status {embedder.status}
        {embedder.progress_total ? ` · ${embedder.progress_done}/${embedder.progress_total}` : ""}
        {embedder.error ? ` · ${embedder.error}` : ""}
      </div>
      <button className="ghost" type="button" onClick={() => void api("/api/embedder/rebuild", { method: "POST", body: "{}" }).then(() => props.refreshBoot()).catch((error: unknown) => props.onBanner(error instanceof Error ? error.message : "Rebuild failed."))}>
        Rebuild embeddings
      </button>
      <div>
        <div className="group-title">Last retrieval</div>
        {props.chat.last_retrieval.length ? props.chat.last_retrieval.map((item) => <p key={item.id}>{item.text}</p>) : <p className="badge">Nothing retrieved on the last turn.</p>}
      </div>
    </div>
  );
}

function useTrackedSampler(chatId: string, incoming: SamplerPreset) {
  const signature = `${chatId}\0${JSON.stringify(incoming)}`;
  const [sampler, setSampler] = useState(incoming);
  const [customText, setCustomText] = useState(() => JSON.stringify(incoming.custom ?? {}, null, 2));
  const [seen, setSeen] = useState(signature);
  if (seen !== signature) {
    setSeen(signature);
    setSampler(incoming);
    setCustomText(JSON.stringify(incoming.custom ?? {}, null, 2));
  }
  return { sampler, setSampler, customText, setCustomText, signature };
}

function Model(props: { chat: Chat; boot: Bootstrap; save: (patch: Record<string, unknown>) => Promise<Chat>; refreshBoot: () => Promise<void>; onBanner: (text: string | null) => void }) {
  const prose = useTrackedSampler(props.chat.id, props.chat.sampler);
  const state = useTrackedSampler(props.chat.id, props.chat.state_sampler);
  const [customError, setCustomError] = useState<string | null>(null);
  const [stateCustomError, setStateCustomError] = useState<string | null>(null);
  const [preview, setPreview] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [prosePresetId, setProsePresetId] = useState("");
  const [statePresetId, setStatePresetId] = useState("");
  const [stateOpen, setStateOpen] = useState(false);
  const [seenChat, setSeenChat] = useState(props.chat.id);
  const resetKey = `${prose.signature}\0${state.signature}`;
  const [seenReset, setSeenReset] = useState(resetKey);
  if (seenChat !== props.chat.id) {
    setSeenChat(props.chat.id);
    setProsePresetId("");
    setStatePresetId("");
  }
  if (seenReset !== resetKey) {
    setSeenReset(resetKey);
    setCustomError(null);
    setStateCustomError(null);
  }
  const connection = props.boot.connections.find((item) => item.id === props.chat.connection_id);
  const stateConnection = props.boot.connections.find((item) => item.id === props.chat.state_connection_id) ?? connection;

  function proseSampler(): SamplerPreset {
    return { ...prose.sampler, custom: customFromText(prose.customText) };
  }

  function stateSampler(): SamplerPreset {
    return { ...state.sampler, custom: customFromText(state.customText) };
  }

  async function saveProse() {
    const error = validateCustom(prose.customText);
    if (error) {
      props.onBanner(error);
      return;
    }
    const withCustom = proseSampler();
    const context = connection?.kind === "ollama" ? withCustom.num_ctx : props.chat.context_tokens;
    try {
      await props.save({ sampler: withCustom, context_tokens: context });
      props.onBanner("Saved the story sampler.");
    } catch (caught) {
      props.onBanner(caught instanceof Error ? caught.message : "Could not save the story sampler.");
    }
  }

  async function saveState() {
    const error = validateCustom(state.customText);
    if (error) {
      props.onBanner(error);
      return;
    }
    try {
      await props.save({ state_sampler: stateSampler() });
      props.onBanner("Saved the state sampler.");
    } catch (caught) {
      props.onBanner(caught instanceof Error ? caught.message : "Could not save the state sampler.");
    }
  }

  async function applyPreset(preset: Preset, which: "prose" | "state") {
    const next = preset.sampler;
    const text = JSON.stringify(next.custom ?? {}, null, 2);
    if (which === "prose") {
      flushSync(() => {
        prose.setSampler(next);
        prose.setCustomText(text);
        setProsePresetId(preset.id);
        setCustomError(null);
      });
    } else {
      flushSync(() => {
        state.setSampler(next);
        state.setCustomText(text);
        setStatePresetId(preset.id);
        setStateCustomError(null);
        setStateOpen(true);
      });
    }
    try {
      await props.save(which === "prose" ? { sampler: next } : { state_sampler: next });
      props.onBanner(`Loaded ${preset.name}.`);
    } catch (caught) {
      props.onBanner(caught instanceof Error ? caught.message : "Could not load the preset.");
    }
  }

  return (
    <div className="panel">
      <label className="field">
        Connection
        <select
          value={props.chat.connection_id ?? ""}
          onChange={(event) => {
            const next = props.boot.connections.find((item) => item.id === event.target.value);
            void props.save({ connection_id: event.target.value || null, model: next?.model || props.chat.model });
          }}
        >
          <option value="">None</option>
          {props.boot.connections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label className="field">
        Model
        <input value={props.chat.model} onChange={(event) => void props.save({ model: event.target.value })} />
      </label>
      {models.length ? (
        <label className="field">
          Known models
          <select value={props.chat.model} onChange={(event) => void props.save({ model: event.target.value })}>
            {models.map((model) => <option key={model}>{model}</option>)}
          </select>
        </label>
      ) : null}
      <button
        className="ghost"
        type="button"
        disabled={!connection}
        onClick={() => {
          if (!connection) return;
          void api<{ models: string[] }>(`/api/connections/${connection.id}/models`, { method: "POST", body: "{}" })
            .then((result) => setModels(result.models))
            .catch((error: unknown) => props.onBanner(error instanceof Error ? error.message : "Could not list models."));
        }}
      >
        Load models
      </button>
      <label className="field">
        State model connection
        <select
          value={props.chat.state_connection_id ?? ""}
          onChange={(event) => void props.save({ state_connection_id: event.target.value || null })}
        >
          <option value="">Same as prose</option>
          {props.boot.connections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label className="field">
        State model id
        <input value={props.chat.state_model} placeholder="Blank uses the prose model" onChange={(event) => void props.save({ state_model: event.target.value })} />
      </label>
      <label className="check">
        <input type="checkbox" checked={props.chat.hold_state_updates} onChange={(event) => void props.save({ hold_state_updates: event.target.checked })} />
        Confirm sheet updates before applying them
      </label>
      <label className="field">
        Context budget{connection?.kind === "ollama" ? " (num_ctx)" : ""}
        <input
          type="number"
          value={connection?.kind === "ollama" ? prose.sampler.num_ctx : props.chat.context_tokens}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (connection?.kind === "ollama") {
              setProsePresetId("");
              prose.setSampler({ ...prose.sampler, num_ctx: value });
            } else void props.save({ context_tokens: value });
          }}
        />
      </label>
      <label className="field">
        Load prose preset
        <select
          value={prosePresetId}
          onChange={(event) => {
            const preset = props.boot.presets.find((item) => item.id === event.target.value);
            if (!preset) {
              setProsePresetId("");
              return;
            }
            void applyPreset(preset, "prose");
          }}
        >
          <option value="">Choose</option>
          {props.boot.presets.filter((preset) => preset.purpose === "prose").map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
        </select>
      </label>
      <SamplerForm
        sampler={prose.sampler}
        section="story"
        kind={connection?.kind ?? "mock"}
        extraSamplers={Boolean(connection?.extra_samplers)}
        onChange={(next) => {
          setProsePresetId("");
          prose.setSampler(next);
        }}
        customText={prose.customText}
        onCustomText={(text, error) => {
          setProsePresetId("");
          prose.setCustomText(text);
          setCustomError(error);
        }}
      />
      {customError ? <div className="banner">{customError}</div> : null}
      <button className="primary" type="button" disabled={Boolean(customError)} onClick={() => void saveProse()}>Save story sampler</button>
      <PresetSave
        sampler={prose.sampler}
        customText={prose.customText}
        purpose="prose"
        presets={props.boot.presets}
        refreshBoot={props.refreshBoot}
        onBanner={props.onBanner}
        onSaved={async (preset) => {
          flushSync(() => {
            prose.setSampler(preset.sampler);
            prose.setCustomText(JSON.stringify(preset.sampler.custom ?? {}, null, 2));
            setProsePresetId(preset.id);
            setCustomError(null);
          });
          await props.save({ sampler: preset.sampler });
          props.onBanner(`Saved the story preset “${preset.name}”.`);
        }}
      />
      <details open={stateOpen} onToggle={(event) => setStateOpen(event.currentTarget.open)}>
        <summary>State sampler</summary>
        <label className="field">
          Load state preset
          <select
            value={statePresetId}
            onChange={(event) => {
              const preset = props.boot.presets.find((item) => item.id === event.target.value);
              if (!preset) {
                setStatePresetId("");
                return;
              }
              void applyPreset(preset, "state");
            }}
          >
            <option value="">Choose</option>
            {props.boot.presets.filter((preset) => preset.purpose === "state").map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
          </select>
        </label>
        <SamplerForm
          sampler={state.sampler}
          section="state"
          kind={stateConnection?.kind ?? "mock"}
          extraSamplers={Boolean(stateConnection?.extra_samplers)}
          onChange={(next) => {
            setStatePresetId("");
            state.setSampler(next);
          }}
          customText={state.customText}
          onCustomText={(text, error) => {
            setStatePresetId("");
            state.setCustomText(text);
            setStateCustomError(error);
          }}
        />
        {stateCustomError ? <div className="banner">{stateCustomError}</div> : null}
        <button className="primary" type="button" disabled={Boolean(stateCustomError)} onClick={() => void saveState()}>Save state sampler</button>
        <PresetSave
          sampler={state.sampler}
          customText={state.customText}
          purpose="state"
          presets={props.boot.presets}
          refreshBoot={props.refreshBoot}
          onBanner={props.onBanner}
          onSaved={async (preset) => {
            flushSync(() => {
              state.setSampler(preset.sampler);
              state.setCustomText(JSON.stringify(preset.sampler.custom ?? {}, null, 2));
              setStatePresetId(preset.id);
              setStateCustomError(null);
              setStateOpen(true);
            });
            await props.save({ state_sampler: preset.sampler });
            props.onBanner(`Saved the state preset “${preset.name}”.`);
          }}
        />
      </details>
      <button
        className="ghost"
        type="button"
        onClick={() => {
          const error = validateCustom(prose.customText);
          if (error) {
            props.onBanner(error);
            return;
          }
          void api<{ body: unknown; applied: string[]; dropped: string[] }>(`/api/chats/${props.chat.id}/preview`, {
            method: "POST",
            body: JSON.stringify({ sampler: proseSampler(), context_tokens: connection?.kind === "ollama" ? prose.sampler.num_ctx : props.chat.context_tokens }),
          }).then((result) => {
            setPreview(`${JSON.stringify(result.body, null, 2)}\n\nSent: ${result.applied.join(", ")}\n\nNot sent: ${result.dropped.join(", ")}`);
          }).catch((error: unknown) => props.onBanner(error instanceof Error ? error.message : "Preview failed."));
        }}
      >
        Preview request
      </button>
      {preview ? <pre className="preview">{preview}</pre> : null}
    </div>
  );
}

function PresetSave(props: {
  sampler: SamplerPreset;
  customText: string;
  purpose: "prose" | "state";
  presets: Preset[];
  refreshBoot: () => Promise<void>;
  onBanner: (text: string | null) => void;
  onSaved: (preset: Preset) => Promise<void>;
}) {
  const [name, setName] = useState("");
  return (
    <div className="row">
      <input value={name} placeholder="Preset name" aria-label={props.purpose === "state" ? "State preset name" : "Story preset name"} onChange={(event) => setName(event.target.value)} />
      <button
        className="ghost"
        type="button"
        onClick={() => {
          const error = validateCustom(props.customText);
          const trimmed = name.trim();
          if (error || !trimmed) {
            props.onBanner(error || "Name the preset.");
            return;
          }
          const sampler = { ...props.sampler, custom: customFromText(props.customText) };
          const existing = props.presets.find((preset) => preset.purpose === props.purpose && preset.name === trimmed);
          const request = existing
            ? api<Preset>(`/api/presets/${existing.id}`, { method: "PUT", body: JSON.stringify({ name: trimmed, purpose: props.purpose, sampler }) })
            : api<Preset>("/api/presets", { method: "POST", body: JSON.stringify({ name: trimmed, purpose: props.purpose, sampler }) });
          void request
            .then(async (saved) => {
              setName("");
              await props.refreshBoot();
              await props.onSaved(saved);
            })
            .catch((caught: unknown) => props.onBanner(caught instanceof Error ? caught.message : "Could not save the preset."));
        }}
      >
        Save preset
      </button>
    </div>
  );
}
