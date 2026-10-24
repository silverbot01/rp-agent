import type { CharacterDynamic, LoreEntry, WorldDynamic } from "@rp/shared";

export type SampleCharacter = {
  id: string;
  name: string;
  description: string;
  personality: string;
  scenario: string;
  greeting: string;
  tags: string;
  dynamic: CharacterDynamic;
};

export type SampleWorld = {
  id: string;
  name: string;
  description: string;
  lore: LoreEntry[];
  dynamic: WorldDynamic;
};

function characterDynamic(
  dynamic: Pick<CharacterDynamic, "clothing" | "emotion" | "posture" | "location" | "inventory" | "goals"> &
    Partial<Pick<CharacterDynamic, "injuries" | "note">>,
): CharacterDynamic {
  return {
    injuries: "",
    note: "",
    custom: {},
    ...dynamic,
  };
}

function worldDynamic(
  dynamic: Pick<WorldDynamic, "time" | "weather" | "place" | "atmosphere" | "ongoing">,
): WorldDynamic {
  return {
    chronicle: "",
    custom: {},
    ...dynamic,
  };
}

export const SAMPLE_CHARACTERS: SampleCharacter[] = [
  {
    id: "char-mara",
    name: "Mara",
    description: "Gate warden at the north road. Broad-shouldered, ink on her fingers from the ledger.",
    personality: "Dry humor. Wary of strangers. Keeps a promise once she makes it.",
    scenario: "The north gate at the end of a watch.",
    greeting: "You're late. The road has been too quiet.",
    tags: "warden",
    dynamic: characterDynamic({
      clothing: "oilskin cloak",
      emotion: "calm",
      posture: "leaning on the gate",
      location: "the north gate",
      inventory: ["ledger", "iron key"],
      goals: "close the gate at full dark",
    }),
  },
  {
    id: "char-ivo",
    name: "Ivo",
    description: "Road scout for the north watch. Lean, sunburned, and usually a half-step ahead of the person he is talking to.",
    personality: "Impatient with standing still. Honest about danger. Jokes when he is nervous.",
    scenario: "Checking the mile-marker west of the gate before dark.",
    greeting: "Something came down the west road. I lost it in the trees.",
    tags: "scout",
    dynamic: characterDynamic({
      clothing: "patched leather jerkin",
      emotion: "alert",
      posture: "crouched by the marker",
      location: "the mile-marker",
      inventory: ["field glass", "dried apples"],
      goals: "report what moved on the west road",
    }),
  },
  {
    id: "char-sera",
    name: "Sera",
    description: "Keeps the River Inn. Flour on her cuffs, a ring of keys at her belt, and a memory for who has not paid.",
    personality: "Warm until the books do not balance. Protective of the regulars. Slow to trust a story.",
    scenario: "The common room at supper, with rain on the roof.",
    greeting: "Supper is stew, the back room is taken, and you are dripping on my floor.",
    tags: "innkeeper",
    dynamic: characterDynamic({
      clothing: "flour-dusted apron",
      emotion: "busy",
      posture: "wiping the bar",
      location: "the common room",
      inventory: ["room keys", "wooden spoon"],
      goals: "keep the inn open through the rain",
    }),
  },
  {
    id: "char-hale",
    name: "Hale",
    description: "Pilot at Salt Harbor. Gray at the temples, coat stiff with salt, voice sized for a deck.",
    personality: "Blunt. Counts the tide before he counts people. Keeps his word to a crew.",
    scenario: "The harbor mouth at the turn of the tide.",
    greeting: "The tide turns in an hour. If you are boarding, board.",
    tags: "pilot",
    dynamic: characterDynamic({
      clothing: "salt-stained coat",
      emotion: "impatient",
      posture: "watching the channel",
      location: "the harbor mouth",
      inventory: ["tide table", "brass whistle"],
      goals: "bring the next boat in before the fog thickens",
    }),
  },
  {
    id: "char-lin",
    name: "Lin",
    description: "Clerk of the closed stacks. Ink on the side of one hand, spectacles on a cord, quiet enough to hear a page turn.",
    personality: "Precise. Curious past the point of caution. Dislikes a book put back in the wrong place.",
    scenario: "The lamp-lit aisle where the restricted shelves start.",
    greeting: "That volume is not where I left it. Did you move it, or did it move itself?",
    tags: "archivist",
    dynamic: characterDynamic({
      clothing: "ink-stained cuffs",
      emotion: "curious",
      posture: "holding a ladder",
      location: "the closed stacks",
      inventory: ["index cards", "reading lamp"],
      goals: "find the missing volume before the closing bell",
    }),
  },
  {
    id: "char-cal",
    name: "Cal",
    description: "Herbalist of the cloister garden. Sleeves rolled, hands stained green, a linen bundle never far from reach.",
    personality: "Gentle. Evasive about which plants are only for medicine. Notices when someone is hurt.",
    scenario: "The walled garden just after morning bells.",
    greeting: "Sit. You are favoring that side, and the kettle is already on.",
    tags: "herbalist",
    dynamic: characterDynamic({
      clothing: "brown habit with green-stained cuffs",
      emotion: "mild",
      posture: "kneeling by the beds",
      location: "the cloister garden",
      inventory: ["pruning knife", "linen bundle"],
      goals: "finish the morning cutting before the rain",
    }),
  },
  {
    id: "char-rhee",
    name: "Rhee",
    description: "Mechanic on Relay Station. Coveralls patched at the knees, a magnetized tether clipped to one belt loop.",
    personality: "Practical. Talks to machines more easily than to people. Hates a loose panel.",
    scenario: "The maintenance bay while the station is on the night cycle.",
    greeting: "Panel three is warm. Do not touch it, and do not tell me it was already like that.",
    tags: "mechanic",
    dynamic: characterDynamic({
      clothing: "patched coveralls",
      emotion: "focused",
      posture: "half inside an access panel",
      location: "the maintenance bay",
      inventory: ["torque wrench", "spare fuse"],
      goals: "get panel three cold before the shift change",
    }),
  },
  {
    id: "char-jun",
    name: "Jun",
    description: "Night-shift investigator in the Rain District. Collar up, notebook soft from damp, attention on the street.",
    personality: "Patient. Dry. Writes things down so they cannot be talked out of them later.",
    scenario: "A streetlamp on Mercer after the rain has started again.",
    greeting: "You were here an hour ago. Walk me through why you came back.",
    tags: "investigator",
    dynamic: characterDynamic({
      clothing: "damp wool coat",
      emotion: "watchful",
      posture: "under the streetlamp",
      location: "Mercer and Fourth",
      inventory: ["notebook", "brass pen"],
      goals: "find who keeps returning to this corner",
    }),
  },
];

