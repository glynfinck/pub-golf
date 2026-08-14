import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { CoursesList } from "@/components/course/courses-list";
import { Screen, ScreenHeader } from "@/components/shell/screen";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RuleDouble } from "@/components/ui/rule";
import { CURATED_COURSES, coursePar } from "@/lib/course-templates";
import { caddyStand } from "@/lib/data/caddy-gate";
import { getMyCourses } from "@/lib/data/courses";
import { cn } from "@/lib/utils";

export const metadata = { title: "The course book" };

const courseRow =
  "flex min-h-13 items-center gap-2 hover:bg-secondary/40 -mx-4 px-4";

export default async function CoursesPage() {
  const [courses, stand] = await Promise.all([getMyCourses(), caddyStand()]);

  return (
    <Screen withTabBar>
      <RuleDouble head />
      <ScreenHeader eyebrow="The course book" title="Your courses" />

      {/* "Nothing of your own in the book" has to mean the live ones — a host
          whose only course is put away is not starting from scratch, and
          telling them so would hide the drawer that has it. */}
      {courses.length > 0 ? (
        <CoursesList courses={courses} />
      ) : (
        <Card className="gap-0 px-4 text-sm text-muted-foreground">
          Nothing of your own in the book yet. Plot a course — or copy a
          curated card below and tweak it.
        </Card>
      )}

      {/* Two doors, because there are two ways to make a course and they are
          genuinely different rooms. The caddy's is a map you draw a walk on;
          the table is a list you fill in by hand. Naming both — rather than
          hanging the caddy off the table's door as a widget — is what stops
          the paid thing reading as a bolt-on to the free one. Off duty there
          is only ever one door, and it is the one that has always been free. */}
      {stand.ready ? (
        <div className="flex flex-col gap-2">
          <Link
            href="/plan"
            className={cn(buttonVariants(), "w-full")}
            data-testid="door-caddy"
          >
            Plan it with the caddy
          </Link>
          <Link
            href="/courses/new"
            className={cn(buttonVariants({ variant: "outline" }), "w-full")}
          >
            Plot it by hand
          </Link>
          <p className="text-center text-[10px] text-muted-foreground">
            The caddy draws and routes the night; the table is yours to fill
            in, free as ever.
          </p>
        </div>
      ) : (
        <Link href="/courses/new" className={cn(buttonVariants(), "w-full")}>
          Plot a new course
        </Link>
      )}

      <section>
        <h3 className="eyebrow mb-2">Curated · the house cards</h3>
        <Card className="gap-0 px-4 py-1">
          {CURATED_COURSES.map((course, index) => (
            <Link
              key={course.slug}
              href={`/courses/curated/${course.slug}`}
              className={cn(courseRow, index > 0 && "border-t border-border")}
            >
              <span className="tabular flex size-8 shrink-0 items-center justify-center rounded-full border-[1.5px] border-fairway font-serif text-sm text-fairway">
                {course.holes.length}
              </span>
              <span className="min-w-0 flex-1">
                <b className="block truncate text-sm">{course.name}</b>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {course.holes.length} holes · par {coursePar(course.holes)} ·
                  read-only until copied
                </span>
              </span>
              <ChevronRight
                size={16}
                aria-hidden
                className="shrink-0 text-muted-foreground"
              />
            </Link>
          ))}
        </Card>
      </section>

      <p className="text-center text-[11px] text-muted-foreground">
        Courses are reusable — every round takes its own snapshot. Tap a
        course to retouch it; the menu beside it files copies and tears out.
        Pubs come from Google; you bring the par and the drinks.
      </p>
    </Screen>
  );
}
