"use client";

import type { ReactNode } from "react";

import { RuleDouble } from "@/components/ui/rule";
import { cn } from "@/lib/utils";

/**
 * The brief's furniture: a section of a commission, and one ask inside it.
 *
 * The brief was eight chip groups stacked in a scroll, every one wearing the
 * same loud eyebrow label, which is the shape of a settings page rather than
 * of a form somebody is pleased to fill in. Two levels fix most of it — the
 * *sections* are the card's headings and carry the printed double rule the
 * rest of the house uses, and inside them an *ask* is quiet: a small label, its
 * control, and a serif line saying what the answer will mean.
 *
 * The eyebrow belongs to the section, not to the field. Reserving the loudest
 * type in the house for four headings is what lets the eye find them.
 */
export function BriefSection({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <div>
        <span className="eyebrow text-fairway">{title}</span>
        <RuleDouble />
      </div>
      {children}
    </section>
  );
}

