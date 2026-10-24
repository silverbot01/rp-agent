import {
  OLLAMA_ROOT_KEYS,
  SAMPLER_FIELDS,
  isChatCompletionKind,
  type ConnectionKind,
  type SamplerFieldKey,
  type SamplerPreset,
} from "./sampler.ts";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type SamplerBuild = {
  body: Record<string, unknown>;
  applied: string[];
  dropped: string[];
};

export type BuildInput = {
  kind: ConnectionKind;
  model: string;
  extraSamplers: boolean;
  sampler: SamplerPreset;
  messages: ChatMessage[];
  prompt: string;
  contextTokens: number;
  stream: boolean;
};

const OPENAI_STANDARD = new Set<SamplerFieldKey>([
  "temperature",
  "top_p",
  "frequency_penalty",
  "presence_penalty",
  "max_tokens",
  "stop",
  "seed",
]);

function customKeys(sampler: SamplerPreset): string[] {
  return Object.keys(sampler.custom);
}

function mark(applied: string[], dropped: string[], field: SamplerFieldKey, sent: boolean) {
  if (sent) applied.push(field);
  else dropped.push(field);
}

function assignCustom(
  target: Record<string, unknown>,
  custom: Record<string, unknown>,
  applied: string[],
  dropped: string[],
  allow: boolean,
) {
  for (const key of Object.keys(custom)) {
    if (!allow) {
      dropped.push(`custom.${key}`);
      continue;
    }
    target[key] = custom[key];
    applied.push(`custom.${key}`);
  }
}

export function buildChatBody(input: BuildInput): SamplerBuild {
  if (input.kind === "ollama") return buildOllama(input);
  if (input.kind === "kobold") return buildKobold(input);
  if (input.kind === "mock") {
    return {
      body: { model: input.model || "mock", messages: input.messages },
      applied: [],
      dropped: [...SAMPLER_FIELDS, ...customKeys(input.sampler).map((key) => `custom.${key}`)],
    };
  }
  return buildOpenAI(input);
}

function buildOpenAI(input: BuildInput): SamplerBuild {
  const { sampler, kind, extraSamplers } = input;
  const applied: string[] = [];
  const dropped: string[] = [];
  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
    stream: input.stream,
    temperature: sampler.temperature,
    top_p: sampler.top_p,
    frequency_penalty: sampler.frequency_penalty,
    presence_penalty: sampler.presence_penalty,
    max_tokens: sampler.max_tokens,
  };
  if (sampler.stop.length > 0) body.stop = sampler.stop;
  if (sampler.seed >= 0) body.seed = sampler.seed;

  const sendExtra = extraSamplers && isChatCompletionKind(kind);
  if (sendExtra) Object.assign(body, koboldSamplerFields(sampler, input.contextTokens, false));

  for (const field of SAMPLER_FIELDS) {
    const standard = OPENAI_STANDARD.has(field);
    const extraField = sendExtra && !standard && koboldFieldNames(field) !== null;
    mark(applied, dropped, field, standard || extraField);
  }

  // SpaceXAI drops custom JSON until extra samplers are on. OpenRouter and Venice always merge it.
  const allowCustom = kind === "openai" || kind === "openai_extra" || kind === "openrouter" || kind === "venice" || sendExtra;
  assignCustom(body, sampler.custom, applied, dropped, allowCustom);
  return { body, applied, dropped };
}

function buildOllama(input: BuildInput): SamplerBuild {
  const { sampler } = input;
  const applied: string[] = [];
  const dropped: string[] = [];
  const options: Record<string, unknown> = {
    temperature: sampler.temperature,
    top_p: sampler.top_p,
    min_p: sampler.min_p,
    typical_p: sampler.typical_p,
    tfs_z: sampler.tfs,
    repeat_penalty: sampler.repetition_penalty,
    presence_penalty: sampler.presence_penalty,
    frequency_penalty: sampler.frequency_penalty,
    mirostat: sampler.mirostat,
    mirostat_tau: sampler.mirostat_tau,
    mirostat_eta: sampler.mirostat_eta,
    num_ctx: input.contextTokens,
    num_predict: sampler.num_predict,
    num_batch: sampler.num_batch,
    num_gpu: sampler.num_gpu,
    num_thread: sampler.num_thread,
    num_keep: sampler.num_keep,
    repeat_last_n: sampler.repeat_last_n,
    penalize_newline: sampler.penalize_newline,
  };
  if (sampler.top_k > 0) options.top_k = sampler.top_k;
  if (sampler.seed >= 0) options.seed = sampler.seed;
  if (sampler.stop.length > 0) options.stop = sampler.stop;

  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
    stream: input.stream,
    options,
  };
  if (sampler.think !== null) body.think = sampler.think;
  if (sampler.keep_alive.trim()) body.keep_alive = sampler.keep_alive.trim();

  const sent = new Set<SamplerFieldKey>([
    "temperature",
    "top_p",
    "top_k",
    "min_p",
    "typical_p",
    "tfs",
    "repetition_penalty",
    "frequency_penalty",
    "presence_penalty",
    "mirostat",
    "mirostat_tau",
    "mirostat_eta",
    "seed",
    "stop",
    "num_ctx",
    "num_predict",
    "num_batch",
    "num_gpu",
    "num_thread",
    "num_keep",
    "repeat_last_n",
    "penalize_newline",
    "keep_alive",
    "think",
  ]);
  for (const field of SAMPLER_FIELDS) mark(applied, dropped, field, sent.has(field));

  const rootCustom: Record<string, unknown> = {};
  const optionCustom: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(sampler.custom)) {
    if (OLLAMA_ROOT_KEYS.has(key)) rootCustom[key] = value;
    else optionCustom[key] = value;
    applied.push(`custom.${key}`);
  }
  Object.assign(options, optionCustom);
  Object.assign(body, rootCustom);
  return { body, applied, dropped };
}

