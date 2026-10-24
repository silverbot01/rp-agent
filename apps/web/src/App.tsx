import { useEffect, useRef, useState } from "react";
import { api } from "./api.ts";
import { CharactersPage, ChatsPage, ConnectionsPage, WorldsPage } from "./Editors.tsx";
import { Play } from "./Play.tsx";
import type { Bootstrap, Chat } from "./types.ts";

type View = "play" | "characters" | "worlds" | "chats" | "connections";

const NAV: { id: View; label: string }[] = [
  { id: "play", label: "Play" },
  { id: "characters", label: "Characters" },
  { id: "worlds", label: "Worlds" },
  { id: "chats", label: "Chats" },
  { id: "connections", label: "Connections" },
];

export function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [view, setView] = useState<View>("play");
  const [chatId, setChatId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement | null>(null);

  async function refreshBoot(prefer?: string) {
    const next = await api<Bootstrap>("/api/bootstrap");
    setBoot(next);
    setChatId((current) => {
      const wanted = prefer ?? current;
      if (wanted && next.chats.some((chat) => chat.id === wanted)) return wanted;
      return next.chats[0]?.id ?? null;
    });
  }

  useEffect(() => {
    void refreshBoot().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not reach the server."));
  }, []);

  async function quickStart() {
    if (!boot) return;
    setError(null);
    const character = boot.characters.find((item) => item.id === "char-mara") ?? boot.characters[0];
    const world = boot.worlds.find((item) => item.id === "world-gate") ?? boot.worlds[0];
    const connection = boot.connections.find((item) => item.id === "conn-mock") ?? boot.connections.find((item) => item.kind === "mock");
    const chat = await api<Chat>("/api/chats", {
      method: "POST",
      body: JSON.stringify({
        title: "North gate",
        world_id: world?.id ?? null,
        cast: character ? [character.id] : [],
        connection_id: connection?.id ?? null,
        persona_name: "You",
      }),
    });
    setView("play");
    await refreshBoot(chat.id);
  }

  async function exportLibrary() {
    setError(null);
    const data = await api<unknown>("/api/export");
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "rp-agent-library.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importLibrary(selected: File) {
    if (!window.confirm("Import replaces characters, worlds, presets, and chats that share an id with this file, including their transcripts. Continue?")) return;
    const parsed = JSON.parse(await selected.text()) as unknown;
    if (typeof parsed !== "object" || parsed === null) throw new Error("The file is not a JSON object.");
    await api("/api/import", { method: "POST", body: JSON.stringify(parsed) });
    await refreshBoot();
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">rp-agent</div>
        <nav className="nav">
          {NAV.map((item) => (
            <button key={item.id} className={view === item.id ? "active" : ""} type="button" onClick={() => setView(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>
        {view === "play" && boot && boot.chats.length > 0 ? (
          <select value={chatId ?? ""} onChange={(event) => setChatId(event.target.value || null)} aria-label="Chat">
            {boot.chats.map((chat) => (
              <option key={chat.id} value={chat.id}>{chat.title}</option>
            ))}
          </select>
        ) : null}
        <div className="top-actions">
          <button className="ghost" type="button" onClick={() => void exportLibrary().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Export failed."))}>Export</button>
          <button className="ghost" type="button" onClick={() => file.current?.click()}>Import</button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const selected = event.target.files?.[0];
              event.target.value = "";
              if (!selected) return;
              void importLibrary(selected).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Import failed."));
            }}
          />
        </div>
      </header>
      {error ? <div className="banner">{error}</div> : null}
      {!boot ? <div className="empty">Loading the library…</div> : null}
      {boot && view === "play" && chatId ? <Play chatId={chatId} boot={boot} refreshBoot={refreshBoot} /> : null}
      {boot && view === "play" && !chatId ? (
        <div className="empty">
          <h1>No chat yet</h1>
          <p>Start from Mara at the north gate, on the offline mock model. The reply updates her clothing and emotion, and the road’s weather and time.</p>
          <button className="primary" type="button" onClick={() => void quickStart().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not start a chat."))}>
            Start at the north gate
          </button>
        </div>
      ) : null}
      {boot && view === "characters" ? <CharactersPage boot={boot} refresh={refreshBoot} onError={setError} /> : null}
      {boot && view === "worlds" ? <WorldsPage boot={boot} refresh={refreshBoot} onError={setError} /> : null}
      {boot && view === "chats" ? (
        <ChatsPage
          boot={boot}
          refresh={refreshBoot}
          onError={setError}
          onOpen={(id) => {
            setChatId(id);
            setView("play");
          }}
        />
      ) : null}
      {boot && view === "connections" ? <ConnectionsPage boot={boot} refresh={refreshBoot} onError={setError} /> : null}
    </div>
  );
}
