import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../src/http.ts";

test("a mock turn updates sheets and undo restores them", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "rp-agent-"));
  const app = createApp(path.join(dir, "test.db"));
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", () => resolve()));
  const port = (app.server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const created = await fetch(`${base}/api/chats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Watch",
        world_id: "world-gate",
        cast: ["char-mara"],
        connection_id: "conn-mock",
      }),
    });
    assert.equal(created.status, 201);
    const chat = (await created.json()) as {
      id: string;
      narrator_enabled: boolean;
      player_character_id: string | null;
      sheets: { characters: Record<string, { dynamic: { emotion: string } }>; world: { dynamic: { weather: string } } };
    };
    assert.equal(chat.sheets.characters["char-mara"]?.dynamic.emotion, "calm");
    assert.equal(chat.narrator_enabled, false);
    assert.equal(chat.player_character_id, null);

    const turn = await fetch(`${base}/api/chats/${chat.id}/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "I pull my hood up against the rain." }),
    });
    assert.equal(turn.status, 200);
    const reader = turn.body?.getReader();
    assert.ok(reader);
    const decoder = new TextDecoder();
    let buffer = "";
    let firstTokenAt = 0;
    let lastTokenAt = 0;
    const events: { type: string; error?: string }[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) {
          const event = JSON.parse(line) as { type: string; error?: string };
          if (event.type === "token") {
            const now = Date.now();
            if (!firstTokenAt) firstTokenAt = now;
            lastTokenAt = now;
          }
          events.push(event);
        }
        index = buffer.indexOf("\n");
      }
    }
    if (buffer.trim()) events.push(JSON.parse(buffer) as { type: string; error?: string });
    assert.ok(lastTokenAt - firstTokenAt >= 100, `tokens arrived together (${lastTokenAt - firstTokenAt}ms)`);
    assert.equal(events.some((event) => event.type === "done"), true);
    assert.equal(events.some((event) => event.type === "state"), true);
    assert.equal(events.some((event) => event.type === "error"), false);

    const after = (await (await fetch(`${base}/api/chats/${chat.id}`)).json()) as {
      messages: { role: string }[];
      sheets: { characters: Record<string, { dynamic: { emotion: string; clothing: string } }>; world: { dynamic: { weather: string; time: string } } };
    };
    assert.equal(after.messages.filter((message) => message.role === "user").length, 1);
    assert.equal(after.sheets.characters["char-mara"]?.dynamic.emotion, "wary");
    assert.equal(after.sheets.characters["char-mara"]?.dynamic.clothing, "a wet wool cloak");
    assert.equal(after.sheets.world.dynamic.weather, "cold rain");
    assert.equal(after.sheets.world.dynamic.time, "just after dusk");

    const undone = (await (await fetch(`${base}/api/chats/${chat.id}/undo`, { method: "POST" })).json()) as typeof after;
    assert.equal(undone.sheets.characters["char-mara"]?.dynamic.emotion, "calm");
    assert.equal(undone.sheets.world.dynamic.weather, "clear");
  } finally {
    await new Promise<void>((resolve, reject) => app.server.close((error) => (error ? reject(error) : resolve())));
    app.close();
  }
});
