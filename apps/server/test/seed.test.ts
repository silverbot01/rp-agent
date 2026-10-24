import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { openDatabase } from "../src/db.ts";
import { SAMPLE_CHARACTERS, SAMPLE_WORLDS } from "../src/samples.ts";

test("sample cards are added once and do not replace edits", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "rp-agent-seed-"));
  const dbPath = path.join(dir, "test.db");
  const db = openDatabase(dbPath);
  const names = (db.prepare("SELECT name FROM characters ORDER BY name").all() as { name: string }[]).map((row) => row.name);
  assert.deepEqual(names, ["Cal", "Hale", "Ivo", "Jun", "Lin", "Mara", "Rhee", "Sera"]);
  const mara = db.prepare("SELECT description, initial_dynamic_json FROM characters WHERE id = 'char-mara'").get() as {
    description: string;
    initial_dynamic_json: string;
  };
  assert.equal(mara.description, "Gate warden at the north road. Broad-shouldered, ink on her fingers from the ledger.");
  assert.equal(JSON.parse(mara.initial_dynamic_json).clothing, "oilskin cloak");
  const worlds = (db.prepare("SELECT id, name FROM worlds ORDER BY name").all() as { id: string; name: string }[]);
  assert.equal(worlds.some((world) => world.id === "world-gate" && world.name === "The Gate Road"), true);
  assert.equal(worlds.length, SAMPLE_WORLDS.length);
  assert.equal(names.length, SAMPLE_CHARACTERS.length);

  db.prepare("UPDATE characters SET description = 'edited warden' WHERE id = 'char-mara'").run();
  db.prepare("DELETE FROM characters WHERE id = 'char-ivo'").run();
  db.prepare("DELETE FROM worlds WHERE id = 'world-relay'").run();
  db.close();

  const again = openDatabase(dbPath);
  const edited = again.prepare("SELECT description FROM characters WHERE id = 'char-mara'").get() as { description: string };
  assert.equal(edited.description, "edited warden");
  assert.equal(again.prepare("SELECT id FROM characters WHERE id = 'char-ivo'").get(), undefined);
  assert.equal(again.prepare("SELECT id FROM worlds WHERE id = 'world-relay'").get(), undefined);
  assert.equal(again.prepare("SELECT id FROM characters WHERE id = 'char-sera'").get() !== undefined, true);
  const gate = again.prepare("SELECT initial_dynamic_json FROM worlds WHERE id = 'world-gate'").get() as { initial_dynamic_json: string };
  assert.equal(JSON.parse(gate.initial_dynamic_json).place, "the north gate");
  again.close();
});
