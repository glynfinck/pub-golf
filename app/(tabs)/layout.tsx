import { TabBar } from "@/components/shell/tab-bar";

export default function TabsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      {children}
      <TabBar />
    </>
  );
}
