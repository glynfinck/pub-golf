import { NewRoundForm } from "@/components/round/new-round-form";
import { getMyCourses } from "@/lib/data/courses";

export const metadata = { title: "New round" };

export default async function NewRoundPage() {
  const courses = await getMyCourses();
  return <NewRoundForm courses={courses} />;
}
