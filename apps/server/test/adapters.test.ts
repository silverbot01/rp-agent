import assert from "node:assert/strict";
import test from "node:test";
import { SAMPLER_FIELD_META, buildChatBody, chatUrl, defaultSampler, fieldIsSent, modelsUrl, type SamplerPreset } from "@rp/shared";

const messages = [{ role: "user" as const, content: "hello" }];

function preset(patch: Partial<SamplerPreset> = {}): SamplerPreset {
  return { ...defaultSampler(), top_k: 40, ...patch, custom: patch.custom ?? {} };
}

test("Ollama body maps native options and leaves DRY off the request", () => {
  const built = buildChatBody({
    kind: "ollama",
    model: "demo",
    extraSamplers: false,
    sampler: preset(),
    messages,
    prompt: "prompt",
    contextTokens: 4096,
    stream: true,
  });
  const options = built.body.options as Record<string, unknown>;
  assert.equal(options.temperature, 1);
  assert.equal(options.top_k, 40);
  assert.equal(options.min_p, 0.05);
  assert.equal(options.num_ctx, 4096);
  assert.equal(options.repeat_penalty, 1);
  assert.equal("dry_multiplier" in options, false);
  assert.equal(built.body.keep_alive, "10m");
  assert.equal(built.applied.includes("dry_multiplier"), false);
  assert.equal(built.dropped.includes("dry_multiplier"), true);
  assert.equal(built.applied.includes("num_ctx"), true);
});

test("Ollama custom JSON overrides options and root fields", () => {
  const built = buildChatBody({
    kind: "ollama",
    model: "demo",
    extraSamplers: false,
    sampler: preset({ custom: { temperature: 0.1, keep_alive: "0", dry_multiplier: 1.2 } }),
    messages,
    prompt: "prompt",
    contextTokens: 2048,
    stream: false,
  });
  const options = built.body.options as Record<string, unknown>;
  assert.equal(options.temperature, 0.1);
  assert.equal(options.dry_multiplier, 1.2);
  assert.equal(built.body.keep_alive, "0");
  assert.equal(built.applied.includes("custom.temperature"), true);
  assert.equal(built.applied.includes("custom.keep_alive"), true);
});

test("KoboldCPP body includes DRY fields and custom JSON wins", () => {
  const sampler = preset({
    dry_multiplier: 0.8,
    dry_base: 1.75,
    dry_allowed_length: 2,
    dry_penalty_last_n: 0,
    dry_sequence_breakers: ["\n", ":"],
    custom: { dry_multiplier: 1.5 },
  });
  const built = buildChatBody({
    kind: "kobold",
    model: "demo",
    extraSamplers: false,
    sampler,
    messages,
    prompt: "Narrator:",
    contextTokens: 8192,
    stream: true,
  });
  assert.equal(built.body.dry_multiplier, 1.5);
  assert.equal(built.body.dry_base, 1.75);
  assert.equal(built.body.dry_allowed_length, 2);
  assert.equal(built.body.dry_penalty_last_n, 0);
  assert.deepEqual(built.body.dry_sequence_breakers, ["\n", ":"]);
  assert.equal(built.body.rep_pen, 1);
  assert.equal(built.body.typical, 1);
  assert.equal(built.body.max_context_length, 8192);
  assert.equal(built.applied.includes("dry_multiplier"), true);
});

test("SpaceXAI body keeps the standard chat fields only", () => {
  const built = buildChatBody({
    kind: "spacexai",
    model: "grok-4.7",
    extraSamplers: false,
    sampler: preset({ custom: { top_k: 20, temperature: 0.2 } }),
    messages,
    prompt: "prompt",
    contextTokens: 8192,
    stream: true,
  });
  assert.deepEqual(Object.keys(built.body).sort(), [
    "frequency_penalty",
    "max_tokens",
    "messages",
    "model",
    "presence_penalty",
    "stream",
    "temperature",
    "top_p",
  ]);
  assert.equal(built.body.temperature, 1);
  assert.equal(built.dropped.includes("custom.top_k"), true);
  assert.equal(built.dropped.includes("dry_multiplier"), true);
  assert.equal(built.dropped.includes("top_k"), true);
});

