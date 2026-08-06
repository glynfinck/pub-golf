import { NewRoundForm } from "@/components/round/new-round-form";
import { getMyCourses } from "@/lib/data/courses";

export default async function NewRoundPage() {
  const courses = await getMyCourses();
  return <NewRoundForm courses={courses} />;
}