function buildKobold(input: BuildInput): SamplerBuild {
  const { sampler } = input;
  const applied: string[] = [];
  const dropped: string[] = [];
  const body: Record<string, unknown> = {
    prompt: input.prompt,
    ...koboldSamplerFields(sampler, input.contextTokens, true),
  };
  const sent = new Set<SamplerFieldKey>(SAMPLER_FIELDS.filter((field) => koboldFieldNames(field) !== null));
  for (const field of SAMPLER_FIELDS) mark(applied, dropped, field, sent.has(field));
  assignCustom(body, sampler.custom, applied, dropped, true);
  return { body, applied, dropped };
}

/** KoboldCPP native names. `includeLength` adds max_length and max_context_length. */
function koboldSamplerFields(sampler: SamplerPreset, contextTokens: number, includeLength: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    temperature: sampler.temperature,
    top_p: sampler.top_p,
    top_k: sampler.top_k,
    top_a: sampler.top_a,
    min_p: sampler.min_p,
    typical: sampler.typical_p,
    tfs: sampler.tfs,
    rep_pen: sampler.repetition_penalty,
    rep_pen_range: sampler.repetition_penalty_range,
    rep_pen_slope: sampler.repetition_penalty_slope,
    frequency_penalty: sampler.frequency_penalty,
    presence_penalty: sampler.presence_penalty,
    mirostat: sampler.mirostat,
    mirostat_tau: sampler.mirostat_tau,
    mirostat_eta: sampler.mirostat_eta,
    dynatemp_range: sampler.dynatemp_range,
    dynatemp_exponent: sampler.dynatemp_exponent,
    smoothing_factor: sampler.smoothing_factor,
    dry_multiplier: sampler.dry_multiplier,
    dry_base: sampler.dry_base,
    dry_allowed_length: sampler.dry_allowed_length,
    dry_penalty_last_n: sampler.dry_penalty_last_n,
    dry_sequence_breakers: sampler.dry_sequence_breakers,
    xtc_threshold: sampler.xtc_threshold,
    xtc_probability: sampler.xtc_probability,
    nsigma: sampler.nsigma,
  };
  if (sampler.sampler_order.length > 0) body.sampler_order = sampler.sampler_order;
  if (sampler.stop.length > 0) body.stop_sequence = sampler.stop;
  if (sampler.seed >= 0) body.seed = sampler.seed;
  if (includeLength) {
    body.max_length = sampler.max_tokens;
    body.max_context_length = contextTokens;
  }
  return body;
}

function koboldFieldNames(field: SamplerFieldKey): string | null {
  const map: Partial<Record<SamplerFieldKey, string>> = {
    temperature: "temperature",
    top_p: "top_p",
    top_k: "top_k",
    min_p: "min_p",
    typical_p: "typical",
    tfs: "tfs",
    top_a: "top_a",
    repetition_penalty: "rep_pen",
    repetition_penalty_range: "rep_pen_range",
    repetition_penalty_slope: "rep_pen_slope",
    frequency_penalty: "frequency_penalty",
    presence_penalty: "presence_penalty",
    mirostat: "mirostat",
    mirostat_tau: "mirostat_tau",
    mirostat_eta: "mirostat_eta",
    dynatemp_range: "dynatemp_range",
    dynatemp_exponent: "dynatemp_exponent",
    smoothing_factor: "smoothing_factor",
    xtc_threshold: "xtc_threshold",
    xtc_probability: "xtc_probability",
    nsigma: "nsigma",
    sampler_order: "sampler_order",
    seed: "seed",
    max_tokens: "max_length",
    stop: "stop_sequence",
    dry_multiplier: "dry_multiplier",
    dry_base: "dry_base",
    dry_allowed_length: "dry_allowed_length",
    dry_penalty_last_n: "dry_penalty_last_n",
    dry_sequence_breakers: "dry_sequence_breakers",
  };
  return map[field] ?? null;
}

const SECRET_KEYS = new Set(["api_key", "apiKey", "authorization", "Authorization"]);

export function redactBody(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactBody(item));
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = SECRET_KEYS.has(key) ? "[redacted]" : redactBody(inner);
    }
    return out;
  }
  return value;
}

export function joinUrl(base: string, suffix: string): string {
  const trimmed = base.replace(/\/+$/, "");
  if (trimmed.endsWith(suffix)) return trimmed;
  return trimmed + suffix;
}

export function chatUrl(kind: ConnectionKind, baseUrl: string, stream: boolean): string {
  if (kind === "ollama") return joinUrl(baseUrl, "/api/chat");
  if (kind === "kobold") {
    return joinUrl(baseUrl, stream ? "/api/extra/generate/stream" : "/api/v1/generate");
  }
  return joinUrl(baseUrl, "/chat/completions");
}

export function modelsUrl(kind: ConnectionKind, baseUrl: string): string {
  if (kind === "ollama") return joinUrl(baseUrl, "/api/tags");
  if (kind === "kobold") return joinUrl(baseUrl, "/api/v1/model");
  return joinUrl(baseUrl, "/models");
}

export function embeddingsUrl(kind: ConnectionKind, baseUrl: string): string {
  if (kind === "ollama") return joinUrl(baseUrl, "/api/embed");
  return joinUrl(baseUrl, "/embeddings");
}
