"use server";

import { headers } from "next/headers";
import { z } from "zod";

import {
  BUG_AREAS,
  BUG_BODY_MAX,
  BUG_BODY_MIN,
  BUG_REPORT_DAILY_CAP,
  bugTrackerEnabled,
  issueLabels,
  issuePayload,
  parseIssueRepo,
  redactRoundCodes,
  stageTag,
  type BugArea,
  type BugContext,
  type IssueDraft,
} from "@/lib/bug-report";
import { BUILD_REF } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";

/**
 * Filing a bug from inside the app.
 *
 * The order is the whole design: **row first, issue second**. The row is what
 * the allowance is counted over (`guard_bug_report_rate`, five a rolling day)
 * and what survives GitHub being unreachable, so a report is never lost to an
 * outage and a failing API can never be used to hammer the tracker. GitHub is
 * best-effort on top: it earns the player a link, and its absence costs only
 * the link.
 *
 * Everything identifying stays on the row. What leaves for the public issue
 * is shaped by `lib/bug-report.ts`, which is where the redaction lives and
 * where it is unit-tested.
 */

const reportSchema = z.object({
  area: z.enum(BUG_AREAS.map((entry) => entry.id) as [BugArea, ...BugArea[]]),
  body: z.string().trim().min(BUG_BODY_MIN).max(BUG_BODY_MAX),
  /** Round the player was on. Never printed to GitHub — it is the join key. */
  roundCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{4,12}$/)
    .nullish(),
  hole: z.number().int().min(1).max(18).nullish(),
  /**
   * The caddy conversation this is about, when the report was filed from the
   * drafting table. Private to the row, exactly like `roundCode` — the public
   * issue goes on carrying nothing but the report's own id, and whoever
   * triages it follows the link from there.
   *
   * This is the feedback loop's join: from a complaint to the session, from
   * the session to its turns, and from a turn's `trace` to what the caddy
   * actually did.
   */
  caddySessionId: z.string().uuid().nullish(),
  caddyTurnId: z.string().uuid().nullish(),
  phase: z.string().trim().max(20).nullish(),
  /** Path only — a query string can carry more than the player thinks. */
  route: z.string().trim().max(200).nullish(),
  viewport: z
    .string()
    .trim()
    .regex(/^\d{1,5}×\d{1,5}$/)
    .nullish(),
});

export type ReportBugInput = z.input<typeof reportSchema>;

export interface ReportBugResult {
  error?: string;
  /** The public issue, when one was created. Null means filed here only. */
  issueUrl?: string | null;
  issueNumber?: number | null;
}

/** GitHub is a courtesy, not the request path — never hold a phone on it. */
const GITHUB_TIMEOUT_MS = 10_000;

export async function reportBug(
  input: ReportBugInput,
): Promise<ReportBugResult> {
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: `Tell us a little more — between ${BUG_BODY_MIN} and ${BUG_BODY_MAX} characters.`,
    };
  }
  const report = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Guests are anonymous *users*, so every screen in the app has a session.
  // No session at all means the cookie jar is gone — the same condition seat
  // rescue exists for, and not something to file an issue about.
  if (!user) return { error: "Open the app again and give it another go." };

  const requestHeaders = await headers();
  const context: BugContext = {
    build: BUILD_REF,
    // Redacted on the way in as well as on the way out: the row keeps the
    // code in its own column, so there is no reason for a second copy of it
    // to sit inside the context blob.
    route: report.route
      ? redactRoundCodes(report.route, report.roundCode)
      : null,
    roundCode: report.roundCode ?? null,
    hole: report.hole ?? null,
    phase: report.phase ?? null,
    viewport: report.viewport ?? null,
    // Read here rather than taken from the client: a browser will tell you
    // what it is, but only the request can be believed about it.
    device: requestHeaders.get("user-agent"),
    locale: requestHeaders.get("accept-language"),
  };

  const { data: row, error } = await supabase
    .from("bug_reports")
    .insert({
      reporter: user.id,
      area: report.area,
      body: report.body,
      round_code: report.roundCode ?? null,
      // Both ids are checked by the insert policy — `owns_caddy_session` and
      // `owns_caddy_turn` — and neither by the foreign key. The comment that
      // used to sit here said the opposite, that "a stranger's id would be
      // refused by the constraint on a row they cannot read", which is a
      // reasonable thing to assume about foreign keys and not how they behave:
      // **a foreign key check runs with row security off.** It proves the row
      // exists and says nothing about whose it is.
      //
      // The turn is the useful one. A session is up to sixty-five cards, so a
      // report that names only the conversation leaves whoever reads it
      // guessing which card the complaint is about.
      caddy_session_id: report.caddySessionId ?? null,
      caddy_turn_id: report.caddyTurnId ?? null,
      context: { ...context, roundCode: null },
    })
    .select("id, created_at")
    .single();

  if (error) {
    // The allowance, raised as 42501 by the trigger — the same code a policy
    // refusal uses, which is why the message is the one that reads.
    if (error.code === "42501") {
      return {
        error: `That's ${BUG_REPORT_DAILY_CAP} reports today — the rest can go to the club secretary.`,
      };
    }
    return { error: "That didn't file. Give it another go." };
  }

  const issue = await fileIssue({
    reportId: row.id,
    area: report.area,
    body: report.body,
    context,
    filedAt: row.created_at,
    // Staging files real issues on purpose — it is the only way to exercise
    // this path — so it says which deployment it came from and does not have
    // to be remembered as a test.
    stage: stageTag(process.env.VERCEL_ENV),
  });
  if (!issue) return { issueUrl: null, issueNumber: null };

  // Stamp the issue back onto the row. Column-granted and one-way (the update
  // policy's USING has `issue_number is null`), so this is the only write the
  // session can make here — and a failure costs the link, not the report.
  await supabase
    .from("bug_reports")
    .update({ issue_number: issue.number, issue_url: issue.url })
    .eq("id", row.id);

  return { issueUrl: issue.url, issueNumber: issue.number };
}

/**
 * Create the public issue. Returns null for every failure — an unreachable
 * tracker, a bad token, a repo that has gone away — because none of them are
 * the player's problem and all of them leave the report safely on its row.
 */
async function fileIssue(
  draft: IssueDraft,
): Promise<{ number: number; url: string } | null> {
  const token = process.env.GITHUB_ISSUE_TOKEN;
  if (!bugTrackerEnabled(token)) return null;

  const repo = parseIssueRepo(process.env.GITHUB_ISSUE_REPO);
  if (!repo) {
    console.error("GITHUB_ISSUE_REPO is not owner/repo — no issue filed");
    return null;
  }

  const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/issues`;
  const payload = issuePayload(draft, issueLabels(process.env.GITHUB_ISSUE_LABELS));

  const post = (body: object) =>
    fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });

  try {
    let response = await post(payload);
    // 422 is nearly always a label the repository has never seen. The report
    // is worth more than its labels, so drop them and file it anyway.
    if (response.status === 422 && payload.labels.length > 0) {
      response = await post({ title: payload.title, body: payload.body });
    }
    if (!response.ok) {
      console.error(
        `Bug report issue failed (${response.status}): ${await response.text()}`,
      );
      return null;
    }
    const issue = (await response.json()) as {
      number?: number;
      html_url?: string;
    };
    if (typeof issue.number !== "number" || !issue.html_url) return null;
    return { number: issue.number, url: issue.html_url };
  } catch (cause) {
    console.error("Bug report issue failed", cause);
    return null;
  }
}
