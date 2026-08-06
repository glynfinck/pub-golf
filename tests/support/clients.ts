import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

import { ANON_KEY, SERVICE_ROLE_KEY, SUPABASE_URL } from "./env";
import { track } from "./scope";

export type Db = SupabaseClient<Database>;

export interface Actor {
  /** Carries this user's JWT, so every query through it is RLS-constrained. */
  db: Db;
  userId: string;
  name: string;
}

/** Local-only, and never a real credential — these users live for one test. */
const PASSWORD = "db-tests-not-a-secret";

/**
 * Bypasses RLS. Seeding, reading a row back to check an attack was really
 * blocked, teardown — never the subject of a test.
 */
export function adminClient(): Db {
  return createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * A signed-in account: the stand-in for a Google host. Production sign-in is
 * Google-only and a consent screen cannot be driven from a test, so the
 * session is minted out of band — create a confirmed user with the admin API,
 * then sign in for real tokens. The JWT that comes back is the same shape RLS
 * sees in production.
 */
export async function signedInUser(name: string): Promise<Actor> {
  const email = `db-${randomUUID()}@test.local`;
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (error) throw error;
  const userId = data.user.id;
  track.user(userId);

  const db = freshClient();
  const { error: signInError } = await db.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signInError) throw signInError;
  return { db, userId, name };
}

/** A guest: exactly what the join screen hands a phone with no account. */
export async function anonymousGuest(name: string): Promise<Actor> {
  const db = freshClient();
  const { data, error } = await db.auth.signInAnonymously({
    // handle_new_user reads display_name out of the metadata; the name on the
    // card itself is set by join_round.
    options: { data: { display_name: name } },
  });
  if (error) throw error;
  const userId = data.user?.id;
  if (!userId) throw new Error("Anonymous sign-in returned no user");
  track.user(userId);
  return { db, userId, name };
}

/** Signed out: the `anon` role, no auth.uid() at all. */
export function visitor(): Db {
  return freshClient();
}

function freshClient(): Db {
  return createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: {
      // Keep the session in this instance only: several actors coexist in one
      // file, and nothing should touch a shared store or schedule a refresh
      // timer that outlives the test.
      persistSession: false,
      autoRefreshToken: false,
      storageKey: `db-test-${randomUUID()}`,
    },
  });
}
