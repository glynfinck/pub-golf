/**
 * The league: one table across many rounds, and the first thing the green
 * fee actually buys.
 *
 * Pure, and fed rounds that have already been scored — `computeStandings`
 * owns what a card is worth, and this owns nothing but the arithmetic of
 * putting several of them side by side. No clock, no stack, no network:
 * the house's testing rule, and the reason the ranking is provable.
 *
 * Identity across rounds is the **profile**, not the seat. A round_players
 * row lives and dies with its round, but the profile behind it survives —
 * a guest keeps theirs on the same phone, and claiming a card keeps every
 * round already on it, which is exactly what makes a league possible for a
 * table where nobody signed up.
 */

export interface LeagueCard {
  profileId: string;
  name: string;
  /** Net to par, which is what the round was won on. */
  netToPar: number;
  gross: number;
  rank: number;
}

export interface LeagueRound {
  code: string;
  name: string;
  /** ISO — when the card was filed. */
  playedAt: string;
  cards: LeagueCard[];
}

export interface LeagueRow {
  profileId: string;
  name: string;
  rounds: number;
  wins: number;
  /** Every round's net to par, added up. */
  totalToPar: number;
  /** The order of merit's own figure: total over rounds played. */
  averageToPar: number;
  /** The best single card, in to-par. */
  bestToPar: number;
  rank: number;
}

/**
 * The order of merit.
 *
 * Ranked on the **average** to par rather than the total, because a league
 * that ranked on the total would punish turning up: a player who came to
 * five rounds could never beat one who came to two. Rounds played is the
 * first tie-break, so between two identical averages the one who kept
 * showing up is ahead — which is the behaviour a league exists to reward.
 *
 * Names come from the most recent round a player appears in: a player who
 * joined as "Dave" and later as "David" is one player, under the newer name.
 */
export function computeLeague(rounds: LeagueRound[]): LeagueRow[] {
  // Newest first, so the first name seen for a profile is its latest.
  const byDate = [...rounds].sort((a, b) => b.playedAt.localeCompare(a.playedAt));

  const tally = new Map<string, LeagueRow>();
  for (const round of byDate) {
    for (const card of round.cards) {
      const row = tally.get(card.profileId);
      if (!row) {
        tally.set(card.profileId, {
          profileId: card.profileId,
          name: card.name,
          rounds: 1,
          wins: card.rank === 1 ? 1 : 0,
          totalToPar: card.netToPar,
          averageToPar: card.netToPar,
          bestToPar: card.netToPar,
          rank: 0,
        });
        continue;
      }
      row.rounds += 1;
      row.wins += card.rank === 1 ? 1 : 0;
      row.totalToPar += card.netToPar;
      row.bestToPar = Math.min(row.bestToPar, card.netToPar);
    }
  }

  const table = [...tally.values()].map((row) => ({
    ...row,
    averageToPar: row.totalToPar / row.rounds,
  }));

  table.sort(
    (a, b) =>
      a.averageToPar - b.averageToPar ||
      b.rounds - a.rounds ||
      b.wins - a.wins ||
      a.name.localeCompare(b.name),
  );

  // Equal averages share a placing, and the next placing skips — golf's own
  // way of printing a tie, and the same rule computeStandings uses.
  let rank = 0;
  let previous: number | null = null;
  return table.map((row, index) => {
    if (previous === null || row.averageToPar !== previous) rank = index + 1;
    previous = row.averageToPar;
    return { ...row, rank };
  });
}
