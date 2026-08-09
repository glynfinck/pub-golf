import { describe, expect, it } from "vitest";

import { adminClient } from "../support/clients";

/**
 * Guards `20260819000000_api_surface_hardening`, and only the half of it this
 * tier can honestly hold down.
 *
 * The migration does two things. The revoke is least privilege on four
 * trigger functions, and there is deliberately **no test for it here**: all
 * four return `trigger`, PostgREST keeps trigger functions out of its schema
 * cache entirely, so an "is it callable over the API?" case passes identically
 * before and after the migration. A test that cannot fail is worse than no
 * test — it reads as cover. The grant itself was checked with
 * `has_function_privilege` against Postgres directly when the migration was
 * written; asserting it from this tier would mean a raw Postgres connection
 * the db suite deliberately does not carry.
 *
 * The `search_path` change is the half that can genuinely regress, and it
 * fails at call time rather than at migration time: an unqualified name that
 * used to resolve now raises, and the first symptom is creating a round
 * 500ing. So call it.
 */
describe("generate_round_code survives its fixed search_path", () => {
  it("returns a six-character code from the unambiguous alphabet", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (adminClient().rpc as any)(
      "generate_round_code",
    );

    expect(error).toBeNull();
    // No 0/O/1/I: the code gets read aloud across a pub table.
    expect(data).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });

  it("keeps minting distinct codes under concurrency", async () => {
    const admin = adminClient();
    const codes = await Promise.all(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Array.from({ length: 8 }, () => (admin.rpc as any)("generate_round_code")),
    );

    const values = codes.map(({ data }) => data as string | null);
    expect(values.every((code) => typeof code === "string")).toBe(true);
    expect(new Set(values).size).toBe(values.length);
  });

  it("still resolves the uniqueness lookup against public.rounds", async () => {
    /**
     * The loop's exit condition selects from `public.rounds`. With
     * `search_path = ''` an unqualified `rounds` there would raise 42P01 —
     * this asserts the qualified name survived the rewrite, by proving the
     * function completes rather than by reading its body.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (adminClient().rpc as any)(
      "generate_round_code",
    );

    expect(error).toBeNull();
    expect(typeof data).toBe("string");
  });
});
