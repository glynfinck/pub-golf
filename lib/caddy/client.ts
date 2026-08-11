import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import {
  CADDY_SYSTEM,
  CADDY_SYSTEM_TOOLS,
  askBlock,
  briefBlock,
  parsePlan,
  patchBlock,
  planSchema,
  type PlanResult,
  type PlannedCourse,
} from "@/lib/caddy/plan";
import type { CaddyBrief } from "@/lib/caddy/brief";
import { buildRouteGraph, targetKmFor } from "@/lib/caddy/route-graph";
import { DEFAULT_DRINK, DEFAULT_PAR } from "@/lib/course-draft";
import {
  addUsage,
  costMicroPence,
  NO_USAGE,
  readUsage,
  type CaddyUsage,
} from "@/lib/caddy/budget";
import { caddyCredentials } from "@/lib/caddy/credentials";
import type { CandidateDossier } from "@/lib/caddy/dossier";
import { dispatchTool } from "@/lib/caddy/session";
import type { WalkPins } from "@/lib/caddy/route";
import {
  CADDY_TOOLS,
  MAX_TOOL_TURNS,
  outOfLoopTime,
  type CaddyBoard,
} from "@/lib/caddy/tools";
import {
  describeFailure,
  FAILURE_LOG_MAX,
  isPermanentFailure,
} from "@/lib/caddy/failure";

/**
 * The caddy's own hand — the one place in the app that talks to a model.
 *
 * A port, deliberately: everything above it is pure and everything below it is
 * one vendor, so the gate can bind a fixture instead and no third-party
 * network ever enters CI. That is the doctrine the billing webhook already
 * follows with Stripe's own signing helper.
 *
 * **One patch, one conversation.** The system rules and the candidate dossier
 * are a stable prefix carrying a `cache_control` breakpoint, so every turn
 * after the first re-reads the patch at roughly a tenth of the price and none
 * of the time. That is what makes asking uncounted affordable — the marginal
 * tweak costs pennies — so the byte-stability of `patchBlock` is not tidiness,
 * it is the economics.
 */

/**
 * Effort, and why `high`.
 *
 * `high` is this model's own default and the documented setting for most
 * intelligence-sensitive work; `medium` is a cost step-down. The caddy is not
 * a lookup — it reads forty dossiers with their review snippets and editorial
 * lines and decides which nine pubs make a good night out of them, which is
 * exactly the judgment the extra thinking buys. The budget has room for it
 * (`lib/caddy/budget.ts`): a plan is pence against an allowance in pounds.
 *
 * Worth a sweep once there are real briefs to sweep against — `xhigh` is
 * documented as the setting for the hardest agentic work and would be the next
 * thing to try when the tool loop lands.
 */
const EFFORT = "high" as const;

/**
 * Thinking, stated rather than inherited.
 *
 * Adaptive thinking is already what this model does when the field is omitted,
 * so this changes nothing today — it is here because *which* model is running
 * is an environment variable (`CADDY_MODEL`), and the default is not uniform
 * across the family: on Opus 4.8 and 4.7 an omitted `thinking` means no
 * thinking at all. Leaving it implicit means a one-word env change could
 * silently turn the caddy's reasoning off.
 *
 * `display` is left at its default, which returns the blocks with their text
 * empty. Nothing here reads the reasoning — the card is the output — and
 * asking for a summary would be tokens spent on something nobody looks at.
 */
const THINKING = { type: "adaptive" } as const;

/**
 * The same thinking, with the summary turned on, for the streamed plan.
 *
 * `display` defaults to `"omitted"`, which returns the blocks with their text
 * empty — right for a call nobody watches, and exactly wrong for one whose
 * whole point is that somebody is watching. `"summarized"` is the only setting
 * that returns readable text at all on this family; the raw chain of thought
 * is never returned by any of them.
 *
 * It changes nothing about the answer and nothing about the bill: thinking
 * happens and is billed the same under every setting. What it buys is the
 * difference between twenty seconds of spinner and twenty seconds of somebody
 * visibly working.
 */
const THINKING_SHOWN = { type: "adaptive", display: "summarized" } as const;

/**
 * Room for the thinking *and* the answer, which is one budget rather than two.
 *
 * `max_tokens` caps them together, so a limit sized for eighteen dressed holes
 * alone gets spent on reasoning first and truncates the card — the failure
 * looks like a short card rather than like a budget problem. Sixteen thousand
 * is the house guidance for a non-streaming call: enough headroom for a long
 * think, still inside the SDK's HTTP timeout, and far above what the answer
 * itself needs.
 */
