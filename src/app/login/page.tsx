"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { LayoutGrid } from "lucide-react";

// Sign-in only. Accounts are created by a system administrator (Admin console);
// there is intentionally no self-service registration.
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.error) {
        toast.error("Invalid email or password, or the account is deactivated");
        setLoading(false);
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      toast.error("Something went wrong");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 p-4">
      <div className="w-full max-w-sm rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-6">
          <div className="h-8 w-8 rounded-md bg-indigo-600 flex items-center justify-center text-white">
            <LayoutGrid size={18} />
          </div>
          <span className="font-semibold text-neutral-900 dark:text-neutral-50">Basework</span>
        </div>
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50 mb-1">Sign in</h1>
        <p className="text-sm text-neutral-500 mb-5">Use the account your administrator created for you.</p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label htmlFor="email" className="text-xs font-medium text-neutral-500 mb-1 block">Email</label>
            <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@company.com" />
          </div>
          <div>
            <label htmlFor="password" className="text-xs font-medium text-neutral-500 mb-1 block">Password</label>
            <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" />
          </div>
          <Button type="submit" disabled={loading} className="w-full justify-center mt-2">
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <p className="text-xs text-neutral-400 mt-4 text-center">No account? Contact your administrator.</p>
      </div>
    </div>
  );
}
