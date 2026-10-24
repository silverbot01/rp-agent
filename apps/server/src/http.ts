import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildChatBody, defaultSampler, normalizeSampler, redactBody } from "@rp/shared";
import { openDatabase } from "./db.ts";
import { HttpError } from "./errors.ts";
import { preparePrompt } from "./prompt.ts";
import { startRebuild } from "./rebuild.ts";
import { listModelIds } from "./runtime.ts";
import {
  createChat,
  createConnection,
  createPreset,
  deleteCharacter,
  deleteChat,
  deleteConnection,
  deletePreset,
  deleteWorld,
  exportLibrary,
  getChat,
  getConnection,
  getEmbedder,
  importLibrary,
  listCharacters,
  listChats,
  listConnections,
  listPresets,
  listWorlds,
  saveCharacter,
  saveWorld,
  setEmbedder,
  updateChat,
  updateConnection,
  updatePreset,
} from "./store.ts";
import { applyStateUpdate, confirmRevision, discardRevision, runTurn, undoRevision } from "./turn.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const distDir = path.join(root, "apps", "web", "dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json",
  ".png": "image/png",
  ".webp": "image/webp",
};

export function createApp(dbPath: string) {
  const db = openDatabase(dbPath);
  const active = new Map<string, AbortController>();
  const server = createServer((req, res) => {
    void handle(db, active, req, res).catch((error: unknown) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      const status = error instanceof HttpError ? error.status : 500;
      if (!(error instanceof HttpError)) console.error(error);
      sendJson(req, res, status, { error: error instanceof Error ? error.message : "Request failed." });
    });
  });
  server.requestTimeout = 0;
  return {
    server,
    db,
    close() {
      db.close();
    },
  };
}

