import { HOLE_PARTS } from "@/lib/house-rules";
import { HAZARDS, type HazardId } from "@/lib/hazards";
import type { RulesetPenalty } from "@/lib/ruleset";
import {
  DRINK_MAX,
  COURSE_NAME_MAX,
  FIT_NOTE_MAX,
  HAZARD_NOTE_MAX,
  clampInt,
  clampText,
  nullableEnum,
  readHazard,
  readRules,
} from "@/lib/caddy/plan";
import {
  candidatesById,
  dossierLine,
  type CandidateDossier,
} from "@/lib/caddy/dossier";
import type { RouteTrial } from "@/lib/caddy/route";

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

/**
 * How long the loop may work before it hands over what it has, and how much
 * room one more turn needs.
 *
 * The turn cap alone was not enough. The first real looped plan was killed by
 * the platform at `maxDuration`, which cost the host nothing on screen and
 * cost us every token it had already spent — the ledger row is written after
 * the call returns, and a killed function never returns. A timeout was the one
 * remaining way to spend money nobody counted.
 *
 * The headroom is the interesting half: a turn is a model call with thinking
 * on plus however long a Places search takes, so beginning one with thirty
 * seconds left is how you get killed mid-flight and lose the card *and* the
 * accounting. Better to stop one turn early holding a finished card.
 */
/**
 * The wall clock the loop lives inside.
 *
 * Lowered from 210s, and the reason is the bug it caused rather than a taste
 * for smaller numbers. `outOfLoopTime` is checked *between* turns while a
 * single turn is unbounded, so the loop could look at the clock at 200s,
 * decide it had room, and start a turn that ran past the platform's 300s
 * ceiling. The function was killed mid-call — before the loop could exit,
 * before the fallback board, before the turn row was written. The money was
 * spent and nothing recorded that it had been.
 *
 * With `TURN_TIMEOUT_MS` bounding each call, the worst case is now this plus
 * one turn, which has to fit inside `maxDuration` with room for the fallback
 * and the ledger write after it.
 */
export const CADDY_LOOP_MS = 150_000;

/**
 * The longest any single model call may run.
 *
 * The missing bound. A turn with 16k of `max_tokens` can run for minutes, and
 * nothing stopped it — the loop's clock only ever spoke between turns, which
 * is precisely when a turn is not the problem.
 */
export const TURN_TIMEOUT_MS = 90_000;
export const TURN_HEADROOM_MS = 45_000;

/**
 * Is there time for another turn?
 *
 * The clock comes in as a number rather than being read in here, which is the
 * house rule for anything with timing in it: a decision a test can make
 * without waiting three and a half minutes to watch it.
 *
 * Never stops before the first turn. A loop that gave up having done nothing
 * would hand back an empty board and call it a card.
 */
export function outOfLoopTime(turn: number, elapsedMs: number): boolean {
  return turn > 0 && elapsedMs > CADDY_LOOP_MS - TURN_HEADROOM_MS;
}

/** A search the caddy runs mid-conversation, and the ceiling on what one is
 * allowed to bring back. Small on purpose: this is a follow-up ("anywhere with
 * a garden?"), not a second gather. */
export const SEARCH_QUERY_MAX = 80;
export const SEARCH_RESULTS_MAX = 8;

