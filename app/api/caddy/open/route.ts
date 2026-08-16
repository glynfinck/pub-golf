import { NextResponse } from "next/server";

import { caddyEnabled } from "@/lib/caddy/credentials";
import { menuOf } from "@/lib/caddy/menu";
import { openPlan } from "@/lib/caddy/run";

/**
 * The open step: everything before the model, answered as a menu.
 *
 * Same gate, same fee check, same gather and same session row as the plan
 * has always started with — `openPlan` is untouched — but instead of going
 * straight to the model this answers with the walks the router worked out,
 * so the host can choose the shape of the night before the turn that spends.
 *
 * Nothing here charges: no model is called, no turn row is written, and the
 * dress step (`/api/caddy/plan` with a `sessionId`) is where the goes are
 * counted, exactly as they always were. Iterating on this menu — re-dialling
 * spacing or holes — happens in the browser over the lean nodes below and
 * costs nobody anything.
 */

export const runtime = "nodejs";
/** A gather on a slow patch, and no model behind it. */
export const maxDuration = 60;

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

  const opened = await openPlan(brief);
  if ("error" in opened) {
    return NextResponse.json(
      { error: opened.error, offer: opened.offer },
      { status: 200 },
    );
  }

  return NextResponse.json({
    sessionId: opened.sessionId,
    menu: menuOf(opened.candidates, opened.brief),
  });
}