const MAX_TOKENS = 16_000;



/** One turn of the conversation, as the transcript remembers it. */
export interface CaddyTurnRecord {
  kind: "plan" | "roll" | "tweak";
  ask: string | null;
  course: PlannedCourse;
}

export interface CaddyAsk {
  brief: CaddyBrief;
  candidates: CandidateDossier[];
  /** Everything said so far on this patch, oldest first. Empty for a plan. */
  history: CaddyTurnRecord[];
  /** What the host said, on a tweak. */
  ask?: string;
  /** Which hole the ask is about, when it came from a hole's own menu. */
  holeNumber?: number | null;
  /** A roll asks for a fresh card from the same patch. */
  roll?: boolean;
}

/**
 * What a call cost, always — on the way out of a card and on the way out of a
 * failure alike. A refusal and a malformed answer are billed by the vendor
 * exactly like a good one, so the caller needs the figure in every branch or
 * failures become the one unmetered way to spend (see the `failed` column in
 * migration 20260826).
 */
export type CaddyOutcome = (
  | PlanResult
  | { ok: false; reason: "unavailable" | "misconfigured" }
) & {
  usage: CaddyUsage;
  model: string;
  /** Why it failed, redacted and one line. Never shown to a player — it exists
   * for the server log and for the staging note. */
  detail?: string;
};

/**
 * Ask the caddy. Returns a resolved card or a reason, and never throws — every
 * failure here is a line on screen and none of them costs the host a card.
 */
export async function askCaddy(input: CaddyAsk): Promise<CaddyOutcome> {
  const call = openCall();
  if (!call) return unavailable();
  try {
    const response = await call.client.messages.create({
      ...requestOf(input, call.model),
      thinking: THINKING,
    });
    return interpret(response, input, call.model);
  } catch (cause) {
    return lostBall(cause, call, "");
  }
}

/**
 * Ask the caddy, and narrate the wait.
 *
 * The same request as `askCaddy` — same system rules, same cached dossier,
 * same schema — with `stream` on and the thinking summary asked for. The
 * caller is handed the reasoning and the half-written answer as they arrive;
 * what it does with them is its business, and dropping every one of them would
 * still leave a correct card at the end.
 *
 * The two share everything except those two lines, which is the point: a
 * streamed plan and an unstreamed tweak must fail identically, bill
 * identically and parse identically, and the cheapest way to guarantee that is
 * for there to be one of each.
 */
export async function askCaddyStreamed(
  input: CaddyAsk,
  narrate: (update: { thinking?: string; answer?: string }) => void,
): Promise<CaddyOutcome> {
  const call = openCall();
  if (!call) return unavailable();
  try {
    const stream = call.client.messages.stream({
      ...requestOf(input, call.model),
      thinking: THINKING_SHOWN,
    });
    // Two deltas matter and the rest is structure. `thinking` is the window;
    // `text` is the answer being written, which the caller reads picks out of.
    stream.on("streamEvent", (event) => {
      if (event.type !== "content_block_delta") return;
      if (event.delta.type === "thinking_delta") {
        narrate({ thinking: event.delta.thinking });
      } else if (event.delta.type === "text_delta") {
        narrate({ answer: event.delta.text });
      }
    });
    return interpret(await stream.finalMessage(), input, call.model);
  } catch (cause) {
    return lostBall(cause, call, "stream ");
  }
}

/** An open line to the vendor, or null when this deploy has no credentials. */
function openCall() {
  // Read per call, never at module load: a Vercel OIDC token rotates, and a
  // credential captured once at cold start goes stale under the deploy.
  const credentials = caddyCredentials(process.env);
  if (!credentials) return null;
  return {
    credentials,
    model: credentials.model,
    client: new Anthropic({
      apiKey: credentials.apiKey ?? null,
      authToken: credentials.authToken,
      ...(credentials.baseURL ? { baseURL: credentials.baseURL } : {}),
    }),
  };
}

function unavailable(): CaddyOutcome {
  return { ok: false, reason: "unavailable", usage: { ...NO_USAGE }, model: "" };
}

/** Everything about the request that does not depend on how it is sent. */
function requestOf(input: CaddyAsk, model: string) {
  return {
    model,
    max_tokens: MAX_TOKENS,
    system: CADDY_SYSTEM,
    output_config: {
      effort: EFFORT,
      format: {
        type: "json_schema" as const,
        schema: planSchema(input.candidates),
      },
    },
    messages: buildMessages(input),
  };
}

