"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { estimateWalkMinutes } from "@/lib/geo";
import { createClient } from "@/lib/supabase/server";

export type CourseActionResult = { error?: string };

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
        lat: z.number().nullable(),
        lng: z.number().nullable(),
      }),
    )
    .min(1)
    .max(18),
});

export type CreateCourseInput = z.infer<typeof courseSchema>;

export async function createCourse(
  input: CreateCourseInput,
): Promise<CourseActionResult> {
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

  const holes = parsed.data.holes.map((hole, index, all) => ({
    course_id: course.id,
    number: index + 1,
    venue_id: hole.venue_id,
    venue_name: hole.venue_name,
    drink: hole.drink,
    par: hole.par,
    hazard: hole.hazard,
    hazard_note: hole.hazard ? hole.hazard_note : null,
    walk_minutes_to_next:
      index < all.length - 1 ? estimateWalkMinutes(hole, all[index + 1]) : null,
  }));

  const { error: holesError } = await supabase
    .from("course_holes")
    .insert(holes);
  if (holesError) {
    // Don't leave a hole-less course behind.
    await supabase.from("courses").delete().eq("id", course.id);
    return { error: holesError.message };
  }

  revalidatePath("/courses");
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