async function handle(db: ReturnType<typeof openDatabase>, active: Map<string, AbortController>, req: IncomingMessage, res: ServerResponse) {
  applyCors(req, res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "api") {
    serveStatic(url.pathname, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") return sendJson(req, res, 200, { ok: true });
  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    return sendJson(req, res, 200, {
      connections: listConnections(db),
      presets: listPresets(db),
      characters: listCharacters(db),
      worlds: listWorlds(db),
      chats: listChats(db),
      embedder: getEmbedder(db),
    });
  }
  if (req.method === "GET" && url.pathname === "/api/export") return sendJson(req, res, 200, exportLibrary(db));
  if (req.method === "POST" && url.pathname === "/api/import") {
    importLibrary(db, (await readJson(req)) as Record<string, unknown>);
    return sendJson(req, res, 200, { ok: true });
  }

  if (url.pathname === "/api/connections" && req.method === "GET") return sendJson(req, res, 200, listConnections(db));
  if (url.pathname === "/api/connections" && req.method === "POST") {
    return sendJson(req, res, 201, createConnection(db, (await readJson(req)) as Record<string, unknown>));
  }
  if (parts[1] === "connections" && parts[2] && parts[3] === "models" && req.method === "POST") {
    const connection = getConnection(db, parts[2]);
    const models = await listModelIds(connection.kind, connection.base_url, connection.api_key);
    return sendJson(req, res, 200, { models });
  }
  if (parts[1] === "connections" && parts[2] && !parts[3]) {
    if (req.method === "PUT") return sendJson(req, res, 200, updateConnection(db, parts[2], (await readJson(req)) as Record<string, unknown>));
    if (req.method === "DELETE") {
      deleteConnection(db, parts[2]);
      return sendJson(req, res, 200, { ok: true });
    }
  }

  if (url.pathname === "/api/presets" && req.method === "GET") return sendJson(req, res, 200, listPresets(db));
  if (url.pathname === "/api/presets" && req.method === "POST") {
    return sendJson(req, res, 201, createPreset(db, (await readJson(req)) as Record<string, unknown>));
  }
  if (parts[1] === "presets" && parts[2] && req.method === "PUT") {
    return sendJson(req, res, 200, updatePreset(db, parts[2], (await readJson(req)) as Record<string, unknown>));
  }
  if (parts[1] === "presets" && parts[2] && req.method === "DELETE") {
    deletePreset(db, parts[2]);
    return sendJson(req, res, 200, { ok: true });
  }

  if (url.pathname === "/api/samplers/preview" && req.method === "POST") {
    const body = (await readJson(req)) as Record<string, unknown>;
    const connection = getConnection(db, String(body.connection_id ?? ""));
    const sampler = body.sampler ? normalizeOrThrow(body.sampler) : defaultSampler();
    const contextTokens = Number(body.context_tokens ?? sampler.num_ctx);
    const built = buildChatBody({
      kind: connection.kind,
      model: String(body.model ?? connection.model ?? ""),
      extraSamplers: connection.extra_samplers,
      sampler,
      messages: [{ role: "system", content: "Preview." }, { role: "user", content: "Preview." }],
      prompt: "Preview.\n\nNarrator:",
      contextTokens,
      stream: true,
    });
    return sendJson(req, res, 200, { body: redactBody(built.body), applied: built.applied, dropped: built.dropped });
  }

  if (url.pathname === "/api/characters" && req.method === "GET") return sendJson(req, res, 200, listCharacters(db));
  if (url.pathname === "/api/characters" && req.method === "POST") {
    return sendJson(req, res, 201, saveCharacter(db, null, (await readJson(req)) as Record<string, unknown>));
  }
  if (parts[1] === "characters" && parts[2] && req.method === "PUT") {
    return sendJson(req, res, 200, saveCharacter(db, parts[2], (await readJson(req)) as Record<string, unknown>));
  }
  if (parts[1] === "characters" && parts[2] && req.method === "DELETE") {
    deleteCharacter(db, parts[2]);
    return sendJson(req, res, 200, { ok: true });
  }

  if (url.pathname === "/api/worlds" && req.method === "GET") return sendJson(req, res, 200, listWorlds(db));
  if (url.pathname === "/api/worlds" && req.method === "POST") {
    return sendJson(req, res, 201, saveWorld(db, null, (await readJson(req)) as Record<string, unknown>));
  }
  if (parts[1] === "worlds" && parts[2] && req.method === "PUT") {
    return sendJson(req, res, 200, saveWorld(db, parts[2], (await readJson(req)) as Record<string, unknown>));
  }
  if (parts[1] === "worlds" && parts[2] && req.method === "DELETE") {
    deleteWorld(db, parts[2]);
    return sendJson(req, res, 200, { ok: true });
  }

  if (url.pathname === "/api/chats" && req.method === "GET") return sendJson(req, res, 200, listChats(db));
  if (url.pathname === "/api/chats" && req.method === "POST") {
    return sendJson(req, res, 201, createChat(db, (await readJson(req)) as Record<string, unknown>));
  }
  if (parts[1] === "chats" && parts[2] && !parts[3] && req.method === "GET") return sendJson(req, res, 200, getChat(db, parts[2]));
  if (parts[1] === "chats" && parts[2] && !parts[3] && req.method === "PUT") {
    return sendJson(req, res, 200, updateChat(db, parts[2], (await readJson(req)) as Record<string, unknown>));
  }
  if (parts[1] === "chats" && parts[2] && !parts[3] && req.method === "DELETE") {
    deleteChat(db, parts[2]);
    return sendJson(req, res, 200, { ok: true });
  }
  if (parts[1] === "chats" && parts[2] && parts[3] === "preview" && req.method === "POST") {
    const body = (await readJson(req)) as Record<string, unknown>;
    const chat = getChat(db, parts[2]);
    if (body.sampler) chat.sampler = normalizeOrThrow(body.sampler);
    if (typeof body.context_tokens === "number") chat.context_tokens = body.context_tokens;
    const prepared = await preparePrompt(db, chat);
    const connection = chat.connection_id ? getConnection(db, chat.connection_id) : null;
    const built = connection
      ? buildChatBody({
          kind: connection.kind,
          model: chat.model || connection.model || "mock",
          extraSamplers: connection.extra_samplers,
          sampler: chat.sampler,
          messages: prepared.assembled.messages,
          prompt: prepared.assembled.prompt,
          contextTokens: chat.context_tokens,
          stream: true,
        })
      : null;
    return sendJson(req, res, 200, {
      body: built ? redactBody(built.body) : null,
      applied: built?.applied ?? [],
      dropped: built?.dropped ?? [],
      estimated_tokens: prepared.assembled.estimatedTokens,
      dropped_messages: prepared.assembled.droppedMessageIds.length,
      memories: prepared.retrieval,
      notices: prepared.notices,
      system: prepared.assembled.systemText,
      prompt: prepared.assembled.prompt,
    });
  }
  if (parts[1] === "chats" && parts[2] && (parts[3] === "turn" || parts[3] === "regenerate") && req.method === "POST") {
    const chatId = parts[2];
    if (active.has(chatId)) throw new HttpError(409, "This chat is already generating.");
    const controller = new AbortController();
    active.set(chatId, controller);
    const body = parts[3] === "turn" ? ((await readJson(req)) as { content?: string }) : {};
    res.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.socket?.setNoDelay(true);
    req.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      await runTurn(db, chatId, {
        content: body.content,
        regenerate: parts[3] === "regenerate",
        signal: controller.signal,
        onEvent: (event) => {
          if (res.writableEnded) return;
          res.write(`${JSON.stringify(event)}\n`);
          res.socket?.uncork();
        },
      });
    } finally {
      active.delete(chatId);
      if (!res.writableEnded) res.end();
    }
    return;
  }
  if (parts[1] === "chats" && parts[2] && parts[3] === "stop" && req.method === "POST") {
    active.get(parts[2])?.abort();
    return sendJson(req, res, 200, { ok: true });
  }
  if (parts[1] === "chats" && parts[2] && parts[3] === "state" && parts[4] === "retry" && req.method === "POST") {
    const result = await applyStateUpdate(db, parts[2]);
    return sendJson(req, res, 200, { ...result, chat: getChat(db, parts[2]) });
  }
  if (parts[1] === "chats" && parts[2] && parts[3] === "undo" && req.method === "POST") {
    return sendJson(req, res, 200, undoRevision(db, parts[2]));
  }
  if (parts[1] === "chats" && parts[2] && parts[3] === "revisions" && parts[4] && parts[5] === "apply" && req.method === "POST") {
    return sendJson(req, res, 200, confirmRevision(db, parts[2], parts[4]));
  }
  if (parts[1] === "chats" && parts[2] && parts[3] === "revisions" && parts[4] && parts[5] === "discard" && req.method === "POST") {
    return sendJson(req, res, 200, discardRevision(db, parts[2], parts[4]));
  }

  if (url.pathname === "/api/embedder" && req.method === "GET") return sendJson(req, res, 200, getEmbedder(db));
  if (url.pathname === "/api/embedder" && req.method === "PUT") {
    const body = (await readJson(req)) as { connection_id?: string | null; model?: string };
    setEmbedder(db, body.connection_id ? String(body.connection_id) : null, String(body.model ?? ""));
    startRebuild(db);
    return sendJson(req, res, 200, getEmbedder(db));
  }
  if (url.pathname === "/api/embedder/rebuild" && req.method === "POST") {
    const started = startRebuild(db);
    return sendJson(req, res, 200, { ...started, embedder: getEmbedder(db) });
  }

  sendJson(req, res, 404, { error: "Not found." });
}

function normalizeOrThrow(input: unknown) {
  try {
    return normalizeSampler(input);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid sampler.");
  }
}

function applyCors(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin;
  if (typeof origin === "string" && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.setHeader("Vary", "Origin");
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 2_000_000) throw new HttpError(413, "Request body is too large.");
    chunks.push(buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body was not JSON.");
  }
}

function sendJson(req: IncomingMessage, res: ServerResponse, status: number, body: unknown) {
  applyCors(req, res);
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

function serveStatic(pathname: string, res: ServerResponse) {
  if (!existsSync(distDir)) {
    sendJson({ headers: {} } as IncomingMessage, res, 404, { error: "UI is not built. Run npm run dev." });
    return;
  }
  const requested = pathname === "/" ? "/index.html" : pathname;
  const file = path.normalize(path.join(distDir, requested));
  if (!file.startsWith(distDir)) {
    res.writeHead(403);
    res.end();
    return;
  }
  const target = existsSync(file) && statSync(file).isFile() ? file : path.join(distDir, "index.html");
  res.writeHead(200, { "Content-Type": MIME[path.extname(target)] ?? "application/octet-stream" });
  createReadStream(target).pipe(res);
}
