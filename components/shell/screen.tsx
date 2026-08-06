import { cn } from "@/lib/utils";

/** Mobile-first page container: phone-width column, safe-area aware. */
export function Screen({
  className,
  withTabBar,
  ...props
}: React.ComponentProps<"main"> & { withTabBar?: boolean }) {
  return (
    <main
      className={cn(
        "mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-5 pt-[max(1rem,env(safe-area-inset-top))]",
        withTabBar ? "pb-24" : "pb-[max(1.5rem,env(safe-area-inset-bottom))]",
        className,
      )}
      {...props}
    />
  );
}

export function ScreenHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex items-end justify-between gap-3">
      <div>
        {eyebrow ? <div className="eyebrow text-fairway">{eyebrow}</div> : null}
        <h1 className="font-serif text-2xl font-semibold tracking-tight text-balance">
          {title}
        </h1>
      </div>
      {action}
    </header>
  );
}
