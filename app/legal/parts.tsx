/**
 * The furniture both legal documents hang from. They read as house papers —
 * eyebrow, serif line, sectioned with the same ruled heading the rules sheet
 * uses — because a policy set in a different voice from the rest of the app
 * reads as somebody else's policy, pasted in.
 */

/** Bumped by hand when either document actually changes. */
export const LEGAL_UPDATED = "9 August 2026";

/** Where a reader takes a question about either document. */
export const CONTACT_EMAIL = "glynfinck@gmail.com";

export function LegalHeader({
  eyebrow,
  title,
  standfirst,
}: {
  eyebrow: string;
  title: string;
  standfirst: string;
}) {
  return (
    <header className="text-center">
      <div className="eyebrow text-fairway">{eyebrow}</div>
      <h1 className="mt-1 font-serif text-2xl font-semibold tracking-tight">
        {title}
      </h1>
      <p className="mx-auto mt-2 max-w-[42ch] text-sm text-muted-foreground">
        {standfirst}
      </p>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Last updated {LEGAL_UPDATED}
      </p>
    </header>
  );
}

export function Section({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2 pt-2">
        <h2 className="eyebrow text-fairway">{heading}</h2>
        <span aria-hidden className="h-px flex-1 bg-border" />
      </div>
      <div className="flex flex-col gap-2 text-sm text-muted-foreground [&_a]:font-bold [&_a]:text-fairway [&_b]:text-foreground">
        {children}
      </div>
    </section>
  );
}

/** A bulleted list in the body voice — tighter and a size down, like the sheet. */
export function Points({ children }: { children: React.ReactNode }) {
  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-4">{children}</ul>
  );
}
