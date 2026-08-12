/**
 * Which door the caddy goes through — Vercel's AI Gateway, or Anthropic direct.
 *
 * Pure, so "does this deploy have a caddy at all, and how does it pay for
 * one" is a function call rather than a thing you find out in production. The
 * house already keeps this rule for the maps key and the Stripe key; the
 * caddy's version has three possible answers instead of two, which is exactly
 * why it earns a tested function.
 *
 * Order of preference, and the reasoning:
 *
 *   1. `AI_GATEWAY_API_KEY` — an explicit choice beats an ambient one. If
 *      somebody has put a gateway key on the deploy, they want the gateway's
 *      spend limits and its usage log, and they want them in preview as well
 *      as in production.
 *   2. `VERCEL_OIDC_TOKEN` — free on every Vercel deployment, rotating, and no
 *      secret to leak or forget. Best path in production, and the reason a
 *      deploy can have a working caddy with no key configured at all.
 *   3. `ANTHROPIC_API_KEY` — straight to Anthropic. What a laptop uses, and
 *      the escape hatch if the gateway is ever in the way.
 *
 * None of the three and there is no caddy: the group never renders and nothing
 * on screen mentions it.
 */

/** The gateway speaks the Anthropic Messages API natively at this host — the
 * SDK appends `/v1/messages` itself. Structured outputs (`output_config`) and
 * `cache_control` both pass through, which is what makes it safe here: the
 * schema is the never-invent-a-pub rule and the cache is the cost model. */
export const AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh";

/**
 * The model the caddy uses, and why this one.
 *
 * Sonnet rather than Opus. Two reasons, and cost is the smaller one: output is
 * five times input on every tier and dominates the bill, so this is roughly
 * forty per cent off — a fresh plan drops from about twelve pence to about
 * seven, and a roll from six to four (`lib/caddy/budget.ts`). The larger reason
 * is that the task does not ask for the top tier. Choosing nine pubs from forty
 * dossiers and dressing them is constrained, well-specified work with a schema
 * holding the shape; it is not the kind of open reasoning Opus is for.
 *
 * Overridable by `CADDY_MODEL`, which exists because model *availability* is
 * not something this repo can know. Vercel's gateway gates models by account
 * tier and answers a request for one you cannot reach with a 403 — so being
 * able to try another id without a redeploy is worth one environment variable.
 * An unknown id is priced at the dearest tier we know rather than free, so an
 * override can make the caddy cost more but never make it uncounted.
 */
export const CADDY_MODEL = "claude-sonnet-5";
export const CADDY_MODEL_VIA_GATEWAY = `anthropic/${CADDY_MODEL}`;

/** A model id with any provider prefix taken off — what Anthropic's own API
 * wants. */
export function bareModel(id: string): string {
  return id.includes("/") ? id.slice(id.indexOf("/") + 1) : id;
}

/**
 * Which model, in the dialect of the door it is going through.
 *
 * The gateway wants a provider on the id and Anthropic does not, so the same
 * override has to read correctly both ways. An override that already names a
 * provider is taken at its word — `openai/gpt-5.4` is a deliberate choice and
 * must not become `anthropic/openai/gpt-5.4` — while a bare one is assumed to
 * be Anthropic's, which is what anybody typing `claude-opus-5` means.
 */
export function modelFor(env: CaddyEnv, via: "gateway" | "anthropic"): string {
  const chosen = env.CADDY_MODEL?.trim() || CADDY_MODEL;
  if (via === "anthropic") return bareModel(chosen);
  return chosen.includes("/") ? chosen : `anthropic/${bareModel(chosen)}`;
}

/** Just the environment, read loosely — an index signature so `process.env`
 * itself can be passed without TypeScript's weak-type check refusing it. */
export type CaddyEnv = Record<string, string | undefined>;

export interface CaddyCredentials {
  /** Sent as `x-api-key`. */
  apiKey?: string;
  /** Sent as `Authorization: Bearer` — how the gateway wants an OIDC token. */
  authToken?: string;
  /** Absent means straight to Anthropic, on the SDK's own default. */
  baseURL?: string;
  model: string;
  via: "gateway" | "anthropic";
}

/** What the deploy actually has. Reads a bag rather than `process.env` so the
 * decision is testable without touching the environment. */
export function caddyCredentials(env: CaddyEnv): CaddyCredentials | null {
  const gatewayKey = env.AI_GATEWAY_API_KEY?.trim();
  if (gatewayKey) {
    return {
      apiKey: gatewayKey,
      baseURL: AI_GATEWAY_BASE_URL,
      model: modelFor(env, "gateway"),
      via: "gateway",
    };
  }

  const oidc = env.VERCEL_OIDC_TOKEN?.trim();
  if (oidc) {
    // Bearer, not x-api-key: an OIDC token is a bearer credential and the
    // gateway documents it as one.
    return {
      authToken: oidc,
      baseURL: AI_GATEWAY_BASE_URL,
      model: modelFor(env, "gateway"),
      via: "gateway",
    };
  }

  const direct = env.ANTHROPIC_API_KEY?.trim();
  if (direct) {
    return { apiKey: direct, model: modelFor(env, "anthropic"), via: "anthropic" };
  }

  return null;
}

/** No credential, no caddy — the maps-key pattern, with three keys to miss
 * instead of one. */
export function caddyEnabled(env: CaddyEnv): boolean {
  return caddyCredentials(env) !== null;
}
