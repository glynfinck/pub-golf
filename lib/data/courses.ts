import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/supabase-helpers";

export interface MyCourse {
  id: string;
  name: string;
  created_at: string;
  hole_count: number;
  par: number;
}

/** The viewer's saved courses, newest first. */
export async function getMyCourses(): Promise<MyCourse[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("courses")
    .select("id, name, created_at, course_holes(par)")
    .order("created_at", { ascending: false });

  return (data ?? []).map((course) => ({
    id: course.id,
    name: course.name,
    created_at: course.created_at,
    hole_count: course.course_holes.length,
    par: course.course_holes.reduce((sum, hole) => sum + hole.par, 0),
  }));
}

/** A course with its holes in order (RLS: owner only). */
export async function getCourseWithHoles(courseId: string): Promise<{
  course: Tables<"courses">;
  holes: Tables<"course_holes">[];
} | null> {
  const supabase = await createClient();
  const { data: course } = await supabase
    .from("courses")
    .select("*")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) return null;

  const { data: holes } = await supabase
    .from("course_holes")
    .select("*")
    .eq("course_id", courseId)
    .order("number");

  return { course, holes: holes ?? [] };
}
