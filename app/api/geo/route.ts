import { ipBiasFrom } from "@/lib/pub-search";

/**
 * Where the player's IP says they are — Vercel's geo headers echoed back,
 * so the map sheet can open framed on the right city before any search has
 * run. Nothing here reaches Google, nothing is stored, and off Vercel it
 * honestly answers null.
 */
export function GET(request: Request) {
  return Response.json({ bias: ipBiasFrom(request.headers) });
}
