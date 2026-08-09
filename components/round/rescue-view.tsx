"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Screen } from "@/components/shell/screen";
import { Button } from "@/components/ui/button";
import { PendingLabel } from "@/components/ui/pending-label";
import { Putt } from "@/components/ui/putt";
import { useAction } from "@/hooks/use-action";
import { requestSeatRescue } from "@/lib/actions/rounds";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Seat = {
  seat_id: string;
  display_name: string;
  role: string;
  holes_scored: number;
  claimable: boolean;
  requested: boolean;
  requested_by_me: boolean;
  mine: boolean;
};

/** The knock is answered by a person, not a timeout — poll gently. */
const POLL_MS = 4000;

/**
 * The rescue screen: a seatless phone holding a round link picks its card
 * back up. Tapping a card only knocks — request_seat_rescue marks the seat,
 * an official waves them in from their own phone, and this screen follows
 * by polling the same seat list until the seat is theirs.
 *
 * The guest list waits behind one tap when there is no session at all:
 * fetching it needs (and mints) an anonymous sign-in, and names stay off
 * the signed-out surface on purpose — a crawler unfurling a shared link
 * reads none of this.
 */
export function RescueView({
  code,
  roundName,
  hasSession,
}: {
  code: string;
  roundName: string;
  hasSession: boolean;
}) {
  const router = useRouter();
  const { run, pending, busy } = useAction();
  const [seats, setSeats] = useState<Seat[] | null>(null);
  const [listOpen, setListOpen] = useState(hasSession);
  const [knockedId, setKnockedId] = useState<string | null>(null);
  const [turnedAway, setTurnedAway] = useState(false);

  // The poll needs the live knock, but must not restart on every knock —
  // the ref keeps the interval's identity out of the state's hands.
  const knockedRef = useRef<string | null>(null);
  function setKnock(id: string | null) {
    knockedRef.current = id;
    setKnockedId(id);
  }

  const loadSeats = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_round_seats", {
      join_code: code,
    });
    if (error) return { error: error.message };
    const rows = data ?? [];
    // Waved in: the seat is on this session now — the round routes take over.
    if (rows.some((seat) => seat.mine)) {
      router.replace(`/round/${code}`);
      return {};
    }
    // A knock that vanished without seating us was turned away (or the
    // seat was struck) — say so once and let them knock again.
    const current = knockedRef.current;
    if (current !== null) {
      const knockedSeat = rows.find((row) => row.seat_id === current);
      if (!knockedSeat || !knockedSeat.requested_by_me) {
        knockedRef.current = null;
        setKnockedId(null);
        setTurnedAway(true);
      }
    }
    setSeats(rows);
    return {};
  }, [code, router]);

  // With a session already on the phone the list needs no gate tap.
  useEffect(() => {
    if (!listOpen) return;
    let cancelled = false;
    (async () => {
      if (!cancelled) await loadSeats();
    })();
    const timer = setInterval(() => {
      void loadSeats();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [listOpen, loadSeats]);

  const knocked =
    knockedId !== null
      ? (seats?.find((seat) => seat.seat_id === knockedId) ?? null)
      : null;

  function openList() {
    run(async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        // The uid the rescued seat will move onto. The card keeps its own
        // name, so no display_name is asked for here.
        const { error } = await supabase.auth.signInAnonymously();
        if (error) return { error: error.message };
      }
      const result = await loadSeats();
      if (!result.error) setListOpen(true);
      return result;
    });
  }

  function knock(seat: Seat) {
    run(async () => {
      const result = await requestSeatRescue(code, seat.seat_id);
      if (!result.error) {
        setTurnedAway(false);
        // Mark the knock locally before the next poll confirms it, or the
        // turned-away check would read the stale list and cry wolf.
        setSeats(
          (prev) =>
            prev?.map((row) =>
              row.seat_id === seat.seat_id
                ? { ...row, requested: true, requested_by_me: true }
                : row,
            ) ?? prev,
        );
        setKnock(seat.seat_id);
      }
      return result;
    });
  }

  function statusFor(seat: Seat) {
    if (seat.requested_by_me) return { label: "KNOCKING…", tone: "text-marker" };
    if (seat.role === "host") return { label: "THE HOST", tone: "text-muted-foreground" };
    if (seat.requested) return { label: "SPOKEN FOR", tone: "text-muted-foreground" };
    if (!seat.claimable) return { label: "CLAIMED", tone: "text-muted-foreground" };
    return null;
  }

  function subFor(seat: Seat) {
    const holes =
      seat.holes_scored > 0
        ? `${seat.holes_scored} ${seat.holes_scored === 1 ? "hole" : "holes"} scored`
        : "No holes scored yet";
    if (seat.role === "host" || !seat.claimable)
      return `${holes} · signs back in with Google`;
    if (seat.role === "caddy") return `${holes} · keeping the card`;
    return holes;
  }

  return (
    <Screen className="justify-center gap-5">
      <div className="text-center">
        <div className="eyebrow text-fairway">You&apos;re expected</div>
        <h1 className="mt-1 font-serif text-3xl">Back on your card?</h1>
        <p className="mx-auto mt-2 max-w-[30ch] text-sm text-muted-foreground">
          This phone isn&apos;t holding a card for {roundName}. If you were
          playing, pick yours back up — your swigs are right where you left
          them.
        </p>
      </div>

      {knocked !== null ? (
        <>
          <div className="rounded-xl border border-border bg-card px-4 py-5 text-center">
            <div className="eyebrow" style={{ textIndent: "0.2em" }}>
              Held at the door
            </div>
            <div className="mt-1 font-serif text-2xl">
              {knocked.display_name}&apos;s card
            </div>
            <p className="mx-auto mt-2 max-w-[28ch] text-xs text-muted-foreground">
              The caddy or the host waves you back in from their phone. Hang
              tight — this screen follows on its own.
            </p>
            <div className="mt-3 text-fairway">
              <Putt />
            </div>
          </div>
          <Button
            variant="secondary"
            onClick={() => setKnock(null)}
            disabled={pending}
          >
            Pick a different card
          </Button>
        </>
      ) : !listOpen ? (
        <>
          <Button onClick={openList} disabled={pending} data-testid="rescue-open">
            <PendingLabel
              pending={pending}
              busy={busy}
              label="I was playing — show me the cards"
              pendingLabel="Fetching the cards"
            />
          </Button>
          <Button asChild variant="secondary">
            <Link href={`/join?code=${code}`}>
              I&apos;m new here — join with my name
            </Link>
          </Button>
        </>
      ) : (
        <>
          {turnedAway ? (
            <p className="rounded-lg border border-hazard/50 px-3 py-2 text-center text-xs text-hazard">
              The caddy didn&apos;t wave you in. Ask at the table, or knock
              again.
            </p>
          ) : null}

          <div data-testid="rescue-seats">
            {(seats ?? []).map((seat) => {
              const status = statusFor(seat);
              const line = (
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 truncate text-sm font-bold">
                    {seat.display_name}
                  </span>
                  <span aria-hidden className="leader flex-1 self-baseline" />
                  {status ? (
                    <span
                      className={cn(
                        "shrink-0 text-[10px] font-bold tracking-[0.14em]",
                        status.tone,
                      )}
                    >
                      {status.label}
                    </span>
                  ) : (
                    <ChevronRight
                      aria-hidden
                      size={14}
                      className="shrink-0 self-center text-muted-foreground/70"
                    />
                  )}
                </div>
              );
              const sub = (
                <span className="block truncate text-[11px] text-muted-foreground">
                  {subFor(seat)}
                </span>
              );
              // A card someone else is knocking on stays off limits — a
              // second knock would overwrite the first, and the caddy can
              // only answer one at a time.
              return seat.claimable && !seat.requested ? (
                <button
                  key={seat.seat_id}
                  type="button"
                  data-testid="rescue-seat"
                  disabled={pending}
                  onClick={() => knock(seat)}
                  className="group flex min-h-13 w-full flex-col justify-center border-b border-dotted border-border py-2 text-left focus-visible:outline-none"
                >
                  {line}
                  {sub}
                </button>
              ) : (
                <div
                  key={seat.seat_id}
                  data-testid="rescue-seat"
                  className="flex min-h-13 flex-col justify-center border-b border-dotted border-border py-2 opacity-60"
                >
                  {line}
                  {sub}
                </div>
              );
            })}
            {seats !== null && seats.length === 0 ? (
              <p className="py-3 text-center text-sm text-muted-foreground">
                No cards dealt on this round yet.
              </p>
            ) : null}
          </div>

          <Button asChild variant="secondary">
            <Link href={`/join?code=${code}`}>
              I&apos;m new here — join with my name
            </Link>
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            Tapping a card knocks — the caddy waves you back in, and the whole
            table sees the card change phones.
          </p>
        </>
      )}
    </Screen>
  );
}
