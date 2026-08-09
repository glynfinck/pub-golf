import { readRuleset } from "@/lib/ruleset";
import { computeStandings } from "@/lib/scoring";
import { createClient } from "@/lib/supabase/server";
import type { LeagueRound } from "@/lib/league";

/**
 * How many covered rounds the viewer has, and nothing else.
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

  return (data ?? []).filter(
    (seat) =>
      seat.rounds.status === "finished" && readRuleset(seat.rounds.ruleset).members,
  ).length;
}

/**
 * Every covered round on the viewer's own card, scored.
 *
 * "Covered" is the members' flag in the round's ruleset snapshot — stamped
 * at tee-off, never unstamped — so a round that was covered when it teed off
 * stays in the league forever, whatever became of the pass that granted it.
 * That is the whole reason the grant lives in the snapshot rather than in a
 * live entitlement lookup.
 *
 * Read as the caller, so RLS is doing the work: these are rounds the viewer
 * is seated in, and nothing else is visible to ask about. That also settles
 * who the league is for — the whole table, not only the host who paid, which
 * is what "one payment covers the whole table" has to mean on screen.
 *
 * The flag is read through `readRuleset` rather than filtered in PostgREST:
 * the ruleset is only ever read through that one door, and a jsonb operator
 * in a query string is exactly the inline re-cast that rule exists to stop.
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
    .filter((round) => round.status === "finished")
    .filter((round) => readRuleset(round.ruleset).members);
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