test("OpenAI-compatible custom JSON merges even when extra samplers are off", () => {
  const built = buildChatBody({
    kind: "openai",
    model: "demo",
    extraSamplers: false,
    sampler: preset({ custom: { top_k: 20 } }),
    messages,
    prompt: "prompt",
    contextTokens: 8192,
    stream: false,
  });
  assert.equal(built.body.top_k, 20);
  assert.equal("dry_multiplier" in built.body, false);
});

test("OpenRouter and Venice send standard chat fields and custom JSON", () => {
  const openrouter = buildChatBody({
    kind: "openrouter",
    model: "author/slug",
    extraSamplers: false,
    sampler: preset({ custom: { provider: { order: ["together"] } } }),
    messages,
    prompt: "prompt",
    contextTokens: 8192,
    stream: true,
  });
  assert.equal(openrouter.body.model, "author/slug");
  assert.equal(openrouter.body.temperature, 1);
  assert.equal(openrouter.body.max_tokens, defaultSampler().max_tokens);
  assert.deepEqual(openrouter.body.provider, { order: ["together"] });
  assert.equal("dry_multiplier" in openrouter.body, false);
  assert.equal(openrouter.applied.includes("custom.provider"), true);
  assert.equal(chatUrl("openrouter", "https://openrouter.ai/api/v1", true), "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(modelsUrl("openrouter", "https://openrouter.ai/api/v1"), "https://openrouter.ai/api/v1/models");

  const venice = buildChatBody({
    kind: "venice",
    model: "",
    extraSamplers: false,
    sampler: preset({ custom: { venice_parameters: { include_venice_system_prompt: false } } }),
    messages,
    prompt: "prompt",
    contextTokens: 8192,
    stream: false,
  });
  assert.equal(venice.body.temperature, 1);
  assert.equal(venice.body.top_p, 1);
  assert.equal(venice.body.frequency_penalty, 0);
  assert.equal(venice.body.presence_penalty, 0);
  assert.deepEqual(venice.body.venice_parameters, { include_venice_system_prompt: false });
  assert.equal("dry_multiplier" in venice.body, false);
  assert.equal("top_k" in venice.body, false);
  assert.equal(venice.applied.includes("custom.venice_parameters"), true);
  assert.equal(chatUrl("venice", "https://api.venice.ai/api/v1/", false), "https://api.venice.ai/api/v1/chat/completions");
  assert.equal(modelsUrl("venice", "https://api.venice.ai/api/v1"), "https://api.venice.ai/api/v1/models");

  const temperature = SAMPLER_FIELD_META.find((field) => field.key === "temperature");
  const dry = SAMPLER_FIELD_META.find((field) => field.key === "dry_multiplier");
  assert.ok(temperature);
  assert.ok(dry);
  assert.equal(fieldIsSent(temperature, "openrouter", false), true);
  assert.equal(fieldIsSent(temperature, "venice", false), true);
  assert.equal(fieldIsSent(dry, "venice", false), false);
  assert.equal(fieldIsSent(dry, "openrouter", false), false);
  assert.equal(fieldIsSent(dry, "venice", true), true);
});

test("extra samplers send DRY on an OpenAI-compatible server", () => {
  const built = buildChatBody({
    kind: "openai_extra",
    model: "local",
    extraSamplers: true,
    sampler: preset({ dry_multiplier: 0.8 }),
    messages,
    prompt: "prompt",
    contextTokens: 8192,
    stream: true,
  });
  assert.equal(built.body.dry_multiplier, 0.8);
  assert.equal(built.applied.includes("dry_multiplier"), true);
});
