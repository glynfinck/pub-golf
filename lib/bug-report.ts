/**
 * A bug report, on its way to a public issue tracker.
 *
 * Everything here is pure — the shaping, the redaction, the markdown — so the
 * rules that matter are proved by a function call rather than by a browser.
 * The one that matters most: **the round code never leaves**. A code is the
 * join key (`join_round(code, name)` is the only door into a round), so a code
 * pasted into a world-readable issue is an open door onto a live round. It is
 * stripped from the route, from the free text, and from anything else on its
 * way out; the real code stays on the private `bug_reports` row.
 *
 * The reporter is not on the issue either — no name, no id, no email. The
 * issue carries the report's row id and nothing else that points at a person,
 * so a maintainer can find the reporter in the database and a stranger
 * reading the tracker cannot.
 */

/**
 * Reports per reporter per rolling day. Hand-kept mirror of
 * `public.bug_report_daily_cap()` — the database is the enforcement, this
 * copy only writes the copy on screen, and `tests/db/rls-bug-reports.test.ts`
 * fails if the two drift apart.
 */
export const BUG_REPORT_DAILY_CAP = 5;

/** Long enough to say something, short enough to read on a phone. */
export const BUG_BODY_MIN = 10;
export const BUG_BODY_MAX = 2000;

/** The house's default tracker, when the deploy names no other. */
export const DEFAULT_ISSUE_REPO = "glynfinck/pub-golf";

/**
 * Which part of the house went wrong. Deliberately six coarse buckets — a
 * player picking a chip in a dark pub is triage, not taxonomy. The ids match
 * the `area` check constraint on `bug_reports`.
 */
export const BUG_AREAS = [
  { id: "scoring", label: "Scoring" },
  { id: "timer", label: "The clock" },
  { id: "joining", label: "Joining" },
  { id: "courses", label: "Courses" },
  { id: "payments", label: "Payments" },
  { id: "other", label: "Something else" },
] as const;

export type BugArea = (typeof BUG_AREAS)[number]["id"];

function areaLabel(area: BugArea): string {
  return BUG_AREAS.find((entry) => entry.id === area)?.label ?? "Something else";
}

/** Where the player was standing when it went wrong. */
export interface BugContext {
  /** Which build is on the phone — the answer to "it did that last night". */
  build: string | null;
  /** Route path only, never the query string, and redacted before it ships. */
  route: string | null;
  /** Private. Held for redaction and for the row; never rendered to GitHub. */
  roundCode: string | null;
  hole: number | null;
  /** `live`, `walking`, or the round's status when it isn't in play. */
  phase: string | null;
  /** "390×844". */
  viewport: string | null;
  /** User agent, read server-side from the request headers. */
  device: string | null;
  locale: string | null;
}

export const EMPTY_BUG_CONTEXT: BugContext = {
  build: null,
  route: null,
  roundCode: null,
  hole: null,
  phase: null,
  viewport: null,
  device: null,
  locale: null,
};

/**
 * Reporting is off until a token exists — the maps-key pattern: no secret, no
 * surface. The difference here is that the report is still *taken*: the row
 * lands in `bug_reports` either way, so a deploy with no token collects
 * reports rather than dropping them, and the player is told the truth
 * ("filed with the club secretary") rather than handed a dead link.
 */
export function bugTrackerEnabled(token: string | undefined): boolean {
  return typeof token === "string" && token.trim().length > 0;
}

/**
 * `owner/repo` for the issues API. Parsed rather than interpolated: this
 * string builds a URL that a token is spent against, so a malformed value
 * must be a `null` here and not a request to somewhere unexpected.
 */
export function parseIssueRepo(
  value: string | undefined,
): { owner: string; repo: string } | null {
  const parts = (value?.trim() || DEFAULT_ISSUE_REPO).split("/");
  if (parts.length !== 2) return null;
  const [owner, repo] = parts.map((part) => part.trim());
  const legal = /^[A-Za-z0-9._-]+$/;
  if (!owner || !repo || !legal.test(owner) || !legal.test(repo)) return null;
  return { owner, repo };
}

/** The labels an app-filed issue wears. `bug` is GitHub's own default label,
 * so the house tracker always has it; anything else is opt-in per deploy
 * because the API refuses a label the repository has never seen. */
export function issueLabels(extra: string | undefined): string[] {
  const configured = (extra ?? "")
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
  return Array.from(new Set(["bug", ...configured]));
}

/**
 * Six characters of the join alphabet — `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`,
 * which is the full alphabet with 0/O/1/I removed (see `generate_round_code`
 * in the init migration). Anchored to a `/round/` path segment so ordinary
 * prose in six capitals ("NO IDEA", a drink name) survives untouched.
 */
const ROUND_ROUTE = /(\/round\/)[A-HJ-NP-Z2-9]{6}/g;

/** What a redacted code reads as. Six bullets, so the shape still says "code". */
export const REDACTED_CODE = "••••••";

/**
 * Take the round code out of anything bound for GitHub.
 *
 * Two passes, because a code reaches the outside world two ways: in the route
 * the player was on (`/round/TAVERN/play`), and typed into the report itself
 * ("nobody could join TAVERN"). The first is a shape and is always redacted;
 * the second needs the code we know about, matched case-insensitively because
 * a player types it as they remember it.
 */
export function redactRoundCodes(
  text: string,
  code: string | null | undefined,
): string {
  let out = text.replace(ROUND_ROUTE, `$1${REDACTED_CODE}`);
  const known = code?.trim();
  if (known && /^[A-Za-z0-9]{4,12}$/.test(known)) {
    out = out.replace(new RegExp(known, "gi"), REDACTED_CODE);
  }
  return out;
}

