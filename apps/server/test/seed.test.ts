import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { OPENROUTER_BASE_URL, VENICE_BASE_URL } from "@rp/shared";
import { openDatabase } from "../src/db.ts";
import { SAMPLE_CHARACTERS, SAMPLE_WORLDS } from "../src/samples.ts";
import { defaultBaseUrl } from "../src/store.ts";

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

test("OpenRouter and Venice connections are inserted once", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "rp-agent-hosts-"));
  const dbPath = path.join(dir, "test.db");
  const db = openDatabase(dbPath);
  const hosted = db.prepare(
    "SELECT id, name, kind, base_url, api_key, model, extra_samplers FROM connections WHERE id IN ('conn-openrouter', 'conn-venice') ORDER BY id",
  ).all() as { id: string; name: string; kind: string; base_url: string; api_key: string | null; model: string; extra_samplers: number }[];
  assert.deepEqual(hosted.map((row) => ({ ...row })), [
    { id: "conn-openrouter", name: "OpenRouter", kind: "openrouter", base_url: OPENROUTER_BASE_URL, api_key: null, model: "", extra_samplers: 0 },
    { id: "conn-venice", name: "Venice", kind: "venice", base_url: VENICE_BASE_URL, api_key: null, model: "", extra_samplers: 0 },
  ]);
  assert.equal(hosted[0]?.base_url, defaultBaseUrl("openrouter"));
  assert.equal(hosted[1]?.base_url, defaultBaseUrl("venice"));
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM connections WHERE id = 'conn-ollama'").get() as { n: number }).n, 1);

  db.prepare("DELETE FROM app_meta WHERE key = 'seeded_connection_ids'").run();
  db.prepare("DELETE FROM connections WHERE id IN ('conn-openrouter', 'conn-venice')").run();
  db.prepare("UPDATE connections SET name = 'Local Ollama' WHERE id = 'conn-ollama'").run();
  db.close();

  const upgraded = openDatabase(dbPath);
  const restored = upgraded.prepare("SELECT id, base_url FROM connections WHERE id IN ('conn-openrouter', 'conn-venice') ORDER BY id").all() as {
    id: string;
    base_url: string;
  }[];
  assert.deepEqual(restored.map((row) => ({ ...row })), [
    { id: "conn-openrouter", base_url: OPENROUTER_BASE_URL },
    { id: "conn-venice", base_url: VENICE_BASE_URL },
  ]);
  const ollama = upgraded.prepare("SELECT name FROM connections WHERE id = 'conn-ollama'").get() as { name: string };
  assert.equal(ollama.name, "Local Ollama");

  upgraded.prepare("UPDATE connections SET base_url = 'https://example.test/v1', model = 'kept-model' WHERE id = 'conn-openrouter'").run();
  upgraded.prepare("DELETE FROM connections WHERE id = 'conn-venice'").run();
  upgraded.close();

  const kept = openDatabase(dbPath);
  const openrouter = kept.prepare("SELECT base_url, model FROM connections WHERE id = 'conn-openrouter'").get() as { base_url: string; model: string };
  assert.equal(openrouter.base_url, "https://example.test/v1");
  assert.equal(openrouter.model, "kept-model");
  assert.equal(kept.prepare("SELECT id FROM connections WHERE id = 'conn-venice'").get(), undefined);
  assert.equal((kept.prepare("SELECT COUNT(*) AS n FROM connections WHERE id = 'conn-openrouter'").get() as { n: number }).n, 1);
  kept.close();
});
