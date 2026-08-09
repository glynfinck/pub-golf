import { TabBar } from "@/components/shell/tab-bar";
import { getSessionUser } from "@/lib/data/rounds";

/**
 * The tab bar is navigation for somebody with a session; all four tabs land
 * on session screens. A signed-out visitor at `/` gets the front door
 * instead, and a tab bar under it would be four doors into the same
 * sign-in. Guests count as sessions here: anonymous auth is still a card.
 */
export default async function TabsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getSessionUser();

  return (
    <>
      {children}
      {user ? <TabBar /> : null}
    </>
  );
}
