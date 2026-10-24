import { BLOCK_IDS, type BlockId } from "./defaults.ts";
import type { ChatMessage } from "./providers.ts";

export type HistoryMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type MemoryCandidate = {
  id: string;
  text: string;
};

export type AssembleInput = {
  order: BlockId[];
  disabled: BlockId[];
  contextTokens: number;
  outputReserve: number;
  memoryBudget: number;
  personaName: string;
  replyName?: string;
  texts: Partial<Record<Exclude<BlockId, "history" | "memories">, string>>;
  memoryCandidates: MemoryCandidate[];
  history: HistoryMessage[];
  estimate?: (text: string) => number;
};

export type AssembleResult = {
  systemText: string;
  trailingText: string;
  messages: ChatMessage[];
  prompt: string;
  estimatedTokens: number;
  usedMemoryIds: string[];
  droppedMessageIds: string[];
  overflow: boolean;
};

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function formatMemories(texts: string[]): string {
  if (!texts.length) return "";
  return `Relevant memory:\n${texts.map((text) => `- ${text}`).join("\n")}`;
}

function historyLine(message: HistoryMessage, personaName: string, replyName: string): string {
  const speaker = message.role === "user" ? personaName || "You" : replyName || "Narrator";
  return `${speaker}: ${message.content}`;
}

export function assemble(input: AssembleInput): AssembleResult {
  const estimate = input.estimate ?? estimateTokens;
  const replyName = input.replyName?.trim() || "Narrator";
  const disabled = new Set(input.disabled);
  const order = input.order.length ? input.order : [...BLOCK_IDS];
  const historyIndex = Math.max(0, order.indexOf("history"));

  const memoryTexts: string[] = [];
  const usedMemoryIds: string[] = [];
  let memoryTokens = 0;
  const memoriesEnabled = !disabled.has("memories");
  if (memoriesEnabled) {
    for (const candidate of input.memoryCandidates) {
      const text = candidate.text.trim();
      if (!text) continue;
      const cost = estimate(text) + 2;
      if (memoryTokens + cost > input.memoryBudget) continue;
      memoryTexts.push(text);
      usedMemoryIds.push(candidate.id);
      memoryTokens += cost;
    }
  }
  const memoryBlock = formatMemories(memoryTexts);

  const blockText = new Map<BlockId, string>();
  for (const id of BLOCK_IDS) {
    if (id === "history") continue;
    if (id === "memories") {
      blockText.set(id, memoryBlock);
      continue;
    }
    blockText.set(id, (input.texts[id] ?? "").trim());
  }

  let fixedTokens = 0;
  for (const id of order) {
    if (id === "history" || id === "memories" || disabled.has(id)) continue;
    const text = blockText.get(id) ?? "";
    if (text) fixedTokens += estimate(text);
  }

  const available = input.contextTokens - input.outputReserve - fixedTokens - memoryTokens;
  const historyBudget = Math.max(0, available);
  const historyEnabled = !disabled.has("history");
  const kept: HistoryMessage[] = [];
  let historyTokens = 0;
  let overflow = available < 0;
  if (historyEnabled) {
    for (let i = input.history.length - 1; i >= 0; i--) {
      const message = input.history[i];
      if (!message) continue;
      const cost = estimate(historyLine(message, input.personaName, replyName));
      const isNewest = i === input.history.length - 1;
      // Keep a contiguous tail. The newest message stays even when it overflows,
      // so the model still sees the turn that was just sent.
      if (!isNewest && historyTokens + cost > historyBudget) break;
      if (isNewest && historyTokens + cost > historyBudget) overflow = true;
      kept.push(message);
      historyTokens += cost;
    }
    kept.reverse();
  }
  const keptIds = new Set(kept.map((message) => message.id));
  const droppedMessageIds = historyEnabled
    ? input.history.filter((message) => !keptIds.has(message.id)).map((message) => message.id)
    : input.history.map((message) => message.id);

  const systemParts: string[] = [];
  const trailingParts: string[] = [];
  for (const id of order) {
    if (id === "history" || disabled.has(id)) continue;
    const text = blockText.get(id) ?? "";
    if (!text) continue;
    if (order.indexOf(id) < historyIndex) systemParts.push(text);
    else trailingParts.push(text);
  }
  const systemText = systemParts.join("\n\n");
  const trailingText = trailingParts.join("\n\n");

  const chatMessages: ChatMessage[] = kept.map((message) => ({ role: message.role, content: message.content }));
  if (trailingText) {
    const last = chatMessages[chatMessages.length - 1];
    if (last && last.role === "user") last.content = `${last.content}\n\n${trailingText}`;
    else chatMessages.push({ role: "user", content: trailingText });
  }
  const messages: ChatMessage[] = [];
  if (systemText) messages.push({ role: "system", content: systemText });
  messages.push(...chatMessages);

  const promptParts: string[] = [];
  if (systemText) promptParts.push(systemText);
  if (kept.length) promptParts.push(kept.map((message) => historyLine(message, input.personaName, replyName)).join("\n\n"));
  if (trailingText) promptParts.push(trailingText);
  promptParts.push(`${replyName}:`);

  const estimatedTokens = fixedTokens + memoryTokens + historyTokens;
  return {
    systemText,
    trailingText,
    messages,
    prompt: promptParts.join("\n\n"),
    estimatedTokens,
    usedMemoryIds,
    droppedMessageIds,
    overflow,
  };
}
