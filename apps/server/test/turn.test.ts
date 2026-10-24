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

test("messages can be edited or deleted, and restart restores the opening scene", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "rp-agent-"));
  const app = createApp(path.join(dir, "test.db"));
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", () => resolve()));
  const port = (app.server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  type ChatBody = {
    messages: { id: string; role: string; content: string }[];
    revisions: unknown[];
    sheets: {
      characters: Record<string, { dynamic: { emotion: string }; pins: string[] }>;
      world: { dynamic: { weather: string } };
    };
  };
  try {
    const created = await fetch(`${base}/api/chats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Rewrite", world_id: "world-gate", cast: ["char-mara"], connection_id: "conn-mock" }),
    });
    const chat = (await created.json()) as ChatBody & { id: string };
    const greeting = chat.messages[0];
    assert.equal(greeting?.role, "assistant");
    assert.equal(greeting?.content, "You're late. The road has been too quiet.");

    const turn = await fetch(`${base}/api/chats/${chat.id}/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "I mention the rain." }),
    });
    const blocked = await fetch(`${base}/api/chats/${chat.id}/messages/${greeting?.id}`, { method: "DELETE" });
    assert.equal(blocked.status, 409);
    await turn.text();

    const played = (await (await fetch(`${base}/api/chats/${chat.id}`)).json()) as ChatBody;
    const user = played.messages.find((message) => message.role === "user");
    const reply = [...played.messages].reverse().find((message) => message.role === "assistant" && message.id !== greeting?.id);
    assert.ok(user && reply);
    assert.equal(played.sheets.characters["char-mara"]?.dynamic.emotion, "wary");

    const edited = await fetch(`${base}/api/chats/${chat.id}/messages/${user.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "  I wait under the arch.  " }),
    });
    assert.equal(edited.status, 200);
    const afterEdit = (await edited.json()) as ChatBody;
    assert.equal(afterEdit.messages.find((message) => message.id === user.id)?.content, "I wait under the arch.");
    assert.equal(afterEdit.sheets.characters["char-mara"]?.dynamic.emotion, "wary");

    const replyEdit = await fetch(`${base}/api/chats/${chat.id}/messages/${reply.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Mara looks up." }),
    });
    assert.equal(replyEdit.status, 200);
    const blank = await fetch(`${base}/api/chats/${chat.id}/messages/${reply.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "   " }),
    });
    assert.equal(blank.status, 400);

    const pinned = structuredClone(afterEdit.sheets);
    pinned.characters["char-mara"]!.pins = ["emotion"];
    const pinSave = await fetch(`${base}/api/chats/${chat.id}/`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sheets: pinned }),
    });
    assert.equal(pinSave.status, 200);

    const removed = await fetch(`${base}/api/chats/${chat.id}/messages/${reply.id}`, { method: "DELETE" });
    assert.equal(removed.status, 200);
    const afterDelete = (await removed.json()) as ChatBody;
    assert.equal(afterDelete.messages.some((message) => message.id === reply.id), false);
    assert.equal(afterDelete.sheets.characters["char-mara"]?.dynamic.emotion, "wary");

    const restarted = await fetch(`${base}/api/chats/${chat.id}/restart`, { method: "POST" });
    assert.equal(restarted.status, 200);
    const fresh = (await restarted.json()) as ChatBody;
    assert.deepEqual(fresh.messages.map((message) => message.content), ["You're late. The road has been too quiet."]);
    assert.equal(fresh.sheets.characters["char-mara"]?.dynamic.emotion, "calm");
    assert.equal(fresh.sheets.characters["char-mara"]?.pins.includes("emotion"), true);
    assert.equal(fresh.sheets.world.dynamic.weather, "clear");
    assert.equal(fresh.revisions.length, 0);
  } finally {
    await new Promise<void>((resolve, reject) => app.server.close((error) => (error ? reject(error) : resolve())));
    app.close();
  }
});