/**
 * A finished message, read once — and read for what it cost *before* it is
 * read for what it says.
 *
 * Every branch below returns usage, because a refusal and a malformed answer
 * are billed by the vendor exactly like a good one. Miss one and failures
 * become the one unmetered way to spend (see the `failed` column in migration
 * 20260826).
 */
function interpret(
  response: Anthropic.Message,
  input: CaddyAsk,
  model: string,
): CaddyOutcome {
  const usage = readUsage(response.usage);
  const spent = <T extends { ok: boolean }>(outcome: T) => ({ ...outcome, usage, model });

  // A refusal is a content outcome, not an error — check before reading.
  if (response.stop_reason === "refusal") {
    return spent({ ok: false as const, reason: "malformed" as const });
  }
  const text = response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
  if (!text.trim()) return spent({ ok: false as const, reason: "malformed" as const });

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return spent({ ok: false as const, reason: "malformed" as const });
  }
  return spent(parsePlan(payload, input.candidates, input.brief));
}

/**
 * The caddy lost the ball.
 *
 * Timeouts, rate limits, a bad gateway — all of them cost the host nothing and
 * none of them reach them as a vendor's error message. Usage is genuinely
 * unknown: the call may never have reached the model, and guessing a number
 * would put an invented charge on a real bill.
 *
 * The reason is kept rather than dropped. Swallowing it entirely is what
 * turned the first real staging failure into a guessing game — the host saw
 * one line, the log had nothing, and the only way forward was to redeploy with
 * logging. Once was enough. The log gets the whole thing and the screen gets
 * the short form, because a vendor nests the sentence that matters — which
 * field it actually rejected — well past where a toast would stop.
 */
function lostBall(
  cause: unknown,
  call: NonNullable<ReturnType<typeof openCall>>,
  label: string,
): CaddyOutcome {
  console.error(
    `[caddy] ${call.credentials.via} ${call.model} ${label}failed: ${describeFailure(cause, FAILURE_LOG_MAX)}`,
  );
  return {
    ok: false,
    // A 401/403/404 is the deploy being wrong, not the night being unlucky —
    // it will answer identically for ever. Saying so is the difference between
    // an honest line and one that has a paying host tapping a dead button.
    reason: isPermanentFailure(cause) ? "misconfigured" : "unavailable",
    usage: { ...NO_USAGE },
    model: call.model,
    detail: describeFailure(cause),
  };
}

/**
 * The conversation, assembled.
 *
 * Ordering is the whole trick: the dossier goes first and carries the cache
 * breakpoint, the brief follows it, and every later turn is appended after
 * both. Nothing before the breakpoint ever varies within a session, so the
 * prefix hits cache on every turn but the first.
 */
function buildMessages(input: CaddyAsk): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: patchBlock(input.candidates, input.brief),
          // The breakpoint. Everything above is byte-identical for the life of
          // the session; everything below is cheap to re-send.
          cache_control: { type: "ephemeral" },
        },
        { type: "text", text: briefBlock(input.brief, input.candidates) },
      ],
    },
  ];

  // The transcript. Each past turn is replayed as the card it produced, so the
  // caddy can be asked to change "hole three" and know which pub that is.
  input.history.forEach((turn) => {
    messages.push({
      role: "assistant",
      content: JSON.stringify(asWire(turn.course, input.candidates)),
    });
    if (turn.ask) {
      messages.push({ role: "user", content: askBlock(turn.ask, null) });
    }
  });

  if (input.ask) {
    messages.push({
      role: "user",
      content: askBlock(input.ask, input.holeNumber ?? null),
    });
  } else if (input.roll) {
    messages.push({
      role: "user",
      content:
        "Write a different card for the same patch. Keep the brief; change which pubs are on it and the order they come in. Answer in the same shape.",
    });
  }
  return messages;
}

/**
 * A card, back in the wire shape the caddy speaks — ids, never names.
 *
 * Replaying an assistant turn as ids rather than as names keeps the rule
 * whole even inside the transcript: at no point in the conversation is the
 * model shown a pub name it could echo back as its own invention.
 */
function asWire(course: PlannedCourse, candidates: CandidateDossier[]) {
  const idByVenue = new Map(candidates.map((c) => [c.venueId, c.id]));
  return {
    courseName: course.name,
    holes: course.holes
      .map((hole) => ({
        candidateId: hole.venue_id ? idByVenue.get(hole.venue_id) : undefined,
        drink: hole.drink,
        par: hole.par,
        hazard: hole.hazard,
        hazardNote: hole.hazard_note,
        fitNote: hole.fit_note,
        localRules: hole.penalties,
      }))
      .filter((hole) => hole.candidateId !== undefined),
  };
}

