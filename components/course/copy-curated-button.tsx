"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PendingLabel } from "@/components/ui/pending-label";
import { useAction } from "@/hooks/use-action";
import { copyCuratedCourse } from "@/lib/actions/courses";

/** Files a copy of a curated card in the viewer's book and opens it to edit. */
export function CopyCuratedButton({ slug }: { slug: string }) {
  const router = useRouter();
  const { run, pending, busy } = useAction();

  return (
    <Button
      className="mt-auto"
      disabled={pending}
      onClick={() =>
        run(async () => {
          const result = await copyCuratedCourse(slug);
          if (result.error || !result.id) return result;
          toast.success("In your book — tweak away.");
          router.push(`/courses/${result.id}`);
        })
      }
    >
      <PendingLabel
        pending={pending}
        busy={busy}
        label="Copy to your book"
        pendingLabel="Copying the card"
      />
    </Button>
  );
}
