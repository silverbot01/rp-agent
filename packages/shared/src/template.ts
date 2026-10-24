import type { CharacterDynamic, LoreEntry, WorldDynamic } from "./sheets.ts";

function lookup(vars: Record<string, string>, key: string): string {
  return vars[key] ?? "";
}

/** Renders {{field}} and {{#if field}}...{{/if}}. Empty fields drop out. No code runs. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  const expanded = template.replace(/\{\{#if\s+([\w.]+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_match, key: string, inner: string) => {
    return lookup(vars, key).trim() ? inner : "";
  });
  const filled = expanded.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => lookup(vars, key));
  return filled
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function characterVars(name: string, dynamic: CharacterDynamic): Record<string, string> {
  const customLines = Object.entries(dynamic.custom)
    .filter(([, value]) => value.trim())
    .map(([key, value]) => `${key}: ${value}`);
  const vars: Record<string, string> = {
    name,
    clothing: dynamic.clothing,
    emotion: dynamic.emotion,
    posture: dynamic.posture,
    location: dynamic.location,
    inventory: dynamic.inventory.join(", "),
    injuries: dynamic.injuries,
    goals: dynamic.goals,
    note: dynamic.note,
    custom: customLines.join("\n"),
  };
  for (const [key, value] of Object.entries(dynamic.custom)) vars[`custom.${key}`] = value;
  return vars;
}

export function worldVars(dynamic: WorldDynamic): Record<string, string> {
  const customLines = Object.entries(dynamic.custom)
    .filter(([, value]) => value.trim())
    .map(([key, value]) => `${key}: ${value}`);
  const vars: Record<string, string> = {
    time: dynamic.time,
    weather: dynamic.weather,
    place: dynamic.place,
    atmosphere: dynamic.atmosphere,
    ongoing: dynamic.ongoing,
    chronicle: dynamic.chronicle,
    custom: customLines.join("\n"),
  };
  for (const [key, value] of Object.entries(dynamic.custom)) vars[`custom.${key}`] = value;
  return vars;
}

export function selectLore(entries: LoreEntry[], recentText: string): { included: LoreEntry[]; rag: LoreEntry[] } {
  const haystack = recentText.toLowerCase();
  const included: LoreEntry[] = [];
  const rag: LoreEntry[] = [];
  for (const entry of entries) {
    const text = entry.text.trim();
    if (!text) continue;
    if (entry.mode === "always") included.push(entry);
    else if (entry.mode === "rag") rag.push(entry);
    else if (entry.keywords.some((keyword) => keyword.trim() && haystack.includes(keyword.trim().toLowerCase()))) {
      included.push(entry);
    }
  }
  return { included, rag };
}

export function composePreHistory(preHistory: string, personaName: string, personaDescription: string): string {
  const persona = [`The user's name is ${personaName.trim() || "You"}.`, personaDescription.trim()]
    .filter(Boolean)
    .join("\n");
  return [preHistory.trim(), persona].filter(Boolean).join("\n\n");
}

export function loreBlock(entries: LoreEntry[]): string {
  if (!entries.length) return "";
  return entries.map((entry) => entry.text.trim()).filter(Boolean).join("\n\n");
}
