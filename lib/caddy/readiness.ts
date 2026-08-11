import { billingEnabled } from "@/lib/billing";
import { caddyCredentials, type CaddyEnv } from "@/lib/caddy/credentials";

/**
 * Why the caddy is not on the drafting table — for the person deploying it,
 * and for nobody else.
 *
 * The house rule is absence rather than apology: a player who cannot have a
 * thing is not shown a disabled version of it, told to buy something, or made
 * to read an error. That is right, and it stays right in production.
 *
 * It is also useless to whoever is trying to *ship* the thing. Four
 * independent gates each render exactly the same nothing, so "I don't see it in
 * preview" is a question the screen refuses to answer and someone has to guess
 * at — which is how an afternoon goes, twice, before anybody notices the branch
 * being looked at was not the branch the work was on.
 *
 * So on any deployment Vercel does not call `production`, the shut gates are
 * named. Same test `lib/bug-report.ts` already uses to mark a staging issue,
 * and the same doubt-goes-which-way reasoning: an absent VERCEL_ENV reads as
 * local, because a diagnostic wrongly hidden on a laptop costs a minute and a
 * diagnostic wrongly shown to a player costs the illusion.
 *
 * Nothing here reveals a secret. It reports whether a credential is *present*,
 * never any part of its value — which is the same thing an attacker learns by
 * observing whether the feature works at all.
 */

export interface CaddyGate {
  /** What is being checked, in the deployer's own vocabulary. */
  label: string;
  ok: boolean;
  /** What to do about it. Empty when the gate is open. */
  fix: string;
}

export interface CaddyReadinessInput {
  signedIn: boolean;
  anonymous: boolean;
  hasPass: boolean;
  /** Whether `caddy_sessions` answered — the one gate that is not an env var
   * and the one most easily missed, because the two deploy integrations do not
   * wait for each other. */
  tablesPresent: boolean;
}

/** Anywhere that is not production. An absent VERCEL_ENV reads as local. */
export function showCaddyDiagnostics(env: CaddyEnv): boolean {
  return (env.VERCEL_ENV ?? "local") !== "production";
}

/** Every gate, in the order they are worth checking. */
export function caddyGates(env: CaddyEnv, input: CaddyReadinessInput): CaddyGate[] {
  const credentials = caddyCredentials(env);
  return [
    {
      label: credentials
        ? `Model credential (${credentials.via})`
        : "Model credential",
      ok: credentials !== null,
      fix: "Set AI_GATEWAY_API_KEY on this environment (Vercel → AI Gateway → API keys). ANTHROPIC_API_KEY also works.",
    },
    {
      label: "Signed in with Google",
      ok: input.signedIn && !input.anonymous,
      fix: input.signedIn
        ? "This seat is a guest. Planning a course takes a Google sign-in, same as hosting one."
        : "Sign in first — the caddy belongs to a host.",
    },
    {
      label: "A green fee to work under",
      ok: billingEnabled(env.STRIPE_SECRET_KEY) || input.hasPass,
      fix: "No till and no pass. Either set STRIPE_SECRET_KEY, or insert an entitlements row for your own user (kind green_fee, round_id null, expires_at in the future) — which is exactly what a purchase writes.",
    },
    {
      label: "Caddy tables migrated",
      ok: input.tablesPresent,
      fix: "caddy_sessions did not answer. Migrations 20260825 and 20260826 have not reached this database — Vercel and Supabase deploy independently, so the app can be ahead of the schema.",
    },
    {
      label: "Places key",
      ok: Boolean(env.GOOGLE_PLACES_API_KEY?.trim()),
      fix: "GOOGLE_PLACES_API_KEY is unset, so there are no pubs to plan from. The group will render and then refuse honestly.",
    },
  ];
}

/** The gates that are shut. Empty means the caddy should be on the page. */
export function shutGates(env: CaddyEnv, input: CaddyReadinessInput): CaddyGate[] {
  return caddyGates(env, input).filter((gate) => !gate.ok);
}

/**
 * Whether the caddy renders at all.
 *
 * The Places key is deliberately *not* one of these. A patch with no pubs in it
 * is a refusal the caddy gives in words, on the screen, having cost nothing —
 * which is a better answer than the group silently not existing, because it
 * tells the host the difference between "not sold here" and "nothing found".
 */
export function caddyReady(env: CaddyEnv, input: CaddyReadinessInput): boolean {
  return (
    caddyCredentials(env) !== null &&
    input.signedIn &&
    !input.anonymous &&
    (billingEnabled(env.STRIPE_SECRET_KEY) || input.hasPass) &&
    input.tablesPresent
  );
}
