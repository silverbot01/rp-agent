import type { DatabaseSync } from "node:sqlite";
import {
  buildChatBody,
  redactBody,
  reduceState,
  stateUpdatePrompt,
  type ChatMessage,
} from "@rp/shared";
import { AbortedError } from "./errors.ts";
import { HttpError } from "./errors.ts";
import { preparePrompt } from "./prompt.ts";
import { completeText, streamProse } from "./runtime.ts";
import {
  addMessage,
  deleteMessage,
  discardPending,
  getChat,
  getConnection,
  getRevision,
  insertMemoryChunk,
  listCharacters,
  listMessages,
  listRevisions,
  recordRevision,
  revisionMemories,
  setRevisionStatus,
  updateChat,
  upsertMessageChunk,
  writeSheets,
  type ChatDetail,
  type MessagePublic,
  type RevisionPublic,
} from "./store.ts";

export type TurnEvent =
  | { type: "token"; text: string }
  | {
      type: "done";
      message: MessagePublic | null;
      estimated_tokens: number;
      prompt_tokens: number | null;
      dropped_messages: number;
      notices: string[];
      stream_fallback: boolean;
      request: unknown;
    }
  | { type: "state"; revision: RevisionPublic | null; notices: string[] }
  | { type: "state_error"; error: string }
  | { type: "error"; error: string };

export async function runTurn(
  db: DatabaseSync,
  chatId: string,
  options: { content?: string; regenerate?: boolean; signal?: AbortSignal; onEvent: (event: TurnEvent) => void },
) {
  const { onEvent, signal } = options;
  try {
    let chat = getChat(db, chatId);
    if (!chat.connection_id) throw new HttpError(400, "Choose a model connection first.");
    if (options.regenerate) {
      const last = chat.messages[chat.messages.length - 1];
      if (last?.role === "assistant") deleteMessage(db, chatId, last.id);
      discardPending(db, chatId);
      chat = getChat(db, chatId);
      if (!chat.messages.some((message) => message.role === "user")) {
        throw new HttpError(400, "There is no user message to regenerate from.");
      }
    } else {
      const content = options.content?.trim() ?? "";
      if (!content) throw new HttpError(400, "Write a message first.");
      addMessage(db, chatId, "user", content);
      chat = getChat(db, chatId);
    }

    const prepared = await preparePrompt(db, chat, signal);
    if (!chat.connection_id) throw new HttpError(400, "Choose a model connection first.");
    const connection = getConnection(db, chat.connection_id);
    const model = chat.model || connection.model;
    if (!model && connection.kind !== "mock") throw new HttpError(400, "Choose a model first.");
    const messages: ChatMessage[] = prepared.assembled.messages;
    const built = buildChatBody({
      kind: connection.kind,
      model: model || "mock",
      extraSamplers: connection.extra_samplers,
      sampler: chat.sampler,
      messages,
      prompt: prepared.assembled.prompt,
      contextTokens: chat.context_tokens,
      stream: true,
    });
    let text = "";
    let streamFallback = false;
    let promptTokens: number | null = prepared.assembled.estimatedTokens;
    try {
      const usage = await streamProse(
        {
          kind: connection.kind,
          baseUrl: connection.base_url,
          apiKey: connection.api_key,
          model: model || "mock",
          extraSamplers: connection.extra_samplers,
          sampler: chat.sampler,
          messages,
          prompt: prepared.assembled.prompt,
          contextTokens: chat.context_tokens,
          signal,
        },
        (token) => {
          text += token;
          onEvent({ type: "token", text: token });
        },
      );
      if (usage.promptTokens) promptTokens = usage.promptTokens;
      streamFallback = Boolean(usage.streamFallback);
    } catch (error) {
      if (error instanceof AbortedError && text) {
        const message = addMessage(db, chatId, "assistant", text);
        onEvent({
          type: "done",
          message,
          estimated_tokens: prepared.assembled.estimatedTokens,
          prompt_tokens: promptTokens,
          dropped_messages: prepared.assembled.droppedMessageIds.length,
          notices: [...prepared.notices, "Stopped. The partial reply was kept."],
          stream_fallback: streamFallback,
          request: redactBody(built.body),
        });
        return;
      }
      throw error;
    }

    const message = text ? addMessage(db, chatId, "assistant", text) : null;
    if (chat.rag_enabled && message) upsertMessageChunk(db, chatId, message.id, message.content);
    const userMessage = [...listMessages(db, chatId)].reverse().find((item) => item.role === "user");
    if (chat.rag_enabled && userMessage) upsertMessageChunk(db, chatId, userMessage.id, userMessage.content);
    updateChat(db, chatId, {
      last_retrieval: prepared.retrieval,
      last_prompt_tokens: promptTokens,
      last_state_error: null,
    });
    onEvent({
      type: "done",
      message,
      estimated_tokens: prepared.assembled.estimatedTokens,
      prompt_tokens: promptTokens,
      dropped_messages: prepared.assembled.droppedMessageIds.length,
      notices: prepared.notices,
      stream_fallback: streamFallback,
      request: redactBody(built.body),
    });
    if (!message) {
      onEvent({ type: "state_error", error: "The model returned an empty reply, so the sheets were left as they were." });
      return;
    }
    const state = await applyStateUpdate(db, chatId, signal);
    if (state.ok) onEvent({ type: "state", revision: state.revision, notices: state.notices });
    else onEvent({ type: "state_error", error: state.error });
  } catch (error) {
    if (error instanceof AbortedError) {
      onEvent({ type: "error", error: "Stopped." });
      return;
    }
    onEvent({ type: "error", error: error instanceof Error ? error.message : "The turn failed." });
  }
}