/**
 * Make a player's typing safe to print inside a fenced block.
 *
 * The free text is quoted verbatim in a code fence rather than rendered as
 * markdown, which is what makes an `@everyone` or a `#1` inert — nothing in
 * there is parsed, so nothing in there can summon anybody. All this has to do
 * is stop the text closing the fence early, strip the control characters a
 * paste can carry, and hold the length.
 */
export function neutralise(text: string, max = BUG_BODY_MAX): string {
  return (
    text
      .replace(/\r\n?/g, "\n")
      // Zero-width and directional marks: invisible in the issue, and the
      // usual way a "clean" string turns out not to be one.
      .replace(/[\u200b-\u200f\u2028\u2029\ufeff]/g, "")
      // Control characters, keeping \n and \t — the rest is paste debris.
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
      // The one sequence that could break out of the fence below.
      .replace(/`{3,}/g, "'''")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, max)
  );
}

/** One line, no fences, short enough to read in a list of issues. */
function firstLine(text: string, max = 72): string {
  const line = text.split("\n").find((candidate) => candidate.trim()) ?? "";
  const clean = line.trim().replace(/\s+/g, " ");
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/**
 * Which deployment filed this, when it was not production.
 *
 * Staging exists to be exercised, so preview deploys do file real issues —
 * but an issue from staging that reads exactly like an issue from a real
 * player is a tracker you cannot trust, and "I'll delete the test ones
 * afterwards" only works if you can tell which those were. Vercel sets
 * `VERCEL_ENV` on every deployment; anything that is not `production` says
 * so in the title.
 *
 * An absent value reads as `local` rather than as production: a marked
 * production issue is a cosmetic annoyance, an unmarked staging issue is the
 * thing being prevented, so the doubt goes that way on purpose.
 */
export function stageTag(vercelEnv: string | undefined): string | null {
  const stage = vercelEnv?.trim().toLowerCase();
  if (stage === "production") return null;
  return stage || "local";
}

export interface IssueDraft {
  reportId: string;
  area: BugArea;
  body: string;
  context: BugContext;
  /** ISO timestamp. Passed in, never read from the clock — same rule as the
   * countdown maths in `lib/time.ts`. */
  filedAt: string;
  /** `stageTag()`'s answer. Null is production and wears no marker. */
  stage: string | null;
}

/**
 * `Scoring — the swigs went back to zero`. The area leads because a tracker
 * is read down its left edge, and the player's own first line follows because
 * nothing summarises a bug like the sentence they reached for.
 *
 * A non-production deploy leads with its own name instead, so a test report
 * is obvious in the list it is about to be deleted from.
 */
export function issueTitle(
  draft: Pick<IssueDraft, "area" | "body" | "context" | "stage">,
): string {
  const said = firstLine(
    redactRoundCodes(neutralise(draft.body), draft.context.roundCode),
    draft.stage ? 72 - draft.stage.length - 3 : 72,
  );
  const area = areaLabel(draft.area);
  const marker = draft.stage ? `[${draft.stage}] ` : "";
  return said
    ? `${marker}${area} — ${said}`
    : `${marker}${area} — reported from the app`;
}

/** Table cells hold inline code; a backtick or a pipe in there breaks the row. */
function cell(value: string, max = 180): string {
  // Strip first, collapse second: the other way round leaves the gap where
  // the pipe used to be, and the cell reads as if it had been redacted.
  const clean = value
    .replace(/[`|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return clean ? `\`${clean}\`` : "—";
}

/**
 * The issue body: what they said, then where they stood.
 *
 * Everything the player typed goes inside one fence, unedited except for the
 * redaction — a maintainer needs their words, not a paraphrase. Everything
 * else is a table, because a bug report is read at a glance six weeks later.
 */
export function issueBody(draft: IssueDraft): string {
  const { context } = draft;
  const said = redactRoundCodes(neutralise(draft.body), context.roundCode);
  const route = context.route
    ? redactRoundCodes(context.route, context.roundCode)
    : null;

  const rows: [string, string][] = [
    ["Build", context.build ? cell(context.build) : "—"],
    ["Screen", route ? cell(route) : "—"],
  ];
  if (context.hole != null) {
    rows.push([
      "Hole",
      `${context.hole}${context.phase ? ` (${context.phase})` : ""}`,
    ]);
  } else if (context.phase) {
    rows.push(["Phase", context.phase]);
  }
  if (context.roundCode) {
    // Named, never printed: the maintainer looks the code up on the row, and
    // a stranger reading this issue cannot join the round.
    rows.push(["Round", "on file — see the report id below"]);
  }
  rows.push(["Viewport", context.viewport ? cell(context.viewport) : "—"]);
  rows.push(["Device", context.device ? cell(context.device) : "—"]);
  rows.push(["Locale", context.locale ? cell(context.locale) : "—"]);
  rows.push(["Filed", cell(draft.filedAt)]);
  if (draft.stage) rows.push(["Deployment", cell(draft.stage)]);

  return [
    draft.stage
      ? `> **Not production.** Filed from the \`${draft.stage}\` deployment — a test report, safe to close or delete.\n`
      : null,
    `**${areaLabel(draft.area)}**, reported from inside the app.`,
    "",
    "```text",
    said,
    "```",
    "",
    "| | |",
    "| --- | --- |",
    ...rows.map(([label, value]) => `| ${label} | ${value} |`),
    "",
    `<sub>Report \`${draft.reportId}\` · filed through Pub Golf's report screen.`,
    "The reporter and their round are recorded privately in `bug_reports`;",
    "nothing on this issue identifies either.</sub>",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/** The whole POST body for GitHub's create-an-issue endpoint. */
export function issuePayload(
  draft: IssueDraft,
  labels: string[],
): { title: string; body: string; labels: string[] } {
  return {
    title: issueTitle(draft),
    body: issueBody(draft),
    labels,
  };
}
