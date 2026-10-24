import type { DatabaseSync } from "node:sqlite";
import {
  assemble,
  bytesToVector,
  characterSection,
  composePreHistory,
  loreBlock,
  outputReserve,
  rankVectors,
  selectLore,
  worldDynamicText,
  worldStaticText,
  type AssembleResult,
  type ConnectionKind,
} from "@rp/shared";
import { embedTexts } from "./runtime.ts";
import {
  ensureMessageChunks,
  getConnection,
  getEmbedder,
  getWorld,
  listCharacters,
  listChunks,
  listReadyChunks,
  saveEmbedding,
  syncLoreChunks,
  type ChatDetail,
} from "./store.ts";
import { vectorToBytes } from "@rp/shared";

export type PreparedPrompt = {
  assembled: AssembleResult;
  notices: string[];
  retrieval: { id: string; text: string }[];
  kind: ConnectionKind;
};

export async function preparePrompt(db: DatabaseSync, chat: ChatDetail, signal?: AbortSignal): Promise<PreparedPrompt> {
  const notices: string[] = [];
  const characters = listCharacters(db);
  const byId = new Map(characters.map((character) => [character.id, character]));
  const world = chat.world_id ? getWorld(db, chat.world_id) : null;
  const names = chat.cast.map((id) => byId.get(id)?.name).filter((name): name is string => Boolean(name));
  const recent = chat.messages
    .slice(-2)
    .map((message) => message.content)
    .join("\n");
  const lore = world ? selectLore(world.lore, recent) : { included: [], rag: [] };
  const cards = chat.cast.flatMap((id) => {
    const card = byId.get(id);
    if (!card) return [];
    const dynamic = chat.sheets.characters[id]?.dynamic ?? card.initial_dynamic;
    return [{
      name: card.name,
      description: card.description,
      personality: card.personality,
      scenario: card.scenario,
      exampleDialogue: card.example_dialogue,
      template: card.dynamic_template,
      dynamic,
    }];
  });
  const texts = {
    main: chat.main_prompt,
    pre_history: composePreHistory(chat.pre_history, chat.persona_name, chat.persona_description),
    world_static: world ? worldStaticText(world.name, world.description) : "",
    world_dynamic: world ? worldDynamicText(world.dynamic_template, chat.sheets.world.dynamic) : "",
    characters: characterSection(cards),
    lore: loreBlock(lore.included),
    post_history: chat.post_history,
  };
  const history = chat.messages.map((message) => ({ id: message.id, role: message.role, content: message.content }));
  const connection = chat.connection_id ? getConnection(db, chat.connection_id) : null;
  const kind = connection?.kind ?? "mock";
  const reserve = outputReserve(chat.sampler, kind);
  const base = {
    order: chat.block_order,
    disabled: chat.disabled_blocks,
    contextTokens: chat.context_tokens,
    outputReserve: reserve,
    personaName: chat.persona_name,
    texts,
    history,
  };

  if (!chat.rag_enabled) {
    return {
      assembled: assemble({ ...base, memoryBudget: 0, memoryCandidates: [] }),
      notices,
      retrieval: [],
      kind,
    };
  }

  const embedder = getEmbedder(db);
  if (!embedder.connection_id || !embedder.model || embedder.status !== "ready") {
    notices.push(
      embedder.status === "rebuilding"
        ? "Retrieval is rebuilding and was left out of this turn."
        : "Retrieval is on, and the embedder is not ready. Rebuild embeddings from the Memory tab.",
    );
    return { assembled: assemble({ ...base, memoryBudget: 0, memoryCandidates: [] }), notices, retrieval: [], kind };
  }

  try {
    ensureMessageChunks(db, chat.id);
    if (world) syncLoreChunks(db, world.id, world.lore);
    await embedFresh(db, chat.id, chat.world_id, signal);
    const probe = assemble({
      ...base,
      outputReserve: reserve + chat.memory_budget_tokens,
      memoryBudget: 0,
      memoryCandidates: [],
    });
    const dropped = new Set(probe.droppedMessageIds);
    const ready = listReadyChunks(db, chat.id, chat.world_id, embedder.model);
    const eligible = ready.filter((chunk) => chunk.source !== "message" || dropped.has(chunk.source_id));
    const queryText = `${[...chat.messages].reverse().find((message) => message.role === "user")?.content ?? ""}\n${names.join(" ")}`;
    const embedConn = getConnection(db, embedder.connection_id);
    const [queryVector] = await embedTexts({
      kind: embedConn.kind,
      baseUrl: embedConn.base_url,
      apiKey: embedConn.api_key,
      model: embedder.model,
      texts: [queryText],
      signal,
    });
    if (!queryVector) throw new Error("The embedder returned no query vector.");
    const ranked = rankVectors(
      queryVector,
      eligible.flatMap((chunk) => (chunk.embedding ? [{ id: chunk.id, text: chunk.text, vector: bytesToVector(chunk.embedding) }] : [])),
      20,
    );
    let candidates = ranked.map((row) => ({ id: row.id, text: row.text }));
    let assembled = assemble({ ...base, memoryBudget: chat.memory_budget_tokens, memoryCandidates: candidates });
    const kept = new Set(history.filter((message) => !assembled.droppedMessageIds.includes(message.id)).map((message) => message.id));
    const messageOf = new Map(eligible.map((chunk) => [chunk.id, chunk.source === "message" ? chunk.source_id : ""]));
    const trimmed = candidates.filter((candidate) => {
      const messageId = messageOf.get(candidate.id) ?? "";
      return !messageId || !kept.has(messageId);
    });
    if (trimmed.length !== candidates.length) {
      candidates = trimmed;
      assembled = assemble({ ...base, memoryBudget: chat.memory_budget_tokens, memoryCandidates: candidates });
    }
    return {
      assembled,
      notices,
      retrieval: candidates.map((candidate) => ({ id: candidate.id, text: candidate.text })),
      kind,
    };
  } catch (error) {
    notices.push(`Retrieval failed: ${error instanceof Error ? error.message : "unknown error"}`);
    return { assembled: assemble({ ...base, memoryBudget: 0, memoryCandidates: [] }), notices, retrieval: [], kind };
  }
}

async function embedFresh(db: DatabaseSync, chatId: string, worldId: string | null, signal?: AbortSignal) {
  const embedder = getEmbedder(db);
  if (embedder.status !== "ready" || !embedder.connection_id || !embedder.model) return;
  const pending = listChunks(db)
    .filter((chunk) => {
      const inScope = (chunk.scope === "chat" && chunk.scope_id === chatId) || (worldId && chunk.scope === "world" && chunk.scope_id === worldId);
      return inScope && (chunk.stale || !chunk.embedding);
    })
    .slice(0, 8);
  if (!pending.length) return;
  const connection = getConnection(db, embedder.connection_id);
  const vectors = await embedTexts({
    kind: connection.kind,
    baseUrl: connection.base_url,
    apiKey: connection.api_key,
    model: embedder.model,
    texts: pending.map((chunk) => chunk.text),
    signal,
  });
  pending.forEach((chunk, index) => {
    const vector = vectors[index];
    if (!vector) return;
    saveEmbedding(db, chunk.id, vectorToBytes(vector), embedder.model, vector.length);
  });
}
