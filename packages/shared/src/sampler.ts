import { z } from "zod";

export const CONNECTION_KINDS = [
  "spacexai",
  "openai",
  "openrouter",
  "venice",
  "ollama",
  "kobold",
  "openai_extra",
  "mock",
] as const;

export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

export const OLLAMA_ROOT_KEYS = new Set([
  "think",
  "keep_alive",
  "format",
  "logprobs",
  "top_logprobs",
]);

const stringList = z.array(z.string());
const numberList = z.array(z.number());

export const samplerSchema = z.object({
  temperature: z.number(),
  top_p: z.number(),
  top_k: z.number().int(),
  min_p: z.number(),
  typical_p: z.number(),
  tfs: z.number(),
  top_a: z.number(),
  repetition_penalty: z.number(),
  repetition_penalty_range: z.number().int(),
  repetition_penalty_slope: z.number(),
  frequency_penalty: z.number(),
  presence_penalty: z.number(),
  mirostat: z.number().int(),
  mirostat_tau: z.number(),
  mirostat_eta: z.number(),
  dynatemp_range: z.number(),
  dynatemp_exponent: z.number(),
  smoothing_factor: z.number(),
  xtc_threshold: z.number(),
  xtc_probability: z.number(),
  nsigma: z.number(),
  sampler_order: numberList,
  seed: z.number().int(),
  max_tokens: z.number().int(),
  stop: stringList,
  dry_multiplier: z.number(),
  dry_base: z.number(),
  dry_allowed_length: z.number().int(),
  dry_penalty_last_n: z.number().int(),
  dry_sequence_breakers: stringList,
  num_ctx: z.number().int(),
  num_predict: z.number().int(),
  num_batch: z.number().int(),
  num_gpu: z.number().int(),
  num_thread: z.number().int(),
  num_keep: z.number().int(),
  repeat_last_n: z.number().int(),
  penalize_newline: z.boolean(),
  keep_alive: z.string(),
  think: z.boolean().nullable(),
  custom: z.record(z.string(), z.unknown()),
});

export type SamplerPreset = z.infer<typeof samplerSchema>;

export const SAMPLER_FIELDS = [
  "temperature",
  "top_p",
  "top_k",
  "min_p",
  "typical_p",
  "tfs",
  "top_a",
  "repetition_penalty",
  "repetition_penalty_range",
  "repetition_penalty_slope",
  "frequency_penalty",
  "presence_penalty",
  "mirostat",
  "mirostat_tau",
  "mirostat_eta",
  "dynatemp_range",
  "dynatemp_exponent",
  "smoothing_factor",
  "xtc_threshold",
  "xtc_probability",
  "nsigma",
  "sampler_order",
  "seed",
  "max_tokens",
  "stop",
  "dry_multiplier",
  "dry_base",
  "dry_allowed_length",
  "dry_penalty_last_n",
  "dry_sequence_breakers",
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
] as const satisfies readonly (keyof SamplerPreset)[];

export type SamplerFieldKey = (typeof SAMPLER_FIELDS)[number];

export type FieldWidget = "number" | "int" | "bool" | "think" | "lines" | "ints" | "text";

export type SamplerFieldMeta = {
  key: SamplerFieldKey;
  label: string;
  group: "common" | "dry" | "ollama";
  widget: FieldWidget;
  step?: number;
  help?: string;
  /** Kinds that send this form field without the extra-sampler switch. */
  sends: ConnectionKind[];
  /** Also sent on OpenAI-compatible servers when extra samplers are enabled. */
  sendsWhenExtra: boolean;
};

const KOBOLD: ConnectionKind[] = ["kobold"];
const OLLAMA: ConnectionKind[] = ["ollama"];
const BOTH: ConnectionKind[] = ["kobold", "ollama"];
const API: ConnectionKind[] = ["spacexai", "openai", "openai_extra", "openrouter", "venice"];
const ALL: ConnectionKind[] = [...API, "kobold", "ollama"];

/** OpenAI Chat Completions hosts, including SpaceXAI, OpenRouter, and Venice. */
export function isChatCompletionKind(kind: ConnectionKind): boolean {
  return API.includes(kind);
}

