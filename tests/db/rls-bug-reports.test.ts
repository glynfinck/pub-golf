import { beforeEach, describe, expect, it } from "vitest";

import { BUG_REPORT_DAILY_CAP } from "@/lib/bug-report";
import {
  adminClient,
  anonymousGuest,
  signedInUser,
  visitor,
  type Actor,
} from "@/tests/support/clients";

import { expectDenied } from "./helpers/assert";

const SAID = "The timer ran out and my swigs went back to zero.";

async function fileReport(actor: Actor, body = SAID) {
  return actor.db
    .from("bug_reports")
    .insert({ reporter: actor.userId, area: "scoring", body })
    .select("id, issue_number, issue_url")
    .single();
}

async function storedReport(id: string) {
  const { data, error } = await adminClient()
    .from("bug_reports")
    .select("id, reporter, body, area, round_code, issue_number, issue_url")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * A bug report is between one player and the club secretary, and it turns
 * into a world-readable GitHub issue. Both halves of that are enforced here:
 * the table is reporter-scoped in every direction, and the allowance that
 * stops the public tracker being papered is counted in Postgres, where a
 * serverless action cannot outrun it.
 */
describe("bug reports", () => {
  let reporter: Actor;
  let guest: Actor;
  let stranger: Actor;

  beforeEach(async () => {
    [reporter, guest, stranger] = await Promise.all([
      signedInUser("Reporter"),
      anonymousGuest("Guest"),
      signedInUser("Stranger"),
    ]);
  });

  it("takes a report from a signed-in member and from a guest alike", async () => {
    // Guests are most of the traffic and hit most of the bugs; an anonymous
    // seat files on exactly the same terms as a claimed card.
    for (const actor of [reporter, guest]) {
      const { data, error } = await fileReport(actor);
      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect((await storedReport(data!.id))?.reporter).toBe(actor.userId);
    }
  });

  it("refuses a report filed in somebody else's name", async () => {
    const { error } = await reporter.db.from("bug_reports").insert({
      reporter: stranger.userId,
      area: "other",
      body: SAID,
    });
    expectDenied(error);
  });

  it("defaults the reporter to the caller, so the column cannot be forgotten", async () => {
    const { data, error } = await reporter.db
      .from("bug_reports")
      .insert({ area: "other", body: SAID })
      .select("id")
      .single();
    expect(error).toBeNull();
    expect((await storedReport(data!.id))?.reporter).toBe(reporter.userId);
  });

  it("shows a reporter their own reports and nobody else's", async () => {
    const mine = await fileReport(reporter);
    await fileReport(stranger, "Something else entirely broke.");

    const { data, error } = await reporter.db
      .from("bug_reports")
      .select("id, body");
    expect(error).toBeNull();
    expect(data?.map((row) => row.id)).toEqual([mine.data!.id]);

    // And a stranger reading for it by id gets nothing, not an error.
    const { data: peek, error: peekError } = await stranger.db
      .from("bug_reports")
      .select("id, body")
      .eq("id", mine.data!.id);
    expect(peekError).toBeNull();
    expect(peek).toEqual([]);
  });

  it("keeps the signed-out world out of the table entirely", async () => {
    const { error } = await visitor().from("bug_reports").select("id");
    // No policy AND no grant for `anon`: nothing signed-out ever queries this
    // table, so the honest answer is the gate, not an empty list.
    expect(error?.code).toBe("42501");
  });

  it("stamps the issue onto the row once, and only the issue", async () => {
    const filed = await fileReport(reporter);
    const id = filed.data!.id;

    const { error } = await reporter.db
      .from("bug_reports")
      .update({ issue_number: 42, issue_url: "https://github.com/x/y/issues/42" })
      .eq("id", id);
    expect(error).toBeNull();
    expect((await storedReport(id))?.issue_number).toBe(42);

    // Re-pointing a filed issue is a one-way door — USING sees OLD, and OLD
    // now has a number. An update RLS filters out is no error and no rows,
    // so the stored row is the only honest proof.
    const { error: again } = await reporter.db
      .from("bug_reports")
      .update({ issue_number: 99 })
      .eq("id", id);
    expect(again).toBeNull();
    expect((await storedReport(id))?.issue_number).toBe(42);
  });

  it("refuses to let a reporter rewrite what they said", async () => {
    const filed = await fileReport(reporter);
    const id = filed.data!.id;

    // Column-level grant: `body` was never writable after the insert, so this
    // is refused outright rather than filtered.
    const { error } = await reporter.db
      .from("bug_reports")
      .update({ body: "Actually, everything is fine and always was." })
      .eq("id", id);
    expectDenied(error);
    expect((await storedReport(id))?.body).toBe(SAID);
  });

  it("refuses to let anyone stamp somebody else's report", async () => {
    const filed = await fileReport(reporter);
    const { error } = await stranger.db
      .from("bug_reports")
      .update({ issue_number: 7 })
      .eq("id", filed.data!.id);
    expect(error).toBeNull(); // filtered, not refused
    expect((await storedReport(filed.data!.id))?.issue_number).toBeNull();
  });

  it("holds the reporter to the day's allowance", async () => {
    for (let filed = 0; filed < BUG_REPORT_DAILY_CAP; filed += 1) {
      const { error } = await fileReport(reporter, `${SAID} (${filed})`);
      expect(error).toBeNull();
    }

    const { error } = await fileReport(reporter, "One more for luck.");
    expectDenied(error);

    // The allowance is per reporter, not per table: a different phone with a
    // different bug is not collateral damage.
    const { error: theirs } = await fileReport(guest);
    expect(theirs).toBeNull();
  });

  it("counts a concurrent burst honestly — a double tap is not an extra report", async () => {
    // 20260816's lesson, applied here: a read-then-check allowance loses to
    // writers whose rows are not yet visible to each other. The trigger takes
    // an advisory lock on the reporter first, so the count below is taken
    // against a snapshot that contains everything already committed.
    const burst = await Promise.all(
      Array.from({ length: BUG_REPORT_DAILY_CAP + 4 }, (_, index) =>
        fileReport(reporter, `${SAID} burst ${index}`),
      ),
    );
    expect(burst.filter((result) => result.error === null)).toHaveLength(
      BUG_REPORT_DAILY_CAP,
    );

    const { count } = await adminClient()
      .from("bug_reports")
      .select("id", { count: "exact", head: true })
      .eq("reporter", reporter.userId);
    expect(count).toBe(BUG_REPORT_DAILY_CAP);
  });

  it("agrees with the app about what the allowance is", async () => {
    // The screen's copy quotes this number. A cap the player is misquoted is
    // a report they were told was filed when it was refused.
    const { data, error } = await reporter.db.rpc("bug_report_daily_cap");
    expect(error).toBeNull();
    expect(data).toBe(BUG_REPORT_DAILY_CAP);
  });

  it("lets the club secretary file past the allowance, as service_role", async () => {
    // The trigger exempts service_role: the allowance is abuse control on a
    // phone, not a rule about what the database may hold.
    for (let filed = 0; filed < BUG_REPORT_DAILY_CAP + 2; filed += 1) {
      const { error } = await adminClient()
        .from("bug_reports")
        .insert({ reporter: reporter.userId, area: "other", body: SAID });
      expect(error).toBeNull();
    }
  });

  it("bounds what a crafted client can store", async () => {
    const tooShort = await reporter.db
      .from("bug_reports")
      .insert({ reporter: reporter.userId, area: "other", body: "nope" });
    expect(tooShort.error?.code).toBe("23514");

    const tooLong = await reporter.db.from("bug_reports").insert({
      reporter: reporter.userId,
      area: "other",
      body: "x".repeat(2001),
    });
    expect(tooLong.error?.code).toBe("23514");

    const notAnArea = await reporter.db
      .from("bug_reports")
      .insert({ reporter: reporter.userId, area: "everything", body: SAID });
    expect(notAnArea.error?.code).toBe("23514");

    const novel = await reporter.db.from("bug_reports").insert({
      reporter: reporter.userId,
      area: "other",
      body: SAID,
      context: { junk: "x".repeat(5000) },
    });
    expect(novel.error?.code).toBe("23514");
  });
});
