"use client";

import { EllipsisVertical } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { CaddyPennant } from "@/components/course/caddy-pennant";
import { ManageCourseSheet } from "@/components/course/manage-course-sheet";
import { Card } from "@/components/ui/card";
import type { MyCourse } from "@/lib/data/courses";
import { cn } from "@/lib/utils";

/**
 * The course book's shelf, with the locker behind it. Each row keeps its
 * one job — tap to retouch the course — and carries the kebab the rounds
 * ledger taught, opening the manage sheet (copy, tear out) without ever
 * opening the editor.
 */
export function CoursesList({ courses }: { courses: MyCourse[] }) {
  const [managingId, setManagingId] = useState<string | null>(null);
  const managing = courses.find((course) => course.id === managingId) ?? null;

  return (
    <>
      <Card className="gap-0 px-4 py-1">
        {courses.map((course, index) => (
          <div
            key={course.id}
            data-testid="course-row"
            className={cn(
              "flex items-center",
              index > 0 && "border-t border-border",
            )}
          >
            <Link
              href={`/courses/${course.id}`}
              className="flex min-h-13 min-w-0 flex-1 items-center gap-2 py-1"
            >
              <span className="tabular flex size-8 shrink-0 items-center justify-center rounded-full border-[1.5px] border-marker font-serif text-sm text-marker">
                {course.hole_count}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1.5">
                  <b className="truncate text-sm">{course.name}</b>
                  {/* Beside the name rather than out at the end of the row:
                      this says something *about the course*, and a mark
                      floated away from the thing it describes gets read as
                      another control. */}
                  {course.byCaddy ? (
                    <CaddyPennant className="flex shrink-0 items-center" />
                  ) : null}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  {course.hole_count} holes · par {course.par}
                </span>
              </span>
            </Link>
            <button
              type="button"
              aria-label={`Manage ${course.name}`}
              data-testid="manage-course"
              onClick={() => setManagingId(course.id)}
              className="-mr-2 ml-1 flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
            >
              <EllipsisVertical size={16} aria-hidden />
            </button>
          </div>
        ))}
      </Card>

      <ManageCourseSheet
        course={managing}
        open={managing !== null}
        onOpenChange={(open) => {
          if (!open) setManagingId(null);
        }}
      />
    </>
  );
}
