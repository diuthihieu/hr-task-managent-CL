import { requirePageUser } from "@/lib/page-context";
import { ChangePasswordForm } from "@/components/account/change-password-form";

export default async function ChangePasswordPage() {
  const user = await requirePageUser({ allowPasswordChange: true });
  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 p-4">
      <ChangePasswordForm email={user.email} forced={user.mustChangePassword} />
    </div>
  );
}