export const SAMPLER_FIELD_META: SamplerFieldMeta[] = [
  { key: "temperature", label: "Temperature", group: "common", widget: "number", step: 0.05, sends: ALL, sendsWhenExtra: false },
  { key: "top_p", label: "Top p", group: "common", widget: "number", step: 0.01, sends: ALL, sendsWhenExtra: false },
  { key: "top_k", label: "Top k", group: "common", widget: "int", help: "0 disables it on KoboldCPP.", sends: BOTH, sendsWhenExtra: true },
  { key: "min_p", label: "Min p", group: "common", widget: "number", step: 0.01, sends: BOTH, sendsWhenExtra: true },
  { key: "typical_p", label: "Typical p", group: "common", widget: "number", step: 0.01, sends: BOTH, sendsWhenExtra: true },
  { key: "tfs", label: "TFS", group: "common", widget: "number", step: 0.01, sends: BOTH, sendsWhenExtra: true },
  { key: "top_a", label: "Top a", group: "common", widget: "number", step: 0.01, sends: KOBOLD, sendsWhenExtra: true },
  { key: "repetition_penalty", label: "Repetition penalty", group: "common", widget: "number", step: 0.01, sends: BOTH, sendsWhenExtra: true },
  { key: "repetition_penalty_range", label: "Repetition range", group: "common", widget: "int", sends: KOBOLD, sendsWhenExtra: true },
  { key: "repetition_penalty_slope", label: "Repetition slope", group: "common", widget: "number", step: 0.01, sends: KOBOLD, sendsWhenExtra: true },
  { key: "frequency_penalty", label: "Frequency penalty", group: "common", widget: "number", step: 0.01, sends: [...API, ...BOTH], sendsWhenExtra: false },
  { key: "presence_penalty", label: "Presence penalty", group: "common", widget: "number", step: 0.01, sends: [...API, ...BOTH], sendsWhenExtra: false },
  { key: "mirostat", label: "Mirostat", group: "common", widget: "int", help: "0 off, 1 or 2 select the mode.", sends: BOTH, sendsWhenExtra: true },
  { key: "mirostat_tau", label: "Mirostat tau", group: "common", widget: "number", step: 0.1, sends: BOTH, sendsWhenExtra: true },
  { key: "mirostat_eta", label: "Mirostat eta", group: "common", widget: "number", step: 0.01, sends: BOTH, sendsWhenExtra: true },
  { key: "dynatemp_range", label: "Dynamic temperature range", group: "common", widget: "number", step: 0.05, sends: KOBOLD, sendsWhenExtra: true },
  { key: "dynatemp_exponent", label: "Dynamic temperature exponent", group: "common", widget: "number", step: 0.05, sends: KOBOLD, sendsWhenExtra: true },
  { key: "smoothing_factor", label: "Smoothing", group: "common", widget: "number", step: 0.01, sends: KOBOLD, sendsWhenExtra: true },
  { key: "xtc_threshold", label: "XTC threshold", group: "common", widget: "number", step: 0.01, sends: KOBOLD, sendsWhenExtra: true },
  { key: "xtc_probability", label: "XTC probability", group: "common", widget: "number", step: 0.01, sends: KOBOLD, sendsWhenExtra: true },
  { key: "nsigma", label: "N-sigma", group: "common", widget: "number", step: 0.01, sends: KOBOLD, sendsWhenExtra: true },
  { key: "sampler_order", label: "Sampler order", group: "common", widget: "ints", help: "KoboldCPP sampler indexes, comma-separated. Empty uses the server default.", sends: KOBOLD, sendsWhenExtra: true },
  { key: "seed", label: "Seed", group: "common", widget: "int", help: "-1 omits the seed.", sends: ALL, sendsWhenExtra: false },
  { key: "max_tokens", label: "Max tokens", group: "common", widget: "int", help: "Ollama uses num_predict instead.", sends: [...API, "kobold"], sendsWhenExtra: false },
  { key: "stop", label: "Stop sequences", group: "common", widget: "lines", sends: ALL, sendsWhenExtra: false },
  { key: "dry_multiplier", label: "DRY multiplier", group: "dry", widget: "number", step: 0.05, help: "0 turns DRY off.", sends: KOBOLD, sendsWhenExtra: true },
  { key: "dry_base", label: "DRY base", group: "dry", widget: "number", step: 0.05, sends: KOBOLD, sendsWhenExtra: true },
  { key: "dry_allowed_length", label: "DRY allowed length", group: "dry", widget: "int", sends: KOBOLD, sendsWhenExtra: true },
  { key: "dry_penalty_last_n", label: "DRY penalty range", group: "dry", widget: "int", help: "0 scans the whole context.", sends: KOBOLD, sendsWhenExtra: true },
  { key: "dry_sequence_breakers", label: "DRY sequence breakers", group: "dry", widget: "lines", sends: KOBOLD, sendsWhenExtra: true },
  { key: "num_ctx", label: "num_ctx", group: "ollama", widget: "int", help: "Ollama context length. The chat context budget is what gets sent.", sends: OLLAMA, sendsWhenExtra: false },
  { key: "num_predict", label: "num_predict", group: "ollama", widget: "int", sends: OLLAMA, sendsWhenExtra: false },
  { key: "num_batch", label: "num_batch", group: "ollama", widget: "int", sends: OLLAMA, sendsWhenExtra: false },
  { key: "num_gpu", label: "num_gpu", group: "ollama", widget: "int", help: "-1 lets Ollama choose.", sends: OLLAMA, sendsWhenExtra: false },
  { key: "num_thread", label: "num_thread", group: "ollama", widget: "int", sends: OLLAMA, sendsWhenExtra: false },
  { key: "num_keep", label: "num_keep", group: "ollama", widget: "int", sends: OLLAMA, sendsWhenExtra: false },
  { key: "repeat_last_n", label: "repeat_last_n", group: "ollama", widget: "int", sends: OLLAMA, sendsWhenExtra: false },
  { key: "penalize_newline", label: "penalize_newline", group: "ollama", widget: "bool", sends: OLLAMA, sendsWhenExtra: false },
  { key: "keep_alive", label: "keep_alive", group: "ollama", widget: "text", help: "How long Ollama keeps the model loaded, for example 10m or 0.", sends: OLLAMA, sendsWhenExtra: false },
  { key: "think", label: "think", group: "ollama", widget: "think", help: "Default omits the field and lets the model decide.", sends: OLLAMA, sendsWhenExtra: false },
];

