import Link from "next/link";
import { redirect } from "next/navigation";
import { Screen, ScreenHeader } from "@/components/shell/screen";
import { ProfileForm } from "@/components/profile-form";
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
      <footer className="mt-auto flex items-center justify-center gap-3 pt-4 text-[11px] text-muted-foreground">
        <Link href="/legal/privacy" className="font-bold text-fairway">
          Privacy
        </Link>
        <span aria-hidden>·</span>
        <Link href="/legal/terms" className="font-bold text-fairway">
          Terms
        </Link>
      </footer>
    </Screen>
  );
}
