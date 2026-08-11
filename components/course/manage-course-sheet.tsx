"use client";

import { Copy, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Archive } from "lucide-react";
import { HoldToConfirm } from "@/components/ui/hold-to-confirm";
import { ActionRow, ConfirmFrame } from "@/components/ui/manage-sheet";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAction } from "@/hooks/use-action";
import { archiveCourse, deleteCourse, duplicateCourse } from "@/lib/actions/courses";
import type { MyCourse } from "@/lib/data/courses";

/**
 * The course book's locker, behind the kebab on a course row — the same
 * grammar as the rounds ledger's manage sheet. Editing has its own door
 * (the row itself); this holds the housekeeping: the copy, and the
 * tear-out behind a press-and-hold priced like tearing up a round.
 */
export function ManageCourseSheet({
  course,
  open,
  onOpenChange,
}: {
  /** The course being managed; null keeps the sheet closed. */
  course: MyCourse | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { run, pending, busy } = useAction();
  const [mode, setMode] = useState<"menu" | "delete">("menu");

  if (!course) return null;
  const { id, name } = course;

  // The sheet always opens on the menu — a half-armed confirm must not
  // survive a close.
  function handleOpenChange(next: boolean) {
    if (!next) setMode("menu");
    onOpenChange(next);
  }

  function putAway() {
    // Read once, before the await: the sheet closes on success and `course`
    // goes null with it, so the toast would otherwise be deciding its wording
    // from a course that is no longer there.
    const wasArchived = course?.archived === true;
    run(async () => {
      const result = await archiveCourse(id, !wasArchived);
      if (result.error) return result;
      toast.success(
        wasArchived ? "Back in the book." : "Put away at the back of the book.",
      );
      onOpenChange(false);
      router.refresh();
      return {};
    });
  }

  function fileCopy() {
    run(async () => {
      const result = await duplicateCourse(id);
      if (!result.error) {
        toast.success("Copy filed beside the original.");
        handleOpenChange(false);
      }
      return result;
    });
  }

  function tearOut() {
    run(async () => {
      const result = await deleteCourse(id);
      if (!result.error) {
        toast(`${name} torn out of the book.`);
        handleOpenChange(false);
      }
      return result;
    });
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-w-md rounded-t-2xl"
        data-testid="manage-course-sheet"
      >
        <SheetHeader className="pb-0 text-center">
          <span className="eyebrow" style={{ textIndent: "0.2em" }}>
            Manage
          </span>
          <SheetTitle className="truncate font-serif">{course.name}</SheetTitle>
          <SheetDescription className="text-xs">
            {course.hole_count} holes · par {course.par}
            {course.walk_minutes > 0
              ? ` · ${course.walk_minutes} min walking`
              : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col px-4 pb-6">
          {mode === "menu" ? (
            <>
              <ActionRow
                icon={<Pencil size={17} aria-hidden />}
                label="Retouch the course"
                sub="Pubs, drinks, pars, hazards and local rules"
                testId="edit-course"
                onClick={() => router.push(`/courses/${id}`)}
              />
              <ActionRow
                icon={<Copy size={17} aria-hidden />}
                label="File a copy beside it"
                sub="The course as last saved, yours to tweak"
                disabled={pending}
                pending={pending}
                busy={busy}
                pendingLabel="Filing the copy"
                testId="duplicate-course"
                onClick={fileCopy}
              />
              {/* A course that cost a credit is put away rather than torn
                  out. Deleting no longer gives the credit back, so losing both
                  from a button whose whole affordance is "undoable-ish" is not
                  a trade anybody agreed to — hold-to-confirm is a speed bump,
                  not a receipt. A hand-plotted course is free to remake and
                  keeps the bin it always had. */}
              {course.byCaddy ? (
                <ActionRow
                  icon={<Archive size={17} aria-hidden />}
                  label={course.archived ? "Bring it back out" : "Put it away"}
                  sub={
                    course.archived
                      ? "Back into the book, exactly as you left it"
                      : "To the back of the book — nothing is lost"
                  }
                  disabled={pending}
                  pending={pending}
                  busy={busy}
                  pendingLabel={course.archived ? "Bringing it out" : "Putting it away"}
                  testId="archive-course"
                  onClick={putAway}
                />
              ) : (
                <ActionRow
                  hazard
                  icon={<Trash2 size={17} aria-hidden />}
                  label="Tear out of the book"
                  sub="Rounds already played on it keep their card"
                  testId="delete-course"
                  onClick={() => setMode("delete")}
                />
              )}
            </>
          ) : (
            <ConfirmFrame
              hazard
              title="Tear it out of the book?"
              body={`${course.name} leaves your courses for good. Rounds already played on it keep their own card — every round takes its own snapshot.`}
            >
              <div className="grid grid-cols-[1fr_1.4fr] gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setMode("menu")}
                >
                  Keep it
                </Button>
                <HoldToConfirm
                  label="Hold to tear it out"
                  holdingLabel="Hold…"
                  disabled={pending}
                  onConfirm={tearOut}
                  data-testid="delete-course-confirm"
                />
              </div>
            </ConfirmFrame>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
