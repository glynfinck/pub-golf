import type { DraftHole } from "@/components/course/hole-editor";
import { readHolePenalties } from "@/lib/ruleset";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/supabase-helpers";

export interface MyCourse {
  id: string;
  name: string;
  created_at: string;
  hole_count: number;
  par: number;
  /** Σ walk_minutes_to_next, for the 19th-hole estimate. */
  walk_minutes: number;
  /**
   * The caddy planned this one.
   *
   * Newly load-bearing rather than decorative: a green fee buys one caddy
   * course at a time and tearing it out frees the next, so a host with five
   * hand-plotted courses and one of these has to be able to tell which is
   * which. Delete the wrong one and nothing is freed.
   */
  byCaddy: boolean;
  /** Put to the back of the book rather than torn out. */
  archived: boolean;
}

/** The viewer's saved courses, newest first. */
export async function getMyCourses(): Promise<MyCourse[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const [{ data }, { data: planned }] = await Promise.all([
    supabase
      .from("courses")
      .select("id, name, created_at, archived_at, course_holes(par, walk_minutes_to_next)")
      .order("created_at", { ascending: false }),
    // Which courses came off the caddy, read from the sessions that filed
    // them rather than from a flag on the course. There is no second copy of
    // the truth to drift: the link is the same one the allowance counts.
    supabase.from("caddy_sessions").select("course_id").not("course_id", "is", null),
  ]);
  const byCaddy = new Set((planned ?? []).map((row) => row.course_id));

  return (data ?? []).map((course) => ({
    id: course.id,
    name: course.name,
    created_at: course.created_at,
    byCaddy: byCaddy.has(course.id),
    archived: course.archived_at != null,
    hole_count: course.course_holes.length,
    par: course.course_holes.reduce((sum, hole) => sum + hole.par, 0),
    walk_minutes: course.course_holes.reduce(
      (sum, hole) => sum + (hole.walk_minutes_to_next ?? 0),
      0,
    ),
  }));
}

export interface CourseDraft {
  id: string;
  name: string;
  holes: DraftHole[];
}

/**
 * A course loaded back onto the drafting table (RLS: owner only). Venue
 * dressing — address, rating, coordinates — comes off the shared Places
 * cache; a pub added by name never had any.
 */
export async function getCourseForEdit(
  courseId: string,
): Promise<CourseDraft | null> {
  const supabase = await createClient();
  const { data: course } = await supabase
    .from("courses")
    .select("id, name")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) return null;

  const { data: holes } = await supabase
    .from("course_holes")
    .select("*, venues(address, rating, lat, lng)")
    .eq("course_id", courseId)
    .order("number");

  return {
    id: course.id,
    name: course.name,
    holes: (holes ?? []).map((hole) => ({
      // The draft's own handle on the hole, minted here and never stored:
      // the row is identified by its position, but the builder's list has
      // to survive the hole moving to another one.
      id: crypto.randomUUID(),
      venue_id: hole.venue_id,
      venue_name: hole.venue_name,
      address: hole.venues?.address ?? null,
      rating: hole.venues?.rating ?? null,
      lat: hole.venues?.lat ?? null,
      lng: hole.venues?.lng ?? null,
      drink: hole.drink,
      par: hole.par,
      hazard: hole.hazard as DraftHole["hazard"],
      hazard_note: hole.hazard_note,
      penalties: readHolePenalties(hole.penalties),
      walk_minutes_to_next: hole.walk_minutes_to_next,
    })),
  };
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
