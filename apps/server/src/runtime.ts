import {
  STATE_JSON_SCHEMA,
  buildChatBody,
  chatUrl,
  embeddingsUrl,
  joinUrl,
  mockVector,
  modelsUrl,
  type ChatMessage,
  type ConnectionKind,
  type SamplerPreset,
} from "@rp/shared";
import type { ChatSheets } from "@rp/shared";
import { mockStatePatch } from "@rp/shared";
import { AbortedError, HttpError } from "./errors.ts";

export type Usage = {
  promptTokens?: number;
  completionTokens?: number;
  streamFallback?: boolean;
};

type CallInput = {
  kind: ConnectionKind;
  baseUrl: string;
  apiKey: string | null;
  model: string;
  extraSamplers: boolean;
  sampler: SamplerPreset;
  messages: ChatMessage[];
  prompt: string;
  contextTokens: number;
  signal?: AbortSignal;
};

function headers(apiKey: string | null): Record<string, string> {
  const result: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) result.Authorization = `Bearer ${apiKey}`;
  return result;
}

function asAbort(error: unknown, signal?: AbortSignal): never {
  if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw new AbortedError();
  throw new HttpError(502, error instanceof Error ? error.message : "The model server did not respond.");
}

async function providerError(response: Response): Promise<HttpError> {
  let detail = "";
  try {
    detail = (await response.text()).slice(0, 600);
  } catch {
    detail = response.statusText;
  }
  return new HttpError(502, `Model server returned ${response.status}. ${detail}`.trim());
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (typeof part === "object" && part && "text" in part && typeof (part as { text: unknown }).text === "string") {
        return (part as { text: string }).text;
      }
      return "";
    })
    .join("");
}

function mockProse(messages: ChatMessage[]): string {
  const user = [...messages].reverse().find((message) => message.role === "user");
  const line = (user?.content ?? "").trim().replace(/\s+/g, " ").slice(0, 280);
  return `The wind shifts on the road. ${line ? `What was said hangs in the air: ${line}` : "Nobody speaks."} Rain finds the timber of the gate.`;
}

export async function listModelIds(kind: ConnectionKind, baseUrl: string, apiKey: string | null, signal?: AbortSignal): Promise<string[]> {
  if (kind === "mock") return ["mock"];
  let response: Response;
  try {
    response = await fetch(modelsUrl(kind, baseUrl), { headers: headers(apiKey), signal });
  } catch (error) {
    asAbort(error, signal);
  }
  if (!response.ok) throw await providerError(response);
  const body = (await response.json()) as Record<string, unknown>;
  if (kind === "ollama") {
    const models = Array.isArray(body.models) ? body.models : [];
    return models
      .map((model) => (typeof model === "object" && model && "name" in model ? String((model as { name: unknown }).name) : ""))
      .filter(Boolean);
  }
  if (kind === "kobold") {
    const name = typeof body.result === "string" ? body.result : "";
    return name ? [name] : [];
  }
  const data = Array.isArray(body.data) ? body.data : [];
  return data
    .map((model) => (typeof model === "object" && model && "id" in model ? String((model as { id: unknown }).id) : ""))
    .filter(Boolean);
}

export async function streamProse(input: CallInput, onToken: (text: string) => void): Promise<Usage> {
  if (input.signal?.aborted) throw new AbortedError();
  if (input.kind === "mock") {
    const text = mockProse(input.messages);
    const parts = text.match(/\S+\s*/g) ?? [text];
    for (const part of parts) {
      if (input.signal?.aborted) throw new AbortedError();
      onToken(part);
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    return { promptTokens: Math.ceil(input.prompt.length / 4), completionTokens: Math.ceil(text.length / 4) };
  }
  const built = buildChatBody({ ...input, stream: true });
  const url = chatUrl(input.kind, input.baseUrl, true);
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", headers: headers(input.apiKey), body: JSON.stringify(built.body), signal: input.signal });
  } catch (error) {
    asAbort(error, input.signal);
  }
  if (input.kind === "kobold" && response.status === 404) {
    const fallback = buildChatBody({ ...input, stream: false });
    let second: Response;
    try {
      second = await fetch(chatUrl(input.kind, input.baseUrl, false), {
        method: "POST",
        headers: headers(input.apiKey),
        body: JSON.stringify(fallback.body),
        signal: input.signal,
      });
    } catch (error) {
      asAbort(error, input.signal);
    }
    if (!second.ok) throw await providerError(second);
    const body = (await second.json()) as { results?: { text?: string }[] };
    const text = body.results?.[0]?.text ?? "";
    if (text) onToken(text);
    return { streamFallback: true, completionTokens: Math.ceil(text.length / 4) };
  }
  if (!response.ok) throw await providerError(response);
  return readStream(input.kind, response, onToken, input.signal);
}

