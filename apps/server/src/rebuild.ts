import type { DatabaseSync } from "node:sqlite";
import { vectorToBytes } from "@rp/shared";
import { embedTexts } from "./runtime.ts";
import {
  ensureMessageChunks,
  getConnection,
  getEmbedder,
  listChunks,
  listWorlds,
  saveEmbedding,
  setEmbedderProgress,
  syncLoreChunks,
} from "./store.ts";

let running: Promise<void> | null = null;

export function startRebuild(db: DatabaseSync): { started: boolean } {
  if (running) return { started: false };
  running = rebuild(db).finally(() => {
    running = null;
  });
  return { started: true };
}

async function rebuild(db: DatabaseSync) {
  const embedder = getEmbedder(db);
  if (!embedder.connection_id || !embedder.model) {
    setEmbedderProgress(db, { status: "error", error: "Choose an embedder connection and model first.", progress_done: 0, progress_total: 0 });
    return;
  }
  const connection = getConnection(db, embedder.connection_id);
  setEmbedderProgress(db, { status: "rebuilding", error: null, progress_done: 0, progress_total: 0 });
  try {
    for (const world of listWorlds(db)) syncLoreChunks(db, world.id, world.lore);
    const chats = db.prepare("SELECT id FROM chats").all() as { id: string }[];
    for (const chat of chats) ensureMessageChunks(db, chat.id);
    const pending = listChunks(db).filter((chunk) => chunk.stale || !chunk.embedding);
    setEmbedderProgress(db, { status: "rebuilding", progress_done: 0, progress_total: pending.length, error: null });
    const batchSize = 16;
    for (let index = 0; index < pending.length; index += batchSize) {
      const batch = pending.slice(index, index + batchSize);
      const vectors = await embedTexts({
        kind: connection.kind,
        baseUrl: connection.base_url,
        apiKey: connection.api_key,
        model: embedder.model,
        texts: batch.map((chunk) => chunk.text),
      });
      batch.forEach((chunk, batchIndex) => {
        const vector = vectors[batchIndex];
        if (!vector || vector.length === 0) return;
        saveEmbedding(db, chunk.id, vectorToBytes(vector), embedder.model, vector.length);
      });
      setEmbedderProgress(db, {
        status: "rebuilding",
        progress_done: Math.min(pending.length, index + batch.length),
        progress_total: pending.length,
        error: null,
      });
    }
    setEmbedderProgress(db, { status: "ready", progress_done: pending.length, progress_total: pending.length, error: null });
  } catch (error) {
    setEmbedderProgress(db, {
      status: "error",
      error: error instanceof Error ? error.message : "Rebuild failed.",
    });
  }
}
