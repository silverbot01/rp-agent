import { DEFAULT_STATE_INSTRUCTIONS } from "./defaults.ts";
import type { ChatSheets } from "./sheets.ts";

export function stateUpdatePrompt(input: {
  sheets: ChatSheets;
  names: Record<string, string>;
  instructions: string;
  userText: string;
  assistantText: string;
}): string {
  const characters = Object.entries(input.sheets.characters).map(([id, state]) => ({
    id,
    name: input.names[id] || id,
    pinned: state.pins,
    state: state.dynamic,
  }));
  const world = {
    pinned: input.sheets.world.pins,
    state: input.sheets.world.dynamic,
  };
  return [
    "You update structured roleplay state. Reply with one JSON object and no other text.",
    "Shape:",
    JSON.stringify(
      {
        characters: {
          "<characterId>": {
            set: { emotion: "string, optional" },
            custom: { "field": "string, empty deletes" },
            inventory_add: ["item"],
            inventory_remove: ["item"],
          },
        },
        world: { set: { time: "string", weather: "string" }, custom: {} },
        memories: [{ text: "short fact", tags: ["tag"] }],
      },
      null,
      2,
    ),
    "Omit fields that did not change. Do not change pinned fields.",
    "Current characters:",
    JSON.stringify(characters, null, 2),
    "Current world:",
    JSON.stringify(world, null, 2),
    "Latest exchange:",
    `User: ${input.userText}`,
    `Narrator: ${input.assistantText}`,
    "Instructions:",
    input.instructions.trim() || DEFAULT_STATE_INSTRUCTIONS,
  ].join("\n\n");
}

export const STATE_JSON_SCHEMA = {
  type: "object",
  properties: {
    characters: { type: "object" },
    world: { type: "object" },
    memories: { type: "array" },
  },
  additionalProperties: false,
} as const;