export async function applyStateUpdate(
  db: DatabaseSync,
  chatId: string,
  signal?: AbortSignal,
): Promise<{ ok: true; revision: RevisionPublic | null; notices: string[] } | { ok: false; error: string }> {
  const chat = getChat(db, chatId);
  const assistant = [...chat.messages].reverse().find((message) => message.role === "assistant");
  const user = [...chat.messages].reverse().find((message) => message.role === "user");
  if (!assistant || !user) {
    const error = "A state update needs a user message and a narrator reply.";
    updateChat(db, chatId, { last_state_error: error });
    return { ok: false, error };
  }
  const prose = chat.connection_id ? getConnection(db, chat.connection_id) : null;
  const stateConnection = chat.state_connection_id ? getConnection(db, chat.state_connection_id) : prose;
  if (!stateConnection) return { ok: false, error: "Choose a model connection first." };
  const model = (chat.state_connection_id ? chat.state_model : chat.model) || stateConnection.model || "mock";
  const names = Object.fromEntries(listCharacters(db).map((character) => [character.id, character.name]));
  const prompt = stateUpdatePrompt({
    sheets: chat.sheets,
    names,
    instructions: chat.state_instructions,
    userText: user.content,
    assistantText: assistant.content,
  });
  let text = "";
  try {
    const result = await completeText({
      kind: stateConnection.kind,
      baseUrl: stateConnection.base_url,
      apiKey: stateConnection.api_key,
      model,
      extraSamplers: stateConnection.extra_samplers,
      sampler: chat.state_sampler,
      messages: [{ role: "user", content: prompt }],
      prompt,
      contextTokens: chat.context_tokens,
      signal,
      purpose: "state",
      sheets: chat.sheets,
    });
    text = result.text;
  } catch (error) {
    if (error instanceof AbortedError) return { ok: false, error: "State update stopped." };
    const message = error instanceof Error ? error.message : "State update failed.";
    updateChat(db, chatId, { last_state_error: message });
    return { ok: false, error: message };
  }
  const reduced = reduceState(chat.sheets, text, names);
  if (!reduced.ok) {
    updateChat(db, chatId, { last_state_error: reduced.error });
    return { ok: false, error: reduced.error };
  }
  const status = chat.hold_state_updates ? "pending" : "applied";
  if (status === "applied") writeSheets(db, chatId, reduced.sheets);
  const revision = recordRevision(db, chatId, {
    source: "model",
    status,
    patch: reduced,
    before: chat.sheets,
    after: reduced.sheets,
    diff: reduced.diff,
    notices: reduced.notices,
    error: null,
  });
  if (chat.rag_enabled && status === "applied") {
    reduced.memories.forEach((memory, index) => {
      insertMemoryChunk(db, chatId, `${revision.id}:${index}`, memory.text, memory.tags);
    });
  }
  updateChat(db, chatId, { last_state_error: null });
  return { ok: true, revision, notices: reduced.notices };
}

export function confirmRevision(db: DatabaseSync, chatId: string, revisionId: string): ChatDetail {
  const revision = getRevision(db, chatId, revisionId);
  if (revision.status !== "pending") throw new HttpError(400, "That revision is not waiting for confirmation.");
  writeSheets(db, chatId, revision.after);
  setRevisionStatus(db, revisionId, "applied");
  const chat = getChat(db, chatId);
  if (chat.rag_enabled) {
    revisionMemories(db, revisionId).forEach((memory, index) => {
      insertMemoryChunk(db, chatId, `${revisionId}:${index}`, memory.text, memory.tags);
    });
  }
  return getChat(db, chatId);
}

export function discardRevision(db: DatabaseSync, chatId: string, revisionId: string): ChatDetail {
  const revision = getRevision(db, chatId, revisionId);
  if (revision.status !== "pending") throw new HttpError(400, "That revision is not waiting for confirmation.");
  setRevisionStatus(db, revisionId, "discarded");
  return getChat(db, chatId);
}

export function undoRevision(db: DatabaseSync, chatId: string): ChatDetail {
  discardPending(db, chatId);
  const latest = listRevisions(db, chatId).find((revision) => revision.status === "applied");
  if (!latest) throw new HttpError(400, "There is no applied sheet change to undo.");
  writeSheets(db, chatId, latest.before);
  setRevisionStatus(db, latest.id, "undone");
  return getChat(db, chatId);
}
