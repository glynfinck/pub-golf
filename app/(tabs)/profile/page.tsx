import { redirect } from "next/navigation";
import { Screen, ScreenHeader } from "@/components/shell/screen";
import { ProfileForm } from "@/components/profile-form";
import { getProfile } from "@/lib/data/rounds";

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
    </Screen>
  );
}
