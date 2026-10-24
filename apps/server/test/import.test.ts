import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../src/http.ts";

test("import keeps ids and replaces a chat transcript", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "rp-agent-import-"));
  const app = createApp(path.join(dir, "test.db"));
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", () => resolve()));
  const port = (app.server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const body = JSON.stringify({
      characters: [{ id: "char-ivo", name: "Ivo", description: "A scout", initial_dynamic: { emotion: "eager", clothing: "linen" } }],
      worlds: [{ id: "world-fen", name: "The Fen", description: "Wet ground", initial_dynamic: { weather: "mist" } }],
      chats: [{
        id: "chat-import",
        title: "Imported",
        world_id: "world-fen",
        cast: ["char-ivo"],
        connection_id: "conn-mock",
        persona_name: "You",
        sheets: {
          characters: { "char-ivo": { dynamic: { emotion: "tense", clothing: "linen", inventory: ["map"] }, pins: ["emotion"] } },
          world: { dynamic: { weather: "mist", time: "night" }, pins: [] },
        },
        messages: [
          { id: "msg-1", role: "user", content: "We wait.", created_at: "2026-01-01T00:00:00.000Z" },
          { id: "msg-2", role: "assistant", content: "The mist holds.", created_at: "2026-01-01T00:00:01.000Z" },
        ],
      }],
    });
    const imported = await fetch(`${base}/api/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    const importedText = await imported.text();
    assert.equal(imported.status, 200, importedText);

    const characters = (await (await fetch(`${base}/api/characters`)).json()) as { id: string; description: string }[];
    assert.equal(characters.some((character) => character.id === "char-ivo" && character.description === "A scout"), true);

    const chat = (await (await fetch(`${base}/api/chats/chat-import`)).json()) as {
      id: string;
      messages: { content: string }[];
      sheets: {
        characters: Record<string, { dynamic: { emotion: string; inventory: string[] }; pins: string[] }>;
        world: { dynamic: { time: string; weather: string } };
      };
    };
    assert.equal(chat.id, "chat-import");
    assert.deepEqual(chat.messages.map((message) => message.content), ["We wait.", "The mist holds."]);
    assert.equal(chat.sheets.characters["char-ivo"]?.dynamic.emotion, "tense");
    assert.deepEqual(chat.sheets.characters["char-ivo"]?.dynamic.inventory, ["map"]);
    assert.equal(chat.sheets.characters["char-ivo"]?.pins.includes("emotion"), true);
    assert.equal(chat.sheets.world.dynamic.time, "night");
    assert.equal(chat.sheets.world.dynamic.weather, "mist");

    const again = await fetch(`${base}/api/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characters: [{ id: "char-ivo", name: "Ivo", description: "A tired scout" }] }),
    });
    assert.equal(again.status, 200);
    const after = (await (await fetch(`${base}/api/characters`)).json()) as { id: string; description: string }[];
    const matches = after.filter((character) => character.id === "char-ivo");
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.description, "A tired scout");
  } finally {
    await new Promise<void>((resolve, reject) => app.server.close((error) => (error ? reject(error) : resolve())));
    app.close();
  }
});
