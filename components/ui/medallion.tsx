import { cn } from "@/lib/utils";

/** Engraved hole-number medallion: a serif numeral in a double ring. */
export function Medallion({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-full",
        "border-[1.5px] border-marker font-serif text-xl text-marker",
        "outline outline-offset-[3px] outline-marker",
        className,
      )}
    >
      {children}
    </span>
  );
}
