"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

const emptySubscribe = () => () => {};

const OPTIONS = [
  { value: "dark", label: "Night" },
  { value: "light", label: "Day" },
  { value: "system", label: "Auto" },
] as const;

/** Night / Day / Auto segmented control. Day is the house default — cream
 * stock, the same as the printed scorecard. */
export function ThemeControl() {
  const { theme, setTheme } = useTheme();
  // next-themes is undefined on the server; render a neutral shell until
  // hydrated so server and client HTML agree.
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      className="flex overflow-hidden rounded-xl border border-border"
    >
      {OPTIONS.map((option) => {
        const active = mounted && theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(option.value)}
            className={cn(
              "min-h-11 flex-1 text-sm font-semibold",
              active ? "bg-secondary text-foreground" : "text-muted-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
