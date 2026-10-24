import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeSampler, type SamplerPreset } from "@rp/shared";
import { createApp } from "../src/http.ts";

function filledSampler(mark: number): SamplerPreset {
  return normalizeSampler({
    temperature: 0.3 + mark,
    top_p: 0.55,
    top_k: 40 + mark,
    min_p: 0.11,
    typical_p: 0.9,
    tfs: 0.8,
    top_a: 0.2,
    repetition_penalty: 1.15,
    repetition_penalty_range: 256,
    repetition_penalty_slope: 0.4,
    frequency_penalty: 0.3,
    presence_penalty: 0.2,
    mirostat: 2,
    mirostat_tau: 4,
    mirostat_eta: 0.2,
    dynatemp_range: 0.5,
    dynatemp_exponent: 1.2,
    smoothing_factor: 0.3,
    xtc_threshold: 0.1,
    xtc_probability: 0.15,
    nsigma: 1,
    sampler_order: [6, 0, 1],
    seed: 7 + mark,
    max_tokens: 321 + mark,
    stop: mark === 0 ? ["END", "STOP"] : ["STATE"],
    dry_multiplier: 0.4,
    dry_base: 1.9,
    dry_allowed_length: 3,
    dry_penalty_last_n: 128,
    dry_sequence_breakers: ["\n", "—"],
    num_ctx: 4096,
    num_predict: 222,
    num_batch: 128,
    num_gpu: 1,
    num_thread: 4,
    num_keep: 16,
    repeat_last_n: 32,
    penalize_newline: true,
    keep_alive: "5m",
    think: false,
    custom: { note: mark === 0 ? "story" : "state", nested: { lane: mark } },
  });
}

test("restart keeps the model page and presets keep every sampler option", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "rp-agent-model-"));
  const app = createApp(path.join(dir, "test.db"));
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", () => resolve()));
  const port = (app.server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const story = filledSampler(0);
  const state = filledSampler(1);
  try {
    const created = await fetch(`${base}/api/chats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Model", world_id: "world-gate", cast: ["char-mara"], connection_id: "conn-mock" }),
    });
    const chat = (await created.json()) as { id: string };
    const turn = await fetch(`${base}/api/chats/${chat.id}/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "I mention the rain." }),
    });
    await turn.text();
    const saved = await fetch(`${base}/api/chats/${chat.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        connection_id: "conn-ollama",
        model: "custom-model",
        state_connection_id: "conn-mock",
        state_model: "state-model",
        context_tokens: 4096,
        hold_state_updates: true,
        sampler: story,
        state_sampler: state,
      }),
    });
    assert.equal(saved.status, 200);

    const restarted = await fetch(`${base}/api/chats/${chat.id}/restart`, { method: "POST" });
    assert.equal(restarted.status, 200);
    const fresh = (await restarted.json()) as {
      connection_id: string;
      model: string;
      state_connection_id: string;
      state_model: string;
      context_tokens: number;
      hold_state_updates: boolean;
      sampler: SamplerPreset;
      state_sampler: SamplerPreset;
      messages: { content: string }[];
      sheets: { characters: Record<string, { dynamic: { emotion: string } }> };
    };
    assert.equal(fresh.connection_id, "conn-ollama");
    assert.equal(fresh.model, "custom-model");
    assert.equal(fresh.state_connection_id, "conn-mock");
    assert.equal(fresh.state_model, "state-model");
    assert.equal(fresh.context_tokens, 4096);
    assert.equal(fresh.hold_state_updates, true);
    assert.deepEqual(fresh.sampler, story);
    assert.deepEqual(fresh.state_sampler, state);
    assert.deepEqual(fresh.messages.map((message) => message.content), ["You're late. The road has been too quiet."]);
    assert.equal(fresh.sheets.characters["char-mara"]?.dynamic.emotion, "calm");

    const createdPreset = await fetch(`${base}/api/presets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Check story", purpose: "prose", sampler: story }),
    });
    assert.equal(createdPreset.status, 201);
    const storyPreset = (await createdPreset.json()) as { id: string; sampler: SamplerPreset };
    assert.deepEqual(storyPreset.sampler, story);

    const updated = await fetch(`${base}/api/presets/${storyPreset.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sampler: { ...story, temperature: 0.77, custom: { note: "edited", nested: { lane: 9 } } } }),
    });
    assert.equal(updated.status, 200);
    const edited = (await updated.json()) as { sampler: SamplerPreset };
    assert.equal(edited.sampler.temperature, 0.77);
    assert.deepEqual(edited.sampler.stop, ["END", "STOP"]);
    assert.deepEqual(edited.sampler.sampler_order, [6, 0, 1]);
    assert.deepEqual(edited.sampler.dry_sequence_breakers, ["\n", "—"]);
    assert.equal(edited.sampler.penalize_newline, true);
    assert.equal(edited.sampler.think, false);
    assert.deepEqual(edited.sampler.custom, { note: "edited", nested: { lane: 9 } });

    const statePresetResponse = await fetch(`${base}/api/presets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Check state", purpose: "state", sampler: state }),
    });
    assert.equal(statePresetResponse.status, 201);
    const statePreset = (await statePresetResponse.json()) as { id: string; purpose: string; sampler: SamplerPreset };
    assert.equal(statePreset.purpose, "state");
    assert.deepEqual(statePreset.sampler, state);
    const listed = (await (await fetch(`${base}/api/presets`)).json()) as { id: string; sampler: SamplerPreset }[];
    assert.deepEqual(listed.find((preset) => preset.id === statePreset.id)?.sampler, state);
  } finally {
    await new Promise<void>((resolve, reject) => app.server.close((error) => (error ? reject(error) : resolve())));
    app.close();
  }
});
