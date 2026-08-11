import { readRuleset } from "@/lib/ruleset";
import { computeStandings } from "@/lib/scoring";
import { createClient } from "@/lib/supabase/server";
import type { LeagueRound } from "@/lib/league";

/**
 * How many finished rounds the viewer has, and nothing else.
 *
 * The Clubhouse needs to know whether there is a league to link to, not what
 * is in it — and scoring every round to answer that would make the first
 * screen of the app pay for a page nobody opened.
 */
export async function countLeagueRounds(): Promise<number> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 0;

  const { data } = await supabase
    .from("round_players")
    .select("rounds!inner(ruleset, status)")
    .eq("profile_id", user.id);

  return (data ?? []).filter((seat) => seat.rounds.status === "finished").length;
}

/**
 * Every finished round on the viewer's own card, scored.
 *
 * Every one of them, now. The league used to admit only rounds teed off under
 * a day pass, and the reason for dropping that is not generosity — it is that
 * a league is the game keeping score of itself. Standings are what makes a
 * second round mean something, so gating them charged for the sport rather
 * than for a service, and the twenty-four-hour window made it worse: a table
 * that played on Friday and again a fortnight later had two rounds and no
 * table to put them on unless somebody paid twice.
 *
 * Rounds already stamped `members` keep their stamp — it is a receipt for a
 * pass that was held, and it is still written at tee-off — but nothing reads
 * it to decide who gets in here any more.
 *
 * Read as the caller, so RLS is doing the work: these are rounds the viewer
 * is seated in, and nothing else is visible to ask about. That settles who the
 * league is for — everyone at the table, host and guests alike.
 */
export async function getLeagueRounds(): Promise<LeagueRound[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: seats } = await supabase
    .from("round_players")
    .select(
      "rounds!inner(id, code, name, ruleset, status, created_at, finished_at)",
    )
    .eq("profile_id", user.id);

  const played = (seats ?? [])
    .map((seat) => seat.rounds)
    .filter((round) => round.status === "finished");
  if (played.length === 0) return [];

  const ids = played.map((round) => round.id);
  const [{ data: holes }, { data: players }, { data: scores }, { data: penalties }] =
    await Promise.all([
      supabase.from("holes").select("*").in("round_id", ids).order("number"),
      supabase.from("round_players").select("*").in("round_id", ids),
      supabase.from("scores").select("*").in("round_id", ids),
      supabase.from("penalties").select("*").in("round_id", ids),
    ]);

  const forRound = <T extends { round_id: string }>(
    rows: T[] | null,
    id: string,
  ) => (rows ?? []).filter((row) => row.round_id === id);

  return played
    .map((round): LeagueRound => {
      const roundHoles = forRound(holes, round.id);
      const roundPlayers = forRound(players, round.id);
      const ruleset = readRuleset(round.ruleset);
      const standings = computeStandings(
        roundHoles,
        roundPlayers,
        forRound(scores, round.id),
        forRound(penalties, round.id),
        undefined,
        {
          filedThrough: roundHoles.length,
          softSubstituteScoresPar: ruleset.softSubstituteScoresPar,
          mulliganStrokes: ruleset.mulliganStrokes,
        },
      );
      // Seats are per-round; profiles are what survive between them.
      const profileOf = new Map(
        roundPlayers.map((player) => [player.id, player.profile_id] as const),
      );

      return {
        code: round.code,
        name: round.name,
        // A card filed before finished_at existed has only its creation to
        // date it by, which for a round is the same evening.
        playedAt: round.finished_at ?? round.created_at,
        cards: standings.flatMap((row) => {
          const profileId = profileOf.get(row.playerId);
          return profileId
            ? [
                {
                  profileId,
                  name: row.name,
                  netToPar: row.netToPar,
                  gross: row.gross,
                  rank: row.rank,
                },
              ]
            : [];
        }),
      };
    })
    .sort((a, b) => b.playedAt.localeCompare(a.playedAt));
}
