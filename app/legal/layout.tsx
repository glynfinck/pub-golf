import Link from "next/link";

import { Masthead } from "@/components/shell/masthead";
import { Screen } from "@/components/shell/screen";
import { CONTACT_EMAIL } from "@/app/legal/parts";

/**
 * Both documents are reachable signed out — the sign-in screen links them,
 * and Google's consent screen links them from outside the app entirely — so
 * the way back is the clubhouse, which sends a signed-out reader to /signin
 * on its own.
 */
export default function LegalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <Screen>
      <Masthead back={{ href: "/", label: "Clubhouse" }} />
      {children}
      <footer className="mt-2 flex flex-col gap-2 border-t border-border pt-4 text-center text-[11px] text-muted-foreground">
        <p>
          Questions about either document go to{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="font-bold text-fairway"
          >
            {CONTACT_EMAIL}
          </a>
          .
        </p>
        <p className="flex items-center justify-center gap-3">
          <Link href="/legal/privacy" className="font-bold text-fairway">
            Privacy
          </Link>
          <span aria-hidden>·</span>
          <Link href="/legal/terms" className="font-bold text-fairway">
            Terms
          </Link>
        </p>
      </footer>
    </Screen>
  );
}
