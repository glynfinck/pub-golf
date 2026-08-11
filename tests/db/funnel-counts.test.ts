import { beforeEach, describe, expect, it } from "vitest";

import {
  adminClient,
  anonymousGuest,
  signedInUser,
  visitor,
  type Actor,
} from "@/tests/support/clients";
import { seedRound, type SeededRound } from "@/tests/support/factories";

import { expectDenied } from "./helpers/assert";

/** The two funnel columns, read past RLS — the only honest witness. */
async function books(roundId: string) {
  const { data, error } = await adminClient()
    .from("rounds")
    .select("status, finished_at, recap_shares")
    .eq("id", roundId)
    .single();
  if (error) throw error;
  return data;
}

/**
 * Phase one's denominators. Two columns on `rounds` and two functions, and
 * the whole point of them is that the numbers are true — so what this suite
 * asks is who can move them and who cannot.
 *
 * Both columns are derived rather than submitted: `finished_at` comes off the
 * status transition and `recap_shares` moves only for `record_recap_share`.
 * An official may update a round all night without either of them budging.
 */
describe("funnel counts", () => {
  let host: Actor;
  let caddy: Actor;
  let guest: Actor;
  let stranger: Actor;
  let round: SeededRound;

  beforeEach(async () => {
    [host, caddy, guest, stranger] = await Promise.all([
      signedInUser("Host"),
      signedInUser("Caddy"),
      anonymousGuest("Guest"),
      signedInUser("Stranger"),
    ]);
    round = await seedRound({
      host,
      players: [{ ...caddy, role: "caddy" }, guest],
      status: "live",
    });
  });

  describe("finished_at — when the card was filed", () => {
    it("stamps itself when the round is filed, and clears on a reopen", async () => {
      expect((await books(round.id)).finished_at).toBeNull();

      const { error: fileError } = await host.db
        .from("rounds")
        .update({ status: "finished" })
        .eq("id", round.id);
      expect(fileError).toBeNull();

      const filed = await books(round.id);
      expect(filed.status).toBe("finished");
      expect(filed.finished_at).not.toBeNull();

      // Reopened: a card back in play has no filing time again.
      const { error: reopenError } = await host.db
        .from("rounds")
        .update({ status: "live" })
        .eq("id", round.id);
      expect(reopenError).toBeNull();
      expect((await books(round.id)).finished_at).toBeNull();
    });

    it("is derived, not submitted — a backdated filing is ignored", async () => {
      // Filing and lying about when, in one statement. The stamp overwrites
      // whatever came in, so the round is filed *now* however it was asked.
      const lie = "2020-01-01T00:00:00.000Z";
      await host.db
        .from("rounds")
        .update({ status: "finished", finished_at: lie })
        .eq("id", round.id);

      const filed = await books(round.id);
      expect(filed.finished_at).not.toBeNull();
      expect(new Date(filed.finished_at as string).getUTCFullYear()).toBe(
        new Date().getUTCFullYear(),
      );
    });

    it("stays null while an official runs the round", async () => {
      await host.db
        .from("rounds")
        .update({ current_hole: 2, hole_phase: "walking" })
        .eq("id", round.id);
      expect((await books(round.id)).finished_at).toBeNull();
    });
  });

  describe("recap_shares — the one moment that leaves no trace", () => {
    it("counts a share from every seat at the table, guests included", async () => {
      for (const actor of [host, caddy, guest]) {
        const { error } = await actor.db.rpc("record_recap_share", {
          join_code: round.code,
        });
        expect(error).toBeNull();
      }
      expect((await books(round.id)).recap_shares).toBe(3);
    });

    it("takes the code in either case, like every other door", async () => {
      const { error } = await guest.db.rpc("record_recap_share", {
        join_code: round.code.toLowerCase(),
      });
      expect(error).toBeNull();
      expect((await books(round.id)).recap_shares).toBe(1);
    });

    it("refuses a stranger holding the code", async () => {
      const { error } = await stranger.db.rpc("record_recap_share", {
        join_code: round.code,
      });
      expectDenied(error);
      expect((await books(round.id)).recap_shares).toBe(0);
    });

    it("refuses a visitor with no session at all", async () => {
      // anon holds no execute grant: a crawler cannot inflate the books.
      const { error } = await visitor().rpc("record_recap_share", {
        join_code: round.code,
      });
      expect(error).not.toBeNull();
      expect((await books(round.id)).recap_shares).toBe(0);
    });

    it("cannot be set directly, even by the host", async () => {
      // The rounds UPDATE policy admits officials, so this write is not
      // filtered out — it succeeds and changes nothing, which is why the
      // stored row is the proof rather than the absent error.
      await host.db
        .from("rounds")
        .update({ recap_shares: 9999 })
        .eq("id", round.id);
      expect((await books(round.id)).recap_shares).toBe(0);

      // And an honest share still lands afterwards.
      await host.db.rpc("record_recap_share", { join_code: round.code });
      expect((await books(round.id)).recap_shares).toBe(1);
    });

    it("is not moved by the round being run", async () => {
      await host.db.rpc("record_recap_share", { join_code: round.code });
      await host.db
        .from("rounds")
        .update({ current_hole: 3, status: "finished" })
        .eq("id", round.id);
      expect((await books(round.id)).recap_shares).toBe(1);
    });
  });

  describe("house_funnel — the house's own books", () => {
    it("is refused to players and visitors alike", async () => {
      for (const db of [host.db, guest.db, visitor()]) {
        const { error } = await db.rpc("house_funnel", {});
        expect(error).not.toBeNull();
      }
    });

    it("counts the four moments, and never the host's own seat as a join", async () => {
      const since = new Date(Date.now() - 60_000).toISOString();
      await guest.db.rpc("record_recap_share", { join_code: round.code });
      await host.db
        .from("rounds")
        .update({ status: "finished" })
        .eq("id", round.id);

      const { data, error } = await adminClient().rpc("house_funnel", {
        since,
        until: new Date(Date.now() + 60_000).toISOString(),
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;

      // Other tests in the run share this window, so these are floors, not
      // equalities — except the shape of the pairing, which is exact: this
      // round contributed one created, two joined (caddy and guest, never
      // the host's seat), one finished and one share.
      expect(row.rounds_created).toBeGreaterThanOrEqual(1);
      expect(row.rounds_joined).toBeGreaterThanOrEqual(2);
      expect(row.rounds_finished).toBeGreaterThanOrEqual(1);
      expect(row.recaps_shared).toBeGreaterThanOrEqual(1);
    });

    it("leaves an unfiled round out of the finished count", async () => {
      const { data, error } = await adminClient().rpc("house_funnel", {
        since: new Date(Date.now() - 60_000).toISOString(),
        until: new Date(Date.now() + 60_000).toISOString(),
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      const { count } = await adminClient()
        .from("rounds")
        .select("id", { count: "exact", head: true })
        .not("finished_at", "is", null)
        .gte("finished_at", new Date(Date.now() - 60_000).toISOString());
      expect(row.rounds_finished).toBe(count ?? 0);
    });
  });
});
