import type { Tables } from "@/types/supabase-helpers";

export interface StandingRow {
  playerId: string;
  name: string;
  role: string;
  /** Swigs + penalty strokes + breakfast balls, across holes played. */
  gross: number;
  penaltyStrokes: number;
  /** Breakfast balls taken so far — the count, not the strokes. */
  breakfastBalls: number;
  holesPlayed: number;
  /** Gross minus the par of the holes actually played. */
  toPar: number;
  /** The player's whole-round handicap, as set by the officials. */
  handicap: number;
  /** How much of it is in play yet — see computeStandings. */
  handicapApplied: number;
  /** Gross minus the handicap in play. This is what the round is won on. */
  net: number;
  netToPar: number;
  rank: number;
  isYou: boolean;
}

export interface StandingsOptions {
  /**
   * The last FILED hole (current_hole − 1 mid-round, the final hole once
   * finished). Zero swigs on a filed hole means the drink never happened —
   * the player scores a substitute instead of an impossible free ride.
   */
  filedThrough: number;
  /** Substitute = par when true (the friendly default), double par —
   * the maximum — when false. */
  softSubstituteScoresPar: boolean;
  /** What one breakfast ball costs on the card. */
  breakfastBallStrokes: number;
}

const DEFAULT_OPTIONS: StandingsOptions = {
  filedThrough: 0,
  softSubstituteScoresPar: true,
  breakfastBallStrokes: 1,
};

/**
 * Live standings: players may be on different holes mid-round, so ranking
 * uses score-to-par over holes each player has actually recorded, exactly
 * like a golf leaderboard mid-tournament. Filed holes always count —
 * unplayed drinks score the substitute, never zero.
 *
 * Handicaps come off gross to give net, and net is what the round is won on.
 * They arrive **pro rata**, though: a flat six shots off from the first hole
 * would put a six-handicap six under before they had drunk anything, and this
 * leaderboard is read all night, not just at the end. So a player holds the
 * share of their handicap matching the holes they have played — which is the
 * whole handicap by the time the card is filed, and an honest number before.
 */
export function computeStandings(
  holes: Pick<Tables<"holes">, "number" | "par">[],
  players: Pick<
    Tables<"round_players">,
    "id" | "display_name" | "role" | "handicap"
  >[],
  scores: Pick<
    Tables<"scores">,
    "player_id" | "hole_number" | "swigs" | "breakfast_balls"
  >[],
  penalties: Pick<Tables<"penalties">, "player_id" | "strokes">[],
  myPlayerId?: string,
  options: StandingsOptions = DEFAULT_OPTIONS,
): StandingRow[] {
  const rows = players.map((player) => {
    const myScores = scores.filter((score) => score.player_id === player.id);
    const scoreByHole = new Map(
      myScores.map((score) => [score.hole_number, score.swigs]),
    );

    let swigs = 0;
    let parPlayed = 0;
    let holesPlayed = 0;
    for (const hole of holes) {
      const recorded = scoreByHole.get(hole.number) ?? 0;
      if (hole.number <= options.filedThrough) {
        // Filed: a drink with no swigs on it never happened. That holds even
        // after a breakfast ball — resetting a hole must never buy a free
        // one, so the substitute lands and the mulligan is still charged.
        swigs +=
          recorded > 0
            ? recorded
            : options.softSubstituteScoresPar
              ? hole.par
              : hole.par * 2;
        parPlayed += hole.par;
        holesPlayed += 1;
      } else if (recorded > 0) {
        // In progress: count only once there are real swigs on the card.
        swigs += recorded;
        parPlayed += hole.par;
        holesPlayed += 1;
      }
    }

    const penaltyStrokes = penalties
      .filter((penalty) => penalty.player_id === player.id)
      .reduce((sum, penalty) => sum + penalty.strokes, 0);
    // Every breakfast ball is charged, wherever on the card it was taken —
    // the same rule penalties already follow.
    const breakfastBalls = myScores.reduce(
      (sum, score) => sum + score.breakfast_balls,
      0,
    );
    const gross =
      swigs + penaltyStrokes + breakfastBalls * options.breakfastBallStrokes;

    const handicap = player.handicap;
    const handicapApplied =
      holes.length > 0
        ? Math.round((handicap * holesPlayed) / holes.length)
        : 0;
    const net = gross - handicapApplied;

    return {
      playerId: player.id,
      name: player.display_name,
      role: player.role,
      gross,
      penaltyStrokes,
      breakfastBalls,
      holesPlayed,
      toPar: gross - parPlayed,
      handicap,
      handicapApplied,
      net,
      netToPar: net - parPlayed,
      rank: 0,
      isYou: player.id === myPlayerId,
    };
  });

  rows.sort(
    (a, b) =>
      a.netToPar - b.netToPar || b.holesPlayed - a.holesPlayed || a.net - b.net,
  );
  rows.forEach((row, index) => {
    // Shared placings on equal score-to-par, golf style.
    row.rank =
      index > 0 && rows[index - 1].netToPar === row.netToPar
        ? rows[index - 1].rank
        : index + 1;
  });
  return rows;
}

