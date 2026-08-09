import Link from "next/link";
import { redirect } from "next/navigation";
import { Screen, ScreenHeader } from "@/components/shell/screen";
import { ProfileForm } from "@/components/profile-form";
import { BUILD_REF } from "@/lib/config";
import { getProfile } from "@/lib/data/rounds";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const profile = await getProfile();
  if (!profile) redirect("/signin");

  return (
    <Screen withTabBar>
      <ScreenHeader eyebrow="Member card" title="Profile" />
      <ProfileForm
        displayName={profile.display_name}
        isAnonymous={profile.isAnonymous}
        memberSince={profile.created_at}
      />

      {/* The second door onto the house papers — the first is the sign-in
          screen, which a returning player never sees again. */}
      <footer className="mt-auto flex flex-col items-center gap-1.5 pt-4 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-3">
          <Link href="/legal/privacy" className="font-bold text-fairway">
            Privacy
          </Link>
          <span aria-hidden>·</span>
          <Link href="/legal/terms" className="font-bold text-fairway">
            Terms
          </Link>
        </div>
        {/* Which build is on the phone. Small, grey, and the difference
            between "it did something odd last night" being answerable and
            being a guess. */}
        {BUILD_REF ? (
          <div className="tabular font-mono text-[10px] opacity-70">
            build {BUILD_REF}
          </div>
        ) : null}
      </footer>
    </Screen>
  );
}
