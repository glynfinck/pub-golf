import { adminClient } from "./clients";
import { pooled } from "./concurrency";

/**
 * There is no seed.sql and nothing truncates between runs, so every fixture
 * takes its own rows back out again. Scoped deletes only — the Playwright
 * suite runs against this same stack minutes later, and a developer's local
 * database is not ours to empty.
 */
const users: string[] = [];
const rounds: string[] = [];

export const track = {
  user: (id: string) => {
    users.push(id);
  },
  round: (id: string) => {
    rounds.push(id);
  },
};

export async function cleanupScope(): Promise<void> {
  const db = adminClient();

  // Order is forced by the schema: rounds.host references profiles with no ON
  // DELETE, so a round cannot outlive its host. Deleting a round cascades to
  // holes, round_players, scores and penalties; deleting the auth user
  // cascades to profiles and courses.
  if (rounds.length > 0) {
    await db.from("rounds").delete().in("id", rounds);
  }
  if (users.length > 0) {
    // Rounds a test created through the API were never handed to track.round.
    await db.from("rounds").delete().in("host", users);
    // One admin call per user, and there is no batch form — at four seats
    // that loop was invisible, at twenty-one it is the slowest thing in the
    // stress tier. Bounded rather than unbounded: the rounds above are
    // already gone, so these are independent deletes of leaf rows, and the
    // point is to stop paying a round trip of latency per seat, not to see
    // how many gotrue will take at once.
    await pooled(users, 8, (id) => db.auth.admin.deleteUser(id));
  }

  users.length = 0;
  rounds.length = 0;
}
