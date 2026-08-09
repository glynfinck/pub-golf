import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Screen, ScreenHeader } from "@/components/shell/screen";
import { ClaimCard } from "@/components/round/claim-card";
import { HonestyBox } from "@/components/round/honesty-box";
import { Podium } from "@/components/round/podium";
import { RecapCard } from "@/components/round/recap-card";
import { RescueKnock } from "@/components/round/rescue-knock";
import { ReopenRound, ResultsLive } from "@/components/round/results-live";
import { RoundBar } from "@/components/round/round-bar";
import { SameAgain } from "@/components/round/same-again";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DotLeaderRow } from "@/components/ui/dot-leader";
import { getRoundByCode, getSessionUser } from "@/lib/data/rounds";
import { getRoundCard } from "@/lib/data/round-card";
import { readRuleset } from "@/lib/ruleset";
import { computeStandings, computeSuperlatives } from "@/lib/scoring";
import { cn, formatToPar } from "@/lib/utils";

/** No winner in the title — the results page redirects a signed-out visitor,
 * and the preview must not hand out what the page will not. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const round = await getRoundCard(code.toUpperCase());
  if (!round) return { title: "The 19th hole" };

  return {
    title: `${round.name} — the 19th hole`,
    description: `${round.holeCount} holes, par ${round.par}. The card, filed.`,
  };
}

export default async function ResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ claimed?: string }>;
}) {
  const { code } = await params;
  const { claimed } = await searchParams;
  const normalized = code.toUpperCase();

  const user = await getSessionUser();
  if (!user) redirect(`/round/${normalized}/rescue`);

  const bundle = await getRoundByCode(normalized);
  if (!bundle || !bundle.me) redirect(`/round/${normalized}/rescue`);
  if (bundle.round.status !== "finished") redirect(`/round/${normalized}`);

  const { round, holes, players, scores, penalties, me } = bundle;
  const ruleset = readRuleset(round.ruleset);
  const standings = computeStandings(holes, players, scores, penalties, me?.id, {
    filedThrough: holes.length,
    softSubstituteScoresPar: ruleset.softSubstituteScoresPar,
    mulliganStrokes: ruleset.mulliganStrokes,
  });
  // Handicaps only earn their column when somebody is actually carrying one.
  const handicapped = standings.some((row) => row.handicap > 0);
  const superlatives = computeSuperlatives(holes, players, scores, penalties);
  const winner = standings[0];
  const last = standings[standings.length - 1];
  const isOfficial = me != null && ["host", "caddy"].includes(me.role);
  const par = holes.reduce((sum, hole) => sum + hole.par, 0);
  const myRow = standings.find((row) => row.isYou);

  return (
    <Screen>
      <ResultsLive roundId={round.id} />
      <RoundBar round={round} holes={holes} />
      <ScreenHeader eyebrow={`Final · ${round.name}`} title="The 19th hole" />

      {/* A dropped card can still be picked back up at the 19th — claiming
          it with Google needs the seat on the claimer's own session. */}
      <RescueKnock code={round.code} players={players} me={me} />

      <Podium standings={standings} />
      {winner ? (
        <p
          className="text-center font-serif text-lg italic"
          data-testid="winner"
        >
          {winner.name} takes the round
          <span className="block font-sans text-[11px] not-italic text-muted-foreground">
            {winner.gross} gross ·{" "}
            {handicapped ? `${winner.net} net · ` : ""}
            {formatToPar(winner.netToPar)} ·{" "}
            {winner.penaltyStrokes > 0
              ? `${winner.penaltyStrokes} penalty strokes`
              : "a clean card"}
          </span>
        </p>
      ) : null}

      <Card className="gap-0 px-4 py-2" data-testid="final-standings">
        {standings.map((row) => (
          <DotLeaderRow
            key={row.playerId}
            className={cn("min-h-9", row.isYou && "font-bold text-foreground")}
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
                {row.name}
                {row.role === "caddy" ? (
                  <span className="ml-1.5 text-[10px] text-muted-foreground">
                    caddy
                  </span>
                ) : null}
                {handicapped && row.handicap > 0 ? (
                  <span className="ml-1.5 text-[10px] text-muted-foreground">
                    hcp {row.handicap}
                  </span>
                ) : null}
              </span>
            }
            value={
              <span className="tabular font-mono text-xs">
                <b>{handicapped ? row.net : row.gross}</b>
                {handicapped ? (
                  <span className="text-muted-foreground"> ({row.gross})</span>
                ) : null}{" "}
                · {formatToPar(row.netToPar)}
              </span>
            }
          />
        ))}
      </Card>

      {last && standings.length > 1 ? (
        <Card className="gap-0 border-l-4 border-l-hazard px-4 py-3 text-xs text-muted-foreground">
          <b className="text-foreground">The forfeit:</b> {last.name} wears
          the golf outfit to work on Monday. Photographic evidence required
          by house rule.
        </Card>
      ) : null}

      {me && user.is_anonymous ? (
        <ClaimCard
          name={me.display_name}
          rank={myRow?.rank ?? standings.length}
          gross={myRow ? (handicapped ? myRow.net : myRow.gross) : 0}
          toPar={myRow?.netToPar ?? 0}
        />
      ) : null}

      {me && !user.is_anonymous && claimed ? (
        <Card className="engraved gap-0 px-5 py-5" data-testid="card-claimed">
          <div className="eyebrow text-center" style={{ textIndent: "0.2em" }}>
            Card claimed
          </div>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            This round and your name now live in the clubhouse. See you on the
            next tee.
          </p>
        </Card>
      ) : null}

      <RecapCard
        round={round}
        holeCount={holes.length}
        par={par}
        standings={standings}
        superlatives={superlatives}
      />

      {/* After the recap, never before it: the ask follows the delivered
          round, and the shareable card stays free and first. */}
      <HonestyBox code={round.code} />

      {me?.role === "host" ? <SameAgain code={round.code} /> : null}

      <div className="flex gap-3">
        <Link
          href="/"
          className={cn(
            buttonVariants({
              variant: me?.role === "host" ? "outline" : "default",
            }),
            "flex-1",
          )}
        >
          Back to the clubhouse
        </Link>
        {isOfficial ? (
          <Link
            href={`/round/${round.code}/card`}
            className={cn(buttonVariants({ variant: "outline" }), "flex-1")}
          >
            Marker&apos;s card
          </Link>
        ) : null}
      </div>
      {isOfficial ? (
        <ReopenRound code={round.code} lastHole={holes.length} />
      ) : null}

      <p className="text-center font-serif text-xs italic text-muted-foreground">
        Card filed by the caddy —{" "}
        {new Date(round.created_at).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })}
        .
      </p>

      {/* Last thing anybody reads at the end of the night, which is the
          hour it is worth reading. Off the RecapCard on purpose — that one
          is the screenshot, and it stays spare. */}
      <p className="pb-2 text-center text-[11px] text-muted-foreground">
        Get everyone home safe.
      </p>
    </Screen>
  );
}
