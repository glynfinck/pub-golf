import { cn } from "@/lib/utils";

/** A menu line: label, dot leader fill, value. */
export function DotLeaderRow({
  label,
  value,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline gap-2 text-sm text-muted-foreground",
        className,
      )}
    >
      <span className="min-w-0">{label}</span>
      <span aria-hidden className="leader flex-1" />
      <span className="shrink-0">{value}</span>
    </div>
  );
}