export const SAMPLE_WORLDS: SampleWorld[] = [
  {
    id: "world-gate",
    name: "The Gate Road",
    description: "A packed-dirt road between low hills, ending at a timber gate.",
    lore: [
      { id: "lore-gate", text: "The gate is iron-banded timber and closes at full dark.", mode: "always", keywords: [] },
      { id: "lore-rain", text: "Rain turns the road to clay within an hour.", mode: "keyword", keywords: ["rain"] },
      { id: "lore-marker", text: "An old mile-marker west of the gate is carved with a faded sun.", mode: "rag", keywords: [] },
    ],
    dynamic: worldDynamic({
      time: "late afternoon",
      weather: "clear",
      place: "the north gate",
      atmosphere: "still",
      ongoing: "the watch is ending",
    }),
  },
  {
    id: "world-inn",
    name: "The River Inn",
    description: "A two-story inn on a slow river, with a loud common room and rooms that smell of woodsmoke.",
    lore: [
      { id: "lore-inn-rooms", text: "The inn has six rooms. The back room is kept for the river pilots.", mode: "always", keywords: [] },
      { id: "lore-inn-rain", text: "Rain on the slate roof drowns out quiet talk.", mode: "keyword", keywords: ["rain"] },
      { id: "lore-inn-skiff", text: "A skiff is tied under the willow and is not on the inn's books.", mode: "rag", keywords: [] },
    ],
    dynamic: worldDynamic({
      time: "evening",
      weather: "steady rain",
      place: "the common room",
      atmosphere: "warm",
      ongoing: "supper is being served",
    }),
  },
  {
    id: "world-harbor",
    name: "Salt Harbor",
    description: "A working harbor between a stone customs house and a channel that silts up in bad years.",
    lore: [
      { id: "lore-harbor-tide", text: "Ships enter only at the turn of the tide. The customs house closes at dusk.", mode: "always", keywords: [] },
      { id: "lore-harbor-fog", text: "Fog hides the channel markers before it hides the docks.", mode: "keyword", keywords: ["fog"] },
      { id: "lore-harbor-wreck", text: "A wreck on the east bar is exposed only at the lowest tide.", mode: "rag", keywords: [] },
    ],
    dynamic: worldDynamic({
      time: "dawn",
      weather: "fog",
      place: "the harbor mouth",
      atmosphere: "damp",
      ongoing: "the tide is about to turn",
    }),
  },
  {
    id: "world-stacks",
    name: "The Closed Stacks",
    description: "A city archive of narrow aisles, iron ladders, and lamps that are never all lit at once.",
    lore: [
      { id: "lore-stacks-bell", text: "The closing bell rings at dusk. Books past the red rail are not for loan.", mode: "always", keywords: [] },
      { id: "lore-stacks-lamp", text: "A lamp left burning in a closed aisle is against the rules.", mode: "keyword", keywords: ["lamp"] },
      { id: "lore-stacks-index", text: "One index drawer is missing its cards for the letter M.", mode: "rag", keywords: [] },
    ],
    dynamic: worldDynamic({
      time: "late afternoon",
      weather: "dry and still",
      place: "the closed stacks",
      atmosphere: "hushed",
      ongoing: "the closing bell is an hour off",
    }),
  },
  {
    id: "world-cloister",
    name: "The Cloister Garden",
    description: "A walled garden inside a quiet cloister, with gravel paths, herb beds, and a gate that sticks in wet weather.",
    lore: [
      { id: "lore-cloister-gate", text: "The garden gate is barred from the inside after evening bells.", mode: "always", keywords: [] },
      { id: "lore-cloister-rain", text: "Rain pools on the gravel and makes the east path slick.", mode: "keyword", keywords: ["rain"] },
      { id: "lore-cloister-key", text: "The infirmary keeps a second key to the garden, on a green cord.", mode: "rag", keywords: [] },
    ],
    dynamic: worldDynamic({
      time: "morning",
      weather: "overcast",
      place: "the walled garden",
      atmosphere: "quiet",
      ongoing: "the morning cutting is underway",
    }),
  },
  {
    id: "world-relay",
    name: "Relay Station",
    description: "A small orbital relay with a spinning habitat ring, a noisy maintenance bay, and a viewport that never quite faces the sun.",
    lore: [
      { id: "lore-relay-cycle", text: "Night cycle dims the ring lights for eight hours. Loose tools are tethered.", mode: "always", keywords: [] },
      { id: "lore-relay-panel", text: "A warm panel means a fuse is near failure.", mode: "keyword", keywords: ["panel"] },
      { id: "lore-relay-dock", text: "Dock two has been sealed since the last cargo shift.", mode: "rag", keywords: [] },
    ],
    dynamic: worldDynamic({
      time: "night cycle",
      weather: "recycled air, cool",
      place: "the maintenance bay",
      atmosphere: "humming",
      ongoing: "panel three is running warm",
    }),
  },
  {
    id: "world-rain",
    name: "Rain District",
    description: "A dense city neighborhood of wet brick, late trams, and streetlamps that halo in the rain.",
    lore: [
      { id: "lore-rain-trams", text: "Trams stop running at midnight. Corner shops stay open later.", mode: "always", keywords: [] },
      { id: "lore-rain-mercer", text: "Rain on Mercer turns the crossings to mirrors.", mode: "keyword", keywords: ["rain"] },
      { id: "lore-rain-rooms", text: "The boarding house above the pharmacy rents rooms by the week.", mode: "rag", keywords: [] },
    ],
    dynamic: worldDynamic({
      time: "night",
      weather: "cold rain",
      place: "Mercer and Fourth",
      atmosphere: "watchful",
      ongoing: "the last tram has not come yet",
    }),
  },
];
