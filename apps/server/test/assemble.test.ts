import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CHARACTER_TEMPLATE,
  assemble,
  castRoles,
  normalizeOrder,
  renderTemplate,
  selectLore,
  characterVars,
  emptyCharacterDynamic,
} from "@rp/shared";

function estimate(text: string): number {
  const found = text.match(/T(\d+)/g) ?? [];
  return found.reduce((sum, item) => sum + Number(item.slice(1)), 0);
}

test("block order is kept and disabled blocks are omitted", () => {
  const result = assemble({
    order: normalizeOrder(undefined),
    disabled: ["pre_history"],
    contextTokens: 1000,
    outputReserve: 0,
    memoryBudget: 0,
    personaName: "You",
    texts: { main: "MAIN", pre_history: "PRE", world_static: "WORLD", post_history: "POST" },
    memoryCandidates: [],
    history: [],
    estimate,
  });
  assert.equal(result.systemText.includes("MAIN"), true);
  assert.equal(result.systemText.includes("WORLD"), true);
  assert.equal(result.systemText.includes("PRE"), false);
  assert.ok(result.systemText.indexOf("MAIN") < result.systemText.indexOf("WORLD"));
  assert.equal(result.trailingText.includes("POST"), true);
});

test("empty dynamic fields are omitted", () => {
  const dynamic = emptyCharacterDynamic();
  dynamic.clothing = "";
  dynamic.emotion = "wary";
  const text = renderTemplate(DEFAULT_CHARACTER_TEMPLATE, characterVars("Mara", dynamic));
  assert.equal(text.includes("Clothing"), false);
  assert.equal(text.includes("Emotion: wary"), true);
});

test("history keeps a newest-first contiguous tail", () => {
  const result = assemble({
    order: normalizeOrder(undefined),
    disabled: [],
    contextTokens: 50,
    outputReserve: 0,
    memoryBudget: 0,
    personaName: "You",
    texts: {},
    memoryCandidates: [],
    history: [
      { id: "1", role: "user", content: "T40" },
      { id: "2", role: "assistant", content: "T40" },
      { id: "3", role: "user", content: "T40" },
    ],
    estimate,
  });
  assert.deepEqual(result.messages.map((message) => message.content), ["T40"]);
  assert.deepEqual(result.droppedMessageIds, ["1", "2"]);
});

test("memory budget is taken before history is filled", () => {
  const withMemory = assemble({
    order: normalizeOrder(undefined),
    disabled: [],
    contextTokens: 100,
    outputReserve: 0,
    memoryBudget: 40,
    personaName: "You",
    texts: {},
    memoryCandidates: [{ id: "m1", text: "T30" }],
    history: [
      { id: "1", role: "user", content: "T40" },
      { id: "2", role: "assistant", content: "T40" },
    ],
    estimate,
  });
  const without = assemble({
    order: normalizeOrder(undefined),
    disabled: [],
    contextTokens: 100,
    outputReserve: 0,
    memoryBudget: 0,
    personaName: "You",
    texts: {},
    memoryCandidates: [],
    history: [
      { id: "1", role: "user", content: "T40" },
      { id: "2", role: "assistant", content: "T40" },
    ],
    estimate,
  });
  assert.deepEqual(withMemory.usedMemoryIds, ["m1"]);
  assert.deepEqual(withMemory.droppedMessageIds, ["1"]);
  assert.deepEqual(without.droppedMessageIds, []);
});

test("the reply speaker is the other character when the narrator is off", () => {
  const roles = castRoles({
    cast: [{ id: "char-mara", name: "Mara" }],
    playerCharacterId: null,
    personaName: "You",
    narratorEnabled: false,
  });
  assert.equal(roles.playerName, "You");
  assert.equal(roles.replyName, "Mara");
  assert.equal(roles.stance.includes("The narrator is off"), true);
  const narrated = castRoles({
    cast: [{ id: "char-mara", name: "Mara" }],
    playerCharacterId: "char-mara",
    personaName: "You",
    narratorEnabled: true,
  });
  assert.equal(narrated.playerName, "Mara");
  assert.equal(narrated.replyName, "Narrator");
  const alone = castRoles({
    cast: [{ id: "char-mara", name: "Mara" }],
    playerCharacterId: "char-mara",
    personaName: "You",
    narratorEnabled: false,
  });
  assert.equal(alone.replyName, "Scene");
  const result = assemble({
    order: normalizeOrder(undefined),
    disabled: ["main", "pre_history", "world_static", "world_dynamic", "characters", "lore", "memories", "post_history"],
    contextTokens: 1000,
    outputReserve: 0,
    memoryBudget: 0,
    personaName: roles.playerName,
    replyName: roles.replyName,
    texts: {},
    memoryCandidates: [],
    history: [{ id: "1", role: "assistant", content: "Hello" }],
    estimate,
  });
  assert.match(result.prompt, /Mara:\s*$/);
  assert.equal(result.prompt.includes("Mara: Hello"), true);
});

test("always and keyword lore are selected, rag lore is held back", () => {
  const { included, rag } = selectLore(
    [
      { id: "a", text: "The gate is iron.", mode: "always", keywords: [] },
      { id: "b", text: "Guards change at dusk.", mode: "keyword", keywords: ["gate"] },
      { id: "c", text: "Dragons sleep.", mode: "keyword", keywords: ["dragon"] },
      { id: "d", text: "Old map.", mode: "rag", keywords: [] },
    ],
    "we reached the gate",
  );
  assert.deepEqual(included.map((entry) => entry.id), ["a", "b"]);
  assert.deepEqual(rag.map((entry) => entry.id), ["d"]);
});
