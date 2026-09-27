"use client";
import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button onClick={() => signOut({ callbackUrl: "/login" })} className="inline-block mt-4 text-sm text-indigo-600 hover:underline">
      Sign out
    </button>
  );
}
