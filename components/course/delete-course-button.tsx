"use client";

import { useTransition } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { deleteCourse } from "@/lib/actions/courses";

export function DeleteCourseButton({
  courseId,
  name,
}: {
  courseId: string;
  name: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      aria-label={`Delete ${name}`}
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`Tear ${name} out of the course book?`)) return;
        startTransition(async () => {
          const result = await deleteCourse(courseId);
          if (result.error) toast.error(result.error);
          else toast(`${name} torn out of the book.`);
        });
      }}
      className="flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary disabled:opacity-40"
    >
      <X size={15} aria-hidden />
    </button>
  );
}
