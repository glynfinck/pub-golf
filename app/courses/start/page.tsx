import { Screen, ScreenHeader } from "@/components/shell/screen";
import { RuleDouble } from "@/components/ui/rule";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { StartCards, StartHint } from "@/components/course/start-cards";
import { caddyStand, caddyTablesPresent } from "@/lib/data/caddy-gate";
import { resumeCaddy } from "@/lib/data/caddy";

export const metadata = { title: "A new course" };

/**
 * Which room: the caddy's map, or the drafting table.
 *
 * One tap on the course book leads here rather than to either room, because
 * the two are genuinely different ways to spend an evening's planning and
 * the choice is the host's to make knowingly. Before this, the caddy hung
 * above the table's own form — so "plot it by hand" handed you the paid
 * thing anyway, which is precisely the confusion this screen removes.
 *
 * Off duty there is one card, and it is the free one: a deploy without a
 * caddy shows the drafting table exactly as it always has.
 */
export default async function StartCoursePage() {
  const stand = await caddyStand();
  /**
   * A conversation already on the go.
   *
   * Offered here, by name, rather than sprung on the drafting table: this is
   * the screen where the host is choosing what to do next, so "carry on with
   * the one you started" is a third honest answer to that question — and
   * making it an answer here is what lets the manual door stay blank.
   */
  const carryOn =
    stand.ready && (await caddyTablesPresent()) ? await resumeCaddy() : null;

  return (
    <Screen>
      <RuleDouble head />
      <ScreenHeader
        eyebrow="A new course"
        title={stand.ready ? "How shall we plan it?" : "Plot a new course"}
      />
      {carryOn ? (
        <Link
          href="/courses/new?caddy=1"
          data-testid="carry-on-card"
          className="engraved flex items-center gap-2 rounded-xl bg-card px-4 py-3"
        >
          <span className="min-w-0 flex-1">
            <span className="eyebrow block text-fairway">On the table</span>
            <b className="block truncate text-sm">{carryOn.course.name}</b>
            <span className="block text-[11px] text-muted-foreground">
              {carryOn.course.holes.length} holes — carry on where you left off
            </span>
          </span>
          <ChevronRight
            size={16}
            aria-hidden
            className="shrink-0 text-muted-foreground"
          />
        </Link>
      ) : null}
      <StartCards caddy={stand.ready} />
      <StartHint />
    </Screen>
  );
}
