import { beforeEach, describe, expect, it } from "vitest";

import {
  adminClient,
  anonymousGuest,
  signedInUser,
  visitor,
  type Actor,
} from "@/tests/support/clients";
import {
  seedRound,
  seedScores,
  type SeededRound,
} from "@/tests/support/factories";

import { expectDenied } from "./helpers/assert";

/**
 * Seat rescue: the adversarial pass on the way back in. A seatless phone may
 * only *knock* (request_seat_rescue marks the seat), an official's
 * approve_seat_rescue is the one sanctioned hand-change, and the strike
 * policy is the broom. Everything here is proven the db tier's way — a
 * blocked write is read back with the admin key, never trusted to the
 * attacker's own response.
 */
describe("seat rescue", () => {
  let host: Actor;
  let caddy: Actor;
  let jamie: Actor;
  let priya: Actor;
  let lostPhone: Actor;
  let round: SeededRound;

  const jamieSeat = () => round.seatOf[jamie.userId];
  const priyaSeat = () => round.seatOf[priya.userId];
  const hostSeat = () => round.seatOf[host.userId];

  async function storedSeatRow(seatId: string) {
    const { data, error } = await adminClient()
      .from("round_players")
      .select("id, profile_id, rescue_requested_by, rescue_requested_at, role")
      .eq("id", seatId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  beforeEach(async () => {
    [host, caddy, jamie, priya, lostPhone] = await Promise.all([
      signedInUser("Host"),
      anonymousGuest("Caddy"),
      anonymousGuest("Jamie"),
      anonymousGuest("Priya"),
      // The phone that lost its cookies: a fresh anonymous session with no
      // seat anywhere — exactly what the rescue screen mints.
      anonymousGuest("Jamie again"),
    ]);
    round = await seedRound({
      host,
      players: [
        { ...caddy, role: "caddy" },
        { ...jamie, role: "player" },
        { ...priya, role: "player" },
      ],
      holes: 3,
      currentHole: 2,
    });
  });

  describe("the seat list", () => {
    it("reads nothing at all signed out — names wait for a session", async () => {
      const { data, error } = await visitor().rpc("get_round_seats", {
        join_code: round.code,
      });
      expectDenied(error);
      expect(data).toBeNull();
    });

    it("shows a seatless session which cards can be knocked on", async () => {
      await seedScores(round.id, [
        { playerId: jamieSeat(), hole: 1, swigs: 5 },
        { playerId: jamieSeat(), hole: 2, swigs: 3 },
      ]);
      const { data, error } = await lostPhone.db.rpc("get_round_seats", {
        join_code: round.code,
      });
      expect(error).toBeNull();
      const seats = data ?? [];
      expect(seats).toHaveLength(4);

      const jamieRow = seats.find((seat) => seat.seat_id === jamieSeat());
      expect(jamieRow?.claimable).toBe(true);
      expect(jamieRow?.holes_scored).toBe(2);

      // The host signs in with Google — that card never moves this way.
      const hostRow = seats.find((seat) => seat.role === "host");
      expect(hostRow?.claimable).toBe(false);
    });
  });

  describe("knocking", () => {
    it("refuses the host seat", async () => {
      const { error } = await lostPhone.db.rpc("request_seat_rescue", {
        join_code: round.code,
        seat: hostSeat(),
      });
      expectDenied(error);
      expect((await storedSeatRow(hostSeat()))?.rescue_requested_by).toBeNull();
    });

    it("refuses a claimed card — Google is its way back", async () => {
      const claimed = await signedInUser("Claimed");
      const withClaimed = await seedRound({
        host,
        players: [{ ...claimed, role: "player" }],
      });
      const { error } = await lostPhone.db.rpc("request_seat_rescue", {
        join_code: withClaimed.code,
        seat: withClaimed.seatOf[claimed.userId],
      });
      expectDenied(error);
    });

    it("refuses a knocker who already holds a card in the round", async () => {
      const { error } = await priya.db.rpc("request_seat_rescue", {
        join_code: round.code,
        seat: jamieSeat(),
      });
      expectDenied(error);
      expect(
        (await storedSeatRow(jamieSeat()))?.rescue_requested_by,
      ).toBeNull();
    });

    it("marks the seat, and only marks it", async () => {
      const { error } = await lostPhone.db.rpc("request_seat_rescue", {
        join_code: round.code,
        seat: jamieSeat(),
      });
      expect(error).toBeNull();
      const seat = await storedSeatRow(jamieSeat());
      expect(seat?.rescue_requested_by).toBe(lostPhone.userId);
      expect(seat?.rescue_requested_at).not.toBeNull();
      // The knock is not the hand-change.
      expect(seat?.profile_id).toBe(jamie.userId);
    });

    it("moves the knock when the same phone aims at another card", async () => {
      await lostPhone.db.rpc("request_seat_rescue", {
        join_code: round.code,
        seat: jamieSeat(),
      });
      const { error } = await lostPhone.db.rpc("request_seat_rescue", {
        join_code: round.code,
        seat: priyaSeat(),
      });
      expect(error).toBeNull();
      expect(
        (await storedSeatRow(jamieSeat()))?.rescue_requested_by,
      ).toBeNull();
      expect((await storedSeatRow(priyaSeat()))?.rescue_requested_by).toBe(
        lostPhone.userId,
      );
    });
  });

  describe("the wave in", () => {
    beforeEach(async () => {
      await seedScores(round.id, [
        { playerId: jamieSeat(), hole: 1, swigs: 5 },
        { playerId: jamieSeat(), hole: 2, swigs: 3 },
      ]);
      const { error } = await lostPhone.db.rpc("request_seat_rescue", {
        join_code: round.code,
        seat: jamieSeat(),
      });
      expect(error).toBeNull();
    });

    it("is not a player's to give", async () => {
      const { error } = await priya.db.rpc("approve_seat_rescue", {
        seat: jamieSeat(),
      });
      expectDenied(error);
      expect((await storedSeatRow(jamieSeat()))?.profile_id).toBe(
        jamie.userId,
      );
    });

    it("never happens by hand, even an official's", async () => {
      await caddy.db
        .from("round_players")
        .update({ profile_id: lostPhone.userId })
        .eq("id", jamieSeat());
      // Whether the trigger errors loudly or RLS filters silently, the row
      // is the witness.
      expect((await storedSeatRow(jamieSeat()))?.profile_id).toBe(
        jamie.userId,
      );
    });

    it("moves the seat, scores and all, when an official waves", async () => {
      const { error } = await caddy.db.rpc("approve_seat_rescue", {
        seat: jamieSeat(),
      });
      expect(error).toBeNull();

      const seat = await storedSeatRow(jamieSeat());
      expect(seat?.profile_id).toBe(lostPhone.userId);
      expect(seat?.rescue_requested_by).toBeNull();
      expect(seat?.rescue_requested_at).toBeNull();

      // The card kept its swigs — the whole point of moving the seat.
      const { data: scores } = await adminClient()
        .from("scores")
        .select("hole_number, swigs")
        .eq("player_id", jamieSeat());
      expect(scores).toHaveLength(2);

      // And the rescued phone is a member now: it can read the round.
      const { data: visibleRound } = await lostPhone.db
        .from("rounds")
        .select("id")
        .eq("id", round.id)
        .maybeSingle();
      expect(visibleRound?.id).toBe(round.id);
    });

    it("refuses once the knocker has taken a seat of their own", async () => {
      await lostPhone.db.rpc("join_round", {
        join_code: round.code,
        player_name: "Jamie again",
      });
      const { error } = await caddy.db.rpc("approve_seat_rescue", {
        seat: jamieSeat(),
      });
      expectDenied(error);
      expect((await storedSeatRow(jamieSeat()))?.profile_id).toBe(
        jamie.userId,
      );
    });

    it("can be turned away by an official, and only an official", async () => {
      const { error: playerError } = await priya.db.rpc(
        "dismiss_seat_rescue",
        { seat: jamieSeat() },
      );
      expectDenied(playerError);
      expect((await storedSeatRow(jamieSeat()))?.rescue_requested_by).toBe(
        lostPhone.userId,
      );

      const { error } = await caddy.db.rpc("dismiss_seat_rescue", {
        seat: jamieSeat(),
      });
      expect(error).toBeNull();
      const seat = await storedSeatRow(jamieSeat());
      expect(seat?.rescue_requested_by).toBeNull();
      expect(seat?.profile_id).toBe(jamie.userId);
    });
  });

  describe("the strike", () => {
    it("is not a player's broom", async () => {
      await priya.db.from("round_players").delete().eq("id", jamieSeat());
      // A filtered delete returns no error and no rows — the row decides.
      expect(await storedSeatRow(jamieSeat())).not.toBeNull();
    });

    it("removes the seat and its card; what it called on others survives", async () => {
      await seedScores(round.id, [
        { playerId: jamieSeat(), hole: 1, swigs: 5 },
      ]);
      // Jamie called a penalty on Priya before leaving: the call stands,
      // attribution released — called_by is `on delete set null`.
      const { error: penaltyError } = await adminClient()
        .from("penalties")
        .insert({
          round_id: round.id,
          player_id: priyaSeat(),
          hole_number: 1,
          strokes: 1,
          reason: "db-test: called by the struck seat",
          called_by: jamieSeat(),
        });
      expect(penaltyError).toBeNull();

      const { data: struck, error } = await caddy.db
        .from("round_players")
        .delete()
        .eq("id", jamieSeat())
        .select("id");
      expect(error).toBeNull();
      expect(struck).toHaveLength(1);

      expect(await storedSeatRow(jamieSeat())).toBeNull();
      const { data: scores } = await adminClient()
        .from("scores")
        .select("id")
        .eq("player_id", jamieSeat());
      expect(scores).toHaveLength(0);

      const { data: survivors } = await adminClient()
        .from("penalties")
        .select("called_by")
        .eq("player_id", priyaSeat());
      expect(survivors).toHaveLength(1);
      expect(survivors?.[0]?.called_by).toBeNull();
    });

    it("never reaches the host seat, even for the host", async () => {
      await host.db.from("round_players").delete().eq("id", hostSeat());
      expect(await storedSeatRow(hostSeat())).not.toBeNull();

      await caddy.db.from("round_players").delete().eq("id", hostSeat());
      expect(await storedSeatRow(hostSeat())).not.toBeNull();
    });

    it("frees the struck phone to knock its way back in", async () => {
      // Strike Jamie's seat, then the very session that was struck asks to
      // come back — the door still works for it.
      await caddy.db.from("round_players").delete().eq("id", jamieSeat());

      const { error } = await jamie.db.rpc("request_seat_rescue", {
        join_code: round.code,
        seat: priyaSeat(),
      });
      expect(error).toBeNull();
      expect((await storedSeatRow(priyaSeat()))?.rescue_requested_by).toBe(
        jamie.userId,
      );
    });
  });
});
