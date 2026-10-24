import type { CharacterDynamic, WorldDynamic } from "./sheets.ts";
import { characterVars, renderTemplate, worldVars } from "./template.ts";

export type CardFields = {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  exampleDialogue: string;
  template: string;
  dynamic: CharacterDynamic;
};

export function characterCardText(card: Pick<CardFields, "name" | "description" | "personality" | "scenario" | "exampleDialogue">): string {
  const parts = [`## ${card.name}`];
  if (card.description.trim()) parts.push(card.description.trim());
  if (card.personality.trim()) parts.push(`Personality: ${card.personality.trim()}`);
  if (card.scenario.trim()) parts.push(`Scenario: ${card.scenario.trim()}`);
  if (card.exampleDialogue.trim()) parts.push(`Example dialogue:\n${card.exampleDialogue.trim()}`);
  return parts.join("\n\n");
}

export function characterSection(cards: CardFields[]): string {
  return cards
    .map((card) => {
      const dynamic = renderTemplate(card.template, characterVars(card.name, card.dynamic));
      return [characterCardText(card), dynamic].filter(Boolean).join("\n\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

export function worldStaticText(name: string, description: string): string {
  return [`# ${name}`, description.trim()].filter(Boolean).join("\n\n");
}

export function worldDynamicText(template: string, dynamic: WorldDynamic): string {
  return renderTemplate(template, worldVars(dynamic));
}

export function castRoles(input: {
  cast: { id: string; name: string }[];
  playerCharacterId: string | null;
  personaName: string;
  narratorEnabled: boolean;
}): { playerId: string | null; playerName: string; otherNames: string[]; replyName: string; stance: string } {
  const player = input.playerCharacterId ? input.cast.find((character) => character.id === input.playerCharacterId) : undefined;
  const playerName = player?.name || input.personaName.trim() || "You";
  const otherNames = input.cast.filter((character) => character.id !== player?.id).map((character) => character.name);
  const replyName = input.narratorEnabled ? "Narrator" : otherNames.length === 1 ? otherNames[0]! : otherNames.length ? otherNames.join(", ") : "Scene";
  const others = otherNames.length ? otherNames.join(", ") : "anyone else";
  const stance = input.narratorEnabled
    ? `The user is playing as ${playerName}. The narrator is on. Write the scene in prose, including ${others}. Do not write ${playerName}'s actions, dialogue, or thoughts.`
    : otherNames.length
      ? `The user is playing as ${playerName}. The narrator is off. Write only what ${others} say and do. Do not narrate, and do not write ${playerName}'s actions, dialogue, or thoughts.`
      : `The user is playing as ${playerName}. The narrator is off and no other characters are in the scene. Write only a brief reaction from the world. Do not narrate a story, and do not write ${playerName}'s actions, dialogue, or thoughts.`;
  return { playerId: player?.id ?? null, playerName, otherNames, replyName, stance };
}