/**
 * Ask the caddy, and let it do the work properly.
 *
 * The looped plan: search when the patch is thin, route what it has picked,
 * read what the routing said, fix it, route again. The point is not that the
 * host can revise more easily — it is that they should not have to. Every
 * revision this saves is a revision they never see, and it is cheaper than the
 * conversation it replaces: a tweak costs a cached prefix plus fresh output,
 * so a plan that lands first time beats one that takes four rounds to.
 *
 * Three things are different from `askCaddy`, and each of them follows from
 * the board being the card:
 *
 *   **No `output_config.format`.** There is no final answer in a fixed shape.
 *   That resolves the tension the tools raised rather than dodging it: the
 *   constrained decoder used to make "never invent a pub" unrepresentable, and
 *   now `applyDraftTool` refuses an unknown id instead — as a sentence the
 *   caddy reads and corrects, rather than as a broken card.
 *
 *   **One bill, many calls.** Usage is summed across the loop, because one
 *   plan is one thing the host asked for and stays one `caddy_turns` row.
 *
 *   **The dossier grows.** A search adds real pubs mid-conversation, and the
 *   additions have to reach `parsePlan` or the caddy would be offered pubs and
 *   then refused for using them. They ride in tool results rather than in the
 *   prefix, so the cached block is still byte-identical every turn.
 *
 * Running out of turns is not a failure. Whatever is on the table is a real
 * card — every hole on it went through the same reducer — so it is handed over
 * as one.
 */
