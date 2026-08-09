"use client";

import { EllipsisVertical } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ManageRoundSheet } from "@/components/round/manage-round-sheet";
import { Card } from "@/components/ui/card";
import type { MyRound } from "@/lib/data/rounds";
import { cn } from "@/lib/utils";

/**
 * The history ledger, with the host's locker behind it. Each row keeps its
 * one job — tap to open the round — and the rounds you host carry a second
 * 44px target, the kebab, which opens the manage sheet. A guest's row
 * looks exactly as it always did: management is a host's affair.
 */
export function RoundsList({ rounds }: { rounds: MyRound[] }) {
  const [managingCode, setManagingCode] = useState<string | null>(null);
  const managing =
    rounds.find((round) => round.code === managingCode) ?? null;

  return (
    <>
      <Card className="gap-0 px-4 py-1">
        {rounds.map((round, index) => (
          <div
            key={round.code}
            data-testid="round-row"
            className={cn(
              "flex items-center",
              index > 0 && "border-t border-border",
            )}
          >
            <Link
              href={`/round/${round.code}${round.status === "finished" ? "/results" : ""}`}
              className="flex min-w-0 flex-1 items-center justify-between gap-3 py-3"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">
                  {round.name}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {new Date(round.created_at).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                  · {round.hole_count} holes · code {round.code}
                </span>
              </span>
              <span
                className={cn(
                  "shrink-0 text-[11px] font-bold uppercase tracking-wide",
                  round.status === "live"
                    ? "text-hazard"
                    : round.status === "lobby"
                      ? "text-marker"
                      : "text-muted-foreground",
                )}
              >
                {round.status}
              </span>
            </Link>
            {round.role === "host" ? (
              <button
                type="button"
                aria-label={`Manage ${round.name}`}
                data-testid="manage-round"
                onClick={() => setManagingCode(round.code)}
                className="-mr-2 ml-1 flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
              >
                <EllipsisVertical size={16} aria-hidden />
              </button>
            ) : null}
          </div>
        ))}
      </Card>

      <ManageRoundSheet
        round={managing}
        open={managing !== null}
        onOpenChange={(open) => {
          if (!open) setManagingCode(null);
        }}
      />
    </>
  );
}
