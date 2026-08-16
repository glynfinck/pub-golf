import type { CaddyMenu } from "@/lib/caddy/menu";
import type { JobStage } from "@/lib/caddy/stages";
import type { CaddyOffer } from "@/lib/caddy/stream";
import type { OpenAnswer, StreamOutcome } from "@/lib/caddy/transport";

/**
 * How a run ends, decided in one place.
 *
 * **The rule this exists to hold: every ending is an ending.** Four exits used
 * to close the overlay and return without touching the stage, so the pill went
 * on saying "the caddy's dressing the card" over a plan turned down at the till
 * minutes earlier — and once the Course Room started reading that stage, its
 * rail froze mid-flight with the gallery gone. Nothing moving, no toast, every
 * step disabled: "I pressed it and nothing happened".
 *
 * Pure, so the rule is provable without a browser: given any outcome the
 * transport can produce, this says exactly what the host should be looking at.
 * The hook's job is then only to apply it.
 */
export interface JobEnding {
  /** Always terminal. `jobWorking(stage)` is false for every one of these. */
  stage: JobStage;
  /** The line the host reads, where there is one. */
  error: string | null;
  /** The server's own words about *why*, kept off the headline. */
  detail?: string;
  /** Money's own answer, which arrives as a sheet rather than a stage. */
  refusal: { text: string; offer: CaddyOffer } | null;
  /** A refusal is answered by a sheet, so the overlay gets out of its way. */
  closeOverlay: boolean;
  /**
   * Ask the server whether a card landed before apologising.
   *
   * The card is written to `caddy_turns` before a byte of it is streamed, so a
   * plan whose connection died on the way back has still produced one — this
   * codebase's own comments record a 32.21p plan that filed nine holes while
   * the browser showed a timeout.
   */
  rescue: boolean;
}

/** What the caddy says when the wire, not the plan, went wrong. */
export const LOST_BALL = "The caddy lost the ball. Ask again — this one's free.";

/** What it says when a dress arrives with no patch behind it. */
export const LOST_THREAD =
  "The caddy lost the thread on this patch. Plan it again — this one's free.";

/** The card landed. The only ending that is not an apology. */
const CARDED: JobEnding = {
  stage: "done",
  error: null,
  refusal: null,
  closeOverlay: false,
  rescue: false,
};

/** What the dress step's outcome means for the screen. */
export function endingOf(
  outcome: StreamOutcome,
  /** Whether a card event arrived before the stream ended. */
  carded: boolean,
): JobEnding {
  if (outcome.kind === "card" || carded) return CARDED;
  if (outcome.kind === "refused") {
    return {
      stage: "failed",
      error: outcome.text,
      refusal: { text: outcome.text, offer: outcome.offer },
      closeOverlay: true,
      rescue: false,
    };
  }
  // A failure and a lost connection differ only in what to say; both are worth
  // asking about first, because both can sit on top of a card already filed.
  return {
    stage: "failed",
    error: outcome.kind === "failed" ? outcome.error : LOST_BALL,
    detail: outcome.kind === "failed" ? outcome.detail : undefined,
    refusal: null,
    closeOverlay: false,
    rescue: true,
  };
}

/** A dress with no session behind it — nothing was spent, so nothing to rescue. */
export function lostThreadEnding(): JobEnding {
  return {
    stage: "failed",
    error: LOST_THREAD,
    refusal: null,
    closeOverlay: false,
    rescue: false,
  };
}

/**
 * What the open step's answer means: either a patch to work on, or an ending.
 *
 * A union rather than a nullable ending, because the two halves are genuinely
 * different and the caller has to prove which it got before spending it. The
 * old shape — check four fields, then reach into the same object for two of
 * them — is how a menu-less answer got as far as the gallery.
 *
 * The overlay **stays** on a failure here. A thin patch used to tear down a
 * ten-second performance into a four-second toast, with nothing on screen to
 * change and no way back to the brief that produced it.
 */
export type OpenResult =
  | { kind: "patch"; sessionId: string; menu: CaddyMenu }
  | { kind: "ending"; ending: JobEnding };

export function openResult(answer: OpenAnswer | null): OpenResult {
  if (answer && !answer.error && answer.sessionId && answer.menu) {
    return { kind: "patch", sessionId: answer.sessionId, menu: answer.menu };
  }
  if (answer?.offer && answer.error) {
    return {
      kind: "ending",
      ending: {
        stage: "failed",
        error: answer.error,
        refusal: { text: answer.error, offer: answer.offer },
        closeOverlay: true,
        rescue: false,
      },
    };
  }
  return {
    kind: "ending",
    ending: {
      stage: "failed",
      error: answer?.error ?? LOST_BALL,
      refusal: null,
      closeOverlay: false,
      rescue: false,
    },
  };
}
