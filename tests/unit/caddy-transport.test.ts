import { afterEach, describe, expect, it, vi } from "vitest";

import { encodeEvent, type CaddyEvent } from "@/lib/caddy/stream";
import { openPatch, streamPlan } from "@/lib/caddy/transport";

/**
 * The twenty seconds a host actually watches, provable without a browser.
 *
 * This is the seam the flow never had. `fetch`, the ndjson sniff, the reader
 * and the re-entrant buffer lived inside a React component wrapped around
 * `setState`, so the only way to exercise a refusal-mid-stream or a
 * card-then-disconnect was to run the app and hope. Both of those paths have
 * shipped broken before — the module's own comments record a 32.21p plan that
 * filed nine holes while the browser showed a timeout — and neither had a
 * test, because there was nothing to hold.
 */

function ndjson(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson" },
  });
}

/** A stream that hands over some chunks and then never speaks again — the
 * hang the stall watchdog exists for. */
function ndjsonThenSilence(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      // Deliberately never closed.
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson" },
  });
}

/**
 * A stream that dies mid-flight — after its chunks have actually been read.
 *
 * Pull-driven on purpose: erroring inside `start` tears the stream down before
 * the first `read()` resolves, so the chunks are never delivered and the test
 * proves nothing about what happens *after* a card lands.
 */
function ndjsonThenBreak(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent < chunks.length) {
        controller.enqueue(encoder.encode(chunks[sent]));
        sent += 1;
        return;
      }
      controller.error(new Error("connection reset"));
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson" },
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const CARD: CaddyEvent = {
  type: "card",
  sessionId: "s1",
  turnId: "t1",
  course: { name: "The Shoreditch Six", holes: [] },
};

function stubFetch(answer: Response | (() => Promise<Response>)) {
  const fn = typeof answer === "function" ? answer : async () => answer;
  vi.stubGlobal("fetch", vi.fn(fn));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ————————————————— the open step —————————————————

describe("openPatch", () => {
  it("hands back the menu it was given", async () => {
    stubFetch(json({ sessionId: "s1", menu: { nodes: [], routes: [] } }));
    const answer = await openPatch({ where: "Soho" });
    expect(answer?.sessionId).toBe("s1");
  });

  it("answers null rather than throwing when the network goes", async () => {
    stubFetch(async () => {
      throw new Error("offline");
    });
    expect(await openPatch({ where: "Soho" })).toBeNull();
  });

  it("passes a refusal through as data, not as a failure", async () => {
    stubFetch(json({ error: "Not enough pubs round there.", offer: "more" }));
    const answer = await openPatch({ where: "Soho" });
    expect(answer?.offer).toBe("more");
    expect(answer?.error).toContain("Not enough");
  });
});

// ————————————————— every ending a plan can have —————————————————

describe("streamPlan", () => {
  it("reports a card and replays every event in order", async () => {
    stubFetch(
      ndjson([
        encodeEvent({ type: "doing", text: "Walking the patch" }),
        encodeEvent({ type: "picked", ids: ["p1", "p2"] }),
        encodeEvent(CARD),
      ]),
    );
    const seen: string[] = [];
    const outcome = await streamPlan({}, (event) => {
      seen.push(event.type);
    });
    expect(outcome).toEqual({ kind: "card" });
    expect(seen).toEqual(["doing", "picked", "card"]);
  });

  it("stitches an event split across two chunks", async () => {
    // TCP splits wherever it likes, regularly mid-object.
    const line = encodeEvent({
      type: "doing",
      text: "Looking for beer gardens",
    });
    stubFetch(ndjson([line.slice(0, 14), line.slice(14), encodeEvent(CARD)]));
    const seen: CaddyEvent[] = [];
    const outcome = await streamPlan({}, (event) => {
      seen.push(event);
    });
    expect(outcome.kind).toBe("card");
    expect(seen[0]).toEqual({
      type: "doing",
      text: "Looking for beer gardens",
    });
  });

  it("calls a pre-stream refusal a refusal, never a failure", async () => {
    // No fee, a thin patch, no sign-in: decided before the model was asked,
    // and answered as ordinary JSON rather than a stream that opens only to
    // apologise.
    stubFetch(json({ error: "Your fee's day has run out.", offer: "fee" }));
    const outcome = await streamPlan({}, () => {});
    expect(outcome).toEqual({
      kind: "refused",
      text: "Your fee's day has run out.",
      offer: "fee",
    });
  });

  it("calls a refusal arriving mid-stream a refusal too", async () => {
    stubFetch(
      ndjson([
        encodeEvent({ type: "doing", text: "Walking the patch" }),
        encodeEvent({
          type: "failed",
          error: "That is the last go on this fee.",
          offer: "more",
        }),
      ]),
    );
    const outcome = await streamPlan({}, () => {});
    expect(outcome.kind).toBe("refused");
  });

  it("reports a failure that arrives with no card", async () => {
    stubFetch(
      ndjson([
        encodeEvent({ type: "failed", error: "The caddy lost the ball." }),
      ]),
    );
    expect(await streamPlan({}, () => {})).toEqual({
      kind: "failed",
      error: "The caddy lost the ball.",
      detail: undefined,
    });
  });

  it("keeps the card when the connection dies after it lands", async () => {
    // The 32.21p case: the card is written to Postgres before a byte of it is
    // streamed, so a broken connection after it is a rough ending, not a loss.
    stubFetch(ndjsonThenBreak([encodeEvent(CARD)]));
    expect(await streamPlan({}, () => {})).toEqual({ kind: "card" });
  });

  it("reports a loss when the connection dies before one does", async () => {
    stubFetch(ndjsonThenBreak([encodeEvent({ type: "doing", text: "…" })]));
    expect(await streamPlan({}, () => {})).toEqual({ kind: "lost" });
  });

  it("ends a hung stream instead of waiting for ever", async () => {
    // The defect: `reader.read()` on a quiet connection never settles, so the
    // host watched an animation with no cancel and no timeout, and a reload
    // was the only way out.
    stubFetch(ndjsonThenSilence([encodeEvent({ type: "doing", text: "…" })]));
    const outcome = await streamPlan({}, () => {}, { stallMs: 40 });
    expect(outcome).toEqual({ kind: "lost" });
  });

  it("keeps a card that landed before the silence", async () => {
    stubFetch(ndjsonThenSilence([encodeEvent(CARD)]));
    const outcome = await streamPlan({}, () => {}, { stallMs: 40 });
    expect(outcome).toEqual({ kind: "card" });
  });

  it("fails rather than throwing when the request never leaves", async () => {
    stubFetch(async () => {
      throw new Error("offline");
    });
    const outcome = await streamPlan({}, () => {});
    expect(outcome.kind).toBe("failed");
  });

  it("treats a non-stream answer with no offer as a plain failure", async () => {
    stubFetch(json({ error: "Signed out." }));
    expect(await streamPlan({}, () => {})).toEqual({
      kind: "failed",
      error: "Signed out.",
    });
  });

  it("awaits each handler, so a slow card cannot be overtaken", async () => {
    stubFetch(
      ndjson([
        encodeEvent(CARD),
        encodeEvent({ type: "doing", text: "after" }),
      ]),
    );
    const order: string[] = [];
    await streamPlan({}, async (event) => {
      if (event.type === "card") {
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push("card handled");
      } else {
        order.push(event.type);
      }
    });
    expect(order).toEqual(["card handled", "doing"]);
  });
});
