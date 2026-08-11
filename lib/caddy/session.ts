import type { CandidateDossier } from "@/lib/caddy/dossier";
import { tryRoute, type WalkPins } from "@/lib/caddy/route";
import {
  applyDraftTool,
  boardBlock,
  isDraftTool,
  routeTrialBlock,
  searchResultBlock,
  TOOL_READ,
  TOOL_ROUTE,
  TOOL_SEARCH,
  SEARCH_QUERY_MAX,
  type CaddyBoard,
} from "@/lib/caddy/tools";

/**
 * One tool call, answered.
 *
 * The dispatcher `lib/caddy/tools.ts` has referred to since it was written.
 * Everything it routes to is either pure (`applyDraftTool`, `tryRoute`) or
 * injected (`search`), so this module has no key, no client and no clock — the
 * loop in `client.ts` supplies the one impure capability and this decides what
 * to do with it.
 *
 * That split is the point. A tool call is the model changing the host's
 * screen, and the rules about what it may change belong somewhere a unit test
 * can reach. The only thing that genuinely needs the outside world is going
 * back to Google, and it arrives as a function.
 *
 * **The rule survives the move.** No tool anywhere accepts a pub's name, and
 * `applyDraftTool` refuses a `candidateId` the server did not mint. A search
 * widens the dossier rather than bypassing it: what comes back are real Places
 * results the server has already cached into `venues`, wearing new ids, which
 * is why `added` goes back to the caller — the dossier the *next* turn is
 * checked against has to include them, or the caddy would be offered pubs it
 * is then refused for using.
 */
export interface ToolContext {
  board: CaddyBoard;
  /** Every pub the caddy may name, including any a search has added. */
  candidates: CandidateDossier[];
  /** The brief's own walking constraints, so a trial routes the way the
   * finished card will. */
  pins: WalkPins;
  /** Back to Google, mid-conversation. Injected: this module knows nothing
   * about keys or sessions. */
  search: (query: string) => Promise<CandidateDossier[]>;
}

export interface ToolAnswer {
  /** The board after the call — unchanged for everything but a draft tool,
   * and unchanged for a refused draft tool too. */
  board: CaddyBoard;
  /** What goes back as the `tool_result`. Always a sentence the model can act
   * on, including when the answer is no. */
  reply: string;
  /** Pubs a search brought back, for the caller to fold into the dossier. */
  added: CandidateDossier[];
  /** One short line for the host, where the call is worth narrating. Null for
   * the ones that would only be noise. */
  narration: string | null;
}

function answer(over: Partial<ToolAnswer> & Pick<ToolAnswer, "board" | "reply">): ToolAnswer {
  return { added: [], narration: null, ...over };
}

export async function dispatchTool(
  name: string,
  raw: unknown,
  context: ToolContext,
): Promise<ToolAnswer> {
  const input = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;

  if (name === TOOL_READ) {
    return answer({
      board: context.board,
      reply: boardBlock(context.board, context.candidates),
    });
  }

  if (name === TOOL_SEARCH) {
    const query =
      typeof input.query === "string" ? input.query.trim().slice(0, SEARCH_QUERY_MAX) : "";
    if (!query) {
      return answer({
        board: context.board,
        reply: "That search was empty. Say what you are looking for.",
      });
    }
    const found = await context.search(query);
    return answer({
      board: context.board,
      reply: searchResultBlock(found),
      added: found,
      // The one tool call worth showing a host by name: it is the caddy
      // visibly going and looking for the thing they asked for.
      narration: `Looking for ${query}`,
    });
  }

  if (name === TOOL_ROUTE) {
    const wanted = Array.isArray(input.candidateIds)
      ? input.candidateIds.filter((id): id is string => typeof id === "string")
      : context.board.holes.map((hole) => hole.candidateId);
    const byId = new Map(context.candidates.map((pub) => [pub.id, pub]));
    const stops = wanted.flatMap((id) => {
      const pub = byId.get(id);
      return pub ? [{ id, lat: pub.lat, lng: pub.lng }] : [];
    });
    if (stops.length < 2) {
      return answer({
        board: context.board,
        reply: "Nothing to route yet — put some pubs on the table first.",
      });
    }
    return answer({
      board: context.board,
      reply: routeTrialBlock(tryRoute(stops, context.pins), context.candidates),
      narration: "Walking the route",
    });
  }

  if (isDraftTool(name)) {
    const outcome = applyDraftTool(name, raw, context.board, context.candidates);
    // A refusal leaves the board exactly as it was and goes back as an
    // ordinary result. The caddy reads the sentence and corrects itself, which
    // is the whole reason the rule moved out of the schema and down to here.
    return answer({
      board: outcome.ok ? outcome.board : context.board,
      reply: outcome.reply,
    });
  }

  // A tool nobody registered. Answering rather than throwing keeps a
  // hallucinated call from ending a plan the host has already paid for.
  return answer({
    board: context.board,
    reply: `There is no tool called ${name}. Use the ones you were given.`,
  });
}
