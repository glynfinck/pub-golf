import { INVITATIONAL_COURSE } from "@/lib/course-templates";

import { adminClient, type Actor } from "./clients";
import { track } from "./scope";

export interface SeededRound {
  id: string;
  code: string;
  holeCount: number;
  /** round_players.id, keyed by the profile sitting in that seat. */
  seatOf: Record<string, string>;
}

export interface SeedRoundOptions {
  host: Pick<Actor, "userId" | "name">;
  players?: (Pick<Actor, "userId" | "name"> & {
    role?: "caddy" | "player";
    handicap?: number;
  })[];
  holes?: number;
  status?: "lobby" | "live" | "finished";
  currentHole?: number;
  /** Mulligans per player. 0 (the default) turns them off. */
  mulligans?: number;
  /** Leave the new ruleset keys off entirely, as a round created before
   * they existed would have them. */
  legacyRuleset?: boolean;
}

/**
 * Seed a round the way createRound would, but in one service-role pass. These
 * tests ask who may read and write a round, not how it was built — driving the
 * real action here would only test the action, and slowly.
 */
export async function seedRound(
  options: SeedRoundOptions,
): Promise<SeededRound> {
  const db = adminClient();
  const holeCount = options.holes ?? 3;

  const { data: round, error } = await db
    .from("rounds")
    .insert({
      name: `db-test round`,
      host: options.host.userId,
      status: options.status ?? "live",
      current_hole: options.currentHole ?? 1,
      ruleset: options.legacyRuleset
        ? {
            format: "stroke",
            hazards: true,
            holeTimerMinutes: null,
            softSubstituteScoresPar: true,
            penalties: [],
          }
        : {
            format: "stroke",
            hazards: true,
            holeTimerMinutes: null,
            softSubstituteScoresPar: true,
            penalties: [],
            handicaps: true,
            mulligans: options.mulligans ?? 0,
            mulliganStrokes: 1,
          },
    })
    .select("id, code")
    .single();
  if (error) throw error;
  track.round(round.id);

  const { error: holesError } = await db.from("holes").insert(
    INVITATIONAL_COURSE.slice(0, holeCount).map((hole) => ({
      round_id: round.id,
      number: hole.number,
      venue_name: hole.venue_name,
      drink: hole.drink,
      par: hole.par,
      hazard: hole.hazard,
      hazard_note: hole.hazard_note,
      walk_minutes_to_next: hole.walk_minutes_to_next,
    })),
  );
  if (holesError) throw holesError;

  // Every row carries the same keys. PostgREST builds one column list from the
  // UNION of the keys across a batch and writes NULL into the rows that did
  // not mention a column — it does not fall back to the column default. So a
  // host row that simply omitted `handicap` would be inserted as null and
  // break the not-null constraint the moment any player row named it.
  const { data: seats, error: seatError } = await db
    .from("round_players")
    .insert([
      {
        round_id: round.id,
        profile_id: options.host.userId,
        display_name: options.host.name,
        role: "host",
        handicap: 0,
      },
      ...(options.players ?? []).map((player) => ({
        round_id: round.id,
        profile_id: player.userId,
        display_name: player.name,
        role: player.role ?? "player",
        handicap: player.handicap ?? 0,
      })),
    ])
    .select("id, profile_id");
  if (seatError) throw seatError;

  return {
    id: round.id,
    code: round.code,
    holeCount,
    seatOf: Object.fromEntries(
      seats.map((seat) => [seat.profile_id, seat.id] as const),
    ),
  };
}

/** Put swigs on the card without playing a hole through a browser. */
export async function seedScores(
  roundId: string,
  entries: {
    playerId: string;
    hole: number;
    swigs: number;
    mulligans?: number;
  }[],
): Promise<void> {
  const { error } = await adminClient()
    .from("scores")
    .insert(
      entries.map((entry) => ({
        round_id: roundId,
        player_id: entry.playerId,
        hole_number: entry.hole,
        swigs: entry.swigs,
        mulligans: entry.mulligans ?? 0,
      })),
    );
  if (error) throw error;
}
