import { caddyEnabled, type CaddyEnv } from "@/lib/caddy/credentials";

/**
 * Whether the house has opened the caddy at all.
 *
 * Every other gate in `readiness.ts` answers "can this deploy run a caddy" —
 * a key, a schema, a signed-in host. This one answers a different question,
 * and it outranks them: **is the thing finished enough to be shown to
 * anybody.** A deploy can have every credential in place and still not be a
 * deploy that should be planning people's nights out.
 *
 * Shut by default, and that direction is the whole point. A flag that has to
 * be set to *hide* an unfinished feature ships it the first time somebody
 * forgets the variable; a flag that has to be set to *show* one cannot. So
 * production needs nothing done to it to stay quiet, and whoever is building
 * the caddy sets `CADDY_OPEN=true` on their own environment — local, preview,
 * a branch deploy — and gets the whole thing back exactly as it was.
 *
 * Nothing is deleted behind this. The pipeline, the ledger, the tables and
 * every test still exist and still run; the flag decides who is allowed to
 * meet them.
 */
export function caddyOpen(env: CaddyEnv): boolean {
  return env.CADDY_OPEN?.trim() === "true";
}

/**
 * Open *and* equipped — the one question the server side asks.
 *
 * Replaces the bare `caddyEnabled` check at every entry point into the
 * pipeline, because a credential is no longer sufficient reason to spend
 * money on somebody's behalf. Kept as one function rather than two checks at
 * four call sites for the reason the house keeps every rule in the lowest
 * layer that can hold it: four places to remember is three places to forget.
 */
export function caddyOnDuty(env: CaddyEnv): boolean {
  return caddyOpen(env) && caddyEnabled(env);
}
