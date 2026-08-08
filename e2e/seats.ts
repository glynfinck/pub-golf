import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !ANON_KEY) {
  throw new Error(
    "E2E needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY " +
      "in .env.local (run `supabase start`).",
  );
}

/**
 * Seats without a browser.
 *
 * A twenty-phone round is a load problem and a rendering problem at once, and
 * they do not need the same instrument. Twenty browser contexts per engine,
 * three engines deep, mostly measures the CPU of whatever is running the
 * suite — the `foursome` spec already learned that spinning WebKit contexts
 * together only ever raced the test host.
 *
 * So the phones that must be *seen* are real pages, and the rest of the table
 * is this: a real anonymous session, through the real `join_round` door, on a
 * real socket, writing real scores. Everything a seat does to the round it
 * does here identically — what it skips is React. That is the load the live
 * pages then have to keep up with, which is the thing actually under test.
 */

export interface Seat {
  db: SupabaseClient<Database>;
  name: string;
  userId: string;
  /** round_players.id — what every score and penalty is keyed on. */
  playerId: string;
  roundId: string;
  channel?: RealtimeChannel;
}

/**
 * Join a round as a fresh guest phone, minus the phone.
 *
 * `join_round` is the only way into a round, so this is the same door the
 * join screen puts a thumb on — no seeded row, no service-role shortcut.
 */
export async function takeSeat(code: string, name: string): Promise<Seat> {
  const db = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
    auth: {
      // Several seats share this process. Nothing may touch a shared store or
      // leave a refresh timer running past the test.
      persistSession: false,
      autoRefreshToken: false,
      storageKey: `e2e-seat-${name}-${process.pid}`,
    },
  });

  const { data: session, error: signInError } = await db.auth.signInAnonymously(
    { options: { data: { display_name: name } } },
  );
  if (signInError) throw signInError;
  const userId = session.user?.id;
  if (!userId) throw new Error(`Anonymous sign-in returned no user for ${name}`);

  const { error: joinError } = await db.rpc("join_round", {
    join_code: code,
    player_name: name,
  });
  if (joinError) throw joinError;

  // `join_round` answers with the code, not the seat, so read the seat back
  // on this session's own view — RLS narrows it to the one round this guest
  // is a member of, which is the only round they have ever seen.
  const { data: seat, error: seatError } = await db
    .from("round_players")
    .select("id, round_id")
    .eq("profile_id", userId)
    .single();
  if (seatError) throw seatError;

  return { db, name, userId, playerId: seat.id, roundId: seat.round_id };
}

/** Seat `names` one after another. Bounded because arriving is not the test —
 * the stampede at twenty is proven in `tests/stress/full-table-join`, where a
 * failure names a row rather than a browser. */
export async function takeSeats(
  code: string,
  names: readonly string[],
): Promise<Seat[]> {
  const seats: Seat[] = [];
  for (const name of names) seats.push(await takeSeat(code, name));
  return seats;
}

/**
 * Stand on the hole, so the phones that can see the round count this seat.
 *
 * The play screen reads presence off a channel keyed by round_players.id and
 * renders "N OF M ON THIS HOLE". A seat that scores without tracking presence
 * is a player the room cannot see, which is a different test.
 */
export async function standOnTheHole(seat: Seat): Promise<void> {
  const {
    data: { session },
  } = await seat.db.auth.getSession();
  // The socket must carry the user JWT or an RLS-backed channel silently
  // drops everything — the same gotcha postgres_changes has.
  if (session) await seat.db.realtime.setAuth(session.access_token);

  const channel = seat.db.channel(`presence:round:${seat.roundId}`, {
    config: { presence: { key: seat.playerId } },
  });
  seat.channel = channel;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${seat.name} never reached the hole`)),
      20_000,
    );
    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({});
        clearTimeout(timer);
        resolve();
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timer);
        reject(new Error(`${seat.name} could not reach the hole: ${status}`));
      }
    });
  });
}

/** File swigs for this seat — the write the play screen's debounce sends. */
export async function drinkAt(
  seat: Seat,
  holeNumber: number,
  swigs: number,
): Promise<void> {
  const { error } = await seat.db.from("scores").upsert(
    {
      round_id: seat.roundId,
      player_id: seat.playerId,
      hole_number: holeNumber,
      swigs,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "player_id,hole_number" },
  );
  if (error) throw new Error(`${seat.name} could not drink: ${error.message}`);
}

/** Every seat files the same hole at once — the storm the live pages must
 * keep up with. */
export async function tableDrinks(
  seats: readonly Seat[],
  holeNumber: number,
  swigsFor: (seat: Seat, index: number) => number,
): Promise<void> {
  await Promise.all(
    seats.map((seat, index) => drinkAt(seat, holeNumber, swigsFor(seat, index))),
  );
}

/**
 * Put the phones back in pockets: sockets closed, timers gone.
 *
 * Deliberately not `removeChannel`: that awaits an unsubscribe reply per
 * channel, and seventeen of those in a row can outwait the whole test budget
 * when a socket has already gone quiet. These clients are being discarded,
 * not reused — dropping the socket tears down every channel and timer it
 * carries, and does it at once.
 */
export function leaveSeats(seats: readonly Seat[]): void {
  for (const seat of seats) {
    seat.db.realtime.disconnect();
  }
}
