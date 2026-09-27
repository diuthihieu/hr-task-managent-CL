import { requirePageUser } from "@/lib/page-context";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requirePageUser();
  return <>{children}</>;
}
