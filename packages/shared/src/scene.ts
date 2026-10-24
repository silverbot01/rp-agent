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