export function defaultSampler(): SamplerPreset {
  return {
    temperature: 1,
    top_p: 1,
    top_k: 0,
    min_p: 0.05,
    typical_p: 1,
    tfs: 1,
    top_a: 0,
    repetition_penalty: 1,
    repetition_penalty_range: 1024,
    repetition_penalty_slope: 0,
    frequency_penalty: 0,
    presence_penalty: 0,
    mirostat: 0,
    mirostat_tau: 5,
    mirostat_eta: 0.1,
    dynatemp_range: 0,
    dynatemp_exponent: 1,
    smoothing_factor: 0,
    xtc_threshold: 0,
    xtc_probability: 0,
    nsigma: 0,
    sampler_order: [],
    seed: -1,
    max_tokens: 400,
    stop: [],
    dry_multiplier: 0.8,
    dry_base: 1.75,
    dry_allowed_length: 2,
    dry_penalty_last_n: 0,
    dry_sequence_breakers: ["\n", ":", '"', "*"],
    num_ctx: 8192,
    num_predict: 400,
    num_batch: 512,
    num_gpu: -1,
    num_thread: 0,
    num_keep: 0,
    repeat_last_n: 64,
    penalize_newline: false,
    keep_alive: "10m",
    think: null,
    custom: {},
  };
}

export function defaultStateSampler(): SamplerPreset {
  return {
    ...defaultSampler(),
    temperature: 0.2,
    top_p: 1,
    top_k: 0,
    min_p: 0,
    dry_multiplier: 0,
    repetition_penalty: 1,
    max_tokens: 800,
    num_predict: 800,
  };
}

export function fieldIsSent(meta: SamplerFieldMeta, kind: ConnectionKind, extraSamplers: boolean): boolean {
  if (kind === "mock") return false;
  if (meta.sends.includes(kind)) return true;
  if (extraSamplers && meta.sendsWhenExtra && isChatCompletionKind(kind)) {
    return true;
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeSampler(input: unknown): SamplerPreset {
  const base = defaultSampler();
  if (!isRecord(input)) return base;
  const merged: Record<string, unknown> = { ...base, ...input, custom: isRecord(input.custom) ? input.custom : {} };
  const parsed = samplerSchema.safeParse(merged);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => `${issue.path.join(".") || "sampler"}: ${issue.message}`).join("; "));
  }
  return parsed.data;
}

export function outputReserve(sampler: SamplerPreset, kind: ConnectionKind): number {
  const raw = kind === "ollama" ? sampler.num_predict : sampler.max_tokens;
  return Math.max(1, raw);
}
