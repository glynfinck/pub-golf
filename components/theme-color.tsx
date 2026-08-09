"use client";

import { useTheme } from "next-themes";
import { useEffect } from "react";

import { GROUND } from "@/lib/config";

/**
 * Keeps the browser chrome on the same ground as the page.
 *
 * `themeColor` in `app/layout.tsx` used to ship a `prefers-color-scheme`
 * pair, which quietly answered the wrong question: the app does not follow
 * the system. Cream lives on `:root` and Midnight is opt-in, so a fresh
 * visitor on a system-dark phone got Midnight chrome over a cream page — and
 * once somebody chose Midnight in Profile, a system-light phone got the
 * mismatch the other way round. A media query cannot see a theme chosen in
 * JavaScript, so no arrangement of them was ever going to be right.
 *
 * This reads the theme next-themes actually resolved and writes the one meta
 * tag to match. The static cream in the viewport export stays as the
 * server-rendered default, which is correct for everyone who has not opted
 * into Midnight; for those who have, the chrome catches up on hydration.
 */
export function ThemeColor() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const ground = resolvedTheme === "dark" ? GROUND.dark : GROUND.light;
    let meta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = ground;
  }, [resolvedTheme]);

  return null;
}
