import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand/brand";
import { ResetPasswordForm } from "@/components/landing/reset-password-form";

export const metadata: Metadata = { title: "Reset password · woli", robots: { index: false } };

/** Opened from the "forgot password" email. The token is checked when the form is sent. */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 flex flex-col items-center justify-center px-4 py-10">
      <Link href="/" aria-label="woli" className="mb-6">
        <Brand size={34} textClassName="text-xl" />
      </Link>
      <ResetPasswordForm token={typeof token === "string" ? token : ""} />
    </div>
  );
}