async function readStream(kind: ConnectionKind, response: Response, onToken: (text: string) => void, signal?: AbortSignal): Promise<Usage> {
  const reader = response.body?.getReader();
  if (!reader) throw new HttpError(502, "The model server returned an empty stream.");
  const decoder = new TextDecoder();
  let buffer = "";
  const usage: Usage = {};
  const consume = async (line: string) => {
    const trimmed = line.replace(/\r$/, "");
    if (!trimmed || trimmed.startsWith("event:") || trimmed.startsWith(":")) return;
    const payload = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
    if (!payload || payload === "[DONE]") return;
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return;
    }
    if (kind === "ollama") {
      const message = json.message as { content?: unknown } | undefined;
      const token = textOf(message?.content);
      if (token) {
        onToken(token);
        await new Promise((resolve) => setImmediate(resolve));
      }
      if (json.done === true) {
        if (typeof json.prompt_eval_count === "number") usage.promptTokens = json.prompt_eval_count;
        if (typeof json.eval_count === "number") usage.completionTokens = json.eval_count;
      }
      return;
    }
    if (kind === "kobold") {
      const token = typeof json.token === "string" ? json.token : "";
      if (token) {
        onToken(token);
        await new Promise((resolve) => setImmediate(resolve));
      }
      return;
    }
    const choices = Array.isArray(json.choices) ? json.choices : [];
    const choice = choices[0] as { delta?: { content?: unknown }; message?: { content?: unknown } } | undefined;
    const token = textOf(choice?.delta?.content ?? choice?.message?.content);
    if (token) {
      onToken(token);
      await new Promise((resolve) => setImmediate(resolve));
    }
    const reported = json.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    if (reported?.prompt_tokens) usage.promptTokens = reported.prompt_tokens;
    if (reported?.completion_tokens) usage.completionTokens = reported.completion_tokens;
  };
  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel();
        throw new AbortedError();
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        await consume(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf("\n");
      }
    }
    if (buffer.trim()) await consume(buffer);
  } catch (error) {
    if (error instanceof AbortedError) throw error;
    asAbort(error, signal);
  }
  return usage;
}

export async function completeText(input: CallInput & { purpose: "state"; sheets: ChatSheets }): Promise<{ text: string; promptTokens?: number }> {
  if (input.signal?.aborted) throw new AbortedError();
  if (input.kind === "mock") {
    return { text: JSON.stringify(mockStatePatch(input.sheets)) };
  }
  const send = async (body: Record<string, unknown>, streamPath: boolean) => {
    try {
      return await fetch(chatUrl(input.kind, input.baseUrl, streamPath), {
        method: "POST",
        headers: headers(input.apiKey),
        body: JSON.stringify(body),
        signal: input.signal,
      });
    } catch (error) {
      asAbort(error, input.signal);
    }
  };
  let built = buildChatBody({ ...input, stream: false });
  if (input.kind === "ollama") built.body.format = STATE_JSON_SCHEMA;
  if (input.kind === "spacexai" || input.kind === "openai" || input.kind === "openai_extra") {
    built.body.response_format = {
      type: "json_schema",
      json_schema: { name: "state_patch", strict: false, schema: STATE_JSON_SCHEMA },
    };
  }
  let response = await send(built.body, false);
  if (!response.ok && response.status === 400 && (input.kind === "spacexai" || input.kind === "openai" || input.kind === "openai_extra")) {
    built = buildChatBody({ ...input, stream: false });
    built.body.response_format = { type: "json_object" };
    response = await send(built.body, false);
  }
  if (!response.ok) throw await providerError(response);
  const json = (await response.json()) as Record<string, unknown>;
  if (input.kind === "ollama") {
    const message = json.message as { content?: unknown } | undefined;
    return {
      text: textOf(message?.content),
      promptTokens: typeof json.prompt_eval_count === "number" ? json.prompt_eval_count : undefined,
    };
  }
  if (input.kind === "kobold") {
    const results = json.results as { text?: string }[] | undefined;
    return { text: results?.[0]?.text ?? "" };
  }
  const choices = json.choices as { message?: { content?: unknown } }[] | undefined;
  const usage = json.usage as { prompt_tokens?: number } | undefined;
  return { text: textOf(choices?.[0]?.message?.content), promptTokens: usage?.prompt_tokens };
}

export async function embedTexts(input: {
  kind: ConnectionKind;
  baseUrl: string;
  apiKey: string | null;
  model: string;
  texts: string[];
  signal?: AbortSignal;
}): Promise<Float32Array[]> {
  if (!input.texts.length) return [];
  if (input.kind === "mock") return input.texts.map((text) => mockVector(text));
  if (input.kind === "kobold") throw new HttpError(400, "KoboldCPP connections do not serve embeddings. Pick Ollama, SpaceXAI, or another embeddings URL.");
  const url = input.kind === "ollama" ? embeddingsUrl(input.kind, input.baseUrl) : embeddingsUrl(input.kind, input.baseUrl);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: headers(input.apiKey),
      body: JSON.stringify(input.kind === "ollama" ? { model: input.model, input: input.texts } : { model: input.model, input: input.texts }),
      signal: input.signal,
    });
  } catch (error) {
    asAbort(error, input.signal);
  }
  if (!response.ok && input.kind === "ollama") {
    const vectors: Float32Array[] = [];
    for (const text of input.texts) {
      let legacy: Response;
      try {
        legacy = await fetch(joinUrl(input.baseUrl, "/api/embeddings"), {
          method: "POST",
          headers: headers(input.apiKey),
          body: JSON.stringify({ model: input.model, prompt: text }),
          signal: input.signal,
        });
      } catch (error) {
        asAbort(error, input.signal);
      }
      if (!legacy.ok) throw await providerError(legacy);
      const one = (await legacy.json()) as { embedding?: number[] };
      if (!one.embedding) throw new HttpError(502, "Ollama returned no embedding.");
      vectors.push(Float32Array.from(one.embedding));
    }
    return vectors;
  }
  if (!response.ok) throw await providerError(response);
  const body = (await response.json()) as Record<string, unknown>;
  if (input.kind === "ollama") {
    const embeddings = body.embeddings as number[][] | undefined;
    if (!embeddings) throw new HttpError(502, "Ollama returned no embeddings.");
    return embeddings.map((item) => Float32Array.from(item));
  }
  const data = (body.data as { embedding?: number[]; index?: number }[] | undefined) ?? [];
  const ordered = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return ordered.map((item) => Float32Array.from(item.embedding ?? []));
}
