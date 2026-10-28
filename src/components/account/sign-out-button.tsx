"use client";
import { signOutAndUnsubscribe } from "@/components/notifications/web-push";

export function SignOutButton() {
  return (
    <button onClick={() => signOutAndUnsubscribe({ callbackUrl: "/login" })} className="inline-block mt-4 text-sm text-indigo-600 hover:underline">
      Sign out
    </button>
  );
}
