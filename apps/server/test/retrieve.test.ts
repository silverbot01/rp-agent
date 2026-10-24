import assert from "node:assert/strict";
import test from "node:test";
import { bytesToVector, rankVectors, vectorToBytes } from "@rp/shared";
import { openDatabase } from "../src/db.ts";
import { insertMemoryChunk, listReadyChunks, saveEmbedding } from "../src/store.ts";

test("cosine rank puts the closest chunk first", () => {
  const ranked = rankVectors(Float32Array.from([1, 0, 0]), [
    { id: "b", text: "side", vector: Float32Array.from([0, 1, 0]) },
    { id: "c", text: "near", vector: Float32Array.from([0.9, 0.1, 0]) },
    { id: "a", text: "match", vector: Float32Array.from([1, 0, 0]) },
  ], 3);
  assert.deepEqual(ranked.map((row) => row.id), ["a", "c", "b"]);
});

test("embeddings round-trip through sqlite blobs", () => {
  const db = openDatabase(":memory:");
  insertMemoryChunk(db, "chat-1", "mem-1", "rain on the gate", ["weather"]);
  const stored = listReadyChunks(db, "chat-1", null, "embed-a");
  assert.equal(stored.length, 0);
  const pending = db.prepare("SELECT id FROM chunks WHERE source_id = :id").get({ id: "mem-1" }) as { id: string };
  const vector = Float32Array.from([0.25, 0.5, 0.75, 1]);
  saveEmbedding(db, pending.id, vectorToBytes(vector), "embed-a", vector.length);
  const ready = listReadyChunks(db, "chat-1", null, "embed-a");
  assert.equal(ready.length, 1);
  const restored = bytesToVector(ready[0]?.embedding ?? new Uint8Array());
  assert.equal(restored.length, 4);
  assert.ok(Math.abs((restored[0] ?? 0) - 0.25) < 1e-6);
  assert.ok(Math.abs((restored[3] ?? 0) - 1) < 1e-6);
  db.close();
});