export const TOOL_SEARCH = "search_pubs";
export const TOOL_READ = "read_draft";
export const TOOL_SET = "set_hole";
export const TOOL_REMOVE = "remove_hole";
export const TOOL_NAME = "name_course";
export const TOOL_ROUTE = "try_route";
export const TOOL_ROUTES = "plan_routes";
export const TOOL_EXCLUDE = "exclude_pubs";
export const TOOL_KEEP = "keep_draft";
export const TOOL_RESTORE = "restore_draft";

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
    name: TOOL_ROUTES,
    description:
      "Work out fresh walks over the pubs in the patch. Free and instant — it re-uses what has already been gathered and never goes back to Google, so ask again whenever the last set did not suit. Excluded pubs are left out.",
    input_schema: {
      type: "object" as const,
      additionalProperties: false,
      required: [],
      properties: {
        holes: {
          type: "integer",
          description: "How many stops. Defaults to the brief's own count.",
        },
        startNear: {
          type: ["string", "null"],
          description:
            "Begin at the pub with this id, or near it. Null to let the walk choose.",
        },
        finishNear: {
          type: ["string", "null"],
          description: "End at the pub with this id. Null to let the walk choose.",
        },
      },
    },
  },
  {
    name: TOOL_EXCLUDE,
    description:
      "Rule pubs out for the rest of this conversation, with a reason. Use it when a pub cannot meet the brief — no garden when one was asked for, wrong sort of place, already tried and it did not fit. Then plan_routes again and they will not come back.",
    input_schema: {
      type: "object" as const,
      additionalProperties: false,
      required: ["candidateIds", "why"],
      properties: {
        candidateIds: {
          type: "array",
          items: { type: "string" },
          description: "Ids from the patch. Only ids you have been given.",
        },
        why: {
          type: "string",
          description: "One short line — what the brief asked for that these cannot give.",
        },
      },
    },
  },
  {
    name: TOOL_KEEP,
    description:
      "Save the card as it stands, so a change can be tried and undone. Keep a draft before reworking something that already looks good.",
    input_schema: {
      type: "object" as const,
      additionalProperties: false,
      required: ["note"],
      properties: {
        note: {
          type: "string",
          description: "What this draft is, in a few words — how you will recognise it.",
        },
      },
    },
  },
  {
    name: TOOL_RESTORE,
    description:
      "Put a saved draft back on the table, replacing what is there. Use it when a change turned out worse than what it replaced.",
    input_schema: {
      type: "object" as const,
      additionalProperties: false,
      required: ["draft"],
      properties: {
        draft: {
          type: "integer",
          description: "Which saved draft, counting from 1.",
        },
      },
    },
  },
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
        drink: { type: "string", description: HOLE_PARTS.drink },
        par: {
          type: "integer",
          description: HOLE_PARTS.par,
        },
        hazard: nullableEnum(HAZARDS.map((h) => h.id)),
        hazardNote: {
          type: ["string", "null"],
          description: HOLE_PARTS.hazardNote,
        },
        fitNote: {
          type: ["string", "null"],
          description: `${HOLE_PARTS.fitNote} One short line, in your own words, and never a quoted review.`,
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
    name: TOOL_ROUTE,
    description:
      // The last sentence used to read "use it before you hand a card over,
      // and again after you change one", which contradicted the prompt above
      // it: every route in <routes> arrives already measured, and <swaps>
      // states the walk to each alternative. Told to measure what it had just
      // been told, the caddy spent a turn re-reading its own inputs. What is
      // left is the one use that is still real — a combination it assembled
      // itself, which nothing has measured yet.
      "Route a set of pubs and see what it actually walks like: the order the club will put them in, every leg in minutes, how many legs come in under the host's minimum walk, and the longest run of consecutive short ones. Call it with candidateIds to measure a combination you put together yourself. This is the same router the finished card goes through, so what it reports is what the group will walk. The routes you were offered have already been through it, and so has every swap's walk — measuring one of those again tells you what you were told.",
    input_schema: {
      type: "object" as const,
      additionalProperties: false,
      required: [],
      properties: {
        candidateIds: {
          type: ["array", "null"],
          items: { type: "string" },
          description:
            "The pubs to try, by id. Leave it out to route the holes already on the table.",
        },
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
  // Not `as const`: the SDK's tool parameter is a mutable array of mutable
  // schemas, and a deeply-readonly literal cannot be handed to it without a
  // cast that would hide a genuine mismatch. What makes this a stable cached
  // prefix is that it is a module constant built from other constants, which
  // is unaffected either way.
];

/** The four tools that change the draft — the ones this module answers. The
 * other two need a key and a session and belong to the server. */
/**
 * The tools that change the card.
 *
 * `move_hole` used to be here and is deliberately gone. The prompt told the
 * model "the walking order is not yours — leave the sequence alone" and then
 * handed it a tool for exactly that, and `parsePlan` overwrote whatever it did
 * anyway, running `orderWalk` and then `forwardOrder` over the result. So the
 * tool could only ever cost tokens and confuse the instruction: the model is a
 * curator and a tweaker, and the walk is arithmetic's.
 */
export const DRAFT_TOOLS: string[] = [TOOL_SET, TOOL_REMOVE, TOOL_NAME];

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

/**
 * A routed trial, written for the caddy to act on.
 *
 * Numbers first and a verdict never. The caddy is the one deciding whether a
 * fourteen-minute leg is a problem — that depends on the brief, and the brief
 * is already in front of it. What it cannot work out for itself is what the
 * router did with its picks, and that is all this says.
 */
export function routeTrialBlock(
  trial: RouteTrial,
  candidates: CandidateDossier[],
): string {
  const byId = candidatesById(candidates);
  const named = (id: string) => `${id} (${byId.get(id)?.name ?? "?"})`;
  if (!trial.legs.length) {
    return "Nothing to route yet — put some pubs on the table first.";
  }
  const lines = [
    "ROUTED",
    `order: ${trial.order.map(named).join(" → ")}`,
    `total walk: ${trial.totalMinutes} min`,
    ...trial.legs.map(
      (leg) =>
        `  ${leg.from} → ${leg.to}: ${leg.minutes} min${leg.short ? "  ← under the minimum" : ""}`,
    ),
  ];
  if (trial.shortLegs > 0) {
    lines.push(
      `${trial.shortLegs} ${trial.shortLegs === 1 ? "leg is" : "legs are"} shorter than asked for.`,
    );
  }
  if (trial.worstRun >= 2) {
    // The complaint that started the spacing work, named as what it is.
    lines.push(
      `${trial.worstRun + 1} pubs in a row sit almost on top of each other. Spread them out.`,
    );
  }
  if (trial.unplaced.length) {
    lines.push(
      `No coordinates for ${trial.unplaced.join(", ")}, so they are not in any of the above.`,
    );
  }
  return lines.join("\n");
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
