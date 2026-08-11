"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Flag, ClipboardList, Map, User } from "lucide-react";
import { BUSY_DELAY_MS, busyHoldRemaining } from "@/lib/time";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "Clubhouse", icon: Flag },
  { href: "/rounds", label: "Rounds", icon: ClipboardList },
  { href: "/courses", label: "Courses", icon: Map },
  { href: "/profile", label: "Profile", icon: User },
] as const;

export function TabBar() {
  const pathname = usePathname();
  const router = useRouter();
  // Tab taps navigate through our own transition so the bar can see the
  // fetch in flight — a plain <Link> keeps its pending state to itself.
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const shownAt = useRef<number | null>(null);

  // The house waiting contract, applied to navigation: the sweep comes up
  // only once the wait has earned it, then holds long enough not to flash.
  // All setState lives in the timeout callbacks — the strict hooks lint
  // forbids it in the effect body itself.
  useEffect(() => {
    if (pending) {
      const show = setTimeout(() => {
        shownAt.current = Date.now();
        setBusy(true);
      }, BUSY_DELAY_MS);
      return () => clearTimeout(show);
    }
    if (shownAt.current === null) return;
    const hide = setTimeout(() => {
      shownAt.current = null;
      setBusy(false);
    }, busyHoldRemaining(shownAt.current, Date.now()));
    return () => clearTimeout(hide);
  }, [pending]);

  return (
    <nav
      aria-label="Main"
      aria-busy={busy}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]",
        busy && "tab-busy",
      )}
    >
      <div className="mx-auto flex max-w-md justify-around">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              onClick={(event) => {
                // Modified clicks keep their browser meaning (new tab…).
                if (
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return;
                event.preventDefault();
                startTransition(() => router.push(href));
              }}
              className={cn(
                "flex min-h-12 min-w-16 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-semibold tracking-wide",
                active ? "text-marker" : "text-muted-foreground",
              )}
            >
              <Icon size={18} strokeWidth={active ? 2.2 : 1.8} aria-hidden />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
