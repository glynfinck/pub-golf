import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { APP_NAME, FLAGSHIP_GAME, SITE_URL, TAGLINE } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
  // Open Graph image URLs have to be absolute, so this is load-bearing rather
  // than decorative: without it every generated card resolves to a relative
  // path and nothing unfurls.
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${APP_NAME} — ${FLAGSHIP_GAME}`,
    template: `%s · ${APP_NAME}`,
  },
  description: TAGLINE,
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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f1edde" },
    { media: "(prefers-color-scheme: dark)", color: "#101b13" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body className="flex min-h-full flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster position="top-center" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
