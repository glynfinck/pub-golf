import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import {
  CADDY_SYSTEM,
  askBlock,
  briefBlock,
  parsePlan,
  patchBlock,
  planSchema,
  type PlanResult,
  type PlannedCourse,
} from "@/lib/caddy/plan";
import type { CaddyBrief } from "@/lib/caddy/brief";
import { NO_USAGE, readUsage, type CaddyUsage } from "@/lib/caddy/budget";
import { caddyCredentials } from "@/lib/caddy/credentials";
import type { CandidateDossier } from "@/lib/caddy/dossier";
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

/** Effort, and why. A small, well-scoped structured-output task: a card of up
 * to eighteen holes from forty dossiers. `medium` is the starting point the
 * spec settled on, worth a sweep once there are real briefs to sweep against.
 * The model itself comes off the credentials, because its id depends on which
 * door the request goes through. */
const EFFORT = "medium";
/** Generous enough for adaptive thinking plus eighteen dressed holes. Thinking
 * is on by default on this model and `max_tokens` caps thinking and answer
 * together, so a tight budget here truncates the card rather than the reasoning. */
const MAX_TOKENS = 8_000;

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
  // Read per call, never at module load: a Vercel OIDC token rotates, and a
  // credential captured once at cold start goes stale under the deploy.
  const credentials = caddyCredentials(process.env);
  if (!credentials) {
    return { ok: false, reason: "unavailable", usage: { ...NO_USAGE }, model: "" };
  }
  const model = credentials.model;

  const client = new Anthropic({
    apiKey: credentials.apiKey ?? null,
    authToken: credentials.authToken,
    ...(credentials.baseURL ? { baseURL: credentials.baseURL } : {}),
  });
  const messages = buildMessages(input);

  try {
    const response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: CADDY_SYSTEM,
      output_config: {
        effort: EFFORT,
        format: {
          type: "json_schema",
          schema: planSchema(input.candidates),
        },
      },
      messages,
    });

    // Read before anything can return: the tokens are spent whatever the
    // content turns out to be.
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
  } catch (cause) {
    // Timeouts, rate limits, a bad gateway — all of them are "the caddy lost
    // the ball", all of them cost the host nothing, and none of them reach
    // them as a vendor's error message. Usage is genuinely unknown here: the
    // call may never have reached the model, and guessing a number would put
    // an invented charge on a real bill.
    //
    // The reason is kept rather than dropped. Swallowing it entirely is what
    // turned the first real staging failure into a guessing game — the host
    // saw one line, the log had nothing, and the only way forward was to
    // redeploy with logging. Once was enough.
    const detail = describeFailure(cause);
    // The log gets the whole thing; the screen gets the short form. A vendor
    // nests the sentence that matters — which field it actually rejected —
    // well past where a toast would stop.
    console.error(
      `[caddy] ${credentials.via} ${model} failed: ${describeFailure(cause, FAILURE_LOG_MAX)}`,
    );
    // A 401/403/404 is the deploy being wrong, not the night being unlucky —
    // it will answer identically for ever. Saying so is the difference between
    // an honest line and one that has a paying host tapping a dead button.
    const reason = isPermanentFailure(cause) ? "misconfigured" : "unavailable";
    return { ok: false, reason, usage: { ...NO_USAGE }, model, detail };
  }
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
          text: patchBlock(input.candidates),
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
