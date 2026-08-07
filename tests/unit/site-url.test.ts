import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which origin a deployment advertises for its cards.
 *
 * Worth testing precisely because getting it wrong is silent: the page still
 * renders, the tags are still there, and the only symptom is that a pasted
 * link unfurls bare. Nothing errors, nothing logs.
 *
 * SITE_URL is resolved once at module load, so each case re-imports with a
 * fresh module registry rather than mutating a live binding.
 */
async function siteUrl(env: Record<string, string | undefined>) {
  vi.resetModules();
  const previous = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return (await import("@/lib/site-url")).SITE_URL;
  } finally {
    process.env = previous;
  }
}

const CLEAN = {
  NEXT_PUBLIC_SITE_URL: undefined,
  VERCEL_ENV: undefined,
  VERCEL_URL: undefined,
  VERCEL_PROJECT_PRODUCTION_URL: undefined,
};

describe("SITE_URL", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.resetModules());

  it("takes an explicit setting over everything else", async () => {
    expect(
      await siteUrl({
        ...CLEAN,
        NEXT_PUBLIC_SITE_URL: "https://parlour.example",
        VERCEL_ENV: "preview",
        VERCEL_URL: "ignored.vercel.app",
      }),
    ).toBe("https://parlour.example");
  });

  it("strips a trailing slash, so metadataBase never doubles it", async () => {
    expect(
      await siteUrl({ ...CLEAN, NEXT_PUBLIC_SITE_URL: "https://x.dev/" }),
    ).toBe("https://x.dev");
  });

  it("lets a preview deployment advertise itself, not production", async () => {
    // The bug this exists to stop: a preview whose cards point at production
    // sends every crawler to a different build — or to a 404, if production
    // has not shipped the card route yet.
    expect(
      await siteUrl({
        ...CLEAN,
        VERCEL_ENV: "preview",
        VERCEL_URL: "pub-golf-git-branch-abc.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL: "pub-golf.glyn.dev",
      }),
    ).toBe("https://pub-golf-git-branch-abc.vercel.app");
  });

  it("uses the stable production domain on a production deployment", async () => {
    expect(
      await siteUrl({
        ...CLEAN,
        VERCEL_ENV: "production",
        VERCEL_URL: "pub-golf-abc123.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL: "pub-golf.glyn.dev",
      }),
    ).toBe("https://pub-golf.glyn.dev");
    // Not the per-deployment URL, which changes every ship and would leave
    // older links pointing at a deployment nobody visits.
  });

  it("falls back to this deployment when there is no production domain yet", async () => {
    expect(
      await siteUrl({ ...CLEAN, VERCEL_URL: "pub-golf-abc123.vercel.app" }),
    ).toBe("https://pub-golf-abc123.vercel.app");
  });

  it("falls back to the production domain off Vercel entirely", async () => {
    expect(await siteUrl(CLEAN)).toBe("https://pub-golf.glyn.dev");
  });

  it("ignores an empty or blank setting rather than building a bare URL", async () => {
    for (const blank of ["", "   "]) {
      expect(await siteUrl({ ...CLEAN, NEXT_PUBLIC_SITE_URL: blank })).toBe(
        "https://pub-golf.glyn.dev",
      );
    }
  });
});
