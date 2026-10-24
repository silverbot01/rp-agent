import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPatch,
  emptySheets,
  normalizeCharacterDynamic,
  parseStatePatch,
  reduceState,
  type ChatSheets,
} from "@rp/shared";

function sheets(): ChatSheets {
  const state = emptySheets();
  state.characters.mara = {
    dynamic: normalizeCharacterDynamic({
      clothing: "oilskin cloak",
      emotion: "calm",
      inventory: ["torch"],
      custom: { hands: "bare" },
    }),
    pins: [],
  };
  state.world.dynamic.weather = "clear";
  state.world.dynamic.time = "late afternoon";
  return state;
}

test("partial set keeps omitted fields", () => {
  const result = applyPatch(sheets(), { characters: { mara: { set: { emotion: "wary" } } } }, { mara: "Mara" });
  assert.equal(result.sheets.characters.mara?.dynamic.emotion, "wary");
  assert.equal(result.sheets.characters.mara?.dynamic.clothing, "oilskin cloak");
  assert.equal(result.diff.some((entry) => entry.path === "character:mara:emotion"), true);
});

test("pinned fields are rejected one field at a time", () => {
  const state = sheets();
  const mara = state.characters.mara;
  if (!mara) throw new Error("missing");
  mara.pins = ["emotion"];
  const result = applyPatch(state, { characters: { mara: { set: { emotion: "angry", clothing: "mail" } } } }, { mara: "Mara" });
  assert.equal(result.sheets.characters.mara?.dynamic.emotion, "calm");
  assert.equal(result.sheets.characters.mara?.dynamic.clothing, "mail");
  assert.equal(result.notices.some((notice) => notice.includes("emotion is pinned")), true);
});

test("inventory add and remove dedupes", () => {
  const result = applyPatch(
    sheets(),
    { characters: { mara: { inventory_add: ["lantern", "torch"], inventory_remove: ["torch"] } } },
    { mara: "Mara" },
  );
  assert.deepEqual(result.sheets.characters.mara?.dynamic.inventory, ["lantern"]);
});

test("an empty custom value deletes the key", () => {
  const result = applyPatch(sheets(), { characters: { mara: { custom: { hands: "" } } } }, { mara: "Mara" });
  assert.deepEqual(result.sheets.characters.mara?.dynamic.custom, {});
});

test("unknown character ids are ignored", () => {
  const state = sheets();
  const result = applyPatch(state, { characters: { ghost: { set: { emotion: "gone" } } } }, {});
  assert.equal(result.sheets.characters.mara?.dynamic.emotion, "calm");
  assert.equal("ghost" in result.sheets.characters, false);
  assert.equal(result.notices.some((notice) => notice.includes("ghost")), true);
});

test("a failed parse leaves the caller with the previous sheets", () => {
  const state = sheets();
  const reduced = reduceState(state, "no json here", { mara: "Mara" });
  assert.equal(reduced.ok, false);
  if (!reduced.ok) assert.match(reduced.error, /JSON/);
  assert.equal(state.characters.mara?.dynamic.emotion, "calm");
  assert.equal(parseStatePatch("{").ok, false);
});
