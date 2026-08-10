import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { adminClient, anonymousGuest } from "@/tests/support/clients";
import { track } from "@/tests/support/scope";

/**
 * handle_new_user picks a display name off whatever the identity provider
 * gave us. Today only the first branch is ever exercised — e2e/auth.ts always
 * sets display_name — so the Google paths have never run in a test.
 */
async function profileNameFor(
  metadata: Record<string, unknown>,
  email = `trigger-${randomUUID()}@test.local`,
): Promise<string | undefined> {
  const admin = adminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: "db-tests-not-a-secret",
    email_confirm: true,
    user_metadata: metadata,
  });
  if (error) throw error;
  track.user(data.user.id);

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("display_name")
    .eq("id", data.user.id)
    .single();
  if (profileError) throw profileError;
  return profile?.display_name;
}

describe("handle_new_user", () => {
  it("prefers the name we set ourselves", async () => {
    expect(
      await profileNameFor({ display_name: "Chosen", full_name: "Ignored" }),
    ).toBe("Chosen");
  });

  it("falls back to Google's full_name", async () => {
    expect(await profileNameFor({ full_name: "Wren Fielding" })).toBe(
      "Wren Fielding",
    );
  });

  it("falls back to Google's name", async () => {
    expect(await profileNameFor({ name: "Wren" })).toBe("Wren");
  });

  it("falls back to the local part of the email", async () => {
    expect(await profileNameFor({}, "jamie.smith@test.local")).toBe(
      "jamie.smith",
    );
  });

  it("skips empty strings rather than taking them as a name", async () => {
    // The nullif() rungs of the ladder — an empty display_name from a provider
    // must not win over a perfectly good full_name.
    expect(
      await profileNameFor({ display_name: "", full_name: "Real Name" }),
    ).toBe("Real Name");
  });

  it("names an anonymous guest 'Player' when they arrive with nothing", async () => {
    const guest = await anonymousGuest("");
    const { data } = await adminClient()
      .from("profiles")
      .select("display_name")
      .eq("id", guest.userId)
      .single();
    expect(data?.display_name).toBe("Player");
  });

  it("gives an anonymous guest the name the join screen typed", async () => {
    const guest = await anonymousGuest("Jamie");
    const { data } = await adminClient()
      .from("profiles")
      .select("display_name")
      .eq("id", guest.userId)
      .single();
    expect(data?.display_name).toBe("Jamie");
  });
});
