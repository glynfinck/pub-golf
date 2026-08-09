import { beforeEach, describe, expect, it } from "vitest";

import {
  adminClient,
  anonymousGuest,
  signedInUser,
  visitor,
  type Actor,
} from "@/tests/support/clients";
import { seedRound, type SeededRound } from "@/tests/support/factories";

import { seatCount, storedSeat } from "./helpers/assert";

/**
 * join_round is the front door: SECURITY DEFINER, so it seats a guest whom the
 * round_players INSERT policy would otherwise turn away, and the only path
 * that requires knowing the code.
 */
describe("join_round", () => {
  let host: Actor;
  let guest: Actor;
  let round: SeededRound;

  beforeEach(async () => {
    [host, guest] = await Promise.all([
      signedInUser("Host"),
      anonymousGuest("Jamie"),
    ]);
    round = await seedRound({ host, status: "lobby" });
  });

  it("seats a guest who knows the code", async () => {
    const { data, error } = await guest.db.rpc("join_round", {
      join_code: round.code,
      player_name: "Jamie",
    });
    expect(error).toBeNull();
    expect(data).toBe(round.code);
    expect((await storedSeat(round.id, guest.userId))?.display_name).toBe(
      "Jamie",
    );
  });

  it("accepts a code typed in lower case", async () => {
    const { error } = await guest.db.rpc("join_round", {
      join_code: round.code.toLowerCase(),
      player_name: "Jamie",
    });
    expect(error).toBeNull();
    expect(await seatCount(round.id)).toBe(2);
  });

  it("never mints an official", async () => {
    await guest.db.rpc("join_round", {
      join_code: round.code,
      player_name: "Jamie",
    });
    expect((await storedSeat(round.id, guest.userId))?.role).toBe("player");
  });

  it("lets a guest join a round already under way", async () => {
    const live = await seedRound({ host, status: "live" });
    const { error } = await guest.db.rpc("join_round", {
      join_code: live.code,
      player_name: "Latecomer",
    });
    expect(error).toBeNull();
  });

  it("refuses an unknown code", async () => {
    const { error } = await guest.db.rpc("join_round", {
      join_code: "ZZZZZZ",
      player_name: "Jamie",
    });
    expect(error?.message).toContain("No open round with that code");
  });

  it("refuses a finished round in the same words as an unknown one", async () => {
    // Deliberately indistinguishable: a wrong code and a closed round should
    // not be tellable apart from outside.
    const finished = await seedRound({ host, status: "finished" });
    const { error } = await guest.db.rpc("join_round", {
      join_code: finished.code,
      player_name: "Jamie",
    });
    expect(error?.message).toContain("No open round with that code");
  });

  it("is idempotent — joining twice keeps one seat", async () => {
    await guest.db.rpc("join_round", {
      join_code: round.code,
      player_name: "Jamie",
    });
    const { error } = await guest.db.rpc("join_round", {
      join_code: round.code,
      player_name: "Jamie",
    });
    expect(error).toBeNull();
    expect(await seatCount(round.id)).toBe(2);
  });

  it("keeps the original name when the same guest rejoins under another", async () => {
    await guest.db.rpc("join_round", {
      join_code: round.code,
      player_name: "Jamie",
    });
    await guest.db.rpc("join_round", {
      join_code: round.code,
      player_name: "Someone else",
    });
    expect((await storedSeat(round.id, guest.userId))?.display_name).toBe(
      "Jamie",
    );
  });

  it("refuses a caller with no session at all", async () => {
    const { error } = await visitor().rpc("join_round", {
      join_code: round.code,
      player_name: "Nobody",
    });
    expect(error).not.toBeNull();
    expect(await seatCount(round.id)).toBe(1);
  });

  it("seats a guest whose cleared session makes them a stranger again", async () => {
    // The identity gap, stated as a test rather than left to be discovered on
    // a crawl: a guest who clears cookies comes back with a new auth.uid(), so
    // the (round_id, profile_id) conflict never fires and they arrive as a
    // second player under the same name. The original card is orphaned —
    // nobody can ever authenticate back into it.
    await guest.db.rpc("join_round", {
      join_code: round.code,
      player_name: "Jamie",
    });

    const returning = await anonymousGuest("Jamie");
    await returning.db.rpc("join_round", {
      join_code: round.code,
      player_name: "Jamie",
    });

    const { data } = await adminClient()
      .from("round_players")
      .select("display_name")
      .eq("round_id", round.id)
      .eq("display_name", "Jamie");
    expect(data).toHaveLength(2);
  });
});

describe("get_round_preview", () => {
  it("answers a signed-out visitor", async () => {
    const host = await signedInUser("Host");
    const round = await seedRound({ host, holes: 3, status: "lobby" });

    const { data, error } = await visitor().rpc("get_round_preview", {
      join_code: round.code,
    });
    expect(error).toBeNull();
    expect(data?.[0]).toMatchObject({
      hole_count: 3,
      player_count: 1,
      host_name: "Host",
    });
  });

  it("returns nothing at all — not an error — for an unknown code", async () => {
    const { data, error } = await visitor().rpc("get_round_preview", {
      join_code: "ZZZZZZ",
    });
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("returns nothing for a finished round", async () => {
    const host = await signedInUser("Host");
    const round = await seedRound({ host, status: "finished" });
    const { data } = await visitor().rpc("get_round_preview", {
      join_code: round.code,
    });
    expect(data).toEqual([]);
  });
});
