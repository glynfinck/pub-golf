"use client";

import {
  ArrowRight,
  BookMarked,
  CircleX,
  FileCheck,
  Pencil,
  RotateCw,
  Share2,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { HoldToConfirm } from "@/components/ui/hold-to-confirm";
import { FieldLabel, Input } from "@/components/ui/input";
import { ActionRow, ConfirmFrame } from "@/components/ui/manage-sheet";
import { PendingLabel } from "@/components/ui/pending-label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAction } from "@/hooks/use-action";
import {
  deleteRound,
  fileCardEarly,
  rehostRound,
  renameRound,
  saveRoundAsCourse,
} from "@/lib/actions/rounds";
import type { MyRound } from "@/lib/data/rounds";

/**
 * The host's locker: everything a host can do to a round after it's made,
 * behind the kebab on their row of the Rounds tab. One sheet, dressed for
 * the round's status — a finished card invites the rematch, a lobby can be
 * quietly called off, a live round is mostly left alone. Rename and the
 * confirms swap in place of the menu, so the round's name stays overhead
 * throughout.
 *
 * Confirmation is priced to the loss: an unplayed lobby goes on a plain
 * tap, a live or finished round takes a press-and-hold. The copy on each
 * row states the blast radius before anything is armed.
 */
export function ManageRoundSheet({
  round,
  open,
  onOpenChange,
}: {
  /** The round being managed; null keeps the sheet closed. */
  round: MyRound | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { run, pending, busy } = useAction();
  const [mode, setMode] = useState<"menu" | "rename" | "delete" | "file">(
    "menu",
  );
  const [draftName, setDraftName] = useState("");
  const [copied, setCopied] = useState(false);

  if (!round) return null;
  const code = round.code;

  // The sheet always opens on the menu — a half-armed confirm must not
  // survive a close.
  function handleOpenChange(next: boolean) {
    if (!next) setMode("menu");
    onOpenChange(next);
  }

  function share() {
    if (!round) return;
    const url = `${window.location.origin}/round/${code}`;
    if (navigator.share) {
      navigator
        .share({ title: round.name, text: `Entry code ${code}`, url })
        .catch(() => undefined);
    } else {
      navigator.clipboard.writeText(
        `${round.name} — entry code ${code} — ${url}`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  function tearUp() {
    run(async () => {
      const result = await deleteRound(code);
      if (!result?.error) handleOpenChange(false);
      return result;
    });
  }

  function fileEarly() {
    run(async () => {
      const result = await fileCardEarly(code);
      if (!result?.error) handleOpenChange(false);
      return result;
    });
  }

  function saveCourse() {
    run(async () => {
      const result = await saveRoundAsCourse(code);
      if (!result?.error) toast(`${round?.name} saved to the course book.`);
      return result;
    });
  }

  function saveName(event: React.FormEvent) {
    event.preventDefault();
    run(async () => {
      const result = await renameRound(code, draftName);
      if (!result?.error) setMode("menu");
      return result;
    });
  }

  // Copy per status for the delete confirm — the blast radius, stated.
  const deleteCopy =
    round.status === "lobby"
      ? {
          title: "Call it off?",
          body: "Nobody has teed off — this just closes the tab and frees the code.",
          hold: false,
          confirm: "Call it off",
        }
      : round.status === "live"
        ? {
            title: "Abandon the round?",
            body: "The round ends mid-hole for everyone in it, and every card goes with it. There's no getting it back.",
            hold: true,
            confirm: "Hold to abandon",
          }
        : {
            title: "Tear up the card?",
            body: `This removes ${round.name} from every player's history — every hole, every score, every penalty. There's no getting it back.`,
            hold: true,
            confirm: "Hold to tear it up",
          };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-w-md rounded-t-2xl"
        data-testid="manage-round-sheet"
      >
        <SheetHeader className="pb-0 text-center">
          <span className="eyebrow" style={{ textIndent: "0.2em" }}>
            Manage
          </span>
          <SheetTitle className="truncate font-serif">{round.name}</SheetTitle>
          <SheetDescription className="text-xs">
            {statusLine(round)}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col px-4 pb-6">
          {mode === "menu" ? (
            <>
              <ActionRow
                icon={<ArrowRight size={17} aria-hidden />}
                label={
                  round.status === "lobby"
                    ? "Open the lobby"
                    : round.status === "live"
                      ? "Rejoin the round"
                      : "View the results"
                }
                onClick={() =>
                  router.push(
                    `/round/${code}${round.status === "finished" ? "/results" : ""}`,
                  )
                }
              />

              {round.status === "finished" ? (
                <>
                  <ActionRow
                    icon={<RotateCw size={17} aria-hidden />}
                    label="Same again"
                    sub="New code, same course and rules — fresh lobby"
                    disabled={pending}
                    pending={pending}
                    busy={busy}
                    pendingLabel="Setting the table"
                    testId="rehost-round"
                    onClick={() => run(() => rehostRound(code))}
                  />
                  <ActionRow
                    icon={<BookMarked size={17} aria-hidden />}
                    label="Save the course to the book"
                    sub="Holes, walks and local rules, into your courses"
                    disabled={pending}
                    testId="save-round-course"
                    onClick={saveCourse}
                  />
                </>
              ) : (
                <ActionRow
                  icon={<Share2 size={17} aria-hidden />}
                  label="Share the entry code"
                  sub={copied ? "Copied!" : `${code} — the same invite as the lobby's`}
                  onClick={share}
                />
              )}

              {round.status === "live" ? (
                <ActionRow
                  icon={<FileCheck size={17} aria-hidden />}
                  label="File the card early"
                  sub="Round ends now — standings stand as played"
                  testId="file-card-early"
                  onClick={() => setMode("file")}
                />
              ) : null}

              <ActionRow
                icon={<Pencil size={17} aria-hidden />}
                label="Rename the round"
                testId="rename-round"
                onClick={() => {
                  setDraftName(round.name);
                  setMode("rename");
                }}
              />

              <ActionRow
                hazard
                icon={
                  round.status === "lobby" ? (
                    <CircleX size={17} aria-hidden />
                  ) : (
                    <Trash2 size={17} aria-hidden />
                  )
                }
                label={
                  round.status === "lobby"
                    ? "Call it off"
                    : round.status === "live"
                      ? "Abandon the round"
                      : "Tear up the card"
                }
                sub={
                  round.status === "lobby"
                    ? "Nobody has teed off — this just closes the tab"
                    : "Removes it from every player's history"
                }
                testId="delete-round"
                onClick={() => setMode("delete")}
              />
            </>
          ) : null}

          {mode === "rename" ? (
            <form onSubmit={saveName} className="flex flex-col gap-3 pt-2">
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="manage-round-name">Round name</FieldLabel>
                <Input
                  id="manage-round-name"
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  maxLength={80}
                  autoFocus
                  data-testid="rename-round-input"
                />
              </div>
              <div className="grid grid-cols-[1fr_1.4fr] gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setMode("menu")}
                >
                  Back
                </Button>
                <Button
                  type="submit"
                  disabled={pending || draftName.trim().length === 0}
                  data-testid="rename-round-save"
                >
                  <PendingLabel
                    pending={pending}
                    busy={busy}
                    label="Save the name"
                    pendingLabel="Inking it in"
                  />
                </Button>
              </div>
            </form>
          ) : null}

          {mode === "file" ? (
            <ConfirmFrame
              title="File the card early?"
              body="The round ends for everyone and the standings stand as played — unplayed holes take the substitute on every card alike."
            >
              <div className="grid grid-cols-[1fr_1.4fr] gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setMode("menu")}
                >
                  Keep playing
                </Button>
                <Button
                  disabled={pending}
                  data-testid="file-card-early-confirm"
                  onClick={fileEarly}
                >
                  <PendingLabel
                    pending={pending}
                    busy={busy}
                    label="File it"
                    pendingLabel="Filing the card"
                  />
                </Button>
              </div>
            </ConfirmFrame>
          ) : null}

          {mode === "delete" ? (
            <ConfirmFrame hazard title={deleteCopy.title} body={deleteCopy.body}>
              <div className="grid grid-cols-[1fr_1.4fr] gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setMode("menu")}
                >
                  Keep it
                </Button>
                {deleteCopy.hold ? (
                  <HoldToConfirm
                    label={deleteCopy.confirm}
                    holdingLabel="Hold…"
                    disabled={pending}
                    onConfirm={tearUp}
                    data-testid="delete-round-confirm"
                  />
                ) : (
                  <Button
                    variant="destructive"
                    disabled={pending}
                    data-testid="delete-round-confirm"
                    onClick={tearUp}
                  >
                    <PendingLabel
                      pending={pending}
                      busy={busy}
                      label={deleteCopy.confirm}
                      pendingLabel="Closing the tab"
                    />
                  </Button>
                )}
              </div>
            </ConfirmFrame>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** "Filed 14 Jun 2026 · 9 holes · code TR4PD" — the sheet's dateline. */
function statusLine(round: MyRound): string {
  if (round.status === "live")
    return `Live · hole ${Math.min(round.current_hole, round.hole_count)} of ${round.hole_count} · code ${round.code}`;
  if (round.status === "lobby")
    return `In the lobby · ${round.hole_count} holes · code ${round.code}`;
  const date = new Date(round.created_at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `Filed ${date} · ${round.hole_count} holes · code ${round.code}`;
}
