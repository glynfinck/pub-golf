import { describe, expect, it } from "vitest";

import { adminClient, anonymousGuest, signedInUser, visitor } from "../support/clients";

/**
 * The API surface, asserted rather than assumed.
 *
 * `20260819000000_api_surface_hardening` revoked EXECUTE on four trigger
 * functions PostgREST was exposing as RPCs. The revoke is four lines and
 * exactly the kind of thing a later migration re-grants by accident — a broad
 * `grant execute on all functions in schema public` would do it silently — so
 * the guard lives here rather than in a comment.
 *
 * A function the caller may not execute is not in that role's schema cache,
 * so PostgREST answers 404. Any error is the pass; a clean response is the
 * regression.
 */
const TRIGGER_FUNCTIONS = [
  "guard_score_hole_window",
  "guard_score_mulligans",
  "handle_new_user",
  "rls_auto_enable",
] as const;

describe("trigger functions are not callable as RPCs", () => {
  for (const fn of TRIGGER_FUNCTIONS) {
    it(`${fn} is unreachable by a signed-in user`, async () => {
      const host = await signedInUser("Surface Host");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (host.db.rpc as any)(fn);
      expect(error).not.toBeNull();
    });

    it(`${fn} is unreachable by a guest`, async () => {
      const guest = await anonymousGuest("Surface Guest");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (guest.db.rpc as any)(fn);
      expect(error).not.toBeNull();
    });

    it(`${fn} is unreachable signed out`, async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (visitor().rpc as any)(fn);
      expect(error).not.toBeNull();
    });
  }
});

describe("generate_round_code still mints codes", () => {
  /**
   * `set search_path = ''` fails at call time, not at migration time: an
   * unqualified name that used to resolve now raises, and the first symptom
   * would be creating a round 500ing. So call it, and hold it to the shape it
   * promises — six characters from an alphabet with no 0/O/1/I in it, because
   * the code gets read aloud in a pub.
   */
  it("returns a six-character code from the unambiguous alphabet", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (adminClient().rpc as any)(
      "generate_round_code",
    );

    expect(error).toBeNull();
    expect(data).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });

  it("does not repeat itself across a handful of calls", async () => {
    const admin = adminClient();
    const codes = await Promise.all(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Array.from({ length: 8 }, () => (admin.rpc as any)("generate_round_code")),
    );

    const values = codes.map(({ data }) => data as string | null);
    expect(values.every((code) => typeof code === "string")).toBe(true);
    expect(new Set(values).size).toBe(values.length);
  });
});
