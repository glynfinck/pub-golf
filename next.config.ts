import type { NextConfig } from "next";

/**
 * The headers every host gets, and the reasoning for the ones that are not
 * here.
 *
 * `Content-Security-Policy` carries only `frame-ancestors` — the modern
 * spelling of X-Frame-Options, and the one directive that needs no knowledge
 * of what the page loads. A real policy (`script-src`, `connect-src`) is
 * deliberately absent rather than forgotten: Next's inline bootstrap needs a
 * per-request nonce, and the Maps JavaScript API pulls script and tiles from
 * several Google origins. Getting either wrong breaks the app silently, on a
 * phone, in a pub. That is its own change, shipped report-only first.
 */
const SECURITY_HEADERS = [
  // Vercel already serves this domain over HTTPS only; this is the browser
  // being told to remember. No `preload` — that list is submitted at the
  // apex, and glyn.dev has not been.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Full URL to our own origin, bare origin to anyone else — a round URL
  // carries its join code, and a code is the whole credential for a seat.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // `geolocation=(self)` is load-bearing: the course builder's map sheet
  // calls navigator.geolocation to frame the first search
  // (components/course/pub-map-sheet.tsx). Denying it here would kill that
  // button with no error the user could act on.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), payment=(), geolocation=(self)",
  },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

const nextConfig: NextConfig = {
  // Nothing gains from announcing the framework version to a scanner.
  poweredByHeader: false,

  // No `images.remotePatterns`. There were three — local Supabase Storage,
  // `*.supabase.co` and Places photos — and the app used none of them:
  // `next/image` appears once, in components/ui/house-mark.tsx, pointing at
  // public/brand. The wildcard was the one worth deleting on purpose, since
  // it let any Supabase project on earth serve bytes through this app's
  // optimizer. Re-add a specific pattern the day something renders a remote
  // image.

  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