export interface Superlatives {
  /** Player with the most penalty strokes on the card, if anyone has any. */
  mostHazarded: { name: string; strokes: number } | null;
  /** The single best player-hole of the night (lowest swigs vs par). */
  bestHole: { name: string; venue: string; toPar: number } | null;
  /** Lowest spread of per-hole to-par among players with 2+ holes. */
  steadiest: { name: string } | null;
}

/** The recap's honours board. All computable from the card alone — no
 * timestamps required. */
export function computeSuperlatives(
  holes: Pick<Tables<"holes">, "number" | "par" | "venue_name">[],
  players: Pick<Tables<"round_players">, "id" | "display_name">[],
  scores: Pick<Tables<"scores">, "player_id" | "hole_number" | "swigs">[],
  penalties: Pick<Tables<"penalties">, "player_id" | "strokes">[],
): Superlatives {
  const parByHole = new Map(holes.map((hole) => [hole.number, hole.par]));
  const venueByHole = new Map(
    holes.map((hole) => [hole.number, hole.venue_name]),
  );
  const nameById = new Map(
    players.map((player) => [player.id, player.display_name]),
  );

  let mostHazarded: Superlatives["mostHazarded"] = null;
  for (const player of players) {
    const strokes = penalties
      .filter((row) => row.player_id === player.id)
      .reduce((sum, row) => sum + row.strokes, 0);
    if (strokes > 0 && (!mostHazarded || strokes > mostHazarded.strokes)) {
      mostHazarded = { name: player.display_name, strokes };
    }
  }

  let bestHole: Superlatives["bestHole"] = null;
  for (const score of scores) {
    if (score.swigs === 0) continue; // an undrunk drink is nobody's best hole
    const par = parByHole.get(score.hole_number);
    const name = nameById.get(score.player_id);
    if (par === undefined || !name) continue;
    const toPar = score.swigs - par;
    if (!bestHole || toPar < bestHole.toPar) {
      bestHole = {
        name,
        venue: venueByHole.get(score.hole_number) ?? `hole ${score.hole_number}`,
        toPar,
      };
    }
  }

  let steadiest: Superlatives["steadiest"] = null;
  let lowestSpread = Infinity;
  for (const player of players) {
    const diffs = scores
      .filter((score) => score.player_id === player.id && score.swigs > 0)
      .map((score) => score.swigs - (parByHole.get(score.hole_number) ?? 0));
    if (diffs.length < 2) continue;
    const mean = diffs.reduce((sum, d) => sum + d, 0) / diffs.length;
    const spread =
      diffs.reduce((sum, d) => sum + (d - mean) ** 2, 0) / diffs.length;
    if (spread < lowestSpread) {
      lowestSpread = spread;
      steadiest = { name: player.display_name };
    }
  }

  return { mostHazarded, bestHole, steadiest };
}