export async function askCaddyLooped(
  input: CaddyAsk,
  deps: {
    search: (query: string) => Promise<CandidateDossier[]>;
    pins: WalkPins;
    /** A runaway ceiling in micropence, set far above any honest plan. Not a
     * budget: a plan is bounded by its turns, and this exists to catch a loop
     * that has gone wrong rather than one that was expensive. */
    breaker: number;
  },
  narrate: (update: { thinking?: string; doing?: string }) => void,
): Promise<CaddyOutcome> {
  const call = openCall();
  if (!call) return unavailable();

  const messages = buildMessages(input);
  let board: CaddyBoard = { name: "", holes: [] };
  let candidates = input.candidates;
  let usage: CaddyUsage = { ...NO_USAGE };

  const startedAt = Date.now();
  try {
    for (let turn = 0; turn < MAX_TOOL_TURNS; turn += 1) {
      // Out of time is a reason to hand over, never a reason to fail. The
      // board is whatever the last completed turn left, which is a card.
      if (outOfLoopTime(turn, Date.now() - startedAt)) {
        console.warn(
          `[caddy] loop stopped on the clock after ${turn} turns with ${board.holes.length} holes`,
        );
        break;
      }
      // A circuit breaker, not a budget — and the distinction is the whole
      // point. This was briefly a cap that truncated a plan to fit its share
      // of the fee, which looks like generosity and is the opposite: a host
      // who paid for a re-design and got a four-turn card that was never
      // route-checked has been quietly handed a lesser product and cannot
      // tell. Work is bounded in *turns*, which is an honest bound the caddy
      // is told about; what a turn costs is ours to absorb, because absorbing
      // variance is what a fixed price is for.
      //
      // So this fires only on a runaway — far above any plan that has ever
      // been honest — and when it fires it shouts, because it means something
      // is wrong rather than that somebody was unlucky.
      const spentSoFar = costMicroPence(usage, call.model);
      if (turn > 0 && spentSoFar >= deps.breaker) {
        console.error(
          `[caddy] RUNAWAY: loop broke after ${turn} turns and ${spentSoFar} micropence (breaker ${deps.breaker}) with ${board.holes.length} holes — investigate`,
        );
        break;
      }
      // Streamed, not awaited whole. The loop shipped using `messages.create`
      // and that was the wrong call in the most literal sense: a turn takes
      // the better part of a minute, so the host got a spinner and silence
      // until it finished, then a paragraph all at once. The narration is the
      // reason any of this streams — dropping it inside the loop dropped it
      // from the *only* turn long enough to need it.
      const turnStream = call.client.messages.stream({
        model: call.model,
        max_tokens: MAX_TOKENS,
        system: CADDY_SYSTEM_TOOLS,
        thinking: THINKING_SHOWN,
        output_config: { effort: EFFORT },
        tools: CADDY_TOOLS,
        messages,
      });
      turnStream.on("streamEvent", (event) => {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "thinking_delta"
        ) {
          narrate({ thinking: event.delta.thinking });
        }
      });
      const response = await turnStream.finalMessage();
      usage = addUsage(usage, readUsage(response.usage));

      // Nothing more to do: the caddy has stopped reaching for tools, which is
      // how it says the card is finished.
      if (response.stop_reason !== "tool_use") break;

      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const answered = await dispatchTool(block.name, block.input, {
          board,
          candidates,
          pins: deps.pins,
          search: deps.search,
        });
        board = answered.board;
        if (answered.added.length) candidates = [...candidates, ...answered.added];
        if (answered.narration) narrate({ doing: answered.narration });
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: answered.reply,
        });
      }
      messages.push({ role: "user", content: results });
    }
  } catch (cause) {
    // Tokens already spent are still owed, so the usage so far goes back with
    // the failure rather than being written off — unlike a call that never
    // reached the model at all.
    return { ...lostBall(cause, call, "loop "), usage };
  }

  // The board, through the one parser. Everything the single-shot plan gets —
  // the walking order, water off the last hole, a short for a bunker, the
  // pinned-tee check — is applied here and nowhere else.
  // A loop that ran out of time before it drafted anything used to return an
  // empty board, which the caller reads as a failure — so the host paid for a
  // full plan (29.20p on the run that prompted this) and got a sentence. The
  // work was real; it was spent searching rather than drafting, and refusing
  // to hand over anything is the one outcome nobody wants.
  //
  // So a board with no holes falls back to the route the graph already worked
  // out before the model was even called. It is the honest floor of this
  // feature: a real walk over real pubs, in a sensible order, wearing default
  // dress. Merely good beats nothing, absolutely.
  //
  // A *fallback* rather than a seed, deliberately. Seeding the live board
  // would put holes in front of the model that it did not choose and would
  // have to reason about removing, which changes every successful plan to
  // rescue the failing ones. This changes only the runs that would otherwise
  // have delivered nothing.
  if (board.holes.length === 0) {
    const rescue = fallbackBoard(candidates, input.brief);
    if (rescue.holes.length > 0) {
      console.warn(
        `[caddy] loop drafted nothing; handing over the precomputed route with ${rescue.holes.length} holes`,
      );
      board = rescue;
    }
  }

  const parsed = parsePlan(
    {
      courseName: board.name,
      holes: board.holes.map((hole) => ({
        candidateId: hole.candidateId,
        drink: hole.drink,
        par: hole.par,
        hazard: hole.hazard,
        hazardNote: hole.hazardNote,
        fitNote: hole.fitNote,
        localRules: hole.localRules,
      })),
    },
    candidates,
    input.brief,
  );
  return { ...parsed, usage, model: call.model };
}

/**
 * The floor: the best precomputed route, dressed with house defaults.
 *
 * Everything here is already decided by the time it is called — the graph
 * chose the stops before the model ran, and the drink and par are the same
 * ones the manual builder starts a hole with. Nothing is invented, least of
 * all a pub: every stop is a candidate id.
 *
 * The course goes unnamed. `parsePlan` gives an unnamed course the house
 * fallback, and a name made up here would be the one part of this that the
 * caddy is supposed to write.
 */
function fallbackBoard(
  candidates: CandidateDossier[],
  brief: CaddyAsk["brief"],
): CaddyBoard {
  const graph = buildRouteGraph(candidates, {
    holes: brief.holes,
    startId: candidateIdFor(candidates, brief.startVenueId),
    finishId: candidateIdFor(candidates, brief.finishVenueId),
    targetKm: targetKmFor(brief.stretch, brief.holes),
  });
  const best = graph.routes[0];
  if (!best) return { name: "", holes: [] };
  return {
    name: "",
    holes: best.stops.map((candidateId: string) => ({
      candidateId,
      drink: DEFAULT_DRINK,
      par: DEFAULT_PAR,
      hazard: null,
      hazardNote: null,
      fitNote: null,
      // No local rules on a fallback hole: a house rule is a judgement about
      // the pub, and this board is geometry rather than judgement.
      localRules: [],
    })),
  };
}

/** A pinned tee is a `venues` id; the graph speaks candidate ids. */
function candidateIdFor(
  candidates: CandidateDossier[],
  venueId: string | null,
): string | null {
  if (!venueId) return null;
  return candidates.find((c) => c.venueId === venueId)?.id ?? null;
}
