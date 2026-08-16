import {
  decodeEvents,
  type CaddyEvent,
  type CaddyOffer,
} from "@/lib/caddy/stream";
import type { CaddyMenu } from "@/lib/caddy/menu";

/**
 * The wire, and the only place on it.
 *
 * `fetch`, the ndjson content-type sniff, `response.body.getReader()`, the
 * `TextDecoder` and the re-entrant buffer used to live inside a React
 * component, wrapped around `setState` calls — so the transport could not be
 * tested without a browser, and the component could not be read without also
 * reading a streaming protocol. Both halves got worse for it.
 *
 * Everything here is transport and nothing here is React: no state, no
 * components, no imports from `components/`. That is the seam, and it is what
 * lets `tests/unit/caddy-transport.test.ts` drive a fake `ReadableStream`
 * through every ending a plan can have — which is the tier CLAUDE.md asks for,
 * and which the two paths this module's callers have historically shipped
 * broken never had.
 *
 * **It adds what the components never had: an ending.** Both requests now
 * carry an `AbortSignal`, and the read loop carries a stall watchdog — a plan
 * whose connection goes quiet mid-stream used to leave the host watching an
 * animation for ever with no cancel and no timeout, and a reload as the only
 * way out.
 */

/** How long the open step may take before it is abandoned. It is one Places
 * fan-out and a route solve — generous, but not unbounded. */
export const OPEN_TIMEOUT_MS = 45_000;

/** How long the stream may go **quiet** before we call it dead. Not a ceiling
 * on the whole plan: a card that takes ninety seconds is fine as long as it
 * keeps saying something, and the caddy narrates continuously. */
export const STREAM_STALL_MS = 60_000;

export interface OpenAnswer {
  sessionId?: string;
  menu?: CaddyMenu;
  error?: string;
  offer?: CaddyOffer;
}

/**
 * How a stream ended, in the caller's own vocabulary.
 *
 * Deliberately not "did it throw": three of these are ordinary endings a host
 * should be told about differently, and collapsing them into an exception is
 * how a refusal came to be reported as breakage.
 */
export type StreamOutcome =
  | { kind: "card" }
  | { kind: "refused"; text: string; offer: CaddyOffer }
  | { kind: "failed"; error: string; detail?: string }
  /** The connection went away. Whether that matters depends on whether a card
   * had already landed, which only the caller knows. */
  | { kind: "lost" };

/** The patch, the menu, and a session to spend it on. Spends nothing. */
export async function openPatch(
  brief: Record<string, unknown>,
  options: { signal?: AbortSignal } = {},
): Promise<OpenAnswer | null> {
  try {
    const response = await fetch("/api/caddy/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(brief),
      signal: options.signal ?? AbortSignal.timeout(OPEN_TIMEOUT_MS),
    });
    return (await response.json().catch(() => null)) as OpenAnswer | null;
  } catch {
    // Including the timeout. A null answer is the caller's "lost the ball",
    // which is the same thing it already did for a network failure.
    return null;
  }
}

/**
 * The plan, streamed.
 *
 * `onEvent` is called for every decoded event in order, awaited, so a caller
 * that needs to do something asynchronous per event (put a card on a table,
 * say) is not racing the next chunk.
 *
 * A refusal is returned rather than surfaced through `onEvent`, because it
 * ends the stream: the caller has one place to decide what a refusal looks
 * like instead of two.
 */
export async function streamPlan(
  request: Record<string, unknown>,
  onEvent: (event: CaddyEvent) => void | Promise<void>,
  options: { signal?: AbortSignal; stallMs?: number } = {},
): Promise<StreamOutcome> {
  const lost = "The caddy lost the ball. Ask again — this one's free.";
  const stallMs = options.stallMs ?? STREAM_STALL_MS;

  let response: Response;
  try {
    response = await fetch("/api/caddy/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: options.signal,
    });
  } catch {
    return { kind: "failed", error: lost };
  }

  // A refusal decided before the model was ever asked — no fee, a thin patch,
  // no sign-in — comes back as ordinary JSON rather than as a stream that
  // opens only to apologise.
  if (
    !response.body ||
    !response.headers.get("content-type")?.includes("ndjson")
  ) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      offer?: CaddyOffer;
    } | null;
    if (body?.offer && body.error) {
      return { kind: "refused", text: body.error, offer: body.offer };
    }
    return { kind: "failed", error: body?.error ?? lost };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let carded = false;
  let failure: { error: string; detail?: string } | null = null;
  let refusal: { text: string; offer: CaddyOffer } | null = null;

  try {
    for (;;) {
      // The watchdog. `reader.read()` on a connection that has gone quiet
      // never settles, so without this the caller waits for ever — which is
      // exactly what a hung plan did.
      const chunk = await Promise.race([
        reader.read(),
        new Promise<"stalled">((resolve) =>
          setTimeout(() => resolve("stalled"), stallMs),
        ),
      ]);
      if (chunk === "stalled") {
        await reader.cancel().catch(() => {});
        return carded ? { kind: "card" } : { kind: "lost" };
      }
      const { value, done } = chunk;
      buffer += decoder.decode(value, { stream: !done });
      const { events, rest } = decodeEvents(buffer);
      buffer = rest;
      for (const event of events) {
        if (event.type === "card") carded = true;
        if (event.type === "failed" && event.offer) {
          refusal = { text: event.error, offer: event.offer };
        } else if (event.type === "failed") {
          failure = { error: event.error, detail: event.detail };
        }
        await onEvent(event);
      }
      if (done) break;
    }
  } catch {
    // The connection went away mid-plan. A card that had already landed makes
    // this a finished plan with a rough ending, not a failure — but that is
    // the caller's judgement, so both facts are reported.
    return carded ? { kind: "card" } : { kind: "lost" };
  }

  if (refusal) return { kind: "refused", ...refusal };
  if (failure && !carded) return { kind: "failed", ...failure };
  if (carded) return { kind: "card" };
  return { kind: "lost" };
}
