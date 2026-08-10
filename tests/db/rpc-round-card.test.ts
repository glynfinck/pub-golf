import { beforeEach, describe, expect, it } from "vitest";

import {
  anonymousGuest,
  signedInUser,
  visitor,
  type Actor,
} from "@/tests/support/clients";
import { seedRound, seedScores, type SeededRound } from "@/tests/support/factories";

/**
 * get_round_card is what an unfurled link may say about a round.
 *
 * An Open Graph crawler carries no session at all — not a member, not the
 * host, not even signed in — so this is SECURITY DEFINER and executable by
 * `anon`. That makes it a public surface, and the interesting question is not
 * what it returns but what it refuses to: the round routes redirect a
 * signed-out visitor, and a preview must not become a way to read a card you
 * cannot open.
 */
describe("get_round_card", () => {
  let host: Actor;
  let player: Actor;
  let round: SeededRound;

  beforeEach(async () => {
    [host, player] = await Promise.all([
      signedInUser("Wren"),
      anonymousGuest("Jamie"),
    ]);
    round = await seedRound({
      host,
      players: [{ ...player, role: "player" }],
      holes: 3,
      status: "lobby",
    });
  });

  it("tells a signed-out visitor what the round is", async () => {
    const { data, error } = await visitor().rpc("get_round_card", {
      join_code: round.code,
    });
    expect(error).toBeNull();

    const card = data?.[0];
    expect(card).toBeTruthy();
    expect(card?.name).toBe("db-test round");
    expect(Number(card?.hole_count)).toBe(3);
    expect(Number(card?.par)).toBeGreaterThan(0);
  });

  it("normalises a lower-case code, because a crawler will not", async () => {
    const { data } = await visitor().rpc("get_round_card", {
      join_code: round.code.toLowerCase(),
    });
    expect(data?.[0]?.name).toBe("db-test round");
  });

  it("answers for a finished round, where get_round_preview will not", async () => {
    // The whole reason this function exists beside the other one. A recap link
    // is shared after the round ends, and get_round_preview filters to
    // lobby/live on purpose — /join must keep saying a finished round cannot
    // be joined.
    const done = await seedRound({ host, status: "finished" });

    const { data: card } = await visitor().rpc("get_round_card", {
      join_code: done.code,
    });
    expect(card?.[0]).toBeTruthy();

    const { data: preview } = await visitor().rpc("get_round_preview", {
      join_code: done.code,
    });
    expect(preview ?? []).toHaveLength(0);
  });

  it("hands out no player names and no scores", async () => {
    // The card carries the round, its size and its date — nothing that
    // belongs to a person. If a column is ever added here, this fails.
    await seedScores(round.id, [
      { playerId: round.seatOf[player.userId], hole: 1, swigs: 7 },
    ]);

    const { data } = await visitor().rpc("get_round_card", {
      join_code: round.code,
    });
    const card = data?.[0];

    expect(Object.keys(card ?? {}).sort()).toEqual([
      "created_at",
      "hole_count",
      "name",
      "par",
      "status",
    ]);
    expect(JSON.stringify(card)).not.toContain("Jamie");
    expect(JSON.stringify(card)).not.toContain("Wren");
  });

  it("returns nothing for a code that does not exist, rather than erroring", async () => {
    // The card route has to answer with an image either way; a thrown error
    // there would surface as a broken preview instead of a fallback.
    const { data, error } = await visitor().rpc("get_round_card", {
      join_code: "ZZZZZZ",
    });
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("is callable by a guest and by a signed-in user too", async () => {
    for (const actor of [player, host]) {
      const { data, error } = await actor.db.rpc("get_round_card", {
        join_code: round.code,
      });
      expect(error).toBeNull();
      expect(data?.[0]?.name).toBe("db-test round");
    }
  });
});
