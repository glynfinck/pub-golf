import { HAZARDS, type HazardId } from "@/lib/hazards";
import type { RulesetPenalty } from "@/lib/ruleset";
import {
  DRINK_MAX,
  COURSE_NAME_MAX,
  FIT_NOTE_MAX,
  HAZARD_NOTE_MAX,
  clampInt,
  clampText,
  readHazard,
  readRules,
} from "@/lib/caddy/plan";
import {
  candidatesById,
  dossierLine,
  type CandidateDossier,
} from "@/lib/caddy/dossier";

/**
 * The caddy's hands: the tools it may call, and what each one does to the
 * drafting table.
 *
 * Until now the caddy answered once, in a fixed shape, and the shape was the
 * safety rule — `candidateId` was a JSON Schema enum, so a constrained decoder
 * could not emit a pub nobody offered. Tools take that away: a tool input is
 * whatever the model puts in it. So the rule moves down a layer and is enforced
 * here instead, by a reducer, and it is enforced harder:
 *
 * **No tool anywhere accepts a pub's name.** Read the schemas below — the only
 * way to put a pub on a hole is `candidateId`, and `applyDraftTool` refuses an
 * id that is not in the dossier the server built out of real Places results.
 * There is no field a fabricated pub could travel in. A name is something the
 * server attaches on the way out, from the `venues` row, and never something
 * the model supplies. That is the same guarantee the enum gave, at a layer that
 * can also explain itself: a bad id comes back as a sentence the caddy reads
 * and corrects, rather than as a broken card.
 *
 * Everything in this module is pure. The two impure tools — searching Google
 * and reading the table — are dispatched by the server (`lib/caddy/session.ts`)
 * because they need a key and a session; the four that *change* the draft are
 * all here, because a change to the host's screen is exactly the thing that
 * should be provable in a unit test.
 */

/** How many times round the tool loop before the caddy is cut off. Generous
 * enough for "search, look, fix four holes, look again" and far short of a
 * model that has started pacing. A cut-off is not an error: whatever is on the
 * board at that point is a real card and is handed over as one. */
export const MAX_TOOL_TURNS = 12;

/** A search the caddy runs mid-conversation, and the ceiling on what one is
 * allowed to bring back. Small on purpose: this is a follow-up ("anywhere with
 * a garden?"), not a second gather. */
export const SEARCH_QUERY_MAX = 80;
export const SEARCH_RESULTS_MAX = 8;

export const TOOL_SEARCH = "search_pubs";
export const TOOL_READ = "read_draft";
export const TOOL_SET = "set_hole";
export const TOOL_REMOVE = "remove_hole";
export const TOOL_MOVE = "move_hole";
export const TOOL_NAME = "name_course";

/** One hole as the caddy holds it: an id and its dressing. The venue behind
 * the id is the server's business, which is the whole point. */
export interface BoardHole {
  candidateId: string;
  drink: string;
  par: number;
  hazard: HazardId | null;
  hazardNote: string | null;
  fitNote: string | null;
  localRules: RulesetPenalty[];
}

/** The drafting table, mid-conversation. */
export interface CaddyBoard {
  name: string;
  holes: BoardHole[];
}

/**
 * What a tool call did.
 *
 * A refusal is `ok: false` and still carries a sentence, because it is not an
 * error — it goes back to the model as an ordinary tool result and the caddy
 * corrects itself on the next turn. This is why the tool layer is a better home
 * for the rule than the schema was: a schema can only make a bad id
 * unrepresentable, whereas this can make it *answerable*.
 */
export type ToolOutcome =
  | { ok: true; board: CaddyBoard; reply: string }
  | { ok: false; reply: string };

/** The tool definitions, in the wire shape the Messages API wants.
 *
 * These sit inside the cached prefix alongside the system rules and the
 * dossier, so like both of those they are a fixed constant and never built per
 * request. A description assembled from a template would re-write the prefix on
 * every call and quietly turn every cache read back into a cache write. */
