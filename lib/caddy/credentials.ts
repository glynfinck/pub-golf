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

/** The model, in each door's own dialect. Through the gateway a model id
 * carries its provider; straight to Anthropic it does not. */
export const CADDY_MODEL = "claude-opus-5";
export const CADDY_MODEL_VIA_GATEWAY = `anthropic/${CADDY_MODEL}`;

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
      model: CADDY_MODEL_VIA_GATEWAY,
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
      model: CADDY_MODEL_VIA_GATEWAY,
      via: "gateway",
    };
  }

  const direct = env.ANTHROPIC_API_KEY?.trim();
  if (direct) {
    return { apiKey: direct, model: CADDY_MODEL, via: "anthropic" };
  }

  return null;
}

/** No credential, no caddy — the maps-key pattern, with three keys to miss
 * instead of one. */
export function caddyEnabled(env: CaddyEnv): boolean {
  return caddyCredentials(env) !== null;
}
