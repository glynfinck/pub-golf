import { NextResponse } from "next/server";

import { caddyEnabled } from "@/lib/caddy/credentials";
import { openPlan, runTurn } from "@/lib/caddy/run";
import { encodeEvent, pickedIds, type CaddyEvent } from "@/lib/caddy/stream";

/**
 * The plan, narrated.
 *
 * The same pipeline `planCourse` runs — the same auth, the same green fee, the
 * same patch, the same single charged turn through `runTurn` — with the
 * difference that it says what it is doing while it does it. Twenty seconds is
 * a long time to look at a spinner, and everything interesting was already
 * over by the time the old action returned.
 *
 * Three things go out, in this order:
 *
 *   **The patch**, the moment Places answers. Forty pubs with coordinates,
 *   several seconds before the card exists — enough for the map to fly to the
 *   neighbourhood and show the caddy the ground it is working on.
 *
 *   **The thinking**, as it happens. The model's own summary, never the raw
 *   chain of thought, and never load-bearing: it is a window.
 *
 *   **The picks**, as pubs are named. Pins, not numbers — the walking order is
 *   decided *after* the answer is complete (`lib/caddy/route.ts`), so numbering
 *   them live would mean renumbering them at the end. The pins land in the
 *   order the caddy chose them and the walk draws over them when the card
 *   arrives, which is what actually happens.
 *
 * A route handler rather than a server action because actions cannot stream —
 * they resolve once. Nothing here is a second implementation of anything: the
 * money is metered in `runTurn` exactly as it is for the unstreamed plan, and
 * this file cannot spend a penny the ledger does not see.
 */

/** Node, not edge: the pipeline reads `next/headers` for the geo bias and
 * talks to Places and Supabase on the host's own session. */
export const runtime = "nodejs";
/**
 * Long enough for a full plan on a slow patch, and no longer.
 *
 * The tool loop needs minutes rather than the twenty seconds a single-shot
 * plan took, and the first real one was killed here at 120 — which cost the
 * host nothing on screen and cost us every token it had already spent, because
 * the ledger row is written after the call returns. The loop now keeps its own
 * clock (`CADDY_LOOP_MS`) and stops itself well inside this, so a card and its
 * bill both make it home. This is the backstop, not the mechanism.
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!caddyEnabled(process.env)) {
    return NextResponse.json({ error: "The caddy isn't on duty here." }, { status: 503 });
  }

  let brief: unknown;
  try {
    brief = await request.json();
  } catch {
    return NextResponse.json({ error: "Tell the caddy where you're drinking." }, { status: 400 });
  }

  // Everything before the model, and none of it costs anything. A refusal
  // here is an ordinary JSON error rather than a stream that opens only to
  // apologise — there is nothing to narrate yet.
  const opened = await openPlan(brief);
  if ("error" in opened) {
    return NextResponse.json(
      { error: opened.error, offer: opened.offer },
      { status: 200 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const say = (event: CaddyEvent) => {
        // A host who navigates away closes the stream underneath us. That is
        // not an error — the turn is still charged and still filed, because it
        // still happened, and the card is on the session for when they come
        // back.
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(encodeEvent(event)));
        } catch {
          open = false;
        }
      };

      say({
        type: "patch",
        pins: opened.candidates.flatMap((pub) =>
          pub.lat != null && pub.lng != null
            ? [{ id: pub.id, lat: pub.lat, lng: pub.lng }]
            : [],
        ),
      });

      // The answer, accumulated only so the picks can be read out of it. The
      // card itself comes back from `runTurn` fully parsed — this copy is
      // narration and is thrown away.
      let answer = "";
      let announced = 0;

      const result = await runTurn({
        ...opened,
        history: [],
        kind: "plan",
        narrate: ({ thinking, answer: chunk, doing }) => {
          if (doing) say({ type: "doing", text: doing });
          if (thinking) say({ type: "thinking", text: thinking });
          if (!chunk) return;
          answer += chunk;
          const ids = pickedIds(answer);
          // Only ever the new ones. Re-sending the whole list every few tokens
          // would work and would also be most of the bytes on this stream.
          if (ids.length > announced) {
            say({ type: "picked", ids: ids.slice(announced) });
            announced = ids.length;
          }
        },
      });

      if (result.error || !result.course || !result.sessionId) {
        say({
          type: "failed",
          error: result.error ?? "The caddy lost the ball. Ask again — this one's free.",
          detail: result.detail,
          offer: result.offer,
        });
      } else {
        say({
          type: "card",
          course: result.course,
          sessionId: result.sessionId,
          turnId: result.turnId ?? null,
        });
      }
      if (open) controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      // Nginx and friends buffer a response by default, which would hold every
      // event back until the end and turn this into the action it replaced.
      "X-Accel-Buffering": "no",
    },
  });
}
