import { notFound } from "next/navigation";
import { CourseBuilder } from "@/components/course/course-builder";
import { getCourseForEdit } from "@/lib/data/courses";

export const metadata = { title: "Retouch the course" };

/**
 * A saved course back on the drafting table. RLS answers for access: a
 * course that is not the viewer's reads back as nothing, and nothing is a
 * 404 — same as a course that never existed.
 */
export default async function EditCoursePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const course = await getCourseForEdit(id);
  if (!course) notFound();

  return <CourseBuilder course={course} />;
}
