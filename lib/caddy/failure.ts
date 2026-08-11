/**
 * What went wrong, in a form that is safe to write down.
 *
 * `askCaddy` catches everything and tells the host one line: the caddy lost the
 * ball, ask again, this one's free. That is right — a vendor's stack trace is
 * not a thing a player should ever read, and the covenant does not want the
 * machinery mentioned. But the first time it actually failed in staging it also
 * meant nobody could find out *why*, because the reason had been thrown away at
 * the point it was caught. A swallowed error is a debugging dead end.
 *
 * So the reason is kept, in two places that are not the player's screen: the
 * server log always, and — on any deployment Vercel does not call production —
 * the staging note, so whoever is looking at it can read the failure instead of
 * asking someone to go and read logs for them.
 *
 * Everything here is pure so the redaction can be tested, which is the same
 * reason `lib/bug-report.ts` is pure: this text is about to be written somewhere
 * it cannot be taken back from, and the thing it is describing is an object
 * that has, at various points, had a credential inside it.
 */

/** Anything shaped like a key we might have sent. Deliberately broad — a false
 * positive costs a few characters of a log line, a false negative writes a live
 * credential into one. */
const SECRETS = [
  /\bsk-ant-[A-Za-z0-9_-]+/g,
  /\bvck_[A-Za-z0-9_-]+/g,
  /\bai_gtw_[A-Za-z0-9_-]+/g,
  /\bsk_(?:live|test)_[A-Za-z0-9]+/g,
  // A JWT, which is the shape a Vercel OIDC token arrives in.
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  // Bearer/x-api-key headers echoed back in an error body.
  /(authorization|x-api-key)"?\s*[:=]\s*"?[^\s",}]+/gi,
];

export const REDACTED = "[redacted]";

/** Strip anything credential-shaped. Applied last, over the whole line, so it
 * catches a key that arrived somewhere this module did not anticipate. */
export function redactSecrets(text: string): string {
  return SECRETS.reduce((clean, pattern) => clean.replace(pattern, REDACTED), text);
}

/** How long a failure line may be. Long enough for a status, a vendor message
 * and a request id; short enough to sit under the staging note without becoming
 * the page. */
export const FAILURE_DETAIL_MAX = 300;

interface ApiErrorish {
  status?: unknown;
  message?: unknown;
  name?: unknown;
  request_id?: unknown;
  error?: unknown;
}

/**
 * One line describing a thrown thing.
 *
 * Reads the shape the Anthropic SDK throws — `status`, `message`, `request_id`
 * — without importing or instanceof-ing it, so this stays pure and testable and
 * keeps working if the vendor renames its error classes. Anything unrecognised
 * still produces something rather than nothing: "no detail" is the outcome this
 * module exists to prevent.
 */
export function describeFailure(cause: unknown): string {
  if (cause == null) return "no error object";

  const parts: string[] = [];
  if (typeof cause === "object") {
    const err = cause as ApiErrorish;
    const name = typeof err.name === "string" ? err.name : "";
    const status =
      typeof err.status === "number" || typeof err.status === "string"
        ? String(err.status)
        : "";
    if (status) parts.push(`HTTP ${status}`);
    if (name && name !== "Error") parts.push(name);

    // The vendor's own message, which is where the useful sentence lives —
    // "model not found", "credit balance too low", "unexpected field".
    if (typeof err.message === "string" && err.message) parts.push(err.message);
    else if (typeof err.error === "object" && err.error !== null) {
      const inner = (err.error as { message?: unknown }).message;
      if (typeof inner === "string") parts.push(inner);
    }

    if (typeof err.request_id === "string" && err.request_id) {
      parts.push(`req ${err.request_id}`);
    }
  } else {
    parts.push(String(cause));
  }

  const line = parts.filter(Boolean).join(" · ") || "unrecognised error";
  return redactSecrets(line).slice(0, FAILURE_DETAIL_MAX);
}
