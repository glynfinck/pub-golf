import type { CandidateDossier } from "@/lib/caddy/dossier";
import { tryRoute, type WalkPins } from "@/lib/caddy/route";
import { buildRouteGraph, routesBlock } from "@/lib/caddy/route-graph";
import {
  applyDraftTool,
  boardBlock,
  isDraftTool,
  routeTrialBlock,
  searchResultBlock,
  TOOL_EXCLUDE,
  TOOL_KEEP,
  TOOL_READ,
  TOOL_RESTORE,
  TOOL_ROUTE,
  TOOL_ROUTES,
  TOOL_SEARCH,
  SEARCH_QUERY_MAX,
  SEARCH_RESULTS_MAX,
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
  /**
   * Pubs ruled out for the rest of the conversation, and why.
   *
   * The caddy's own judgement, written down. A pub that cannot meet the brief
   * is worth remembering rather than re-rejecting on every fresh set of
   * routes — and remembering it is what lets "plan me another, without those"
   * be a single call rather than an argument.
   */
  excluded: Map<string, string>;
  /** Cards kept so a change can be undone. The reason a tweak is safe to try. */
  drafts: { note: string; board: CaddyBoard }[];
  /** How many holes the brief asked for, when a call does not say. */
  holes: number;
  /** Where the round is aimed, so a re-plan faces the same way as the first. */
  aim: {
    from?: { lat: number; lng: number } | null;
    to?: { lat: number; lng: number } | null;
    targetKm?: number | null;
  };
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
    // Capped here rather than at Google, so the reply and the dossier can
    // never disagree: a pub named in the tool result that did not reach
    // `added` is a pub the caddy is offered and then refused for using.
    const found = (await context.search(query)).slice(0, SEARCH_RESULTS_MAX);
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

  if (name === TOOL_ROUTES) {
    // The algorithm answers, not the model. This is the whole division of
    // labour: the caddy is a curator and a tweaker, and asking it to work out
    // a walk one tool call at a time was what made a plan cost a dozen turns.
    //
    // Free to call again, and that is what makes the conversation work. No
    // Google, no network, no money — just the same candidates re-routed, so
    // "not that one, give me another without those two" is a sentence rather
    // than a negotiation.
    const live = context.candidates.filter(
      (candidate) => !context.excluded.has(candidate.id),
    );
    if (live.length < 2) {
      return answer({
        board: context.board,
        reply:
          "Not enough pubs left to walk between — that has ruled out nearly the whole patch. Search for more, or put some back.",
      });
    }
    const holes = Math.min(
      typeof input.holes === "number" && input.holes >= 2
        ? Math.floor(input.holes)
        : context.holes,
      live.length,
    );
    // A pin the caddy names has to be a pub that is still in play. An id it
    // has just excluded, or one nobody offered, is ignored rather than passed
    // down: the graph would drop it silently and the caddy would never learn
    // that the walk it asked for is not the walk it got.
    const inPlay = new Set(live.map((candidate) => candidate.id));
    const pin = (value: unknown) =>
      typeof value === "string" && inPlay.has(value) ? value : null;
    const graph = buildRouteGraph(live, {
      holes,
      startId: pin(input.startNear),
      finishId: pin(input.finishNear),
      targetKm: context.aim.targetKm ?? null,
      aimFrom: context.aim.from,
      aimTo: context.aim.to,
      routes: 6,
    });
    return answer({
      board: context.board,
      reply: routesBlock(graph) || "No walk fits that patch. Try fewer holes.",
      narration: "Working out some walks",
    });
  }

  if (name === TOOL_EXCLUDE) {
    const ids = Array.isArray(input.candidateIds)
      ? input.candidateIds.filter((id): id is string => typeof id === "string")
      : [];
    const why = typeof input.why === "string" ? input.why.trim().slice(0, 120) : "";
    const known = new Set(context.candidates.map((candidate) => candidate.id));
    const ruled = ids.filter((id) => known.has(id));
    // An id nobody offered is refused as a sentence, exactly as `set_hole`
    // refuses one — the never-invent-a-pub rule holds on every door.
    if (ruled.length === 0) {
      return answer({
        board: context.board,
        reply: "None of those are pubs in this patch. Use ids from the list.",
      });
    }
    for (const id of ruled) context.excluded.set(id, why || "not a fit");
    return answer({
      board: context.board,
      reply: `Ruled out ${ruled.length} pub${ruled.length === 1 ? "" : "s"}. plan_routes will leave them out from now on.`,
      narration: why ? `Ruling out ${ruled.length}: ${why}` : null,
    });
  }

  if (name === TOOL_KEEP) {
    const note = typeof input.note === "string" ? input.note.trim().slice(0, 80) : "";
    context.drafts.push({ note: note || `draft ${context.drafts.length + 1}`, board: context.board });
    return answer({
      board: context.board,
      reply: `Kept as draft ${context.drafts.length}: ${context.drafts[context.drafts.length - 1].note}. Try what you like — restore_draft brings it back.`,
    });
  }

  if (name === TOOL_RESTORE) {
    const which = typeof input.draft === "number" ? Math.floor(input.draft) : 0;
    const draft = context.drafts[which - 1];
    if (!draft) {
      return answer({
        board: context.board,
        reply:
          context.drafts.length === 0
            ? "Nothing has been kept yet. keep_draft saves the card as it stands."
            : `There are ${context.drafts.length} drafts. Ask for one of those.`,
      });
    }
    return answer({
      board: draft.board,
      reply: `Back to draft ${which}: ${draft.note}.`,
      narration: `Going back to ${draft.note}`,
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
