import { FrontDoor } from "@/components/auth/front-door";
import { Screen } from "@/components/shell/screen";

export const metadata = { title: "Sign in" };

/**
 * A thin frame around the shared front door. This route earns its keep with
 * the two things `/` does not carry: the `next` deep link a protected screen
 * sends along, and the error line the OAuth callback bounces back to.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  const target = next?.startsWith("/") && !next.startsWith("//") ? next : "/";

  return (
    <Screen className="justify-center gap-5">
      <FrontDoor next={target} error={Boolean(error)} />
    </Screen>
  );
}
