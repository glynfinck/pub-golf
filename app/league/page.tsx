import Link from "next/link";
import { redirect } from "next/navigation";
import { Masthead } from "@/components/shell/masthead";
import { Screen, ScreenHeader } from "@/components/shell/screen";
import { Card } from "@/components/ui/card";
import { DotLeaderRow } from "@/components/ui/dot-leader";
import { HouseMark } from "@/components/ui/house-mark";
import { signInPath } from "@/lib/auth-paths";
import { getLeagueRounds } from "@/lib/data/league";
import { getSessionUser } from "@/lib/data/rounds";
import { computeLeague } from "@/lib/league";
import { cn, formatToPar } from "@/lib/utils";

export const metadata = { title: "The league" };

/** "9 Aug" — the printed-card date, short enough for a table row. */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

/**
 * The order of merit — free, and for everybody who has filed a card.
 *
 * It was the first thing the green fee bought, and it should not have been.
 * A league is the game keeping score of itself: standings are what make the
 * second round mean more than the first, so putting them behind a day pass
 * charged for the sport instead of for a service. The caddy is the service.
 */
export default async function LeaguePage() {
  const user = await getSessionUser();
  // Carry the destination: a shared league link should land back on the table
  // after signing in, and it is what the sign-in screen names as the reason.
  if (!user) redirect(signInPath("/league"));

  const rounds = await getLeagueRounds();
  const table = computeLeague(rounds);

  return (
    <Screen>
      <Masthead
        back={{ href: "/", label: "Clubhouse" }}
        center={<HouseMark className="mx-auto size-6" />}
      />
      <ScreenHeader eyebrow="Members' league" title="The order of merit" />

      {rounds.length === 0 ? (
        <Card className="gap-0 px-4 text-sm text-muted-foreground">
          Nothing on the table yet. Every round lands here once its card is
          filed, and stays for good.
        </Card>
      ) : (
        <>
          <Card className="gap-0 px-4 py-2" data-testid="league-table">
            {table.map((row) => (
              <DotLeaderRow
                key={row.profileId}
                className={cn("min-h-10", row.rank === 1 && "text-foreground")}
                label={
                  <span>
                    <span
                      className={cn(
                        "tabular mr-2 font-mono text-xs",
                        row.rank === 1 ? "text-marker" : "text-muted-foreground",
                      )}
                    >
                      {row.rank}
                    </span>
                    <span className={cn(row.rank === 1 && "font-bold")}>
                      {row.name}
                    </span>
                    <span className="block pl-6 text-[10px] text-muted-foreground">
                      {row.rounds} {row.rounds === 1 ? "round" : "rounds"}
                      {row.wins > 0
                        ? ` · ${row.wins} ${row.wins === 1 ? "win" : "wins"}`
                        : ""}{" "}
                      · best {formatToPar(row.bestToPar)}
                    </span>
                  </span>
                }
                value={
                  <span className="tabular font-mono text-xs">
                    <b>{formatToPar(Math.round(row.averageToPar * 10) / 10)}</b>
                    <span className="block text-[10px] text-muted-foreground">
                      a round
                    </span>
                  </span>
                }
              />
            ))}
          </Card>

          <p className="text-[11px] text-muted-foreground">
            Ranked on the average card, not the total — a league that added
            rounds up would punish turning up. Level averages are split by
            rounds played first.
          </p>

          <section>
            <h2 className="eyebrow mb-2">The rounds</h2>
            <Card className="gap-0 px-4 py-1">
              {rounds.map((round, index) => (
                <Link
                  key={round.code}
                  href={`/round/${round.code}/results`}
                  className={cn(
                    "flex items-center justify-between py-3",
                    index > 0 && "border-t border-border",
                  )}
                >
                  <span>
                    <span className="block text-sm font-semibold">
                      {round.name}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {shortDate(round.playedAt)} · {round.cards.length}{" "}
                      {round.cards.length === 1 ? "card" : "cards"}
                    </span>
                  </span>
                  <span className="text-xs font-bold text-fairway">
                    View card
                  </span>
                </Link>
              ))}
            </Card>
          </section>
        </>
      )}
    </Screen>
  );
}
