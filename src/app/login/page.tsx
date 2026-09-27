import { redirect } from "next/navigation";

// The sign-in form lives on the home page (next to sign-up). Kept for
// NextAuth's `pages.signIn` and old bookmarks.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const { callbackUrl } = await searchParams;
  redirect(callbackUrl ? `/?auth=login&callbackUrl=${encodeURIComponent(callbackUrl)}#auth` : "/?auth=login#auth");
}
