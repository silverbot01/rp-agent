# rp-agent

Local roleplay front-end. One model writes the next beat of the scene. The narrator starts off, and you choose which cast member you play. Character sheets and world state change from what happens in play. Memory search is optional. Replies appear as they are generated.

The server binds to `127.0.0.1`. There are no accounts. API keys stay in the local database or in the environment. The browser does not receive them.

## Run

```bash
npm install
npm test
npm run dev
```

Open http://127.0.0.1:5173. The Vite dev server proxies `/api` to the API on http://127.0.0.1:8787.

`npm start` runs the API only. If `apps/web/dist` exists, the API serves that build. Otherwise a non-API request tells you to run `npm run dev`.

The database file is `data/rp-agent.db`. Set `RP_DB` to use another path. Set `PORT` to move the API off 8787. A `.env` file in the repo root is loaded without overriding variables that are already set.

## Offline mock

The first database includes:

- **Mock (offline)** — local replies that need no model server. The narrator starts off.
- **Mara** — clothing starts as an oilskin cloak, emotion calm. She is the only character in a new chat.
- **The Gate Road** — late afternoon, clear weather, the north gate. This is the default world.

The library also includes other characters (Ivo, Sera, Hale, Lin, Cal, Rhee, and Jun) and other worlds (The River Inn, Salt Harbor, The Closed Stacks, The Cloister Garden, Relay Station, and Rain District). They stay out of a new scene until you add them. Edits you save on a sample card are kept. Deleting a sample card stays deleted.

On the Play screen, choose **Start at the north gate** if you have no chat yet. Send a line about rain. The mock updates Mara’s emotion to wary and her clothing to a wet wool cloak, and sets the weather to cold rain and the time to just after dusk. Undo on the Sheets tab restores the previous sheet.

## Other models

| Connection | Default base URL | Notes |
| --- | --- | --- |
| SpaceXAI | `https://api.x.ai/v1` | Model `grok-4.7`. Set `XAI_API_KEY`, or store a key on the connection. A stored key wins. |
| OpenAI-compatible | `http://127.0.0.1:8080/v1` | Chat Completions. Extra samplers (top-k, DRY, and the rest of the form-only fields) are sent only when that connection option is on. Custom JSON is always merged for this kind. |
| Ollama | `http://127.0.0.1:11434` | `num_ctx` follows the chat context size unless custom JSON overrides it. DRY is not sent unless you put it in custom JSON. |
| KoboldCPP | `http://127.0.0.1:5001` | Native generate API. DRY is native. Streaming falls back when the stream route is missing. |
| Mock | `http://mock` | Offline, for the UI and tests. |

Load model ids from the connection with **Load models**. KoboldCPP cannot embed. Pick an embedder on the Memory tab (Ollama, an OpenAI-compatible embeddings endpoint, or Mock). Search stays off until a rebuild finishes and the status is ready. The full transcript stays on screen; retrieval only changes what the model sees.

## Prompts and sheets

Prompt blocks, in default order: main, pre-history, world, world dynamic, characters, lore, memories, history, post-history. Blocks can be turned off and reordered on the Prompts tab. Your name and description are composed into pre-history when you are playing yourself. On the Sheets tab, check Narrator to have the model narrate, and choose which cast member you play. The model does not write that person's actions, dialogue, or thoughts. With the narrator off, the reply is labeled with the other people in the scene.

Main, pre-history, and post-history are text you write. Character and world blocks are rendered from the sheets. Templates support `{{field}}` and `{{#if field}}...{{/if}}`.

Each past line has Edit and Delete, for your messages and for replies. Changing or removing a line leaves the sheets as they are. Restart, under the composer, clears the transcript and play memories and puts clothing, emotion, weather, and the other dynamic fields back to the character and world cards. Prompts, the cast, who you play, and pins stay. The opening line is added again.

After each reply, a state update (the same model, or a connection chosen on the Model tab) returns a JSON patch. It can change clothing, emotion, posture, location, inventory, injuries, goals, notes, custom fields, world time, weather, place, atmosphere, ongoing events, and the chronicle. Pin a field on the sheet to keep the model from changing it. **Hold state updates** stores the patch until you apply or discard it.

Sampler groups are Common, DRY, and Ollama, plus a custom JSON object merged last. The request preview shows which fields are sent and which are dropped. Secrets are redacted in that preview.

## Library

Characters, worlds, chats, and sampler presets export as one JSON file from the header. Import updates records that share an id and inserts the rest. A chat import replaces that chat’s transcript. Connections are not in the file, so keys are not exported.

## Tests

```bash
npm test
npm run typecheck
```

Tests use the mock connection. They do not call Ollama or a hosted API.
