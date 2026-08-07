import Link from "next/link";
import { Screen, ScreenHeader } from "@/components/shell/screen";
import { DeleteCourseButton } from "@/components/course/delete-course-button";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RuleDouble } from "@/components/ui/rule";
import { getMyCourses } from "@/lib/data/courses";
import { cn } from "@/lib/utils";

export default async function CoursesPage() {
  const courses = await getMyCourses();

  return (
    <Screen withTabBar>
      <RuleDouble head />
      <ScreenHeader eyebrow="The course book" title="Your courses" />

      {courses.length > 0 ? (
        <Card className="gap-0 px-4 py-1">
          {courses.map((course, index) => (
            <div
              key={course.id}
              className={cn(
                "flex min-h-13 items-center gap-2",
                index > 0 && "border-t border-border",
              )}
            >
              <span className="tabular flex size-8 shrink-0 items-center justify-center rounded-full border-[1.5px] border-marker font-serif text-sm text-marker">
                {course.hole_count}
              </span>
              <span className="min-w-0 flex-1">
                <b className="block truncate text-sm">{course.name}</b>
                <span className="block text-[11px] text-muted-foreground">
                  {course.hole_count} holes · par {course.par}
                </span>
              </span>
              <DeleteCourseButton courseId={course.id} name={course.name} />
            </div>
          ))}
        </Card>
      ) : (
        <Card className="gap-0 px-4 text-sm text-muted-foreground">
          Nothing in the book yet. Plot a course — search the pubs, set the
          pars, pour the drinks.
        </Card>
      )}

      <Link href="/courses/new" className={cn(buttonVariants(), "w-full")}>
        Plot a new course
      </Link>

      <p className="text-center text-[11px] text-muted-foreground">
        Courses are reusable — every round takes its own snapshot. Pubs come
        from Google; you bring the par and the drinks.
      </p>
    </Screen>
  );
}
