import { notFound } from "next/navigation";
import { CourseBuilder } from "@/components/course/course-builder";
import { getCourseForEdit } from "@/lib/data/courses";
import { caddyStand } from "@/lib/data/caddy-gate";
import { caddyReopenable, resumeCaddyForCourse } from "@/lib/data/caddy";

export const metadata = { title: "Retouch the course" };

/**
 * A saved course back on the drafting table. RLS answers for access: a
 * course that is not the viewer's reads back as nothing, and nothing is a
 * 404 — same as a course that never existed.
 *
 * The caddy comes with it when the conversation that wrote this course is
 * still open. It used to be hidden here unconditionally, which read as a
 * design decision and was really a dead end: a host planned a course, it filed
 * itself, they landed on this page — and the sixty tweaks they had paid for
 * were behind a door that did not exist. Saving was the one action that ended
 * the conversation about the thing being saved.
 *
 * A hand-built course has no session and sees no caddy, which is the manual
 * builder staying exactly as it was.
 */
export default async function EditCoursePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const course = await getCourseForEdit(id);
  if (!course) notFound();

  const [stand, resumed, reopen] = await Promise.all([
    caddyStand(),
    resumeCaddyForCourse(id),
    // The other half of the same question: a conversation that is over only
    // because its patch was swept. Without this, a course planned this morning
    // and saved shows no caddy at all, which is indistinguishable from a
    // hand-built one and wrong in a way the host cannot act on.
    caddyReopenable(id),
  ]);

  return (
    <CourseBuilder
      course={course}
      caddy={stand.ready && (resumed !== null || reopen !== null)}
      hasPass={stand.hasPass}
      resumed={resumed}
      reopen={reopen}
      allowance={stand.allowance}
    />
  );
}
