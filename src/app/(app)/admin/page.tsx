import { redirect } from "next/navigation";
import { requirePageUser } from "@/lib/page-context";
import { AdminConsole } from "@/components/admin/admin-console";

export default async function AdminPage() {
  const user = await requirePageUser();
  if (user.systemRole !== "ADMIN") redirect("/");
  return <AdminConsole currentUserId={user.id} />;
}