export const CADDY_TOOLS = [
  {
    name: TOOL_READ,
    description:
      "Look at the drafting table as it stands: the course name and every hole on it, in order, with what each is dressed as. Call this first if you have not seen the table this turn, and again after you change it. The host edits the same table by hand, so what is on it may not be what you last left there.",
    input_schema: {
      type: "object" as const,
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: TOOL_SEARCH,
    description:
      "Search for more real pubs in this patch when the ones you were given do not answer the brief — a different sort of place, or somewhere near a particular hole. Returns pubs in the same numbered form, with new ids you may then use. Say what you are looking for in plain words, as you would to a local.",
    input_schema: {
      type: "object" as const,
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description:
            "What to look for, in plain words: 'cocktail bar', 'proper old boozer with a garden', 'somewhere doing food'.",
        },
        near: {
          type: "string",
          description:
            "Optional. The id of a pub to search around, when the host asked for something near a particular hole.",
        },
      },
    },
  },
  {
    name: TOOL_SET,
    description:
      "Put a pub on a hole and dress it. Use an existing hole number to replace what is there, or the next number up to add a hole to the end. A pub may only be on the card once.",
    input_schema: {
      type: "object" as const,
      additionalProperties: false,
      required: ["hole", "candidateId", "drink", "par"],
      properties: {
        hole: {
          type: "integer",
          description: "Which hole, counting from 1.",
        },
        candidateId: {
          type: "string",
          description:
            "The id of the pub, from the patch or from a search. Only ids you have been given.",
        },
        drink: { type: "string" },
        par: {
          type: "integer",
          description: "Swigs the drink should take: 2 a half or a short, 3 a spirit and mixer, 4 a pint, 5 a pint of something heavy.",
        },
        hazard: { type: ["string", "null"], enum: [...HAZARDS.map((h) => h.id), null] },
        hazardNote: { type: ["string", "null"] },
        fitNote: {
          type: ["string", "null"],
          description:
            "One short line on why this pub suits what was asked, in your own words. Never quote a review.",
        },
        localRules: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["strokes", "reason"],
            properties: {
              strokes: { type: "integer" },
              reason: { type: "string" },
            },
          },
        },
      },
    },
  },
  {
    name: TOOL_REMOVE,
    description:
      "Take a hole off the card. The holes after it move up a number.",
    input_schema: {
      type: "object" as const,
      additionalProperties: false,
      required: ["hole"],
      properties: {
        hole: { type: "integer", description: "Which hole, counting from 1." },
      },
    },
  },
  {
    name: TOOL_MOVE,
    description:
      "Move a hole to a different position in the walking order, keeping its dressing.",
    input_schema: {
      type: "object" as const,
      additionalProperties: false,
      required: ["from", "to"],
      properties: {
        from: { type: "integer" },
        to: { type: "integer" },
      },
    },
  },
  {
    name: TOOL_NAME,
    description: "Name the course.",
    input_schema: {
      type: "object" as const,
      additionalProperties: false,
      required: ["name"],
      properties: { name: { type: "string" } },
    },
  },
] as const;

/** The four tools that change the draft — the ones this module answers. The
 * other two need a key and a session and belong to the server. */
export const DRAFT_TOOLS: string[] = [TOOL_SET, TOOL_REMOVE, TOOL_MOVE, TOOL_NAME];

export function isDraftTool(name: string): boolean {
  return DRAFT_TOOLS.includes(name);
}

// ————————————————— what the caddy sees —————————————————

function dressing(hole: BoardHole): string {
  const parts = [`${hole.drink} · par ${hole.par}`];
  if (hole.hazard) {
    parts.push(
      `hazard: ${hole.hazard}${hole.hazardNote ? ` — ${hole.hazardNote}` : ""}`,
    );
  }
  hole.localRules.forEach((rule) => {
    parts.push(`rule: +${rule.strokes} ${rule.reason}`);
  });
  if (hole.fitNote) parts.push(`why: ${hole.fitNote}`);
  return parts.join(" | ");
}

/**
 * The drafting table, written down.
 *
 * Pubs are named here, and that is fine and deliberate: names go *into* the
 * prompt freely — it is the return path that is closed. The caddy needs to read
 * "hole 3 is The Marksman" to answer "swap hole 3", and it puts the answer back
 * as `p7`.
 */
export function boardBlock(
  board: CaddyBoard,
  candidates: CandidateDossier[],
): string {
  const byId = candidatesById(candidates);
  if (!board.holes.length) {
    return ["THE DRAFTING TABLE", `name: ${board.name || "(unnamed)"}`, "(no holes on it yet)"].join("\n");
  }
  return [
    "THE DRAFTING TABLE",
    `name: ${board.name || "(unnamed)"}`,
    ...board.holes.map((hole, index) => {
      const candidate = byId.get(hole.candidateId);
      // A hole whose pub is not in the dossier is one the host added by hand
      // from the builder's own search. It is shown, because the caddy must not
      // plan around a hole it cannot see, but it has no id to be moved onto.
      const who = candidate
        ? `${hole.candidateId} | ${candidate.name}`
        : "— | (a pub the host added by hand)";
      return `hole ${index + 1} | ${who} | ${dressing(hole)}`;
    }),
  ].join("\n");
}

/** Search results, written in the dossier's own form so the caddy reads one
 * format all conversation. Lives in the uncached tail, never the prefix. */
export function searchResultBlock(found: CandidateDossier[]): string {
  if (!found.length) {
    return "Nothing new came back for that. The pubs you already have are all there is in this patch.";
  }
  return [
    `${found.length} more real ${found.length === 1 ? "pub" : "pubs"}, ids yours to use:`,
    "",
    ...found.map(dossierLine),
  ].join("\n");
}

