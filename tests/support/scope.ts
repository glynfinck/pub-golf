import { adminClient } from "./clients";

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
    for (const id of users) {
      await db.auth.admin.deleteUser(id);
    }
  }

  users.length = 0;
  rounds.length = 0;
}
