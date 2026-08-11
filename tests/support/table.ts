import { adminClient, anonymousGuest, signedInUser } from "./clients";
import type { Actor } from "./clients";
import { pooled } from "./concurrency";
import { seedRound } from "./factories";
import type { SeededRound } from "./factories";

/**
 * A whole table's worth of sessions.
 *
 * The db tier seats four because four is a foursome; this seats twenty
 * because twenty is what a stag do actually turns up with, and because
 * nothing in this app is written to notice the difference until it does.
 * Every seat is a real session with its own JWT — the same thing twenty
 * phones would hold — so a test built on this is asking what Postgres does
 * with twenty simultaneous strangers, not what a loop does.
 */

/** Twenty seats and eighteen holes: a full card, played by a full table. */
export const FULL_TABLE = 20;
export const FULL_CARD = 18;

/** Ana, Bram, Cleo … and on into a second and third alphabet if asked. */
const NAMES = [
  "Ana",
  "Bram",
  "Cleo",
  "Dot",
  "Esme",
  "Fitz",
  "Gus",
  "Hero",
  "Ida",
  "Jools",
  "Kit",
  "Lena",
  "Mo",
  "Nev",
  "Otto",
  "Pip",
  "Quin",
  "Rue",
  "Sol",
  "Tam",
  "Ute",
  "Vic",
  "Win",
  "Xan",
  "Yves",
  "Zeb",
];

/** Distinct, stable, and readable in a failure message at any size. */
export function seatName(index: number): string {
  const name = NAMES[index % NAMES.length];
  const lap = Math.floor(index / NAMES.length);
  return lap === 0 ? name : `${name}${lap + 1}`;
}

export interface Table {
  /** The signed-in account that created the round. */
  host: Actor;
  /** The one guest promoted to caddy — every table has a marker. */
  caddy: Actor;
  /** Ordinary players: no officials among them. */
  players: Actor[];
  /** Host + caddy + players, in seating order. */
  everyone: Actor[];
  round: SeededRound;
  /** round_players.id for an actor — the id every score and penalty keys on. */
  seatOf: (actor: Actor) => string;
}

export interface SeatTableOptions {
  /** Total seats including the host and the caddy. */
  size?: number;
  holes?: number;
  status?: "lobby" | "live" | "finished";
  currentHole?: number;
  mulligans?: number;
  /** Handicap per seat index, host first. Defaults to 0 for everyone. */
  handicapAt?: (index: number) => number;
}

/**
 * Seat a full table in one pass: sessions minted, round seeded, seats filled.
 *
 * The host is a signed-in account (only a Google account may host) and
 * everyone else is an anonymous guest, which is exactly the shape of a real
 * round. Seats are written by `seedRound` in a single service-role insert
 * rather than through twenty `join_round` calls — seating is not what these
 * tests are asking about, except in the join stampede, which drives the real
 * RPC on purpose.
 */
export async function seatTable(
  options: SeatTableOptions = {},
): Promise<Table> {
  const size = options.size ?? FULL_TABLE;
  if (size < 2) throw new Error("A table needs a host and at least one guest");
  const handicapAt = options.handicapAt ?? (() => 0);

  const [host, ...guests] = await pooled(
    Array.from({ length: size }, (_, index) => index),
    8,
    (index) =>
      index === 0
        ? signedInUser("Wren")
        : anonymousGuest(seatName(index - 1)),
  );

  const round = await seedRound({
    host,
    holes: options.holes ?? FULL_CARD,
    status: options.status ?? "live",
    currentHole: options.currentHole,
    mulligans: options.mulligans,
    players: guests.map((guest, index) => ({
      userId: guest.userId,
      name: guest.name,
      // One caddy, seated first among the guests: an official who is not the
      // host is the only way to test the marker's powers apart from the
      // host's, and every real table has one.
      role: index === 0 ? ("caddy" as const) : ("player" as const),
      handicap: handicapAt(index + 1),
    })),
  });

  const everyone = [host, ...guests];
  return {
    host,
    caddy: guests[0],
    players: guests.slice(1),
    everyone,
    round,
    seatOf: (actor) => {
      const seat = round.seatOf[actor.userId];
      if (!seat) throw new Error(`${actor.name} is not seated in this round`);
      return seat;
    },
  };
}

/** Every score row on a round, read past RLS. */
export async function storedScores(roundId: string) {
  const { data, error } = await adminClient()
    .from("scores")
    .select("player_id, hole_number, swigs, mulligans")
    .eq("round_id", roundId);
  if (error) throw error;
  return data;
}

/** Every penalty on a round, read past RLS. */
export async function storedPenalties(roundId: string) {
  const { data, error } = await adminClient()
    .from("penalties")
    .select("player_id, hole_number, strokes, reason, called_by")
    .eq("round_id", roundId);
  if (error) throw error;
  return data;
}

/** The holes as seeded, in card order — pars for an independent scoring pass. */
export async function storedHoles(roundId: string) {
  const { data, error } = await adminClient()
    .from("holes")
    .select("number, par, venue_name")
    .eq("round_id", roundId)
    .order("number");
  if (error) throw error;
  return data;
}

/** The seats as stored, for the standings the app would compute. */
export async function storedSeats(roundId: string) {
  const { data, error } = await adminClient()
    .from("round_players")
    .select("id, display_name, role, handicap")
    .eq("round_id", roundId);
  if (error) throw error;
  return data;
}
