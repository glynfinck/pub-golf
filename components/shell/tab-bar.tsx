"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Flag, ClipboardList, Map, User } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "Clubhouse", icon: Flag },
  { href: "/rounds", label: "Rounds", icon: ClipboardList },
  { href: "/courses", label: "Courses", icon: Map },
  { href: "/profile", label: "Profile", icon: User },
] as const;

export function TabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]"
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
