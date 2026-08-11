"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { curatedCourse } from "@/lib/course-templates";
import { estimateWalkMinutes } from "@/lib/geo";
import { MAX_LOCAL_RULES } from "@/lib/rules";
import { createClient } from "@/lib/supabase/server";

export type CourseActionResult = { error?: string };
/** Actions that mint a course hand its id back — the copy actions so the
 * client can open its editor, `createCourse` so a table that is still being
 * worked on files over the same row next time. */
export type CourseCopyResult = CourseActionResult & { id?: string };

const courseSchema = z.object({
  name: z.string().trim().min(1).max(80),
  holes: z
    .array(
      z.object({
        venue_id: z.string().uuid().nullable(),
        venue_name: z.string().trim().min(1).max(120),
        drink: z.string().trim().min(1).max(120),
        par: z.number().int().min(1).max(20),
        hazard: z.enum(["water", "bunker", "dogleg"]).nullable(),
        hazard_note: z.string().trim().max(200).nullable(),
        penalties: z
          .array(
            z.object({
              strokes: z.number().int().min(1).max(20),
              reason: z.string().trim().min(1).max(80),
            }),
          )
          .max(MAX_LOCAL_RULES)
          .default([]),
        lat: z.number().nullable(),
        lng: z.number().nullable(),
        // The stored walk leg, carried through an edit as the fallback when
        // a hole has no coordinates to re-measure (curated copies, pubs
        // added by name). With coordinates, the fresh estimate wins.
        walk_minutes_to_next: z.number().int().min(0).nullable().default(null),
      }),
    )
    .min(1)
    .max(18),
});

export type CreateCourseInput = z.input<typeof courseSchema>;

/** The course_holes rows for a validated draft, walks re-measured. */
function holeRows(
  courseId: string,
  holes: z.output<typeof courseSchema>["holes"],
) {
  return holes.map((hole, index, all) => ({
    course_id: courseId,
    number: index + 1,
    venue_id: hole.venue_id,
    venue_name: hole.venue_name,
    drink: hole.drink,
    par: hole.par,
    hazard: hole.hazard,
    hazard_note: hole.hazard ? hole.hazard_note : null,
    penalties: hole.penalties,
    walk_minutes_to_next:
      index < all.length - 1
        ? (estimateWalkMinutes(hole, all[index + 1]) ??
          hole.walk_minutes_to_next)
        : null,
  }));
}

export async function createCourse(
  input: CreateCourseInput,
): Promise<CourseCopyResult> {
  const parsed = courseSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the course — something's off" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");

  const { data: course, error } = await supabase
    .from("courses")
    .insert({ owner: user.id, name: parsed.data.name })
    .select()
    .single();
  if (error) return { error: error.message };

  const { error: holesError } = await supabase
    .from("course_holes")
    .insert(holeRows(course.id, parsed.data.holes));
  if (holesError) {
    // Don't leave a hole-less course behind.
    await supabase.from("courses").delete().eq("id", course.id);
    return { error: holesError.message };
  }

  revalidatePath("/courses");
  // The id goes back so a caller that is going to keep editing can file its
  // next version over the top rather than minting a second course. The caddy's
  // drafting table is the one that does (`course-builder.tsx`).
  return { id: course.id };
}

export async function updateCourse(
  courseId: string,
  input: CreateCourseInput,
): Promise<CourseActionResult> {
  const parsed = courseSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the course — something's off" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");

  // RLS scopes the update to the owner — a filtered-out UPDATE returns no
  // error and no rows, so the returned row is the proof it was ours.
  const { data: renamed, error } = await supabase
    .from("courses")
    .update({ name: parsed.data.name })
    .eq("id", courseId)
    .select("id");
  if (error) return { error: error.message };
  if (!renamed || renamed.length === 0)
    return { error: "That course is not in your book" };

  // The holes are rewritten wholesale. PostgREST has no transaction to lean
  // on, so keep the old rows to put back if the rewrite fails halfway.
  const { data: oldHoles } = await supabase
    .from("course_holes")
    .select("*")
    .eq("course_id", courseId)
    .order("number");

  const { error: deleteError } = await supabase
    .from("course_holes")
    .delete()
    .eq("course_id", courseId);
  if (deleteError) return { error: deleteError.message };

  const { error: insertError } = await supabase
    .from("course_holes")
    .insert(holeRows(courseId, parsed.data.holes));
  if (insertError) {
    if (oldHoles && oldHoles.length > 0)
      await supabase.from("course_holes").insert(oldHoles);
    return { error: insertError.message };
  }

  revalidatePath("/courses");
  revalidatePath(`/courses/${courseId}`);
  return {};
}

export async function deleteCourse(
  courseId: string,
): Promise<CourseActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("courses").delete().eq("id", courseId);
  if (error) return { error: error.message };
  revalidatePath("/courses");
  return {};
}

export async function duplicateCourse(
  courseId: string,
): Promise<CourseCopyResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");

  // RLS: only the owner's course reads back.
  const { data: source } = await supabase
    .from("courses")
    .select("id, name")
    .eq("id", courseId)
    .maybeSingle();
  if (!source) return { error: "That course is not in your book" };

  const { data: holes } = await supabase
    .from("course_holes")
    .select("*")
    .eq("course_id", courseId)
    .order("number");

  const { data: copy, error } = await supabase
    .from("courses")
    .insert({
      owner: user.id,
      // "· copy" within the 80-char name budget, however long the original.
      name: `${source.name.slice(0, 73)} · copy`,
    })
    .select()
    .single();
  if (error) return { error: error.message };

  if (holes && holes.length > 0) {
    const { error: holesError } = await supabase.from("course_holes").insert(
      holes.map((hole) => ({
        course_id: copy.id,
        number: hole.number,
        venue_id: hole.venue_id,
        venue_name: hole.venue_name,
        drink: hole.drink,
        par: hole.par,
        hazard: hole.hazard,
        hazard_note: hole.hazard_note,
        penalties: hole.penalties,
        walk_minutes_to_next: hole.walk_minutes_to_next,
      })),
    );
    if (holesError) {
      // Don't leave a hole-less course behind.
      await supabase.from("courses").delete().eq("id", copy.id);
      return { error: holesError.message };
    }
  }

  revalidatePath("/courses");
  return { id: copy.id };
}

export async function copyCuratedCourse(
  slug: string,
): Promise<CourseCopyResult> {
  const curated = curatedCourse(slug);
  if (!curated) return { error: "That card is not in the curated book" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");

  const { data: copy, error } = await supabase
    .from("courses")
    .insert({ owner: user.id, name: curated.name })
    .select()
    .single();
  if (error) return { error: error.message };

  const { error: holesError } = await supabase.from("course_holes").insert(
    curated.holes.map((hole) => ({
      course_id: copy.id,
      number: hole.number,
      venue_id: null,
      venue_name: hole.venue_name,
      drink: hole.drink,
      par: hole.par,
      hazard: hole.hazard,
      hazard_note: hole.hazard_note,
      penalties: hole.penalties,
      // The printed legs, verbatim — these pubs carry no coordinates.
      walk_minutes_to_next: hole.walk_minutes_to_next,
    })),
  );
  if (holesError) {
    // Don't leave a hole-less course behind.
    await supabase.from("courses").delete().eq("id", copy.id);
    return { error: holesError.message };
  }

  revalidatePath("/courses");
  return { id: copy.id };
}
