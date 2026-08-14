"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { APIProvider } from "@vis.gl/react-google-maps";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { CaddyGroup } from "@/components/course/caddy-group";
import { DrawSurface } from "@/components/course/draw-walk-sheet";
import { MAPS_BROWSER_KEY } from "@/lib/maps";
import { strokeLengthKm, type StrokePoint } from "@/lib/caddy/stroke";
import type { CaddyAllowance } from "@/lib/data/caddy";
import type { Reach } from "@/lib/caddy/reach";
import type { PlannedCourse } from "@/lib/caddy/plan";

/**
 * The Course Room: the caddy's own place, and the map is the floor of it.
 *
 * The caddy grew up inside the drafting table's form — a map-shaped product
 * bolted above a list-shaped one, sharing one scrolling column so neither
 * read clearly. This is the room it should always have had: the map fills
 * the screen, the brief lives in a panel beneath it that never goes away,
 * and the plan performs on the same ground the host aimed it at.
 *
 * **The map is the draw surface.** Not a picture with a pen button on it —
 * the pen *is* the screen. Reposition, hold still, draw: the primary way to
 * aim the caddy, with the density field showing where a night can actually
 * live before a stroke is committed. The typed patch is still there, in the
 * panel, for the host who would rather name a place.
 *
 * **The job is the group's, not the room's.** Everything about planning —
 * the fee gate, the open step, the menu, the stream, the gallery and the
 * pill — belongs to `CaddyGroup`, which stands here in `room` mode wearing
 * different furniture. One implementation of the job; two rooms to stand it
 * in. Nothing about the drafting table changes, and it stays free.
 */
export function CourseRoom({
  hasPass,
  allowance,
  passExpiresAt = null,
  session = null,
  reopen = null,
  filed = false,
}: {
  hasPass: boolean;
  allowance?: CaddyAllowance;
  passExpiresAt?: string | null;
  session?: string | null;
  reopen?: string | null;
  filed?: boolean;
}) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const [stroke, setStroke] = useState<StrokePoint[] | null>(null);
  const [reach, setReach] = useState<Reach | null>(null);
  /** The card, once one lands. The room does not edit it — the drafting
   * table owns editing, as it owns every course — so this is a door rather
   * than a form. */
  const [landed, setLanded] = useState<PlannedCourse | null>(null);

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-background">
      <header className="flex items-center gap-3 px-4 pt-[max(env(safe-area-inset-top),10px)] pb-2">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Leave the course room"
          className="flex size-9 items-center justify-center rounded-full border border-border text-muted-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
        </button>
        <span className="eyebrow text-fairway">The course room</span>
      </header>

      {/* The floor: the draw surface, edge to edge. Without a browser key
          there is no map and no apology — the panel's own fields still plan
          a round, exactly as they always have.

          **Flex column, and it has to be.** `DrawSurface` sizes itself as a
          flex *child* (`flex-1`), which is how it fills the sheet it was
          written for. Handed a plain block parent it has no height at all,
          the `size-full` map inside it resolves to zero pixels, and the room
          renders a map nobody can see — which is exactly what it did. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {MAPS_BROWSER_KEY ? (
          <APIProvider apiKey={MAPS_BROWSER_KEY}>
            <DrawSurface
              centre={reach?.centre ?? null}
              pins={reach?.preview?.pins ?? []}
              dark={resolvedTheme === "dark"}
              onUse={setStroke}
              useLabel="Take this walk to the brief"
            />
          </APIProvider>
        ) : (
          <div className="flex h-full items-center justify-center px-8 text-center text-xs text-muted-foreground">
            No map on this deploy — name a patch below and the caddy plans it
            exactly as it always has.
          </div>
        )}
      </div>

      {/* The panel: peeked, scrollable, and never dismissed. The brief lives
          here through every stage, so there is nothing to close and no state
          to lose — the panel *is* the room's furniture. */}
      <div className="max-h-[52dvh] shrink-0 overflow-y-auto rounded-t-2xl border-t border-border bg-card pb-[max(env(safe-area-inset-bottom),8px)] shadow-[0_-6px_24px_rgba(0,0,0,0.12)]">
        <div className="mx-auto w-full max-w-md">
          <div aria-hidden className="mx-auto mt-2 h-1 w-9 rounded-full bg-border" />
          {landed ? (
            <div className="flex flex-col gap-2.5 px-4 py-4">
              <span className="eyebrow text-fairway">On the table</span>
              <div className="font-serif text-lg leading-tight">{landed.name}</div>
              <p className="text-xs text-muted-foreground">
                {landed.holes.length} holes, walked in order. Every edit lives
                on the drafting table — drinks, pars, hazards, the lot.
              </p>
              {/* `?caddy=1` is the hand-over: it is what tells the table to
                  reopen this conversation, so the card arrives with its ask
                  box. Without it the table is blank by design. */}
              <Button onClick={() => router.push("/courses/new?caddy=1")}>
                Open on the drafting table
              </Button>
              <button
                type="button"
                onClick={() => setLanded(null)}
                className="min-h-11 text-xs font-semibold text-muted-foreground hover:text-fairway"
              >
                Stay here
              </button>
            </div>
          ) : (
            <>
              {stroke ? (
                <p className="px-4 pt-2 text-[11px] font-semibold text-fairway">
                  Walk drawn — {strokeLengthKm(stroke).toFixed(1)} km. The
                  caddy will look along it.
                </p>
              ) : null}
              <CaddyGroup
                room
                strokeOverride={stroke}
                hasPass={hasPass}
                allowance={allowance}
                passExpiresAt={passExpiresAt}
                session={session}
                reopen={reopen}
                filed={filed}
                reach={reach}
                onReach={setReach}
                onSession={() => {}}
                onCourse={(course) => setLanded(course)}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