// ————————————————— what the caddy may change —————————————————

function readHoleNumber(value: unknown): number | null {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 1 ? n : null;
}

/**
 * Apply one draft-changing tool call. Pure: a board in, a board out.
 *
 * Every refusal names what went wrong in a sentence the model can act on,
 * because the model is the reader. None of them throws and none of them
 * half-applies — a refused call leaves the board exactly as it was, so a
 * confused turn costs the host nothing on screen.
 */
export function applyDraftTool(
  name: string,
  raw: unknown,
  board: CaddyBoard,
  candidates: CandidateDossier[],
): ToolOutcome {
  const input = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;

  if (name === TOOL_NAME) {
    const next = clampText(input.name, COURSE_NAME_MAX);
    if (!next) return { ok: false, reply: "That name was empty. Give the course a name." };
    return {
      ok: true,
      board: { ...board, name: next },
      reply: `The course is called ${next}.`,
    };
  }

  if (name === TOOL_SET) {
    const id = typeof input.candidateId === "string" ? input.candidateId : "";
    const candidate = candidatesById(candidates).get(id);
    // The rule, in one line. An id nobody offered is refused — and because the
    // refusal is a sentence rather than a crash, the caddy simply picks a real
    // one next turn.
    if (!candidate) {
      return {
        ok: false,
        reply: `There is no pub ${id || "(none given)"} in this patch. Use an id from the list you were given, or search for more.`,
      };
    }

    const hole = readHoleNumber(input.hole);
    if (hole === null) {
      return { ok: false, reply: "Which hole? Give a hole number, counting from 1." };
    }
    const index = Math.min(hole, board.holes.length + 1) - 1;

    const clash = board.holes.findIndex(
      (existing, at) => existing.candidateId === id && at !== index,
    );
    if (clash !== -1) {
      return {
        ok: false,
        reply: `That pub is already hole ${clash + 1}. A pub goes on the card once — move it, or pick another.`,
      };
    }

    const hazard = readHazard(input.hazard);
    const next: BoardHole = {
      candidateId: id,
      drink: clampText(input.drink, DRINK_MAX) || "Pint of your choosing",
      par: clampInt(input.par, 1, 20, 4),
      hazard,
      hazardNote: hazard
        ? clampText(input.hazardNote, HAZARD_NOTE_MAX) || null
        : null,
      fitNote: clampText(input.fitNote, FIT_NOTE_MAX) || null,
      localRules: readRules(input.localRules),
    };

    const holes = [...board.holes];
    const replaced = index < holes.length;
    if (replaced) holes[index] = next;
    else holes.push(next);
    return {
      ok: true,
      board: { ...board, holes },
      reply: `Hole ${index + 1} is now ${candidate.name}, ${next.drink.toLowerCase()}, par ${next.par}.`,
    };
  }

  if (name === TOOL_REMOVE) {
    const hole = readHoleNumber(input.hole);
    if (hole === null || hole > board.holes.length) {
      return {
        ok: false,
        reply: `There is no hole ${input.hole}. The card has ${board.holes.length}.`,
      };
    }
    const holes = board.holes.filter((_, index) => index !== hole - 1);
    return {
      ok: true,
      board: { ...board, holes },
      reply: `Hole ${hole} is off the card. ${holes.length} left.`,
    };
  }

  if (name === TOOL_MOVE) {
    const from = readHoleNumber(input.from);
    const to = readHoleNumber(input.to);
    if (from === null || from > board.holes.length) {
      return {
        ok: false,
        reply: `There is no hole ${input.from}. The card has ${board.holes.length}.`,
      };
    }
    if (to === null) {
      return { ok: false, reply: "Move it to which position? Count from 1." };
    }
    const target = Math.min(to, board.holes.length);
    const holes = [...board.holes];
    const [moved] = holes.splice(from - 1, 1);
    holes.splice(target - 1, 0, moved);
    return {
      ok: true,
      board: { ...board, holes },
      reply: `Moved. That pub is hole ${target} now.`,
    };
  }

  return { ok: false, reply: `There is no tool called ${name}.` };
}

/** Read a search's arguments, clamped. Impure dispatch happens elsewhere; the
 * reading of what was asked for is testable and lives here. */
export function readSearchCall(
  raw: unknown,
  candidates: CandidateDossier[],
): { query: string; near: CandidateDossier | null } | null {
  const input = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  const query = clampText(input.query, SEARCH_QUERY_MAX);
  if (!query) return null;
  const near =
    typeof input.near === "string"
      ? (candidatesById(candidates).get(input.near) ?? null)
      : null;
  return { query, near };
}
