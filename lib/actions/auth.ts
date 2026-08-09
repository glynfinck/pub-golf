"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function updateDisplayName(displayName: string) {
  const name = displayName.trim();
  if (!name) return { error: "A name is required" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase
    .from("profiles")
    .update({ display_name: name })
    .eq("id", user.id);
  if (error) return { error: error.message };

  // Every round screen reads round_players.display_name — the name written
  // onto the card when you joined — not the profile. Renaming the profile
  // alone left your old name on the standings of a round you were playing,
  // with no way to correct it and nothing to tell the other phones, since
  // `profiles` is not in the realtime publication either.
  //
  // Cards that are already filed keep the name they were played under: a
  // result is a record, and rewriting the winner of last month's round is
  // not what changing your name means. Renaming a seat in a live round IS
  // published, so every phone at the table re-renders.
  const { data: seats } = await supabase
    .from("round_players")
    .select("id, rounds!inner(status)")
    .eq("profile_id", user.id)
    .neq("rounds.status", "finished");
  const open = seats?.map((seat) => seat.id) ?? [];
  if (open.length > 0) {
    await supabase
      .from("round_players")
      .update({ display_name: name })
      .in("id", open);
  }

  revalidatePath("/profile");
  return {};
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/signin");
}
