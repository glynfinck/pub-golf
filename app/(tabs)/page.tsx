import Link from "next/link";
import { Landing } from "@/components/landing";
import { DayPassCard } from "@/components/round/day-pass-card";
import { Screen, ScreenHeader } from "@/components/shell/screen";
import { Avatar } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RuleDouble } from "@/components/ui/rule";
import { DESCRIPTION } from "@/lib/config";
import { getDayPass } from "@/lib/data/billing";
import { countLeagueRounds } from "@/lib/data/league";
import { getMyRounds, getProfile } from "@/lib/data/rounds";
import { greeting } from "@/lib/time";
import { cn } from "@/lib/utils";

/**
 * The greeting is resolved on the server, in London, on purpose.
 *
 * Reading the browser's clock would be more correct for a player abroad, but
 * it costs a client component and a hydration guard, and a greeting that
 * flips a beat after paint is worse than one that is an hour out. The house
 * keeps British time — the same choice every `en-GB` date on these screens
 * already makes.
 */
function houseHour(): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: "Europe/London",
    }).format(new Date()),
  );
}

/**
 * The root route's own description, overriding the tagline the layout sets
 * for every other page. "Nine pubs. Par 36. Lowest swigs wins." is a slogan,
 * and this is the one URL where a reader (or a verifier) has not yet been
 * told what the thing does.
 *
 * Shared with the schema.org block on the page itself (`components/landing`),
 * because a verifier reading both wants them to agree.
 */
export const metadata = { description: DESCRIPTION };

export default async function ClubhousePage() {
  // One wait, not four — the pause on a tab switch is these round trips.
  const [profile, rounds, pass, leagueRounds] = await Promise.all([
    getProfile(),
    getMyRounds(),
    getDayPass(),
    countLeagueRounds(),
  ]);

  // A signed-out visitor gets the landing page, not a bounce to /signin and
  // not the sign-in screen wearing a paragraph. Google's brand verification
  // grades this URL, and it rejected both of those in turn: the redirect for
  // hiding the name and the privacy link, then the sign-in screen for still
  // not explaining what the app does. The layout hides the tab bar on the
  // same condition, so the page stands on its own.
  if (!profile) {
    return (
      <Screen className="gap-6">
        <Landing />
      </Screen>
    );
  }

  const active = rounds.find((round) => round.status !== "finished");
  const past = rounds.filter((round) => round.status === "finished");

  return (
    <Screen withTabBar>
      <RuleDouble head />
      <ScreenHeader
        eyebrow="The Clubhouse"
        title={`${greeting(houseHour())}, ${profile.display_name.split(" ")[0]}`}
        action={<Avatar name={profile.display_name} />}
      />

      {active ? (
        <Card className="gap-0 px-4 border-l-4 border-l-marker">
          <div className="flex items-center justify-between">
            <span className="eyebrow text-hazard">
              {active.status === "live" ? "● Live now" : "● In the lobby"}
            </span>
            <span className="tabular text-xs text-muted-foreground">
              {active.status === "live"
                ? `Hole ${active.current_hole} of ${active.hole_count}`
                : `${active.hole_count} holes`}
            </span>
          </div>
          <h2 className="mt-1.5 font-serif text-lg">{active.name}</h2>
          <p className="text-xs text-muted-foreground">
            Entry code {active.code}
            {active.role !== "player" ? ` · you are the ${active.role}` : ""}
          </p>
          <Link
            href={`/round/${active.code}`}
            className={cn(buttonVariants(), "mt-3 w-full")}
          >
            {active.status === "live" ? "Open scorecard" : "Back to the lobby"}
          </Link>
        </Card>
      ) : (
        <Card className="gap-0 px-4 text-sm text-muted-foreground">
          No round on the card tonight. Start one, or join with a code.
        </Card>
      )}

      {/* The pass while it runs; the league for good once a round has teed
          off on one. Never both — the card carries the league's own door. */}
      {pass ? (
        <DayPassCard pass={pass} />
      ) : leagueRounds > 0 ? (
        <Link
          href="/league"
          className="flex items-center justify-between rounded-xl bg-card px-4 py-3.5 ring-1 ring-foreground/10"
          data-testid="league-link"
        >
          <span>
            <span className="eyebrow block text-fairway">Members&apos; league</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              The order of merit across {leagueRounds} covered{" "}
              {leagueRounds === 1 ? "round" : "rounds"}
            </span>
          </span>
          <span className="text-xs font-bold text-fairway">Open</span>
        </Link>
      ) : null}

      <div className="flex gap-3">
        <Link href="/new" className={cn(buttonVariants(), "flex-1")}>
          New round
        </Link>
        <Link
          href="/join"
          className={cn(buttonVariants({ variant: "outline" }), "flex-1")}
        >
          Join with code
        </Link>
      </div>

      {past.length > 0 ? (
        <section>
          <h3 className="eyebrow mb-2">Past rounds</h3>
          <Card className="gap-0 px-4 py-1">
            {past.map((round, index) => (
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
                    {new Date(round.created_at).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                    })}{" "}
                    · {round.hole_count} holes
                  </span>
                </span>
                <span className="text-xs font-bold text-fairway">
                  View card
                </span>
              </Link>
            ))}
          </Card>
        </section>
      ) : null}
    </Screen>
  );
}
