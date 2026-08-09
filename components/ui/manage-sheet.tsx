"use client";

import { ChevronRight } from "lucide-react";
import { PendingLabel } from "@/components/ui/pending-label";
import { cn } from "@/lib/utils";

/**
 * The manage sheets' shared furniture — one grammar behind every ledger
 * kebab (the rounds locker, the course book's), so managing anything in
 * the house reads the same.
 */

/** One line of a manage menu: icon, label and blast radius, full thumb
 * height, the dotted rule between rows like the lobby's guest list. */
export function ActionRow({
  icon,
  label,
  sub,
  hazard,
  disabled,
  pending,
  busy,
  pendingLabel,
  testId,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  sub?: string;
  hazard?: boolean;
  disabled?: boolean;
  /** When set with `busy`, the label swaps through PendingLabel. */
  pending?: boolean;
  busy?: boolean;
  pendingLabel?: string;
  testId?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      data-testid={testId}
      onClick={onClick}
      className="group flex min-h-12 w-full items-center gap-3 border-t border-dotted border-border py-2 text-left first:border-t-0 focus-visible:outline-none disabled:opacity-50"
    >
      <span
        className={cn("shrink-0", hazard ? "text-hazard" : "text-fairway")}
        aria-hidden
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-sm font-semibold transition-colors group-hover:text-marker group-focus-visible:text-marker",
            hazard && "text-hazard group-hover:text-hazard group-focus-visible:text-hazard",
          )}
        >
          {pending !== undefined && pendingLabel ? (
            <PendingLabel
              pending={pending}
              busy={busy ?? false}
              label={label}
              pendingLabel={pendingLabel}
            />
          ) : (
            label
          )}
        </span>
        {sub ? (
          <span className="block text-xs text-muted-foreground">{sub}</span>
        ) : null}
      </span>
      <ChevronRight
        size={14}
        className="shrink-0 text-muted-foreground/70"
        aria-hidden
      />
    </button>
  );
}

/** The engraved confirm plate that swaps in for the menu — hazard-inked
 * when the action destroys, house-inked when it merely concludes. */
export function ConfirmFrame({
  title,
  body,
  hazard,
  children,
}: {
  title: string;
  body: string;
  hazard?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "mt-2 flex flex-col gap-3 rounded-xl border bg-card p-4",
        hazard ? "border-hazard/60" : "border-border",
      )}
    >
      <h3
        className={cn(
          "font-serif text-base font-semibold",
          hazard ? "text-hazard" : "text-foreground",
        )}
      >
        {title}
      </h3>
      <p className="text-xs text-muted-foreground">{body}</p>
      {children}
    </div>
  );
}
