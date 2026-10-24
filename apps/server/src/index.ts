import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./http.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function loadEnv() {
  const file = path.join(root, ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = raw?.replace(/^['"]|['"]$/g, "") ?? "";
  }
}

loadEnv();

const dbPath = process.env.RP_DB || path.join(root, "data", "rp-agent.db");
const port = Number(process.env.PORT || 8787);
const app = createApp(dbPath);
app.server.listen(port, "127.0.0.1", () => {
  console.log(`rp-agent listening on http://127.0.0.1:${port}`);
});
