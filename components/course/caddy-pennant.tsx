/**
 * The caddy's pennant: this course was planned for you.
 *
 * An icon and nothing else, because the alternative was a word and the word
 * was the problem. "AI-generated" is exactly the register this app has agreed
 * not to speak in — the caddy is a member of staff here, not a feature — and
 * a text badge would be the loudest thing on a row that is mostly a pub count.
 *
 * A pennant rather than a spark or a wand for the same reason. Golf already
 * has a mark for "the club set this one", it is the shape the house mark is
 * built on (`lib/mark.ts`), and it means something to somebody who has never
 * thought about how the course got made — which is most people, and the point.
 *
 * **It is not decoration.** A green fee buys one caddy course at a time and
 * tearing that course out frees the next one, so a host with five hand-plotted
 * courses and one of these has to be able to see which is which. Delete the
 * wrong one and nothing is freed. That is why it earns a row it would
 * otherwise not deserve.
 *
 * Icon-only on screen, never icon-only to a screen reader: the title is what
 * a pointer gets on hover and the label is what a screen reader reads, because
 * an unlabelled ornament here is a host being asked to guess which course
 * their fee is holding.
 */
export function CaddyPennant({ className }: { className?: string }) {
  return (
    <span
      title="Planned by the caddy"
      className={className}
      data-testid="caddy-pennant"
    >
      <svg
        viewBox="0 0 16 16"
        width="12"
        height="12"
        fill="none"
        role="img"
        aria-label="Planned by the caddy"
        className="text-marker"
      >
        {/* The stick, planted. Rounded because at twelve pixels a square cap
            reads as a stray pixel rather than as a line. */}
        <path
          d="M4.4 1.6v12.8"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        {/* The pennant, deliberately oversized against the stick — the same
            trade `lib/mark.ts` makes at 16px, where the flag is the only part
            still legible and a to-scale one disappears. */}
        <path d="M4.4 2.2h6.9L9.2 5.1l2.1 2.9H4.4z" fill="currentColor" />
      </svg>
    </span>
  );
}
