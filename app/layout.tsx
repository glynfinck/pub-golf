import type { Metadata, Viewport } from "next";
import { ThemeColor } from "@/components/theme-color";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import {
  APP_NAME,
  GROUND,
  SITE_URL,
  SITE_VERIFICATION,
  TAGLINE,
} from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
  // Open Graph image URLs have to be absolute, so this is load-bearing rather
  // than decorative: without it every generated card resolves to a relative
  // path and nothing unfurls.
  metadataBase: new URL(SITE_URL),
  applicationName: APP_NAME,
  // Deliberately no `alternates.canonical` here. Set on the root layout it
  // is inherited rather than computed, so every page — /join, /signin, the
  // legal papers — emits a canonical pointing at "/", which tells a crawler
  // they are all the same page as the clubhouse. Next self-canonicalises by
  // default, and no route here has a duplicate URL that needs overriding.
  // iOS turns anything that looks like a number into a phone link, and a
  // scorecard is nothing but numbers — a tapped "7:05" that offers to dial
  // is the kind of detail that reads as unfinished.
  formatDetection: { telephone: false },
  title: {
    // The app and its flagship game became the same words when the
    // "Parlour" name retired, so gluing them read "Pub Golf — Pub Golf".
    // The bare name is the clubhouse tab; every other screen titles
    // itself through the template.
    default: APP_NAME,
    template: `%s · ${APP_NAME}`,
  },
  description: TAGLINE,
  // Search Console's HTML-tag proof, when there is one to render. Google's
  // brand verification checks that the home page's domain is registered to
  // the account that owns the Cloud project, and this is one of the two ways
  // to say so (see SITE_VERIFICATION). Null until the env var is set, which
  // Next resolves to no tag at all rather than an empty one.
  verification: { google: SITE_VERIFICATION },
  openGraph: {
    siteName: APP_NAME,
    type: "website",
    url: "/",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: APP_NAME,
  },
};

// No `maximumScale`. Locking zoom fails WCAG 1.4.4, and it does not even buy
// what it is usually reached for: iOS has ignored it for years, so the only
// people who lose pinch-zoom are Android users. The iOS focus-zoom it is
// meant to prevent is already handled properly — inputs are `text-base`
// (16px) on mobile in `components/ui/input.tsx`, which is the real fix.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // One value, not a prefers-color-scheme pair. The app does not follow the
  // system — cream lives on `:root` and Midnight is opt-in — so a media query
  // here painted Midnight chrome above a cream page for every system-dark
  // visitor. Cream is the server-rendered truth for anyone who has not opted
  // in; `<ThemeColor />` corrects it for anyone who has.
  themeColor: GROUND.light,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body className="flex min-h-full flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <ThemeColor />
          {children}
          <Toaster position="top-center" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
